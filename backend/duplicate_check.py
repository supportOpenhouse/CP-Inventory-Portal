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

Submissions with status 'Price Rejected' or 'Rejected' no longer free the
unit entirely: an exact tower+unit match against a rejected lead is still
surfaced as a perfect match (badge kept, match_level='exact') but does NOT
auto-reject — block=False + matched_rejected=True, and the caller routes the
new submission to 'Unapproved' for admin review. An exact match against a LIVE
listing still auto-rejects as before. 'Unapproved' rows stay excluded from
matching (pending review — neither live nor rejected).

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

            # 2. Fall back to the city's default RM (its manager) from the rms table
            cur.execute(
                """
                SELECT name AS rm_name, phone AS rm_phone
                FROM rms
                WHERE LOWER(TRIM(city)) = LOWER(TRIM(%s))
                  AND COALESCE(is_active, TRUE) = TRUE
                ORDER BY COALESCE(is_manager, FALSE) DESC, id ASC
                LIMIT 1
                """,
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
        "match_details": [],
    }


# Statuses that still occupy a unit in inventory. The 2 reject statuses
# (Price Rejected, Rejected) and Unapproved free it up. Visit Completed
# means a CP has gotten this far through the pipeline — the unit is committed.
_ACTIVE_SUBMISSION_STATUSES = ("Submitted", "Offer", "Closure", "Visit Scheduled", "Visit Completed")

# Reject statuses whose unit was historically "freed up" and ignored entirely.
# Now used to still surface a perfect (exact) match against a rejected lead —
# the re-submission keeps the badge but routes to Unapproved (see check_duplicate).
_REJECTED_SUBMISSION_STATUSES = ("Rejected", "Price Rejected")


def _check_submissions(society, city, bhk_n, floor_n, tower, unit_no,
                       exclude_submission_id=None,
                       statuses=_ACTIVE_SUBMISSION_STATUSES):
    """Query the app DB submissions table for matching active submissions.

    Mirrors the properties-table matching logic: matches require society +
    bhk (digit-normalized) + floor, plus optionally tower/unit when given.

    Returns a LIST of matched submission rows (dicts with the columns needed to
    build match_details) — empty list if none / on error. Callers derive the
    boolean flag from `bool(rows)`.

    `exclude_submission_id` skips a specific row — used by the backfill so a live
    submission doesn't match itself (at submit time the row doesn't exist yet, so
    this is only relevant when re-running over historical data).
    """
    import logging
    log = logging.getLogger(__name__)

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            # Explicit IN placeholders (safer than ANY(array) across psycopg2 versions)
            status_placeholders = ",".join(["%s"] * len(statuses))

            conditions = [
                "LOWER(TRIM(society)) = LOWER(TRIM(%s))",
                "LOWER(TRIM(city)) = LOWER(TRIM(%s))",
                # BHK floored to its integer part: '2.5 BHK' -> '2', '3.5' -> '3'.
                "SUBSTRING(COALESCE(bhk::text, '') FROM '[0-9]+') = %s",
                "LOWER(TRIM(COALESCE(floor, ''))) = %s",
                f"status IN ({status_placeholders})",
            ]
            params = [society, city, bhk_n, floor_n, *statuses]

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
            if exclude_submission_id is not None:
                conditions.append("id <> %s")
                params.append(exclude_submission_id)

            sql = (
                "SELECT id, public_id, society_name, tower, unit_no, floor, bhk, sqft "
                f"FROM submissions WHERE {' AND '.join(conditions)} LIMIT 25"
            )

            try:
                cur.execute(sql, params)
                return cur.fetchall()
            except Exception as e:
                # Don't crash the whole dup-check if submissions query fails —
                # fall back to properties-only behavior.
                log.exception("[dup-check] _check_submissions failed: %s", e)
                return []
    finally:
        put_app_conn(conn)


