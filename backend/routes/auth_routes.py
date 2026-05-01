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
    """Look up an active RM in the `rms` table by normalized phone.

    Phones in `rms` may have +91 prefix and/or spaces (e.g. '+91 9289500953')
    while normalize_phone() returns last-10-digits only. Both sides are
    normalized in SQL so the match works regardless of storage format.

    Tries the fullest query first (city_id + manager columns). If that fails
    (e.g. migration hasn't run yet), rolls back the aborted transaction and
    tries simpler fallbacks so login doesn't 500 during partial migrations.
    """
    import logging

    # Primary: full query with city + manager hierarchy
    try:
        cur.execute("""
            SELECT r.id, r.name, r.phone, r.email,
                   r.city_id, c.name AS city,
                   r.is_manager, r.manager_id
            FROM rms r
            LEFT JOIN cities c ON r.city_id = c.id
            WHERE RIGHT(REGEXP_REPLACE(r.phone, '\\D', '', 'g'), 10) = %s
              AND COALESCE(r.is_active, TRUE) = TRUE
            LIMIT 1
        """, (phone,))
        return cur.fetchone()
    except Exception as e:
        logging.warning("RM lookup (full) failed, trying fallback. phone=%s err=%s", phone, e)
        try:
            cur.connection.rollback()
        except Exception:
            pass

    # Fallback 1: has city_id but no manager columns (migration_rms_city_id ran,
    # migration_manager_role has not)
    try:
        cur.execute("""
            SELECT r.id, r.name, r.phone, r.email,
                   r.city_id, c.name AS city,
                   FALSE AS is_manager, NULL::integer AS manager_id
            FROM rms r
            LEFT JOIN cities c ON r.city_id = c.id
            WHERE RIGHT(REGEXP_REPLACE(r.phone, '\\D', '', 'g'), 10) = %s
              AND COALESCE(r.is_active, TRUE) = TRUE
            LIMIT 1
        """, (phone,))
        row = cur.fetchone()
        if row is not None:
            return row
    except Exception as e:
        logging.warning("RM lookup (no manager cols) failed. phone=%s err=%s", phone, e)
        try:
            cur.connection.rollback()
        except Exception:
            pass

    # Fallback 2: neither migration ran (no city_id, no manager cols)
    try:
        cur.execute("""
            SELECT r.id, r.name, r.phone, r.email,
                   NULL::integer AS city_id, NULL::varchar AS city,
                   FALSE AS is_manager, NULL::integer AS manager_id
            FROM rms r
            WHERE RIGHT(REGEXP_REPLACE(r.phone, '\\D', '', 'g'), 10) = %s
              AND COALESCE(r.is_active, TRUE) = TRUE
            LIMIT 1
        """, (phone,))
        return cur.fetchone()
    except Exception as e:
        logging.warning("RM lookup (minimal) failed. phone=%s err=%s", phone, e)
        try:
            cur.connection.rollback()
        except Exception:
            pass
        return None


def _rm_user_response(rm: dict) -> dict:
    """Shape returned to the frontend for an RM login."""
    is_mgr = bool(rm.get("is_manager"))
    return {
        "id": f"rm-{rm['id']}",
        "cp_code": f"RM{rm['id']:04d}",
        "name": rm.get("name") or "RM",
        "phone": rm["phone"],
        "company": "Openhouse",
        "city": rm.get("city"),
        "isAdmin": False,
        # UI role: 'manager' if user is a manager (optionally also an RM with
        # direct CPs); 'rm' otherwise. Scope enforcement still happens in the
        # backend based on the raw manager_id / is_manager values in the JWT.
        "role": "manager" if is_mgr else "rm",
        "isManager": is_mgr,
        "managerId": rm.get("manager_id"),
        "microMarkets": [],
    }


def _generate_rm_token(rm: dict) -> str:
    """Issue a JWT for an RM/manager logged in via rms table.

    JWT payload carries:
      - rm_id       : this user's rms.id
      - role        : 'rm' or 'manager' (informational; backend trusts is_manager)
      - is_manager  : bool — true if user has direct reports
      - manager_id  : this user's own manager (NULL if top of chain)
      - city_id     : for legacy city-scoped queries (may be unused post-migration)
    """
    import jwt
    from datetime import datetime, timedelta, timezone
    is_mgr = bool(rm.get("is_manager"))
    now = datetime.now(timezone.utc)
    payload = {
        "rm_id": rm["id"],
        "cp_code": f"RM{rm['id']:04d}",
        "phone": rm["phone"],
        "is_admin": False,
        "role": "manager" if is_mgr else "rm",
        "is_manager": is_mgr,
        "manager_id": rm.get("manager_id"),
        "city_id": rm.get("city_id"),
        "iat": int(now.timestamp()),  # for force-logout check in auth middleware
        "exp": now + timedelta(hours=24),
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
                # Try full query first, fall back if columns missing
                rm = None
                try:
                    cur.execute("""
                        SELECT r.id, r.name, r.phone, r.email,
                               r.city_id, c.name AS city,
                               r.is_manager, r.manager_id
                        FROM rms r
                        LEFT JOIN cities c ON r.city_id = c.id
                        WHERE r.id = %s AND COALESCE(r.is_active, TRUE) = TRUE
                    """, (rm_id,))
                    rm = cur.fetchone()
                except Exception:
                    conn.rollback()
                    cur.execute("""
                        SELECT r.id, r.name, r.phone, r.email,
                               r.city_id, c.name AS city,
                               FALSE AS is_manager, NULL::integer AS manager_id
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