"""Openhouse CP Inventory Portal — Flask app factory.

Run locally:
    python app.py

Run in production (Render):
    gunicorn "app:create_app()" --bind 0.0.0.0:$PORT
"""

import logging

from flask import Flask, jsonify, request
from flask_cors import CORS

from config import Config
from db import init_pools
from routes.admin import bp as admin_bp
from routes.auth_routes import bp as auth_bp
from routes.comet import bp as comet_bp
from routes.health import bp as health_bp
from routes.media import bp as media_bp
from routes.meta import bp as meta_bp
from routes.societies import bp as societies_bp
from routes.relay import bp as relay_bp
from routes.submissions import bp as submissions_bp
from routes.sync import bp as sync_bp
from routes.tickets import bp as tickets_bp
from routes.webhooks import bp as webhooks_bp


def create_app() -> Flask:
    Config.validate()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    app = Flask(__name__)
    app.config.from_object(Config)
    # Cap request bodies a hair above the 100 MB video limit (multipart
    # overhead) so the media-upload proxy accepts max-size videos but oversize
    # bodies are rejected with a clean 413.
    app.config["MAX_CONTENT_LENGTH"] = 110 * 1024 * 1024

    CORS(app, origins=[Config.FRONTEND_ORIGIN], supports_credentials=False)

    @app.before_request
    def _csrf_origin_guard():
        # CSRF defense-in-depth for cookie-auth browser requests. SameSite=Lax
        # already withholds the cookie from cross-site state-changing requests;
        # this rejects any mutating /api call that DOES ride the session cookie
        # but whose Origin/Referer isn't our SPA. Header-authenticated callers
        # (partner relay, Interakt webhooks, sync/cron secrets, impersonation
        # Bearer) are checked too only if they also carry the cookie — which
        # server-to-server callers never do — so they're unaffected.
        # ponytail: SameSite=Lax + this Origin check; add double-submit CSRF
        # tokens only if a stricter audit demands it.
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return
        if not request.path.startswith("/api/"):
            return
        if not request.cookies.get(Config.AUTH_COOKIE_NAME):
            return
        origin = request.headers.get("Origin")
        if origin is not None:
            if origin != Config.FRONTEND_ORIGIN:
                return jsonify({"error": "Cross-origin request blocked"}), 403
            return
        referer = request.headers.get("Referer", "")
        if referer == Config.FRONTEND_ORIGIN or referer.startswith(Config.FRONTEND_ORIGIN + "/"):
            return
        return jsonify({"error": "Cross-origin request blocked"}), 403

    init_pools()

    app.register_blueprint(health_bp)
    app.register_blueprint(media_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(meta_bp)
    app.register_blueprint(societies_bp)
    app.register_blueprint(relay_bp)
    app.register_blueprint(submissions_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(sync_bp)
    app.register_blueprint(tickets_bp)
    app.register_blueprint(comet_bp)
    app.register_blueprint(webhooks_bp)

    @app.errorhandler(400)
    def bad_request(e):
        return jsonify({"error": "Bad request"}), 400

    @app.errorhandler(404)
    def not_found(e):
        return jsonify({"error": "Not found"}), 404

    @app.errorhandler(405)
    def method_not_allowed(e):
        return jsonify({"error": "Method not allowed"}), 405

    @app.errorhandler(500)
    def server_error(e):
        return jsonify({"error": "Internal server error"}), 500

    return app


if __name__ == "__main__":
    app = create_app()
    app.run(host="127.0.0.1", port=5000, debug=(Config.ENV == "development"))