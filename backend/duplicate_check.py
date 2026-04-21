"""Duplicate check against the properties DB and the submissions table.

Matching sources (both checked, either match blocks):
  1. properties (ground truth from LSQ + legacy — in Properties DB)
  2. submissions (active CP portal submissions — in app DB, status != 'Rejected')

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

Submissions with status 'Rejected' are ignored (freed up for other CPs).

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
    """Coerce floor string to int. Returns None if unparseable."""
    if value is None or value == "":
        return None
    try:
        return int(str(value).strip())
    except (ValueError, TypeError):
        return None


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
    return {"match_level": "none", "block": False, "message": "", "details": {}}


# Statuses that still occupy a unit in inventory. Rejected submissions free it up.
_ACTIVE_SUBMISSION_STATUSES = ("Submitted", "Evaluation", "Offer Given", "Visit Scheduled")


def _check_submissions(society_id, bhk_n, floor_n, tower, unit_no):
    """Query the app DB submissions table for a matching active submission.

    Mirrors the properties-table matching logic: matches require society +
    bhk (digit-normalized) + floor, plus optionally tower/unit when given.

    Returns True if any active, non-rejected submission matches; False otherwise.
    """
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            conditions = [
                "society_id = %s",
                "REGEXP_REPLACE(COALESCE(bhk, ''), '[^0-9]', '', 'g') = %s",
                "floor = %s",
                "status = ANY(%s)",
            ]
            params = [
                society_id,
                bhk_n,
                floor_n,
                list(_ACTIVE_SUBMISSION_STATUSES),
            ]

            if tower:
                conditions.append("UPPER(TRIM(COALESCE(tower, ''))) = UPPER(TRIM(%s))")
                params.append(tower)
            if unit_no:
                conditions.append("UPPER(TRIM(COALESCE(unit_no, ''))) = UPPER(TRIM(%s))")
                params.append(unit_no)

            sql = f"SELECT 1 FROM submissions WHERE {' AND '.join(conditions)} LIMIT 1"
            cur.execute(sql, params)
            return cur.fetchone() is not None
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

    # Shared base WHERE clause — society + bhk (digit-normalized) + floor
    base_where = (
        "LOWER(TRIM(city))         = LOWER(TRIM(%s)) "
        "AND LOWER(TRIM(society_name)) = LOWER(TRIM(%s)) "
        "AND REGEXP_REPLACE(COALESCE(configuration, ''), '[^0-9]', '', 'g') = %s "
        "AND floor                   = %s "
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
                    conditions.append("UPPER(TRIM(tower_no)) = UPPER(TRIM(%s))")
                    params.append(tower)
                if unit_no:
                    conditions.append("UPPER(TRIM(unit_no)) = UPPER(TRIM(%s))")
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
                    }

                # No narrower match in either source — CP proceeds
                return _no_match()

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

            if properties_hit or submissions_hit:
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
                }
    finally:
        put_props_conn(pconn)

    return _no_match()