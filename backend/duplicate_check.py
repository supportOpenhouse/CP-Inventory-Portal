"""Duplicate check against the properties DB and the submissions table.

Matching sources for an EXACT (perfect-match) block — only these two
count, because they're the only sources with tower/unit columns:
  1. properties (ground truth from LSQ + legacy — in Properties DB)
  2. submissions (active CP portal submissions — in app DB,
     status NOT IN ('Price Rejected', 'Rejected', 'Unapproved'))

A third source, the `inventory` table (external listings like 99acres,
formerly collated_data, now in a separate Inventory DB), has no
tower/unit columns so it can match at most at society+bhk+floor. It is
checked and exposed as `collated_match` on the response, but it never
drives an exact-match block on its own — that would falsely flag the
CP's specific unit just because some other unit on the same floor was
seen by an external source.

Matching fields:
  society (required) + bhk + floor + optionally tower + optionally unit_no

Decision table:
  CP inputs                                     Match found?        Result
  ────────────────────────────────────────────  ─────────────────   ─────────────────────────────
  society+bhk+floor+tower+unit                  full exact match    EXACT block (Rejected, reason='Duplicacy')
  society+bhk+floor+tower+unit                  soc+bhk+floor only  PARTIAL (informational, no block)
  society+bhk+floor+tower (no unit)             any match           PARTIAL (informational, no block)
  society+bhk+floor+unit (no tower)             any match           PARTIAL (informational, no block)
  society+bhk+floor (no tower/unit)             any match           PARTIAL (informational, no block)
  any input                                     no match            none

EXACT match (match_level='exact', block=True) requires the CP to supply
BOTH tower AND unit_no AND for a matching row in properties or submissions
to share society+bhk+floor+tower+unit. This is the only path that drives
"Rejected" status (with status_reason='Duplicacy') downstream. If either tower or unit_no is
missing on the CP side — or the inventory has only a coarser match — the
result is reported as 'partial': the dup signal is surfaced (collated_match
/ submissions_match flags, banner copy) but block=False so callers route
the submission through the normal path instead of auto-rejecting.

BHK is normalized by stripping "BHK" and matching digits only:
  "2 BHK" -> "2", "2BHK" -> "2", "2" -> "2"
Properties DB stores config as "2 BHK" etc; submissions stores bhk as "2 BHK" etc.
We normalize both sides.

Submissions with status 'Price Rejected' or 'Rejected' are ignored
(freed up for other CPs).

If the properties DB isn't configured, only that source is skipped — the
submissions check (app DB) still runs, as does the inventory check when the
Inventory DB is configured (both fail open/closed independently).
"""

import re

from db import (
    get_app_conn,
    put_app_conn,
    get_props_conn,
    put_props_conn,
    properties_configured,
    get_inv_conn,
    put_inv_conn,
    inventory_configured,
)

_BHK_DIGIT_RE = re.compile(r"(\d+)")


def _norm_bhk(value) -> str | None:
    """Strip 'BHK' and return just the digit count. '2 BHK' -> '2'."""
    if value is None:
        return None
    m = _BHK_DIGIT_RE.search(str(value))
    return m.group(1) if m else None


def _norm_floor(value):
    """Normalize floor to lowercase trimmed string. Empty / None -> None.

    Floors are categorical text in this codebase ('Middle', 'Lower', 'Ground',
    'B1', 'F1') AND numeric ('1', '5'). Return a string in all cases so SQL
    comparisons against the VARCHAR column match by value, not type.
    Previously this returned int(), which silently broke dup-check:
      - numeric input: SQL `varchar = integer` raised UndefinedFunction (caught)
      - text input:    raised ValueError, returned None, exited early
    """
    if value is None:
        return None
    s = str(value).strip().lower()
    return s if s else None


