"""Public lookup endpoints: RM contacts."""

from flask import Blueprint, g, jsonify

from db import get_app_conn, put_app_conn
from auth import require_auth

bp = Blueprint("meta", __name__, url_prefix="/api")


@bp.get("/my-rm")
@require_auth
def my_rm():
    """Returns { name, phone } for the logged-in CP's assigned RM.

    Schema: channel_partners.rm_id (FK) -> rms.id. The `rms` table carries
    the RM's actual contact details (id, name, phone, email, is_active).

    Fallback order:
      1. CP's assigned RM from rms table (via channel_partners.rm_id FK)
      2. First active RM in the CP's city (channel_partners role='rm')
      3. Legacy cities.rm_name / rm_phone default
      4. null — caller should handle gracefully
    """
    cp_id = g.user["cp_id"]
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            # 1. Direct lookup via channel_partners.rm_id -> rms.id
            try:
                cur.execute(
                    """
                    SELECT r.name AS name, r.phone AS phone
                    FROM channel_partners cp
                    JOIN rms r ON r.id = cp.rm_id
                    WHERE cp.id = %s AND cp.rm_id IS NOT NULL
                    """,
                    (cp_id,),
                )
                row = cur.fetchone()
                if row and row.get("phone"):
                    return jsonify({"rm": {"name": row["name"], "phone": row["phone"]}}), 200
            except Exception:
                # Table or column might not exist yet — fall through to fallbacks
                conn.rollback()

            # 2. First active RM in the CP's city (from channel_partners role='rm')
            cur.execute(
                """
                SELECT rm.name AS name, rm.phone AS phone
                FROM channel_partners me
                JOIN channel_partners rm
                  ON rm.city_id = me.city_id
                 AND rm.role = 'rm'
                 AND rm.is_active = TRUE
                WHERE me.id = %s
                ORDER BY rm.name ASC, rm.id ASC
                LIMIT 1
                """,
                (cp_id,),
            )
            row = cur.fetchone()
            if row and row.get("phone"):
                return jsonify({"rm": {"name": row["name"], "phone": row["phone"]}}), 200

            # 3. Legacy cities.rm_name / rm_phone default
            cur.execute(
                """
                SELECT c.rm_name AS name, c.rm_phone AS phone
                FROM channel_partners cp
                LEFT JOIN cities c ON c.id = cp.city_id
                WHERE cp.id = %s
                """,
                (cp_id,),
            )
            row = cur.fetchone()
            if row and row.get("phone"):
                return jsonify({"rm": {"name": row["name"], "phone": row["phone"]}}), 200

            return jsonify({"rm": None}), 200
    finally:
        put_app_conn(conn)


@bp.get("/rm-contacts")
def rm_contacts():
    """Returns { 'contacts': { cityName: { name, phone } } }."""
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT name, rm_name, rm_phone FROM cities ORDER BY name"
            )
            rows = cur.fetchall()
        return jsonify({
            "contacts": {
                r["name"]: {"name": r["rm_name"], "phone": r["rm_phone"]}
                for r in rows
            }
        }), 200
    finally:
        put_app_conn(conn)
