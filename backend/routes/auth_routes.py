"""Auth routes.

Two-step login flow (mandatory OTP when Config.OTP_ENABLED):
  POST /api/auth/send-otp        { phone }           → { status }
  POST /api/auth/verify-otp      { phone, code }     → { token, user }

Legacy single-step flow (used when OTP_ENABLED=false):
  POST /api/auth/phone-login     { phone }           → { token, user }

Plus /me to verify token.
"""

from flask import Blueprint, g, jsonify, request

from auth import generate_token, require_auth
from config import Config
from db import get_app_conn, put_app_conn
from services_otp import send_otp, verify_otp
from utils import normalize_phone

bp = Blueprint("auth_routes", __name__, url_prefix="/api")


def _user_response(cp: dict) -> dict:
    return {
        "id": cp["cp_code"],
        "cp_code": cp["cp_code"],
        "name": cp["name"],
        "phone": cp["phone"],
        "company": cp["company"],
        "city": cp.get("city"),
        "isAdmin": bool(cp.get("is_admin", False)),
        "role": cp.get("role") or "cp",
        "microMarkets": cp.get("micro_markets") or [],
    }


def _fetch_active_cp(cur, phone: str):
    cur.execute("""
        SELECT cp.id, cp.cp_code, cp.name, cp.phone, cp.company,
               cp.is_admin, cp.role, cp.micro_markets, cp.city_id,
               c.name AS city
        FROM channel_partners cp
        LEFT JOIN cities c ON cp.city_id = c.id
        WHERE cp.phone = %s AND cp.is_active = TRUE
    """, (phone,))
    return cur.fetchone()


def _not_registered_response(cur):
    cur.execute("SELECT name, rm_name, rm_phone FROM cities ORDER BY name")
    cities = cur.fetchall()
    rm_contacts = {
        c["name"]: {"name": c["rm_name"], "phone": c["rm_phone"]}
        for c in cities
    }
    return {
        "success": True,
        "user": None,
        "token": None,
        "message": "Phone not registered as a channel partner",
        "rm_contacts": rm_contacts,
    }


# ------------------------------------------------------------------
# Step 1: send OTP
# ------------------------------------------------------------------

@bp.post("/auth/send-otp")
def send_otp_route():
    data = request.get_json(silent=True) or {}
    phone = normalize_phone(data.get("phone"))
    if not phone:
        return jsonify({"error": "Phone number must be at least 10 digits"}), 400

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cp = _fetch_active_cp(cur, phone)
            if not cp:
                return jsonify(_not_registered_response(cur)), 200
    finally:
        put_app_conn(conn)

    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "").split(",")[0].strip()
    status, err = send_otp(phone, ip=ip or None)

    if status == "rate_limited":
        return jsonify({"success": False, "status": "rate_limited", "error": err}), 429
    if status == "failed":
        return jsonify({"success": False, "status": "failed", "error": err}), 502

    return jsonify({
        "success": True,
        "status": status,
        "message": "OTP sent" if status == "sent" else "Dev mode: any 6 digits will work",
    }), 200


# ------------------------------------------------------------------
# Step 2: verify OTP + log in
# ------------------------------------------------------------------

@bp.post("/auth/verify-otp")
def verify_otp_route():
    data = request.get_json(silent=True) or {}
    phone = normalize_phone(data.get("phone"))
    code = (data.get("code") or "").strip()
    if not phone:
        return jsonify({"error": "Phone number required"}), 400
    if not code:
        return jsonify({"error": "OTP required"}), 400

    status, err = verify_otp(phone, code)
    if status != "ok":
        return jsonify({"success": False, "status": status, "error": err or "Invalid OTP"}), 401

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cp = _fetch_active_cp(cur, phone)
            if not cp:
                return jsonify(_not_registered_response(cur)), 200
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
        "user": _user_response(cp),
    }), 200


# ------------------------------------------------------------------
# Legacy single-step (kept for backward compat when OTP_ENABLED=false)
# ------------------------------------------------------------------

@bp.post("/auth/phone-login")
def phone_login():
    """Legacy endpoint. When OTP_ENABLED=true, this is blocked to force new flow."""
    if Config.OTP_ENABLED:
        return jsonify({
            "error": "Phone-only login is disabled. Use /auth/send-otp then /auth/verify-otp."
        }), 410

    data = request.get_json(silent=True) or {}
    phone = normalize_phone(data.get("phone"))
    if not phone:
        return jsonify({"error": "Phone number must be at least 10 digits"}), 400

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cp = _fetch_active_cp(cur, phone)
            if not cp:
                return jsonify(_not_registered_response(cur)), 200
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
        "user": _user_response(cp),
    }), 200


# ------------------------------------------------------------------
# /me
# ------------------------------------------------------------------

@bp.get("/me")
@require_auth
def me():
    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT cp.id, cp.cp_code, cp.name, cp.phone, cp.company,
                       cp.is_admin, cp.role, cp.micro_markets, cp.city_id,
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

    return jsonify({"user": _user_response(cp)}), 200