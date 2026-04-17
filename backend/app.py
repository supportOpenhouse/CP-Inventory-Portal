"""Openhouse CP Inventory Portal — Flask app factory.

Run locally:
    python app.py

Run in production (Render):
    gunicorn "app:create_app()" --bind 0.0.0.0:$PORT
"""

import logging

from flask import Flask, jsonify
from flask_cors import CORS

from config import Config
from db import init_pools
from routes.admin import bp as admin_bp
from routes.auth_routes import bp as auth_bp
from routes.health import bp as health_bp
from routes.meta import bp as meta_bp
from routes.societies import bp as societies_bp
from routes.submissions import bp as submissions_bp


def create_app() -> Flask:
    Config.validate()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    app = Flask(__name__)
    app.config.from_object(Config)

    CORS(app, origins=[Config.FRONTEND_ORIGIN], supports_credentials=False)

    init_pools()

    app.register_blueprint(health_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(meta_bp)
    app.register_blueprint(societies_bp)
    app.register_blueprint(submissions_bp)
    app.register_blueprint(admin_bp)

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