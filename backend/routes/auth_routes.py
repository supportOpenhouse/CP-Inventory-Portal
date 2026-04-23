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


def _fetch_active_rm(cur, phone: str):
    """Look up an active RM in the `rms` table by phone.
    Returns a dict with keys matching the RM login shape, or None.
    rms table is expected to have: id, name, phone, email, is_active, city_id.
    """
    try:
        cur.execute("""
            SELECT r.id, r.name, r.phone, r.email, r.city_id, c.name AS city
            FROM rms r
            LEFT JOIN cities c ON r.city_id = c.id
            WHERE r.phone = %s AND COALESCE(r.is_active, TRUE) = TRUE
        """, (phone,))
        return cur.fetchone()
    except Exception:
        # Table may be missing city_id column until migration runs — fall through gracefully
        return None


def _rm_user_response(rm: dict) -> dict:
    """Shape returned to the frontend for an RM login."""
    return {
        "id": f"rm-{rm['id']}",
        "cp_code": f"RM{rm['id']:04d}",
        "name": rm.get("name") or "RM",
        "phone": rm["phone"],
        "company": "Openhouse",
        "city": rm.get("city"),
        "isAdmin": False,
        "role": "rm",
        "microMarkets": [],
    }


def _generate_rm_token(rm: dict) -> str:
    """Issue a JWT for an RM logged in via rms table.
    Uses the same auth.generate_token but with rm_id + role='rm' + city_id.
    """
    # Reuse generate_token shape: pass a synthetic dict it understands.
    fake_cp = {
        "id": None,                 # intentionally None — no cp_id
        "cp_code": f"RM{rm['id']:04d}",
        "phone": rm["phone"],
        "is_admin": False,
        "role": "rm",
        "city_id": rm.get("city_id"),
    }
    import jwt
    from datetime import datetime, timedelta, timezone
    payload = {
        "rm_id": rm["id"],
        "cp_code": fake_cp["cp_code"],
        "phone": fake_cp["phone"],
        "is_admin": False,
        "role": "rm",
        "city_id": fake_cp["city_id"],
        "exp": datetime.now(timezone.utc) + timedelta(hours=24),
    }
    return jwt.encode(payload, Config.JWT_SECRET, algorithm="HS256")


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
            # Try channel_partners first, then rms table
            cp = _fetch_active_cp(cur, phone)
            rm = None if cp else _fetch_active_rm(cur, phone)
            if not cp and not rm:
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
            if cp:
                cur.execute(
                    "UPDATE channel_partners SET last_login = NOW() WHERE id = %s",
                    (cp["id"],),
                )
                conn.commit()
                token = generate_token(cp)
                return jsonify({
                    "success": True,
                    "token": token,
                    "user": _user_response(cp),
                }), 200

            # No CP match — try RMs table
            rm = _fetch_active_rm(cur, phone)
            if rm:
                try:
                    cur.execute(
                        "UPDATE rms SET last_login = NOW() WHERE id = %s",
                        (rm["id"],),
                    )
                    conn.commit()
                except Exception:
                    conn.rollback()
                token = _generate_rm_token(rm)
                return jsonify({
                    "success": True,
                    "token": token,
                    "user": _rm_user_response(rm),
                }), 200

            return jsonify(_not_registered_response(cur)), 200
    finally:
        put_app_conn(conn)


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
    # RM session (JWT has rm_id, not cp_id)
    rm_id = g.user.get("rm_id")
    if rm_id:
        conn = get_app_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT r.id, r.name, r.phone, r.email, r.city_id, c.name AS city
                    FROM rms r
                    LEFT JOIN cities c ON r.city_id = c.id
                    WHERE r.id = %s AND COALESCE(r.is_active, TRUE) = TRUE
                """, (rm_id,))
                rm = cur.fetchone()
        finally:
            put_app_conn(conn)
        if not rm:
            return jsonify({"error": "User not found or inactive"}), 404
        return jsonify({"user": _rm_user_response(rm)}), 200

    # CP session (legacy path)
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