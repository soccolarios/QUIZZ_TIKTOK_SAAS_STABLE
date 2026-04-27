from functools import wraps
from flask import request, jsonify, g
from backend.saas.auth.jwt_handler import verify_token
from backend.saas.models.user import get_user_by_id


def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"error": "Missing or invalid Authorization header"}), 401
        token = auth_header[7:]
        user_id = verify_token(token)
        if not user_id:
            return jsonify({"error": "Invalid or expired token"}), 401
        user = get_user_by_id(user_id)
        if not user or not user["is_active"]:
            return jsonify({"error": "User not found or inactive"}), 401
        g.current_user = dict(user)
        g.current_user_id = str(user["id"])
        g.current_user_is_admin = bool(user.get("is_admin", False))
        return f(*args, **kwargs)
    return decorated
