"""Society search + per-society inventory (towers, units, configs) from properties DB."""

from flask import Blueprint, g, jsonify, request

from auth import require_auth
from db import (
    get_app_conn,
    put_app_conn,
    get_props_conn,
    put_props_conn,
    properties_configured,
)

bp = Blueprint("societies", __name__, url_prefix="/api/societies")


@bp.get("")
@require_auth
def list_societies():
    """Search/list societies. Admin sees all cities; others only their own city."""
    search = (request.args.get("search") or "").strip()
    try:
        limit = min(max(int(request.args.get("limit", 20)), 1), 50)
    except (ValueError, TypeError):
        limit = 20

    user = g.user
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            city_ids = None  # None = no filter (admin)
            if not user["is_admin"]:
                cur.execute(
                    "SELECT city_id FROM channel_partners WHERE id = %s",
                    (user["cp_id"],),
                )
                row = cur.fetchone()
                if not row or row["city_id"] is None:
                    return jsonify({"societies": []}), 200
                city_ids = [row["city_id"]]

            conditions = []
            params = []
            if search:
                conditions.append("s.name ILIKE %s")
                params.append(f"%{search}%")
            if city_ids is not None:
                conditions.append("s.city_id = ANY(%s)")
                params.append(city_ids)

            where_clause = (" WHERE " + " AND ".join(conditions)) if conditions else ""
            sql = f"""
                SELECT s.id, s.name, s.locality, c.name AS city
                FROM societies s
                JOIN cities c ON s.city_id = c.id
                {where_clause}
                ORDER BY s.name
                LIMIT %s
            """
            params.append(limit)
            cur.execute(sql, params)
            rows = cur.fetchall()
        return jsonify({"societies": rows}), 200
    finally:
        put_app_conn(conn)


@bp.get("/<int:society_id>/inventory")
@require_auth
def society_inventory(society_id: int):
    """Return tower/unit/config data for a society, sourced from the properties DB.

    Response shape matches the JSX's `selectedSocietyData`:
        {
          "society": { id, name, city, locality },
          "towers": { "A1": { "01": 2480, "02": 2480, ... }, "B1": {...} },
          "configs": ["2BHK", "3BHK", ...]
        }
    """
    # Lookup society from app DB
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT s.id, s.name, s.locality, c.name AS city
                FROM societies s
                JOIN cities c ON s.city_id = c.id
                WHERE s.id = %s
            """, (society_id,))
            soc = cur.fetchone()
            if not soc:
                return jsonify({"error": "Society not found"}), 404
    finally:
        put_app_conn(conn)

    towers: dict[str, dict[str, int]] = {}
    configs: set[str] = set()

    # Query properties DB for towers/units/configs
    if properties_configured():
        pconn = get_props_conn()
        try:
            with pconn.cursor() as cur:
                # Towers + unit-suffix -> area
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
            put_props_conn(pconn)

    return jsonify({
        "society": soc,
        "towers": towers,
        "configs": sorted(configs),
    }), 200
