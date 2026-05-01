"""JWT token helpers and auth decorators."""

import logging
from datetime import datetime, timedelta, timezone
from functools import wraps

import jwt
from flask import g, jsonify, request

from config import Config
from db import get_app_conn, put_app_conn

JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 24

log = logging.getLogger(__name__)


def generate_token(cp: dict) -> str:
    """Given a CP record, issue a 24h JWT. Includes role for routing.
    `iat` is included so the auth middleware can compare against the
    user's `force_logout_at` (if set) and reject pre-logout tokens.
    """
    now = datetime.now(timezone.utc)
    payload = {
        "cp_id": cp["id"],
        "cp_code": cp["cp_code"],
        "phone": cp["phone"],
        "is_admin": bool(cp.get("is_admin", False)),
        "role": cp.get("role") or "cp",
        "city_id": cp.get("city_id"),
        "iat": int(now.timestamp()),
        "exp": now + timedelta(hours=JWT_EXPIRY_HOURS),
    }
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


def require_auth(f):
    """Any authenticated user (CP, RM, or admin)."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return jsonify({"error": "Missing or invalid Authorization header"}), 401
        payload, err = _decode_or_reject(auth[7:].strip())
        if err:
            body, status = err
            return jsonify(body), status
        g.user = payload
        return f(*args, **kwargs)
    return wrapper


def require_staff(f):
    """RM or admin only. Used by /api/admin/* endpoints."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return jsonify({"error": "Missing or invalid Authorization header"}), 401
        payload, err = _decode_or_reject(auth[7:].strip())
        if err:
            body, status = err
            return jsonify(body), status
        g.user = payload

        role = payload.get("role", "cp")
        if role not in ("rm", "manager", "admin"):
            return jsonify({"error": "Forbidden"}), 403
        return f(*args, **kwargs)
    return wrapper