def _fetch_rm(city_name: str, cp_id=None):
    """Look up RM contact info.

    Priority:
      1. If cp_id given and that CP has an assigned rm_id, return that RM.
      2. Otherwise fall back to the city-level default RM.

    Returns {} if nothing matches.
    """
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            # 1. Try CP's assigned RM from the rms table
            if cp_id is not None:
                cur.execute("""
                    SELECT r.name AS rm_name, r.phone AS rm_phone
                    FROM channel_partners cp
                    JOIN rms r ON cp.rm_id = r.id AND r.is_active
                    WHERE cp.id = %s
                """, (cp_id,))
                row = cur.fetchone()
                if row and row.get("rm_phone"):
                    return {
                        "rm_name": row["rm_name"],
                        "rm_phone": row["rm_phone"],
                    }

            # 2. Fall back to city-level RM
            cur.execute(
                "SELECT rm_name, rm_phone FROM cities WHERE LOWER(TRIM(name)) = LOWER(TRIM(%s))",
                (city_name,),
            )
            row = cur.fetchone()
            if not row:
                return {}
            return {
                "rm_name": row["rm_name"],
                "rm_phone": row["rm_phone"],
            }
    finally:
        put_app_conn(conn)


def _no_match():
    return {
        "match_level": "none",
        "block": False,
        "message": "",
        "details": {},
        "collated_match": False,
        "submissions_match": False,
    }


# Statuses that still occupy a unit in inventory. The 2 reject statuses
# (Price Rejected, Rejected) and Unapproved free it up. Visit Completed
# means a CP has gotten this far through the pipeline — the unit is committed.
_ACTIVE_SUBMISSION_STATUSES = ("Submitted", "Offer", "Closure", "Visit Scheduled", "Visit Completed")


def _check_submissions(society_id, bhk_n, floor_n, tower, unit_no):
    """Query the app DB submissions table for a matching active submission.

    Mirrors the properties-table matching logic: matches require society +
    bhk (digit-normalized) + floor, plus optionally tower/unit when given.

    Returns True if any active, non-rejected submission matches; False otherwise.
    """
    import logging
    log = logging.getLogger(__name__)

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            # Explicit IN placeholders (safer than ANY(array) across psycopg2 versions)
            status_placeholders = ",".join(["%s"] * len(_ACTIVE_SUBMISSION_STATUSES))

            conditions = [
                "society_id = %s",
                "REGEXP_REPLACE(COALESCE(bhk, ''), '[^0-9]', '', 'g') = %s",
                "LOWER(TRIM(COALESCE(floor, ''))) = %s",
                f"status IN ({status_placeholders})",
            ]
            params = [society_id, bhk_n, floor_n, *_ACTIVE_SUBMISSION_STATUSES]

            if tower:
                # Strip leading zeros from both sides so "02" matches "2", "0A2" matches "A2" etc.
                conditions.append(
                    "UPPER(TRIM(REGEXP_REPLACE(COALESCE(tower, ''), '^0+', ''))) "
                    "= UPPER(TRIM(REGEXP_REPLACE(%s, '^0+', '')))"
                )
                params.append(tower)
            if unit_no:
                # Same: leading-zero insensitive match. "071" == "71", "071A" == "71A".
                conditions.append(
                    "UPPER(TRIM(REGEXP_REPLACE(COALESCE(unit_no, ''), '^0+', ''))) "
                    "= UPPER(TRIM(REGEXP_REPLACE(%s, '^0+', '')))"
                )
                params.append(unit_no)

            sql = f"SELECT 1 FROM submissions WHERE {' AND '.join(conditions)} LIMIT 1"

            try:
                cur.execute(sql, params)
                return cur.fetchone() is not None
            except Exception as e:
                # Don't crash the whole dup-check if submissions query fails —
                # fall back to properties-only behavior.
                log.exception("[dup-check] _check_submissions failed: %s", e)
                return False
    finally:
        put_app_conn(conn)