def _check_collated_data(city, society_name, bhk_n, floor_n):
    """Query the `inventory` table (external listings, formerly collated_data,
    now in a separate DB) for a match.

    Schema has no tower/unit_no columns, so matching is on city + society +
    bedrooms + floor only — the same narrowest scope shared with
    properties/submissions. `bedrooms` is an INTEGER column here (it was TEXT
    in collated_data) so we cast it to text before digit-normalizing.

    Returns a LIST of matched inventory rows (dicts) — empty when nothing
    matches, the inventory DB isn't configured, or the query errors (fail closed
    so dup-check as a whole keeps working). Callers derive the boolean flag from
    `bool(rows)`.
    """
    import logging
    log = logging.getLogger(__name__)

    if not inventory_configured():
        return []

    conn = get_inv_conn()
    try:
        with conn.cursor() as cur:
            # Both sides get digit-only normalization for floor and bedrooms, and
            # whitespace-collapsed lower-case for society, to absorb source-side
            # formatting quirks ("18 ", "F18", "  Antriksh  Heights  ", etc.).
            # City filter is tolerant of NULL/empty because source rows often
            # don't populate city.
            sql = """
                SELECT oh_id, society, tower, unit_no, floor, bedrooms, area_sqft
                FROM inventory
                WHERE REGEXP_REPLACE(LOWER(TRIM(COALESCE(society, ''))), '\\s+', ' ', 'g')
                      = REGEXP_REPLACE(LOWER(TRIM(%s)), '\\s+', ' ', 'g')
                  AND SUBSTRING(COALESCE(bedrooms::text, '') FROM '[0-9]+') = %s
                  AND REGEXP_REPLACE(COALESCE(floor, ''),    '[^0-9]', '', 'g')
                      = REGEXP_REPLACE(%s, '[^0-9]', '', 'g')
                  AND (
                        city IS NULL
                     OR TRIM(city) = ''
                     OR LOWER(TRIM(city)) = LOWER(TRIM(%s))
                  )
                LIMIT 25
            """
            params = [society_name, bhk_n, floor_n, city]

            try:
                cur.execute(sql, params)
                rows = cur.fetchall()
                log.info(
                    "[dup-check] inventory query: city=%r society=%r bhk=%r floor=%r -> %d match(es)",
                    city, society_name, bhk_n, floor_n, len(rows),
                )
                return rows
            except Exception as e:
                # Fail closed (return []) so we don't break dup-check entirely.
                log.exception("[dup-check] _check_collated_data failed: %s", e)
                return []
    finally:
        put_inv_conn(conn)


# --- match_details helpers --------------------------------------------------

def _num(v):
    """Coerce a numeric-ish value (Decimal/int/str) to a JSON-safe number, or
    None. Whole floats become ints so areas read '1030', not '1030.0'."""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return int(f) if f.is_integer() else f


def _match_item(source: str, match: str, row: dict) -> dict:
    """Normalize a matched row from any of the three tables into the common
    match_details shape: source, match (exact/partial), id, society, tower,
    unit_no, floor, bhk, area. Handles each table's column-name differences."""
    if source == "inventory":
        _id, soc, bhk, area = row.get("oh_id"), row.get("society"), row.get("bedrooms"), row.get("area_sqft")
        tower = row.get("tower")
    elif source == "submissions":
        _id, soc, bhk, area = row.get("public_id"), row.get("society_name"), row.get("bhk"), row.get("sqft")
        tower = row.get("tower")
    else:  # properties
        _id, soc, bhk, area = row.get("uid"), row.get("society_name"), row.get("configuration"), row.get("area_sqft")
        tower = row.get("tower_no")

    def _s(v):
        return None if v is None else str(v)

    # ref_id: the numeric submissions.id of a matched *submission*, so the admin
    # UI can open that submission's side panel on click. Only submissions have a
    # viewable side panel (inventory/properties are external listings).
    ref_id = row.get("id") if source == "submissions" else None

    return {
        "source": source,
        "match": match,
        "id": _s(_id),
        "ref_id": ref_id,
        "society": _s(soc),
        "tower": _s(tower),
        "unit_no": _s(row.get("unit_no")),
        "floor": _s(row.get("floor")),
        "bhk": _s(bhk),
        "area": _num(area),
    }


def _dedup_matches(items: list) -> list:
    """Drop duplicate matched records (same source + id), preserving order."""
    seen, out = set(), []
    for it in items:
        key = (it.get("source"), it.get("id"))
        if it.get("id") is not None and key in seen:
            continue
        seen.add(key)
        out.append(it)
    return out


