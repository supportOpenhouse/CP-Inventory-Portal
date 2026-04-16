"""Auth routes: phone-login (no password, temporary) + /me (verify token)."""

from flask import Blueprint, g, jsonify, request

from auth import generate_token, require_auth
from db import get_app_conn, put_app_conn
from utils import normalize_phone

bp = Blueprint("auth_routes", __name__, url_prefix="/api")


@bp.post("/auth/phone-login")
def phone_login():
    """Lookup CP by phone. If found, issue JWT. If not, return RM contacts."""
    data = request.get_json(silent=True) or {}
    phone = normalize_phone(data.get("phone"))
    if not phone:
        return jsonify({"error": "Phone number must be at least 10 digits"}), 400

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT cp.id, cp.cp_code, cp.name, cp.phone, cp.company,
                       cp.is_admin, cp.micro_markets,
                       c.name AS city
                FROM channel_partners cp
                LEFT JOIN cities c ON cp.city_id = c.id
                WHERE cp.phone = %s AND cp.is_active = TRUE
            """, (phone,))
            cp = cur.fetchone()

            if not cp:
                # Phone not in our CP table — return RM contacts so the frontend
                # can show the "not registered" card with contact buttons.
                cur.execute(
                    "SELECT name, rm_name, rm_phone FROM cities ORDER BY name"
                )
                cities = cur.fetchall()
                rm_contacts = {
                    c["name"]: {"name": c["rm_name"], "phone": c["rm_phone"]}
                    for c in cities
                }
                return jsonify({
                    "success": True,
                    "user": None,
                    "token": None,
                    "message": "Phone not registered as a channel partner",
                    "rm_contacts": rm_contacts,
                }), 200

            # Update last_login
            cur.execute(
                "UPDATE channel_partners SET last_login = NOW() WHERE id = %s",
                (cp["id"],),
            )
            conn.commit()
    finally:
        put_app_conn(conn)

    token = generate_token(cp)
    return jsonify({
        "success": True,
        "token": token,
        "user": {
            "id": cp["cp_code"],          # JSX expects `id` = CP code for display
            "cp_code": cp["cp_code"],
            "name": cp["name"],
            "phone": cp["phone"],
            "company": cp["company"],
            "city": cp["city"],
            "isAdmin": bool(cp["is_admin"]),
            "microMarkets": cp["micro_markets"] or [],
        },
    }), 200


@bp.get("/me")
@require_auth
def me():
    """Verify token and return current CP (frontend uses this on page load)."""
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT cp.id, cp.cp_code, cp.name, cp.phone, cp.company,
                       cp.is_admin, cp.micro_markets,
                       c.name AS city
                FROM channel_partners cp
                LEFT JOIN cities c ON cp.city_id = c.id
                WHERE cp.id = %s AND cp.is_active = TRUE
            """, (g.user["cp_id"],))
            cp = cur.fetchone()
    finally:
        put_app_conn(conn)

    if not cp:
        return jsonify({"error": "User not found or inactive"}), 404

    return jsonify({
        "user": {
            "id": cp["cp_code"],
            "cp_code": cp["cp_code"],
            "name": cp["name"],
            "phone": cp["phone"],
            "company": cp["company"],
            "city": cp["city"],
            "isAdmin": bool(cp["is_admin"]),
            "microMarkets": cp["micro_markets"] or [],
        }
    }), 200
