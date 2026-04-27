from flask import Blueprint, request, g
from backend.saas.auth.password import hash_password, verify_password
from backend.saas.auth.jwt_handler import generate_token
from backend.saas.auth.middleware import require_auth
from backend.saas.models.user import create_user, get_user_by_email, get_user_with_plan, email_exists
from backend.saas.utils.validators import is_valid_email, is_valid_password
from backend.saas.utils.responses import success, error, serialize_row

bp = Blueprint("auth", __name__, url_prefix="/api/auth")


@bp.post("/register")
def register():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not is_valid_email(email):
        return error("Invalid email address")

    valid, msg = is_valid_password(password)
    if not valid:
        return error(msg)

    if email_exists(email):
        return error("Email already registered", 409)

    user = create_user(email, hash_password(password))
    token = generate_token(str(user["id"]), is_admin=bool(user.get("is_admin", False)))
    return success({"token": token, "user": serialize_row(user)}, 201)


@bp.post("/login")
def login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not email or not password:
        return error("Email and password are required")

    user = get_user_by_email(email)
    if not user or not verify_password(password, user["password_hash"]):
        return error("Invalid credentials", 401)

    if not user["is_active"]:
        return error("Account is disabled", 403)

    token = generate_token(str(user["id"]), is_admin=bool(user.get("is_admin", False)))
    safe_user = {k: v for k, v in user.items() if k != "password_hash"}
    return success({"token": token, "user": serialize_row(safe_user)})


@bp.get("/me")
@require_auth
def me():
    user = get_user_with_plan(g.current_user_id)
    if not user:
        return error("User not found", 404)
    return success({"user": serialize_row(user)})
