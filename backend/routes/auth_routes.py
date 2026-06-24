"""Auth routes.

Two-step login flow (mandatory OTP when Config.OTP_ENABLED):
  POST /api/auth/send-otp        { phone }           → { status }
  POST /api/auth/verify-otp      { phone, code }     → { user } + Set-Cookie

Legacy single-step flow (used when OTP_ENABLED=false):
  POST /api/auth/phone-login     { phone }           → { user } + Set-Cookie

The session JWT is set as an HttpOnly cookie (not returned in the body).
  POST /api/auth/logout          clears the cookie
  GET  /api/me                   verifies the cookie + returns the user
"""

from flask import Blueprint, g, jsonify, request

from auth import clear_auth_cookie, generate_token, require_auth, set_auth_cookie
from config import Config
from db import get_app_conn, put_app_conn
from services_otp import send_otp, verify_otp
from utils import normalize_phone

# Optional LOCAL DEV bypass. The module is gitignored and only present on dev
# machines; in production the import fails and `_local_bypass` stays None, so
# phone-only login is blocked and OTP is strictly enforced. See local_bypass.py.
try:
    from local_bypass import phone_login_bypass_enabled as _local_bypass
except Exception:
    _local_bypass = None

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

    # Primary: full query with city + manager hierarchy + viewer flag
    try:
        cur.execute("""
            SELECT r.id, r.name, r.phone, r.email,
                   r.city_id, c.name AS city,
                   r.is_manager, r.manager_id,
                   COALESCE(r.is_viewer, FALSE) AS is_viewer
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

    # Fallback 1: has city_id + manager but no viewer column
    try:
        cur.execute("""
            SELECT r.id, r.name, r.phone, r.email,
                   r.city_id, c.name AS city,
                   r.is_manager, r.manager_id,
                   FALSE AS is_viewer
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
        logging.warning("RM lookup (no viewer col) failed. phone=%s err=%s", phone, e)
        try:
            cur.connection.rollback()
        except Exception:
            pass

    # Fallback 2: has city_id but no manager / viewer columns
    try:
        cur.execute("""
            SELECT r.id, r.name, r.phone, r.email,
                   r.city_id, c.name AS city,
                   FALSE AS is_manager, NULL::integer AS manager_id,
                   FALSE AS is_viewer
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

    # Fallback 3: neither migration ran (no city_id, no manager / viewer cols)
    try:
        cur.execute("""
            SELECT r.id, r.name, r.phone, r.email,
                   NULL::integer AS city_id, NULL::varchar AS city,
                   FALSE AS is_manager, NULL::integer AS manager_id,
                   FALSE AS is_viewer
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


def _resolve_role(rm: dict) -> str:
    """Derive the UI/JWT role from the rms row.

    Precedence: viewer > manager > rm. Viewer wins because the CHECK
    constraint already forbids is_viewer+is_manager together, but if both
    were ever true (legacy data) we'd want the more-restrictive role.
    """
    if bool(rm.get("is_viewer")):
        return "viewer"
    if bool(rm.get("is_manager")):
        return "manager"
    return "rm"


def _rm_user_response(rm: dict) -> dict:
    """Shape returned to the frontend for an RM/viewer login."""
    is_mgr = bool(rm.get("is_manager"))
    is_viewer = bool(rm.get("is_viewer"))
    return {
        "id": f"rm-{rm['id']}",
        "rm_id": rm["id"],   # numeric — used by UI gates that need to identify "me" against the rms table (e.g. "RMs in my team")
        "cp_code": f"RM{rm['id']:04d}",
        "name": rm.get("name") or "RM",
        "phone": rm["phone"],
        "company": "Openhouse",
        "city": rm.get("city"),
        "isAdmin": False,
        # UI role: 'viewer' / 'manager' / 'rm'. Backend trusts is_manager /
        # is_viewer flags for scope enforcement; the string is informational.
        "role": _resolve_role(rm),
        "isManager": is_mgr,
        "isViewer": is_viewer,
        "managerId": rm.get("manager_id"),
        "microMarkets": [],
    }


def _generate_rm_token(rm: dict) -> str:
    """Issue a JWT for an RM/manager/viewer logged in via the rms table.

    JWT payload carries:
      - rm_id       : this user's rms.id
      - role        : 'rm' | 'manager' | 'viewer' (informational)
      - is_manager  : bool — true if user has direct reports
      - is_viewer   : bool — true if user is read-only city viewer
      - manager_id  : this user's own manager (NULL if top of chain)
      - city_id     : the row's city. Used by the viewer scope filter.
    """
    import jwt
    from datetime import datetime, timedelta, timezone
    from auth import expiry_hours_for_role
    is_mgr = bool(rm.get("is_manager"))
    is_viewer = bool(rm.get("is_viewer"))
    role = _resolve_role(rm)
    now = datetime.now(timezone.utc)
    payload = {
        "rm_id": rm["id"],
        "cp_code": f"RM{rm['id']:04d}",
        "phone": rm["phone"],
        "is_admin": False,
        "role": role,
        "is_manager": is_mgr,
        "is_viewer": is_viewer,
        "manager_id": rm.get("manager_id"),
        "city_id": rm.get("city_id"),
        "iat": int(now.timestamp()),  # for force-logout check in auth middleware
        # Non-CP roles auto-logout after 7 days (vs 1 day for CPs).
        "exp": now + timedelta(hours=expiry_hours_for_role(role)),
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
            # Try rms table first, then fall back to channel_partners
            rm = _fetch_active_rm(cur, phone)
            cp = None if rm else _fetch_active_cp(cur, phone)
            if not rm and not cp:
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
            # Try rms table first; fall back to channel_partners
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
                resp = jsonify({
                    "success": True,
                    "user": _rm_user_response(rm),
                })
                set_auth_cookie(resp, token, "rm")  # non-CP role → 7-day window
                return resp, 200

            cp = _fetch_active_cp(cur, phone)
            if cp:
                cur.execute(
                    "UPDATE channel_partners SET last_login = NOW() WHERE id = %s",
                    (cp["id"],),
                )
                conn.commit()
                token = generate_token(cp)
                resp = jsonify({
                    "success": True,
                    "user": _user_response(cp),
                })
                set_auth_cookie(resp, token, cp.get("role") or "cp")
                return resp, 200

            return jsonify(_not_registered_response(cur)), 200
    finally:
        put_app_conn(conn)


@bp.post("/auth/logout")
def logout():
    """Clear the session cookie. Unauthenticated + idempotent on purpose so a
    logout always succeeds even with an already-expired/absent cookie."""
    resp = jsonify({"success": True})
    clear_auth_cookie(resp)
    return resp, 200


# ------------------------------------------------------------------
# Legacy single-step (kept for backward compat when OTP_ENABLED=false)
# ------------------------------------------------------------------

@bp.post("/auth/phone-login")
def phone_login():
    """Phone-only login (no OTP). Allowed when OTP is disabled globally
    (OTP_ENABLED=false), or when the gitignored local-dev bypass is present
    (see local_bypass.py); blocked otherwise to force the OTP flow. Mirrors the
    OTP verify flow's user resolution so EVERY role works: RM / manager / viewer
    via the rms table, CP via channel_partners.
    """
    if Config.OTP_ENABLED and not (_local_bypass and _local_bypass()):
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
            # Try rms first (RM/manager/viewer), then channel_partners (CP) —
            # same precedence as verify-otp so every role can log in locally.
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
                resp = jsonify({
                    "success": True,
                    "user": _rm_user_response(rm),
                })
                set_auth_cookie(resp, token, "rm")  # non-CP role → 7-day window
                return resp, 200

            cp = _fetch_active_cp(cur, phone)
            if cp:
                cur.execute(
                    "UPDATE channel_partners SET last_login = NOW() WHERE id = %s",
                    (cp["id"],),
                )
                conn.commit()
                token = generate_token(cp)
                resp = jsonify({
                    "success": True,
                    "user": _user_response(cp),
                })
                set_auth_cookie(resp, token, cp.get("role") or "cp")
                return resp, 200

            return jsonify(_not_registered_response(cur)), 200
    finally:
        put_app_conn(conn)


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

    resp = _user_response(cp)
    # Surface impersonation so the CP-side app can show a "viewing as" banner.
    if g.user.get("impersonated_by"):
        resp["impersonated_by"] = g.user["impersonated_by"]
    return jsonify({"user": resp}), 200