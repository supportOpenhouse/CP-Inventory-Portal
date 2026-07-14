"""JWT token helpers and auth decorators."""

import hmac
import logging
from datetime import datetime, timedelta, timezone
from functools import wraps

import jwt
from flask import g, jsonify, request

from config import Config
from db import get_app_conn, put_app_conn

JWT_ALGORITHM = "HS256"
# Auto-logout windows: CPs get 1 day, all other roles (rm/manager/viewer/admin)
# get 7 days. Tokens are stateless session tokens — once `exp` passes the
# frontend hits a 401 and clears the session (see api.js).
JWT_EXPIRY_HOURS = 24  # CP / default
JWT_EXPIRY_HOURS_STAFF = 24 * 7  # non-CP roles

log = logging.getLogger(__name__)


def expiry_hours_for_role(role: str | None) -> int:
    """Hours until auto-logout for a given role. CP = 1 day, others = 7 days."""
    return JWT_EXPIRY_HOURS if (role or "cp") == "cp" else JWT_EXPIRY_HOURS_STAFF


def generate_token(cp: dict, ttl_minutes: int | None = None, extra_claims: dict | None = None) -> str:
    """Given a CP record, issue a JWT. Includes role for routing.
    Auto-logout window is role-based: CP = 1 day, other roles = 7 days.
    `iat` is included so the auth middleware can compare against the
    user's `force_logout_at` (if set) and reject pre-logout tokens.

    `ttl_minutes`, when given, overrides the role-based window (used for
    short-lived impersonation tokens). `extra_claims` is merged into the
    payload (e.g. `impersonated_by` for "view as CP").
    """
    now = datetime.now(timezone.utc)
    role = cp.get("role") or "cp"
    exp = (now + timedelta(minutes=ttl_minutes)) if ttl_minutes \
        else (now + timedelta(hours=expiry_hours_for_role(role)))
    payload = {
        "cp_id": cp["id"],
        "cp_code": cp["cp_code"],
        "phone": cp["phone"],
        "is_admin": bool(cp.get("is_admin", False)),
        "role": role,
        "city": cp.get("city"),        # text city — what scope filters now use
        "iat": int(now.timestamp()),
        "exp": exp,
    }
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(payload, Config.JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    """Raises jwt.ExpiredSignatureError or jwt.InvalidTokenError."""
    return jwt.decode(token, Config.JWT_SECRET, algorithms=[JWT_ALGORITHM])


def _is_force_logged_out(payload: dict) -> bool:
    """Check whether this token has been invalidated by a force-logout
    on the user's row. Returns True iff the user has a force_logout_at
    timestamp newer than the token's `iat`.

    Best-effort: if iat is missing (legacy token) or DB is unreachable,
    we don't force-logout — fail open so a transient hiccup doesn't kick
    everyone out.
    """
    iat = payload.get("iat")
    if not iat:
        return False
    role = payload.get("role", "cp")
    try:
        conn = get_app_conn()
        try:
            with conn.cursor() as cur:
                if role in ("rm", "manager"):
                    rm_id = payload.get("rm_id")
                    if not rm_id:
                        return False
                    cur.execute(
                        "SELECT force_logout_at FROM rms WHERE id = %s",
                        (rm_id,),
                    )
                else:
                    cp_id = payload.get("cp_id")
                    if not cp_id:
                        return False
                    cur.execute(
                        "SELECT force_logout_at FROM channel_partners WHERE id = %s",
                        (cp_id,),
                    )
                row = cur.fetchone()
        finally:
            put_app_conn(conn)
    except Exception:
        log.exception("[auth] _is_force_logged_out lookup failed; failing open")
        return False
    if not row:
        return False
    fl_at = row.get("force_logout_at")
    if not fl_at:
        return False
    iat_dt = datetime.fromtimestamp(iat, tz=timezone.utc)
    return iat_dt < fl_at


def _decode_or_reject(token: str):
    """Returns (payload, None) on success or (None, (json_dict, status)).
    Centralises the JWT-decode + force-logout check so require_auth and
    require_staff don't drift apart.
    """
    try:
        payload = decode_token(token)
    except jwt.ExpiredSignatureError:
        return None, ({"error": "Token expired. Please log in again."}, 401)
    except jwt.InvalidTokenError:
        return None, ({"error": "Invalid token"}, 401)
    if _is_force_logged_out(payload):
        return None, ({"error": "Session ended by admin. Please log in again."}, 401)
    return payload, None


def set_auth_cookie(resp, token: str, role: str | None) -> None:
    """Attach the session JWT as an HttpOnly cookie on `resp`.

    Same-origin deploy (Vercel rewrite / Vite proxy) makes this a first-party
    cookie, so SameSite=Lax is enough. The cookie lifetime mirrors the token's
    role-based expiry so cookie and JWT die together.
    """
    resp.set_cookie(
        Config.AUTH_COOKIE_NAME,
        token,
        max_age=expiry_hours_for_role(role) * 3600,
        httponly=True,
        secure=Config.AUTH_COOKIE_SECURE,
        samesite=Config.AUTH_COOKIE_SAMESITE,
        domain=Config.AUTH_COOKIE_DOMAIN,
        path="/",
    )


def clear_auth_cookie(resp) -> None:
    """Expire the session cookie (logout)."""
    resp.delete_cookie(
        Config.AUTH_COOKIE_NAME,
        domain=Config.AUTH_COOKIE_DOMAIN,
        path="/",
        secure=Config.AUTH_COOKIE_SECURE,
        samesite=Config.AUTH_COOKIE_SAMESITE,
        httponly=True,
    )


def _token_from_request():
    """Extract the session token, header-first then cookie.

    The Authorization: Bearer header wins so impersonation tabs (per-tab Bearer
    token) and partner-relay callers override the HttpOnly session cookie the
    browser also sends. Falls back to the cookie for normal logged-in sessions.
    """
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return request.cookies.get(Config.AUTH_COOKIE_NAME) or None


def _relay_user_or_none():
    """Check for partner relay auth (API key + X-Broker-Id phone).

    Returns (user_dict, None) on success, (None, error_tuple) if the relay key
    is present but invalid/broker not found, or (None, None) if relay auth
    doesn't apply (key not configured or header absent — fall through to JWT).
    """
    relay_key = (Config.RELAY_API_KEY or "").strip()
    if not relay_key:
        return None, None  # relay not configured

    header_name = Config.RELAY_API_KEY_HEADER
    incoming_key = request.headers.get(header_name, "").strip()
    if not incoming_key:
        return None, None  # no relay key in this request

    if not hmac.compare_digest(incoming_key, relay_key):
        log.warning("[relay] invalid API key from %s", request.remote_addr)
        return None, ({"error": "Invalid relay API key"}, 401)

    # Valid key — resolve broker from X-Broker-Id (raw 10-digit phone).
    raw_phone = request.headers.get("X-Broker-Id", "").strip()
    digits = "".join(c for c in raw_phone if c.isdigit())
    phone = digits[-10:] if len(digits) >= 10 else digits
    if not phone:
        return None, ({"error": "X-Broker-Id header with a valid phone is required for relay requests"}, 400)

    conn = get_app_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, cp_code, name, phone, role, is_admin, city "
                "FROM channel_partners WHERE phone = %s AND is_active = TRUE",
                (phone,),
            )
            cp = cur.fetchone()
    finally:
        put_app_conn(conn)

    if not cp:
        log.warning("[relay] broker not found for phone=%s", phone)
        return None, ({"error": "Broker not found or inactive"}, 404)

    user = {
        "cp_id": cp["id"],
        "cp_code": cp["cp_code"],
        "phone": cp["phone"],
        "is_admin": bool(cp.get("is_admin", False)),
        "role": cp.get("role") or "cp",
        "city": cp.get("city"),
        "_relay": True,
    }
    log.info("[relay] authenticated broker cp_id=%s cp_code=%s", user["cp_id"], user["cp_code"])
    return user, None