def _check_collated_data(city, society_name, bhk_n, floor_n):
    """Query the `inventory` table (external listings, formerly collated_data,
    now in a separate DB) for a match.

    Schema has no tower/unit_no columns, so matching is on city + society +
    bedrooms + floor only — the same narrowest scope shared with
    properties/submissions. `bedrooms` is an INTEGER column here (it was TEXT
    in collated_data) so we cast it to text before digit-normalizing.

    Returns True if any inventory row matches; False otherwise (also False when
    the inventory DB isn't configured/reachable — fail closed so dup-check as a
    whole keeps working).
    """
    import logging
    log = logging.getLogger(__name__)

    if not inventory_configured():
        return False

    conn = get_inv_conn()
    try:
        with conn.cursor() as cur:
            # Both sides get digit-only normalization for floor and bedrooms, and
            # whitespace-collapsed lower-case for society, to absorb source-side
            # formatting quirks ("18 ", "F18", "  Antriksh  Heights  ", etc.).
            # City filter is tolerant of NULL/empty because source rows often
            # don't populate city.
            sql = """
                SELECT 1 FROM inventory
                WHERE REGEXP_REPLACE(LOWER(TRIM(COALESCE(society, ''))), '\\s+', ' ', 'g')
                      = REGEXP_REPLACE(LOWER(TRIM(%s)), '\\s+', ' ', 'g')
                  AND REGEXP_REPLACE(COALESCE(bedrooms::text, ''), '[^0-9]', '', 'g') = %s
                  AND REGEXP_REPLACE(COALESCE(floor, ''),    '[^0-9]', '', 'g')
                      = REGEXP_REPLACE(%s, '[^0-9]', '', 'g')
                  AND (
                        city IS NULL
                     OR TRIM(city) = ''
                     OR LOWER(TRIM(city)) = LOWER(TRIM(%s))
                  )
                LIMIT 1
            """
            params = [society_name, bhk_n, floor_n, city]

            try:
                cur.execute(sql, params)
                hit = cur.fetchone() is not None
                log.info(
                    "[dup-check] inventory query: city=%r society=%r bhk=%r floor=%r -> match=%s",
                    city, society_name, bhk_n, floor_n, hit,
                )
                return hit
            except Exception as e:
                # Fail closed (return False) so we don't break dup-check entirely.
                log.exception("[dup-check] _check_collated_data failed: %s", e)
                return False
    finally:
        put_inv_conn(conn)


