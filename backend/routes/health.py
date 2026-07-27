"""GET /api/health — reports DB pool status. GET /api/version — update gate."""

import os

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


@bp.get("/version")
def version():
    """Client update gate. `force_reload_after` is an epoch-ms threshold set via
    the FORCE_RELOAD_AFTER env var: any client whose build predates it is told
    to force-apply the waiting update (the "push a hotfix now" kill-switch).
    0 / unset = no forced reload. Public, no auth."""
    try:
        force_after = int(os.getenv("FORCE_RELOAD_AFTER", "0") or 0)
    except ValueError:
        force_after = 0
    return jsonify({"force_reload_after": force_after}), 200
