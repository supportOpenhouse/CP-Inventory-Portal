"""Openhouse CP Inventory Portal — Flask app factory.

Run locally:
    python app.py

Run in production (later, via Render):
    gunicorn "app:create_app()" --bind 0.0.0.0:$PORT
"""

from flask import Flask, jsonify
from flask_cors import CORS

from config import Config
from db import init_pools
from routes.health import bp as health_bp


def create_app() -> Flask:
    # Fail fast if required env is missing
    Config.validate()

    app = Flask(__name__)
    app.config.from_object(Config)

    # CORS — only allow the configured frontend origin
    CORS(
        app,
        origins=[Config.FRONTEND_ORIGIN],
        supports_credentials=False,
    )

    # Initialize DB connection pools (once per process)
    init_pools()

    # Register blueprints
    app.register_blueprint(health_bp)
    # Future: auth_bp, societies_bp, submissions_bp, faqs_bp

    # Global error handlers — always return JSON
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