def _normalize_relay_phone(raw: str) -> str:
    digits = "".join(c for c in (raw or "") if c.isdigit())
    return digits[-10:] if len(digits) >= 10 else digits


def require_relay_on_behalf(f):
    """Partner relay auth for sales-manager on-behalf unit submission.

    Requires API key + X-Broker-Id (target CP phone) + X-Sales-Id.
    Optional X-Sales-Name for submitted_by_name audit display.
    """
    @wraps(f)
    def wrapper(*args, **kwargs):
        relay_key = (Config.RELAY_API_KEY or "").strip()
        if not relay_key:
            return jsonify({"error": "Relay is not configured"}), 503

        header_name = Config.RELAY_API_KEY_HEADER
        incoming_key = request.headers.get(header_name, "").strip()
        if not incoming_key or not hmac.compare_digest(incoming_key, relay_key):
            log.warning("[relay/on-behalf] invalid API key from %s", request.remote_addr)
            return jsonify({"error": "Invalid relay API key"}), 401

        phone = _normalize_relay_phone(request.headers.get("X-Broker-Id", ""))
        if not phone:
            return jsonify({
                "error": "X-Broker-Id header with a valid phone is required for relay on-behalf requests",
            }), 400

        sales_phone = _normalize_relay_phone(
            request.headers.get(Config.RELAY_SALES_ID_HEADER, ""),
        )
        if not sales_phone:
            return jsonify({
                "error": f"{Config.RELAY_SALES_ID_HEADER} header with sales phone is required",
            }), 400

        sales_name = (request.headers.get(Config.RELAY_SALES_NAME_HEADER) or "").strip()
        submitted_by_name = sales_name if sales_name else sales_phone

        conn = get_app_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, name, phone, cp_code, is_active,
                           COALESCE(is_admin, FALSE) AS is_admin
                    FROM channel_partners
                    WHERE phone = %s
                    """,
                    (phone,),
                )
                cp = cur.fetchone()
        finally:
            put_app_conn(conn)

        if not cp:
            return jsonify({"error": "Broker not found for the provided phone"}), 404
        if not cp.get("is_active"):
            return jsonify({"error": "Target CP is inactive"}), 400
        if cp.get("is_admin"):
            return jsonify({"error": "Target is an admin account, not a CP"}), 400

        g.relay_target_cp_id = cp["id"]
        g.relay_target_cp_name = (cp.get("name") or f"CP #{cp['id']}").strip()
        g.relay_submitted_by_name = submitted_by_name
        g.relay_sales_phone = sales_phone
        return f(*args, **kwargs)

    return wrapper


def require_auth(f):
    """Any authenticated user (CP, RM, or admin). Accepts JWT or relay API key."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        relay_user, relay_err = _relay_user_or_none()
        if relay_err:
            body, status = relay_err
            return jsonify(body), status
        if relay_user is not None:
            g.user = relay_user
            return f(*args, **kwargs)

        token = _token_from_request()
        if not token:
            return jsonify({"error": "Missing authentication credentials"}), 401
        payload, err = _decode_or_reject(token)
        if err:
            body, status = err
            return jsonify(body), status
        g.user = payload
        return f(*args, **kwargs)
    return wrapper


