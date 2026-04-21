"""Duplicate check against the properties DB.

Matching fields:
  society (required) + bhk + floor + optionally tower + optionally unit_no

Decision table:
  CP inputs                                     Match found?        Result
  ────────────────────────────────────────────  ─────────────────   ──────────────────
  society+bhk+floor (no tower/unit)             soc+bhk+floor       BLOCK "already exists"
  society+bhk+floor (no tower/unit)             no match            proceed
  society+bhk+floor+tower (no unit)             soc+bhk+floor+tower BLOCK "already exists"
  society+bhk+floor+tower (no unit)             no finer match      proceed
  society+bhk+floor+unit (no tower)             soc+bhk+floor+unit  BLOCK "already exists"
  society+bhk+floor+unit (no tower)             no finer match      proceed
  society+bhk+floor+tower+unit                  full exact match    BLOCK "already exists"
  society+bhk+floor+tower+unit                  partial only        proceed

Every duplicate hit is a hard block with Contact RM + Edit buttons.
There is no soft-warning / Continue Anyway path.

BHK is normalized by stripping "BHK" and matching digits only:
  "2 BHK" -> "2", "2BHK" -> "2", "2" -> "2"
Properties DB stores config as e.g. "2 BHK" or "2BHK" — we normalize both sides.

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


def _fetch_rm(city_name: str):
    """Look up RM phone/name for a city. Returns {} if not found."""
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
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


def check_duplicate(society_id, bhk=None, tower=None, unit_no=None,
                    floor=None, city_hint=None):
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
                    rm_info = _fetch_rm(city)
                    return {
                        "match_level": "exact",
                        "block": True,
                        "message": (
                            f"This unit ({unit_label}) is already with Openhouse. "
                            f"Please contact your Openhouse representative."
                        ),
                        "details": {**hard_block_details, **rm_info},
                    }
                # No narrower match — CP proceeds even if society+bhk+floor matches
                # (the tower/unit they gave rules out the existing records).
                return _no_match()

            # ---------- SOFT WARNING: society+bhk+floor only ----------
            # ---------- HARD BLOCK: society+bhk+floor match (no tower/unit given) ----------
            # Per spec, this is treated the same as an exact match — "already in inventory"
            # with Contact RM + Edit buttons. No soft warning / Continue Anyway.
            cur.execute(
                f"SELECT COUNT(*) AS cnt FROM properties WHERE {base_where}",
                base_params,
            )
            row = cur.fetchone()
            if row and row["cnt"] > 0:
                rm_info = _fetch_rm(city)
                return {
                    "match_level": "exact",
                    "block": True,
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
