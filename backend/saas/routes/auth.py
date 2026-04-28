import logging
from datetime import datetime, timedelta, timezone

from flask import Blueprint, request, g
from backend.saas.auth.password import hash_password, verify_password
from backend.saas.auth.jwt_handler import generate_token
from backend.saas.auth.middleware import require_auth
from backend.saas.models.user import (
    create_user, get_user_by_email, get_user_with_plan,
    email_exists, get_user_by_id, update_password,
)
from backend.saas.models.password_reset import (
    create_reset_token, get_valid_token, consume_token, invalidate_user_tokens,
)
from backend.saas.services.email_service import send_email, generate_reset_token, hash_token
from backend.saas.services.email_templates import (
    render_welcome, render_password_reset, render_password_changed,
)
from backend.saas.config import settings
from backend.saas.utils.validators import is_valid_email, is_valid_password
from backend.saas.utils.responses import success, error, serialize_row

logger = logging.getLogger(__name__)
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

    subject, html, text = render_welcome(email)
    send_email(
        to_email=email, to_name=email, subject=subject,
        html_body=html, text_body=text,
        template_key="welcome", user_id=str(user["id"]),
    )

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


@bp.post("/request-reset")
def request_reset():
    """
    Request a password reset email.

    Body: { "email": "user@example.com" }

    Always returns 200 to prevent email enumeration.
    """
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()

    if not email:
        return success({"sent": True})

    user = get_user_by_email(email)
    if not user or not user["is_active"]:
        return success({"sent": True})

    invalidate_user_tokens(str(user["id"]))

    raw_token, token_hash_val = generate_reset_token()
    expiry_minutes = settings.PASSWORD_RESET_EXPIRY_MINUTES
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=expiry_minutes)

    create_reset_token(
        user_id=str(user["id"]),
        token_hash=token_hash_val,
        expires_at=expires_at,
    )

    reset_url = f"{settings.APP_BASE_URL}/reset-password?token={raw_token}"

    subject, html, text = render_password_reset(email, reset_url, expiry_minutes)
    send_email(
        to_email=email, to_name=email, subject=subject,
        html_body=html, text_body=text,
        template_key="password_reset", user_id=str(user["id"]),
    )

    logger.info("Password reset requested for %s", email)
    return success({"sent": True})


@bp.post("/confirm-reset")
def confirm_reset():
    """
    Confirm a password reset with the token from the email link.

    Body: { "token": "...", "password": "new_password" }
    """
    data = request.get_json(silent=True) or {}
    raw_token = (data.get("token") or "").strip()
    new_password = data.get("password") or ""

    if not raw_token:
        return error("Reset token is required")

    valid, msg = is_valid_password(new_password)
    if not valid:
        return error(msg)

    token_hash_val = hash_token(raw_token)
    token_row = get_valid_token(token_hash_val)

    if not token_row:
        return error("Invalid or expired reset link. Please request a new one.", 400)

    user_id = str(token_row["user_id"])
    user = get_user_by_id(user_id)
    if not user:
        return error("User not found", 404)

    update_password(user_id, hash_password(new_password))
    consume_token(str(token_row["id"]))
    invalidate_user_tokens(user_id)

    subject, html, text = render_password_changed(user["email"])
    send_email(
        to_email=user["email"], to_name=user["email"], subject=subject,
        html_body=html, text_body=text,
        template_key="password_changed", user_id=user_id,
    )

    logger.info("Password reset confirmed for user %s", user_id)
    return success({"reset": True})
