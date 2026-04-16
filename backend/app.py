"""Openhouse CP Inventory Portal — Flask app factory.

Run locally:
    python app.py

Run in production (Render, later):
    gunicorn "app:create_app()" --bind 0.0.0.0:$PORT
"""

from flask import Flask, jsonify
from flask_cors import CORS

from config import Config
from db import init_pools
from routes.health import bp as health_bp
from routes.auth_routes import bp as auth_bp
from routes.meta import bp as meta_bp
from routes.societies import bp as societies_bp
from routes.submissions import bp as submissions_bp


def create_app() -> Flask:
    Config.validate()

    app = Flask(__name__)
    app.config.from_object(Config)

    # CORS — allow only the configured frontend origin
    CORS(
        app,
        origins=[Config.FRONTEND_ORIGIN],
        supports_credentials=False,
    )

    init_pools()

    # Register blueprints
    app.register_blueprint(health_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(meta_bp)
    app.register_blueprint(societies_bp)
    app.register_blueprint(submissions_bp)

    # Global JSON error handlers
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

    # TODO: wire up flask-limiter for per-IP rate limits once OTP flow lands.

    return app


if __name__ == "__main__":
    app = create_app()
    app.run(host="127.0.0.1", port=5000, debug=(Config.ENV == "development"))
