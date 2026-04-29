"""Duplicate check against the properties DB and the submissions table.

Matching sources (both checked, either match blocks):
  1. properties (ground truth from LSQ + legacy — in Properties DB)
  2. submissions (active CP portal submissions — in app DB,
     status NOT IN ('Price Rejected', 'Duplicate Rejected', 'Unapproved'))

Matching fields:
  society (required) + bhk + floor + optionally tower + optionally unit_no

Decision table (applies to BOTH sources):
  CP inputs                                     Match found?        Result
  ────────────────────────────────────────────  ─────────────────   ──────────────────
  society+bhk+floor (no tower/unit)             soc+bhk+floor       BLOCK "floor already has unit"
  society+bhk+floor (no tower/unit)             no match            proceed
  society+bhk+floor+tower (no unit)             soc+bhk+floor+tower BLOCK "unit already exists"
  society+bhk+floor+tower (no unit)             no finer match      proceed
  society+bhk+floor+unit (no tower)             soc+bhk+floor+unit  BLOCK "unit already exists"
  society+bhk+floor+unit (no tower)             no finer match      proceed
  society+bhk+floor+tower+unit                  full exact match    BLOCK "unit already exists"
  society+bhk+floor+tower+unit                  partial only        proceed

Every duplicate hit is a hard block with Contact RM + Edit buttons.
There is no soft-warning / Continue Anyway path.

BHK is normalized by stripping "BHK" and matching digits only:
  "2 BHK" -> "2", "2BHK" -> "2", "2" -> "2"
Properties DB stores config as "2 BHK" etc; submissions stores bhk as "2 BHK" etc.
We normalize both sides.

Submissions with status 'Price Rejected' or 'Duplicate Rejected' are ignored
(freed up for other CPs).

If properties DB isn't configured, we fail open (no match).
"""

import re