def require_staff(f):
    """Any staff role — admin, manager, rm, OR viewer.

    Used by /api/admin/* endpoints that READ data. Mutating endpoints
    should additionally use @require_acting_staff to block viewers.
    """
    @wraps(f)
    def wrapper(*args, **kwargs):
        token = _token_from_request()
        if not token:
            return jsonify({"error": "Missing authentication credentials"}), 401
        payload, err = _decode_or_reject(token)
        if err:
            body, status = err
            return jsonify(body), status
        g.user = payload

        role = payload.get("role", "cp")
        if role not in ("rm", "manager", "admin", "viewer"):
            return jsonify({"error": "Forbidden"}), 403
        return f(*args, **kwargs)
    return wrapper


def require_acting_staff(f):
    """Use AFTER require_staff. Rejects viewers — for mutation endpoints
    that should only be reachable by admin / manager / rm.

    Why a separate decorator instead of folding into the require_admin_*
    decorators: lots of staff-callable mutations (status change, comment,
    schedule visit, on-behalf submit, bulk status) are NOT admin/manager-only,
    they're plain @require_staff. Without this gate, viewers would inherit
    write access via require_staff.
    """
    @wraps(f)
    def wrapper(*args, **kwargs):
        if (g.user or {}).get("role") == "viewer":
            return jsonify({"error": "Viewers have read-only access"}), 403
        return f(*args, **kwargs)
    return wrapper