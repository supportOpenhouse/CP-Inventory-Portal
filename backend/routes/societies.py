"""Society search + per-society inventory — sourced from the properties DB.

The society dropdown and the per-society tower/unit inventory both read from the
properties DB now: `master_societies` is the source of truth for the society
list, and `properties` supplies the tower/unit/config data. Nothing here touches
the app DB `societies` table anymore.

NOTE: this makes the (optional) properties DB a hard dependency for the Step-1
society picker — if it's unconfigured/unreachable the dropdown returns empty.
"""

from flask import Blueprint, g, jsonify, request

from auth import require_auth
from db import (
    get_props_conn,
    put_props_conn,
    properties_configured,
)

bp = Blueprint("societies", __name__, url_prefix="/api/societies")


@bp.get("")
@require_auth
def list_societies():
    """Search/list societies from master_societies (properties DB).

    Admin sees all cities by default. CPs see their own city (from the JWT
    `city` claim) by default UNLESS a `city` query param is provided
    (e.g. 'Gurgaon', 'Noida', 'Ghaziabad') — the Step 1 city dropdown lets a
    CP pick any serviceable city.
    """
    search = (request.args.get("search") or "").strip()
    city_override = (request.args.get("city") or "").strip()
    try:
        limit = min(max(int(request.args.get("limit", 20)), 1), 50)
    except (ValueError, TypeError):
        limit = 20

    if not properties_configured():
        return jsonify({"societies": []}), 200

    user = g.user
    # City scope: explicit pick wins; else non-admins default to their own city
    # (from the JWT). A non-admin with no city context has nothing to show.
    city_name = city_override or (None if user.get("is_admin") else (user.get("city") or None))
    if not user.get("is_admin") and not city_name:
        return jsonify({"societies": []}), 200

    conditions = []
    params = []
    if search:
        conditions.append("society_name ILIKE %s")
        params.append(f"%{search}%")
    if city_name:
        conditions.append("LOWER(TRIM(city)) = LOWER(TRIM(%s))")
        params.append(city_name)

    where_clause = (" WHERE " + " AND ".join(conditions)) if conditions else ""
    sql = f"""
        SELECT id, society_name AS name, locality, city
        FROM master_societies
        {where_clause}
        ORDER BY society_name
        LIMIT %s
    """
    params.append(limit)

    conn = get_props_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
        return jsonify({"societies": rows}), 200
    finally:
        put_props_conn(conn)


@bp.get("/<int:society_id>/inventory")
@require_auth
def society_inventory(society_id: int):
    """Return tower/unit/config data for a society, all from the properties DB.

    Response shape matches the JSX's `selectedSocietyData`:
        {
          "society": { id, name, city, locality },
          "towers": { "A1": { "01": 2480, "02": 2480, ... }, "B1": {...} },
          "configs": ["2BHK", "3BHK", ...]
        }
    """
    if not properties_configured():
        return jsonify({"error": "Properties DB not configured"}), 503

    towers: dict[str, dict[str, int]] = {}
    configs: set[str] = set()

    conn = get_props_conn()
    try:
        with conn.cursor() as cur:
            # Society master record (id/name/city/locality) from master_societies
            cur.execute("""
                SELECT id, society_name AS name, locality, city
                FROM master_societies
                WHERE id = %s
            """, (society_id,))
            soc = cur.fetchone()
            if not soc:
                return jsonify({"error": "Society not found"}), 404

            # Towers + unit-suffix -> area, from the properties listings
            cur.execute("""
                SELECT
                    UPPER(TRIM(tower_no)) AS tower,
                    RIGHT(
                        REGEXP_REPLACE(COALESCE(unit_no, ''), '[^0-9]', '', 'g'),
                        2
                    ) AS suffix,
                    MAX(area_sqft) AS area,
                    MAX(configuration) AS config
                FROM properties
                WHERE LOWER(TRIM(city))         = LOWER(TRIM(%s))
                  AND LOWER(TRIM(society_name)) = LOWER(TRIM(%s))
                  AND tower_no IS NOT NULL AND TRIM(tower_no) <> ''
                  AND COALESCE(is_dead, FALSE) = FALSE
                GROUP BY
                    UPPER(TRIM(tower_no)),
                    RIGHT(
                        REGEXP_REPLACE(COALESCE(unit_no, ''), '[^0-9]', '', 'g'),
                        2
                    )
            """, (soc["city"], soc["name"]))
            for row in cur.fetchall():
                t = row["tower"]
                s = row["suffix"] or ""
                towers.setdefault(t, {})
                if s and row["area"]:
                    towers[t][s] = int(row["area"])
                if row["config"]:
                    # Normalize "2 BHK" / "2BHK" / "2bhk" -> "2BHK"
                    configs.add(row["config"].strip().upper().replace(" ", ""))
    finally:
        put_props_conn(conn)

    return jsonify({
        "society": soc,
        "towers": towers,
        "configs": sorted(configs),
    }), 200
