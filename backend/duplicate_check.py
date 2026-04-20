"""Two-tier duplicate check against the properties DB.

Tier 1 (exact):   society + tower + unit_no all match (case-insensitive, is_dead excluded)
                  -> block=True, match_level="exact"
Tier 2 (partial): society alone OR society+tower OR society+floor
                  -> block=False, match_level="partial", warning only (CP can proceed)
No match:         block=False, match_level="none"

NOTE: society_name + city must match identically (after LOWER/TRIM) between our
master societies table and the properties table. If matching reliability drops
in production, we may need a normalized_name column on societies or a
city-name mapping (e.g., 'Gurugram' <-> 'Gurgaon').
"""

from db import (
    get_app_conn,
    put_app_conn,
    get_props_conn,
    put_props_conn,
    properties_configured,
)


def _no_match():
    return {"match_level": "none", "block": False, "message": "", "details": {}}


def check_duplicate(society_id, tower=None, unit_no=None, floor=None, city_hint=None):
    """
    Returns:
        {
          "match_level": "exact" | "partial" | "none",
          "block": bool,
          "message": str,
          "details": { ... }
        }
    """
    # 1. Resolve society_id -> canonical (name, city) using the app DB
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

    # 2. If properties DB isn't configured, we can't check. Fail open.
    if not properties_configured():
        return _no_match()

    city = soc["city"]
    society_name = soc["name"]

    pconn = get_props_conn()
    try:
        with pconn.cursor() as cur:
            # ---------- Tier 1: exact match (BLOCKS) ----------
            # If the CP provided both tower AND unit_no, they're being specific.
            # An exact match is the only hard block — blocks submission outright.
            if tower and unit_no:
                cur.execute("""
                    SELECT uid, tower_no, unit_no, configuration, area_sqft,
                           demand_price, registry_status, floor
                    FROM properties
                    WHERE LOWER(TRIM(city))         = LOWER(TRIM(%s))
                      AND LOWER(TRIM(society_name)) = LOWER(TRIM(%s))
                      AND UPPER(TRIM(tower_no))     = UPPER(TRIM(%s))
                      AND UPPER(TRIM(unit_no))      = UPPER(TRIM(%s))
                      AND COALESCE(is_dead, FALSE)  = FALSE
                    LIMIT 1
                """, (city, society_name, tower, unit_no))
                exact = cur.fetchone()
                if exact:
                    return {
                        "match_level": "exact",
                        "block": True,
                        "message": (
                            f"Unit {tower}-{unit_no} at {society_name} is already "
                            f"with Openhouse. Please contact your Openhouse representative."
                        ),
                        "details": {
                            "society": society_name,
                            "city": city,
                        },
                    }
                # Full details given, no exact match — trust them, proceed with no warning.
                return _no_match()

            # ---------- Tier 2: partial matches (WARNINGS ONLY) ----------
            # The CP didn't give tower+unit together, so we can only make soft guesses.
            # We surface these as warnings — CP sees a banner but can proceed.
            # Ordered specific -> general; first hit is what we return.

            # 2a: society + tower
            if tower:
                cur.execute("""
                    SELECT COUNT(*) AS cnt
                    FROM properties
                    WHERE LOWER(TRIM(city))         = LOWER(TRIM(%s))
                      AND LOWER(TRIM(society_name)) = LOWER(TRIM(%s))
                      AND UPPER(TRIM(tower_no))     = UPPER(TRIM(%s))
                      AND COALESCE(is_dead, FALSE)  = FALSE
                """, (city, society_name, tower))
                row = cur.fetchone()
                if row and row["cnt"] > 0:
                    return {
                        "match_level": "partial",
                        "block": False,
                        "message": (
                            f"Heads up: Openhouse already has units in Tower {tower} at "
                            f"{society_name}. Double-check that this isn't a duplicate "
                            f"before submitting."
                        ),
                        "details": {
                            "society": society_name,
                            "city": city,
                        },
                    }

            # 2b: society + floor
            if floor is not None:
                try:
                    floor_int = int(str(floor).strip())
                except (ValueError, TypeError):
                    floor_int = None

                if floor_int is not None:
                    cur.execute("""
                        SELECT COUNT(*) AS cnt
                        FROM properties
                        WHERE LOWER(TRIM(city))         = LOWER(TRIM(%s))
                          AND LOWER(TRIM(society_name)) = LOWER(TRIM(%s))
                          AND floor                     = %s
                          AND COALESCE(is_dead, FALSE)  = FALSE
                    """, (city, society_name, floor_int))
                    row = cur.fetchone()
                    if row and row["cnt"] > 0:
                        return {
                            "match_level": "partial",
                            "block": False,
                            "message": (
                                f"Heads up: Openhouse already has units on floor "
                                f"{floor_int} at {society_name}. Double-check that this "
                                f"isn't a duplicate before submitting."
                            ),
                            "details": {
                                "society": society_name,
                                "city": city,
                            },
                        }

            # 2c: society only
            cur.execute("""
                SELECT COUNT(*) AS cnt
                FROM properties
                WHERE LOWER(TRIM(city))         = LOWER(TRIM(%s))
                  AND LOWER(TRIM(society_name)) = LOWER(TRIM(%s))
                  AND COALESCE(is_dead, FALSE)  = FALSE
            """, (city, society_name))
            row = cur.fetchone()
            if row and row["cnt"] > 0:
                return {
                    "match_level": "partial",
                    "block": False,
                    "message": (
                        f"Heads up: Openhouse already has units in {society_name}. "
                        f"Double-check that this isn't a duplicate before submitting."
                    ),
                    "details": {
                        "society": society_name,
                        "city": city,
                    },
                }
    finally:
        put_props_conn(pconn)

    return _no_match()