from db import (
    get_app_conn,
    put_app_conn,
    get_props_conn,
    put_props_conn,
    properties_configured,
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


# Statuses that still occupy a unit in inventory. The 3 reject statuses
# (Price Rejected, Duplicate Rejected) and Unapproved free it up. Visit Completed
# means a CP has gotten this far through the pipeline — the unit is committed.
_ACTIVE_SUBMISSION_STATUSES = ("Submitted", "Offer Given", "Visit Scheduled", "Visit Completed")


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
    """Query the collated_data table (external-source scraper listings) for a match.

    Schema has no tower/unit_no columns, so matching is on city + society + bedrooms
    + floor only — the same narrowest scope shared with properties/submissions.

    Returns True if any collated row matches; False otherwise.
    """
    import logging
    log = logging.getLogger(__name__)

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            # Both sides get digit-only normalization for floor and bedrooms, and
            # whitespace-collapsed lower-case for society, to absorb scraper-side
            # formatting quirks ("18 ", "F18", "  Antriksh  Heights  ", etc.).
            # City filter is tolerant of NULL/empty because scraped rows often
            # don't populate city.
            sql = """
                SELECT 1 FROM collated_data
                WHERE REGEXP_REPLACE(LOWER(TRIM(COALESCE(society, ''))), '\\s+', ' ', 'g')
                      = REGEXP_REPLACE(LOWER(TRIM(%s)), '\\s+', ' ', 'g')
                  AND REGEXP_REPLACE(COALESCE(bedrooms, ''), '[^0-9]', '', 'g') = %s
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
                    "[dup-check] collated_data query: city=%r society=%r bhk=%r floor=%r -> match=%s",
                    city, society_name, bhk_n, floor_n, hit,
                )
                return hit
            except Exception as e:
                # Likely cause: collated_data table doesn't exist yet.
                # Fail closed (return False) so we don't break dup-check entirely.
                log.exception("[dup-check] _check_collated_data failed: %s", e)
                return False
    finally:
        put_app_conn(conn)


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

    if not properties_configured():
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

    # Compute collated_data match up-front and surface it on every response.
    # collated_data has no tower/unit columns, so it can only match at the
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
    unit_label = society_name
    if tower:
        unit_label += f", Tower {tower}"
    if unit_no:
        unit_label += f", Unit {unit_no}"

    pconn = get_props_conn()
    try:
        with pconn.cursor() as cur:
            # ---------- HARD BLOCK: society+bhk+floor + (tower AND/OR unit) ----------
            if tower or unit_no:
                conditions = [base_where]
                params = list(base_params)

                if tower:
                    conditions.append(
                        "UPPER(TRIM(REGEXP_REPLACE(COALESCE(tower_no, ''), '^0+', ''))) "
                        "= UPPER(TRIM(REGEXP_REPLACE(%s, '^0+', '')))"
                    )
                    params.append(tower)
                if unit_no:
                    conditions.append(
                        "UPPER(TRIM(REGEXP_REPLACE(COALESCE(unit_no, ''), '^0+', ''))) "
                        "= UPPER(TRIM(REGEXP_REPLACE(%s, '^0+', '')))"
                    )
                    params.append(unit_no)

                sql = (
                    "SELECT uid FROM properties "
                    f"WHERE {' AND '.join(conditions)} "
                    "LIMIT 1"
                )
                cur.execute(sql, params)
                hit = cur.fetchone()

                if hit:
                    rm_info = _fetch_rm(city, cp_id=cp_id)
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
                        "submissions_match": False,  # properties hit, not submissions
                    }

                # Not in properties — also check pending submissions from all CPs
                if _check_submissions(society_id, bhk_n, floor_n, tower, unit_no):
                    rm_info = _fetch_rm(city, cp_id=cp_id)
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
                        "submissions_match": True,  # ← submissions_hit drove this block
                    }

                # External-scraper match (99acres etc.) — collated_data has no tower/unit,
                # so this match is at society+bhk+floor only. Pessimistically blocks:
                # a scraped listing on the same floor could be the same unit.
                if collated_match_flag:
                    rm_info = _fetch_rm(city, cp_id=cp_id)
                    return {
                        "match_level": "exact",
                        "block": True,
                        "banner_title": "This unit is already\nwith Openhouse",
                        "message": (
                            f"This unit ({unit_label}) is already with Openhouse. "
                            f"Please contact your Openhouse representative."
                        ),
                        "details": {**hard_block_details, **rm_info},
                        "collated_match": True,
                        "submissions_match": False,
                    }

                # No narrower match in any source — CP proceeds
                result = _no_match()
                result["collated_match"] = collated_match_flag
                result["submissions_match"] = False
                return result

            # ---------- HARD BLOCK: society+bhk+floor match (no tower/unit given) ----------
            # Per spec, this is treated the same as an exact match — "already in inventory"
            # with Contact RM + Edit buttons. No soft warning / Continue Anyway.
            cur.execute(
                f"SELECT COUNT(*) AS cnt FROM properties WHERE {base_where}",
                base_params,
            )
            row = cur.fetchone()
            properties_hit = bool(row and row["cnt"] > 0)

            # Also check pending submissions from all CPs
            submissions_hit = _check_submissions(society_id, bhk_n, floor_n, None, None)

            if properties_hit or submissions_hit or collated_match_flag:
                rm_info = _fetch_rm(city, cp_id=cp_id)
                return {
                    "match_level": "exact",
                    "block": True,
                    "banner_title": "A unit on this floor\nis already with Openhouse",
                    "message": (
                        f"A {bhk_n} BHK unit on floor {floor_n} at {society_name} "
                        f"is already with Openhouse. Please contact your Openhouse "
                        f"representative."
                    ),
                    "details": {**hard_block_details, **rm_info},
                    "collated_match": collated_match_flag,
                    "submissions_match": submissions_hit,
                }
    finally:
        put_props_conn(pconn)

    result = _no_match()
    result["collated_match"] = collated_match_flag
    result["submissions_match"] = False
    return result