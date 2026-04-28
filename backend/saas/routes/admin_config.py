"""
Admin config routes -- Super Admin only.

GET  /api/admin/config/<key>   -- read a config namespace
PUT  /api/admin/config/<key>   -- upsert a config namespace
POST /api/admin/config/test-email -- send a test email

Keys: site_config, plans, feature_flags, mailjet, api_keys, sound_bank

Security:
  - Secrets are masked on read (write-only) for mailjet and api_keys
  - PUT preserves existing secrets when masked placeholder values are sent
  - Test email is rate-limited
"""

import json
import logging
from flask import Blueprint, request as req
from backend.saas.auth.middleware import require_auth
from backend.saas.db.base import fetch_one, execute
from backend.saas.utils.responses import success, error

logger = logging.getLogger(__name__)
bp = Blueprint("admin_config", __name__, url_prefix="/api/admin/config")

ALLOWED_KEYS = {"site_config", "plans", "feature_flags", "mailjet", "api_keys", "sound_bank"}

_MASK_PLACEHOLDER = "********"


def _require_admin():
    from flask import g
    if not g.get("current_user_is_admin"):
        return error("Forbidden", 403)
    return None


def _mask_secret(value: str | None) -> str:
    """Mask a secret key for display. Shows first 4 + last 4 chars if long enough."""
    if not value:
        return ""
    if len(value) <= 8:
        return _MASK_PLACEHOLDER
    return value[:4] + _MASK_PLACEHOLDER + value[-4:]


def _mask_mailjet_config(cfg: dict | None) -> dict | None:
    """Return a copy of the mailjet config with secrets masked."""
    if not cfg:
        return cfg
    masked = dict(cfg)
    if masked.get("api_key"):
        masked["api_key"] = _mask_secret(masked["api_key"])
    if masked.get("secret_key"):
        masked["secret_key"] = _mask_secret(masked["secret_key"])
    masked["_secrets_masked"] = True
    return masked


_API_KEY_SECRET_FIELDS = {
    "openai_api_key", "elevenlabs_api_key", "azure_tts_key", "tiktok_api_key",
}


def _mask_api_keys_config(cfg: dict | None) -> dict | None:
    """Return a copy of the api_keys config with all secret values masked."""
    if not cfg:
        return cfg
    masked = dict(cfg)
    for field in _API_KEY_SECRET_FIELDS:
        if masked.get(field):
            masked[field] = _mask_secret(masked[field])
    masked["_secrets_masked"] = True
    return masked


def _merge_secrets(new_config: dict, existing_config: dict | None, secret_fields: set[str]) -> dict:
    """
    Generic secret merge: preserve existing secrets when masked/unchanged values are submitted.
    """
    if not existing_config:
        return new_config
    merged = dict(new_config)
    merged.pop("_secrets_masked", None)
    for field in secret_fields:
        submitted = merged.get(field, "")
        if _is_masked_value(submitted) or submitted == "":
            existing_val = existing_config.get(field)
            if existing_val:
                merged[field] = existing_val
    return merged


def _is_masked_value(value: str | None) -> bool:
    """Check if a value is a masked placeholder (should not be persisted)."""
    if not value:
        return False
    return _MASK_PLACEHOLDER in value


def _merge_mailjet_secrets(new_config: dict, existing_config: dict | None) -> dict:
    return _merge_secrets(new_config, existing_config, {"api_key", "secret_key"})


@bp.get("/<key>")
@require_auth
def get_config(key: str):
    denied = _require_admin()
    if denied:
        return denied

    if key not in ALLOWED_KEYS:
        return error("Unknown config key", 404)

    row = fetch_one(
        "SELECT value, updated_at FROM platform_config WHERE key = %s",
        (key,),
    )
    if not row:
        return success({"key": key, "value": None, "updated_at": None})

    value = row["value"]

    if key == "mailjet":
        value = _mask_mailjet_config(value)
    elif key == "api_keys":
        value = _mask_api_keys_config(value)

    return success({
        "key": key,
        "value": value,
        "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
    })


@bp.put("/<key>")
@require_auth
def put_config(key: str):
    denied = _require_admin()
    if denied:
        return denied

    if key not in ALLOWED_KEYS:
        return error("Unknown config key", 404)

    body = req.get_json(silent=True)
    if not body or "value" not in body:
        return error("Request body must contain 'value'", 400)

    value = body["value"]

    if key in ("mailjet", "api_keys") and isinstance(value, dict):
        existing_row = fetch_one(
            "SELECT value FROM platform_config WHERE key = %s",
            (key,),
        )
        existing_config = existing_row["value"] if existing_row else None
        if key == "mailjet":
            value = _merge_mailjet_secrets(value, existing_config)
        else:
            value = _merge_secrets(value, existing_config, _API_KEY_SECRET_FIELDS)

    from flask import g
    user_id = g.current_user_id

    execute(
        """
        INSERT INTO platform_config (key, value, updated_at, updated_by)
        VALUES (%s, %s, now(), %s)
        ON CONFLICT (key) DO UPDATE
          SET value = EXCLUDED.value,
              updated_at = now(),
              updated_by = EXCLUDED.updated_by
        """,
        (key, json.dumps(value), user_id),
    )

    logger.info("Admin config updated: key=%s by user=%s", key, user_id)
    return success({"key": key, "saved": True})


@bp.post("/test-email")
@require_auth
def test_email():
    """Send a test email to verify Mailjet configuration. Rate-limited."""
    denied = _require_admin()
    if denied:
        return denied

    from flask import g
    from backend.saas.services.rate_limiter import check_rate_limit, record_attempt

    admin_id = str(g.current_user_id)
    if not check_rate_limit("test_email", admin_id, max_attempts=3, window_seconds=300):
        return error("Too many test emails. Please wait a few minutes.", 429)

    body = req.get_json(silent=True) or {}
    to_email = (body.get("email") or "").strip()
    if not to_email:
        return error("email is required")

    from backend.saas.services.email_templates import render_test_email
    from backend.saas.services.email_service import send_email

    record_attempt("test_email", admin_id)

    subject, html, text = render_test_email(to_email)
    sent = send_email(
        to_email=to_email, to_name=to_email, subject=subject,
        html_body=html, text_body=text,
        template_key="test_email",
    )

    if sent:
        return success({"sent": True, "message": f"Test email sent to {to_email}"})
    return error("Failed to send test email. Check Mailjet configuration.", 502)
