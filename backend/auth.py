"""JWT token helpers and auth decorators."""

from datetime import datetime, timedelta, timezone
from functools import wraps

import jwt
from flask import g, jsonify, request

from config import Config

JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 24


def generate_token(cp: dict) -> str:
    """Given a CP record, issue a 24h JWT. Includes role for routing."""
    payload = {
        "cp_id": cp["id"],
        "cp_code": cp["cp_code"],
        "phone": cp["phone"],
        "is_admin": bool(cp.get("is_admin", False)),
        "role": cp.get("role") or "cp",
        "city_id": cp.get("city_id"),
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRY_HOURS),
    }
    return jwt.encode(payload, Config.JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    """Raises jwt.ExpiredSignatureError or jwt.InvalidTokenError."""
    return jwt.decode(token, Config.JWT_SECRET, algorithms=[JWT_ALGORITHM])


def require_auth(f):
    """Any authenticated user (CP, RM, or admin)."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return jsonify({"error": "Missing or invalid Authorization header"}), 401
        token = auth[7:].strip()
        try:
            payload = decode_token(token)
        except jwt.ExpiredSignatureError:
            return jsonify({"error": "Token expired. Please log in again."}), 401
        except jwt.InvalidTokenError:
            return jsonify({"error": "Invalid token"}), 401
        g.user = payload
        return f(*args, **kwargs)
    return wrapper


def require_staff(f):
    """RM or admin only. Used by /api/admin/* endpoints."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        # Reuse require_auth to set g.user
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return jsonify({"error": "Missing or invalid Authorization header"}), 401
        token = auth[7:].strip()
        try:
            payload = decode_token(token)
        except jwt.ExpiredSignatureError:
            return jsonify({"error": "Token expired. Please log in again."}), 401
        except jwt.InvalidTokenError:
            return jsonify({"error": "Invalid token"}), 401
        g.user = payload

        role = payload.get("role", "cp")
        if role not in ("rm", "admin"):
            return jsonify({"error": "Forbidden"}), 403
        return f(*args, **kwargs)
    return wrapper