def check_duplicate(society, city, bhk=None, tower=None, unit_no=None,
                    floor=None, city_hint=None, cp_id=None,
                    exclude_submission_id=None):
    """
    Returns:
        {
          "match_level": "exact" | "partial" | "none",
          "block": bool,               # True => hard-block (Contact RM/Edit), False => soft warning
          "message": str,
          "details": { "society": str, "city": str },
          "collated_match": bool,
          "submissions_match": bool,
          "match_details": [ {source, match, id, society, tower, unit_no, floor, bhk, area}, ... ],
        }

    `exclude_submission_id` is forwarded to the submissions check so a row
    doesn't match itself (used by the historical backfill).
    """
    # 1. Resolve society — use the passed-in text values directly.
    if not society:
        return _no_match()

    society_name = society

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
    inventory_rows = _check_collated_data(city, society_name, bhk_n, floor_n)
    collated_match_flag = bool(inventory_rows)

    # Shared base WHERE clause — society + bhk (digit-normalized) + floor
    # `floor::text` defensive cast in case the properties column is INT.
    base_where = (
        "LOWER(TRIM(city))         = LOWER(TRIM(%s)) "
        "AND LOWER(TRIM(society_name)) = LOWER(TRIM(%s)) "
        # BHK floored to its integer part: '2.5 BHK' -> '2', '3.5' -> '3'.
        "AND SUBSTRING(COALESCE(configuration, '') FROM '[0-9]+') = %s "
        "AND LOWER(TRIM(COALESCE(floor::text, ''))) = %s "
        "AND COALESCE(is_dead, FALSE) = FALSE"
    )
    base_params = [city, society_name, bhk_n, floor_n]

    hard_block_details = {"society": society_name, "city": city}

    def _partial(submissions_hit: bool, matches: list):
        """Build a partial-match response: signal surfaced, no hard block.

        Returned when society+bhk+floor matches somewhere but we can't
        confirm a full 5-field (society+bhk+floor+tower+unit) match — either
        because the CP didn't supply both tower and unit, or because the
        inventory only has a coarser match. Caller decides what to do; the
        downstream status logic treats only match_level=='exact' as a
        perfect-match auto-reject. `matches` is the list of matched records
        persisted as submissions.match_details.
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
            "match_details": _dedup_matches(matches),
        }

    def _exact(submissions_match: bool, matches: list, block: bool = True,
               matched_rejected: bool = False):
        """Build an exact-match response: a full 5-field hit.

        block=True  → the match is against a LIVE listing; drives 'Rejected'
                      (status_reason='Duplicacy') downstream (unchanged).
        block=False + matched_rejected=True → the only exact hit is a
                      previously-REJECTED lead; the perfect-match badge is kept
                      (match_level stays 'exact') but the caller routes the new
                      submission to 'Unapproved' instead of auto-rejecting.
        `submissions_match` records whether the hit came from the submissions
        table (True) or the properties table (False). `matches` is the list of
        matched records persisted as submissions.match_details.
        """
        rm_info = _fetch_rm(city, cp_id=cp_id)
        unit_label = f"{society_name}, Tower {tower}, Unit {unit_no}"
        return {
            "match_level": "exact",
            "block": block,
            "matched_rejected": matched_rejected,
            "banner_title": (
                "Previously listed unit —\npending review" if matched_rejected
                else "This unit is already\nwith Openhouse"
            ),
            "message": (
                f"This unit ({unit_label}) matches a previously rejected listing "
                f"and will be reviewed by the Openhouse team."
                if matched_rejected else
                f"This unit ({unit_label}) is already with Openhouse. "
                f"Please contact your Openhouse representative."
            ),
            "details": {**hard_block_details, **rm_info},
            "collated_match": collated_match_flag,
            "submissions_match": submissions_match,
            "match_details": _dedup_matches(matches),
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
        prop_exact_rows = []
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
                        "SELECT uid, society_name, tower_no, unit_no, floor, configuration, area_sqft "
                        f"FROM properties WHERE {' AND '.join(conditions)} LIMIT 25",
                        params,
                    )
                    prop_exact_rows = cur.fetchall()
            finally:
                put_props_conn(pconn)

        sub_exact_rows = _check_submissions(
            society, city, bhk_n, floor_n, tower, unit_no, exclude_submission_id,
        )

        if prop_exact_rows or sub_exact_rows:
            matches = (
                [_match_item("properties", "exact", r) for r in prop_exact_rows]
                + [_match_item("submissions", "exact", r) for r in sub_exact_rows]
            )
            # Preserve prior flag semantics: submissions_match is True only when
            # the exact hit came from submissions and NOT properties.
            return _exact(
                submissions_match=bool(sub_exact_rows) and not bool(prop_exact_rows),
                matches=matches,
            )

        # No LIVE exact match — check previously-REJECTED leads. An exact
        # tower+unit hit there is still a perfect match (badge kept) but must
        # NOT auto-reject; the caller routes the new submission to Unapproved.
        rejected_exact_rows = _check_submissions(
            society, city, bhk_n, floor_n, tower, unit_no, exclude_submission_id,
            statuses=_REJECTED_SUBMISSION_STATUSES,
        )
        if rejected_exact_rows:
            return _exact(
                submissions_match=True,
                matches=[_match_item("submissions", "exact", r) for r in rejected_exact_rows],
                block=False,
                matched_rejected=True,
            )
        # Fall through: tower+unit given but no full match — may still be partial.

    # ---------- PARTIAL: society+bhk+floor matches anywhere ----------
    # Reaching here means either the CP didn't supply both tower+unit, or they
    # did but the full 5-field match missed. If anything matches at the
    # society+bhk+floor scope (properties / active submissions / collated),
    # report it as a partial signal — informational only.
    prop_partial_rows = []
    if properties_configured():
        pconn = get_props_conn()
        try:
            with pconn.cursor() as cur:
                cur.execute(
                    "SELECT uid, society_name, tower_no, unit_no, floor, configuration, area_sqft "
                    f"FROM properties WHERE {base_where} LIMIT 25",
                    base_params,
                )
                prop_partial_rows = cur.fetchall()
        finally:
            put_props_conn(pconn)

    sub_partial_rows = _check_submissions(
        society, city, bhk_n, floor_n, None, None, exclude_submission_id,
    )
    submissions_hit = bool(sub_partial_rows)

    if prop_partial_rows or submissions_hit or collated_match_flag:
        matches = (
            [_match_item("inventory", "partial", r) for r in inventory_rows]
            + [_match_item("submissions", "partial", r) for r in sub_partial_rows]
            + [_match_item("properties", "partial", r) for r in prop_partial_rows]
        )
        return _partial(submissions_hit, matches)

    result = _no_match()
    result["collated_match"] = collated_match_flag
    result["submissions_match"] = False
    return result