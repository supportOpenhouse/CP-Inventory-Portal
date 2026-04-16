"""Public lookup endpoints: RM contacts, FAQs."""

from flask import Blueprint, jsonify

from db import get_app_conn, put_app_conn

bp = Blueprint("meta", __name__, url_prefix="/api")


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


@bp.get("/faqs")
def faqs():
    """Returns active FAQs ordered for display."""
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, category, question, answer, display_order
                FROM faqs
                WHERE is_active = TRUE
                ORDER BY display_order, id
            """)
            rows = cur.fetchall()
        return jsonify({"faqs": rows}), 200
    finally:
        put_app_conn(conn)