def check_duplicate(society_id, bhk=None, tower=None, unit_no=None,
                    floor=None, city_hint=None, cp_id=None):
    """
    Returns:
        {
          "match_level": "exact" | "partial" | "none",
          "block": bool,               # True => hard-block (Contact RM/Edit), False => soft warning
          "message": str,
          "details": { "society": str, "city": str }
        }
    """
    # 1. Resolve society
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT s.id, s.name, c.name AS city
                FROM societies s
                JOIN cities c ON s.city_id = c.id
                WHERE s.id = %s
            """, (society_id,))
            soc = cur.fetchone()
    finally:
        put_app_conn(conn)

    if not soc:
        return _no_match()

    city = soc["city"]
    society_name = soc["name"]

    bhk_n = _norm_bhk(bhk)
    floor_n = _norm_floor(floor)

    # BHK + floor are required for any meaningful duplicate signal.
    # Without them, we can't narrow the search enough to be useful,
    # so fail open rather than flood CPs with weak warnings.
    if bhk_n is None or floor_n is None:
        return _no_match()

    # Compute inventory match up-front and surface it on every response.
    # inventory has no tower/unit columns, so it can only match at the
    # society+bhk+floor level. We expose this flag even when the final block
    # decision is "no" — the admin UI uses it to highlight Unapproved
    # submissions that came through the "submit without unit details" path.
    collated_match_flag = _check_collated_data(city, society_name, bhk_n, floor_n)

    # Shared base WHERE clause — society + bhk (digit-normalized) + floor
    # `floor::text` defensive cast in case the properties column is INT.
    base_where = (
        "LOWER(TRIM(city))         = LOWER(TRIM(%s)) "
        "AND LOWER(TRIM(society_name)) = LOWER(TRIM(%s)) "
        "AND REGEXP_REPLACE(COALESCE(configuration, ''), '[^0-9]', '', 'g') = %s "
        "AND LOWER(TRIM(COALESCE(floor::text, ''))) = %s "
        "AND COALESCE(is_dead, FALSE) = FALSE"
    )
    base_params = [city, society_name, bhk_n, floor_n]

    hard_block_details = {"society": society_name, "city": city}

    def _partial(submissions_hit: bool):
        """Build a partial-match response: signal surfaced, no hard block.

        Returned when society+bhk+floor matches somewhere but we can't
        confirm a full 5-field (society+bhk+floor+tower+unit) match — either
        because the CP didn't supply both tower and unit, or because the
        inventory only has a coarser match. Caller decides what to do; the
        downstream status logic treats only match_level=='exact' as a
        perfect-match auto-reject.
        """
        rm_info = _fetch_rm(city, cp_id=cp_id)
        return {
            "match_level": "partial",
            "block": False,
            "banner_title": "Similar unit may\nbe with Openhouse",
            "message": (
                f"A {bhk_n} BHK unit on floor {floor_n} at {society_name} "
                f"may already be with Openhouse."
            ),
            "details": {**hard_block_details, **rm_info},
            "collated_match": collated_match_flag,
            "submissions_match": submissions_hit,
        }

    def _exact(submissions_match: bool):
        """Build an exact-match response: a full 5-field hit, hard block.

        This is the only result that drives 'Rejected' (status_reason='Duplicacy') downstream.
        `submissions_match` records whether the hit came from the submissions
        table (True) or the properties table (False).
        """
        rm_info = _fetch_rm(city, cp_id=cp_id)
        unit_label = f"{society_name}, Tower {tower}, Unit {unit_no}"
        return {
            "match_level": "exact",
            "block": True,
            "banner_title": "This unit is already\nwith Openhouse",
            "message": (
                f"This unit ({unit_label}) is already with Openhouse. "
                f"Please contact your Openhouse representative."
            ),
            "details": {**hard_block_details, **rm_info},
            "collated_match": collated_match_flag,
            "submissions_match": submissions_match,
        }

    # ---------- EXACT BLOCK: requires CP to supply BOTH tower AND unit ----------
    # Only a full 5-field match (society+bhk+floor+tower+unit) qualifies as an
    # exact/perfect match. Anything coarser falls through to the partial path.
    # Exact is the only result that drives 'Rejected' (status_reason='Duplicacy').
    #
    # The two sources are checked independently: properties only when the
    # optional properties DB is configured, submissions always (app DB) —
    # so CP-to-CP matching works even with no properties DB.
    if tower and unit_no:
        if properties_configured():
            pconn = get_props_conn()
            try:
                with pconn.cursor() as cur:
                    conditions = [
                        base_where,
                        "UPPER(TRIM(REGEXP_REPLACE(COALESCE(tower_no, ''), '^0+', ''))) "
                        "= UPPER(TRIM(REGEXP_REPLACE(%s, '^0+', '')))",
                        "UPPER(TRIM(REGEXP_REPLACE(COALESCE(unit_no, ''), '^0+', ''))) "
                        "= UPPER(TRIM(REGEXP_REPLACE(%s, '^0+', '')))",
                    ]
                    params = [*base_params, tower, unit_no]
                    cur.execute(
                        f"SELECT uid FROM properties WHERE {' AND '.join(conditions)} LIMIT 1",
                        params,
                    )
                    properties_exact_hit = cur.fetchone() is not None
            finally:
                put_props_conn(pconn)

            if properties_exact_hit:
                return _exact(submissions_match=False)

        if _check_submissions(society_id, bhk_n, floor_n, tower, unit_no):
            return _exact(submissions_match=True)
        # Fall through: tower+unit given but no full match — may still be partial.

    # ---------- PARTIAL: society+bhk+floor matches anywhere ----------
    # Reaching here means either the CP didn't supply both tower+unit, or they
    # did but the full 5-field match missed. If anything matches at the
    # society+bhk+floor scope (properties / active submissions / collated),
    # report it as a partial signal — informational only.
    properties_hit = False
    if properties_configured():
        pconn = get_props_conn()
        try:
            with pconn.cursor() as cur:
                cur.execute(
                    f"SELECT 1 FROM properties WHERE {base_where} LIMIT 1",
                    base_params,
                )
                properties_hit = cur.fetchone() is not None
        finally:
            put_props_conn(pconn)

    submissions_hit = _check_submissions(society_id, bhk_n, floor_n, None, None)

    if properties_hit or submissions_hit or collated_match_flag:
        return _partial(submissions_hit)

    result = _no_match()
    result["collated_match"] = collated_match_flag
    result["submissions_match"] = False
    return result