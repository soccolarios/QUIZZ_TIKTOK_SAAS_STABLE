import logging
import os
from flask import Flask, jsonify, request

from backend.saas.config import settings
from backend.saas.routes.auth import bp as auth_bp
from backend.saas.routes.projects import bp as projects_bp
from backend.saas.routes.quizzes import bp as quizzes_bp
from backend.saas.routes.sessions import bp as sessions_bp
from backend.saas.routes.overlay import bp as overlay_bp
from backend.saas.routes.billing import bp as billing_bp
from backend.saas.routes.analytics import bp as analytics_bp
from backend.saas.routes.ai import bp as ai_bp
from backend.saas.routes.music import bp as music_bp
from backend.saas.routes.public_config import bp as public_config_bp
from backend.saas.routes.admin_config import bp as admin_config_bp
from backend.saas.routes.admin_billing import bp as admin_billing_bp

logger = logging.getLogger(__name__)


def create_app() -> Flask:
    frontend_dir = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "../../frontend")
    )
    app = Flask(__name__, static_folder=frontend_dir, static_url_path="/overlay-assets")
    app.config["JSON_SORT_KEYS"] = False

    @app.after_request
    def _cors(response):
        origin = request.headers.get("Origin", "")
        allowed = settings.CORS_ORIGINS
        if origin in allowed or not settings.IS_PRODUCTION:
            response.headers["Access-Control-Allow-Origin"] = origin or "*"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
        return response

    @app.before_request
    def _options():
        if request.method == "OPTIONS":
            from flask import make_response
            resp = make_response("", 204)
            origin = request.headers.get("Origin", "")
            allowed = settings.CORS_ORIGINS
            if origin in allowed or not settings.IS_PRODUCTION:
                resp.headers["Access-Control-Allow-Origin"] = origin or "*"
                resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
                resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
            return resp

    app.register_blueprint(auth_bp)
    app.register_blueprint(projects_bp)
    app.register_blueprint(quizzes_bp)
    app.register_blueprint(sessions_bp)
    app.register_blueprint(overlay_bp)
    app.register_blueprint(billing_bp)
    app.register_blueprint(analytics_bp)
    app.register_blueprint(ai_bp)
    app.register_blueprint(music_bp)
    app.register_blueprint(public_config_bp)
    app.register_blueprint(admin_config_bp)
    app.register_blueprint(admin_billing_bp)

    @app.get("/api/health")
    def health():
        return jsonify({"ok": True, "service": "tiktok-quiz-saas"}), 200

    @app.errorhandler(404)
    def not_found(e):
        return jsonify({"error": "Not found"}), 404

    @app.errorhandler(405)
    def method_not_allowed(e):
        return jsonify({"error": "Method not allowed"}), 405

    @app.errorhandler(500)
    def internal_error(e):
        logger.exception("Internal server error")
        return jsonify({"error": "Internal server error"}), 500

    @app.errorhandler(Exception)
    def handle_exception(e):
        logger.exception("Unhandled exception: %s", e)
        return jsonify({"error": "Internal server error"}), 500

    return app


if __name__ == "__main__":
    app = create_app()
    app.run(host="0.0.0.0", port=settings.SAAS_PORT, debug=settings.FLASK_DEBUG)
