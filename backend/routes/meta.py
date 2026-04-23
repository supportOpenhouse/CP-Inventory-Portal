"""Public lookup endpoints: RM contacts, FAQs."""

from flask import Blueprint, jsonify

from db import get_app_conn, put_app_conn

bp = Blueprint("meta", __name__, url_prefix="/api")


@bp.get("/rm-contacts")
def rm_contacts():
    """Returns { 'contacts': { cityName: { name, phone } } }.

    Data source: `channel_partners` rows with role='rm' and is_active=TRUE,
    grouped by their city. For each city we return the first active RM
    (by name ASC, tie-broken by id ASC). If a city has no active RM, we
    fall back to the legacy `cities.rm_name / cities.rm_phone` default
    so the endpoint never returns a city without any contact.
    """
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            # DISTINCT ON (city) picks the first RM per city per our ORDER BY.
            cur.execute("""
                SELECT DISTINCT ON (c.id)
                       c.name AS city_name,
                       cp.name AS rm_name,
                       cp.phone AS rm_phone
                FROM cities c
                JOIN channel_partners cp
                  ON cp.city_id = c.id
                 AND cp.role = 'rm'
                 AND cp.is_active = TRUE
                ORDER BY c.id, cp.name ASC, cp.id ASC
            """)
            from_rms = {
                r["city_name"]: {"name": r["rm_name"], "phone": r["rm_phone"]}
                for r in cur.fetchall()
            }

            # Fallback: any city without an RM in the join above uses
            # the legacy default (cities.rm_name / cities.rm_phone).
            cur.execute(
                "SELECT name, rm_name, rm_phone FROM cities ORDER BY name"
            )
            result = {}
            for r in cur.fetchall():
                city = r["name"]
                if city in from_rms:
                    result[city] = from_rms[city]
                elif r["rm_name"]:
                    result[city] = {"name": r["rm_name"], "phone": r["rm_phone"]}
        return jsonify({"contacts": result}), 200
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