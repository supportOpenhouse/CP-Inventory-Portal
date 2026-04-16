"""GET /api/health — reports DB pool status."""

from flask import Blueprint, jsonify

from db import health_check

bp = Blueprint("health", __name__, url_prefix="/api")


@bp.get("/health")
def health():
    status = health_check()
    all_ok = (
        status["app"] == "ok"
        and status["properties"] in ("ok", "not configured")
    )
    http_status = 200 if all_ok else 503
    return jsonify({"ok": all_ok, "databases": status}), http_status
