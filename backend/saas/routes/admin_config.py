"""
Admin config routes -- Super Admin only.

GET  /api/admin/config/<key>   -- read a config namespace
PUT  /api/admin/config/<key>   -- upsert a config namespace

Keys: site_config, plans, feature_flags, mailjet, api_keys, sound_bank

Security:
  - Secrets are masked on read (write-only) for mailjet and api_keys
  - PUT preserves existing secrets when masked placeholder values are sent
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
    if not value:
        return ""
    if len(value) <= 8:
        return _MASK_PLACEHOLDER
    return value[:4] + _MASK_PLACEHOLDER + value[-4:]


def _is_masked_value(value: str | None) -> bool:
    if not value:
        return False
    return _MASK_PLACEHOLDER in value


def _merge_secrets(new_config: dict, existing_config: dict | None, secret_fields: set[str]) -> dict:
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


_MAILJET_SECRETS = {"api_key", "secret_key"}
_API_KEY_SECRETS = {"openai_api_key", "elevenlabs_api_key", "azure_tts_key", "tiktok_api_key"}


def _mask_config(cfg: dict | None, secret_fields: set[str]) -> dict | None:
    if not cfg:
        return cfg
    masked = dict(cfg)
    for field in secret_fields:
        if masked.get(field):
            masked[field] = _mask_secret(masked[field])
    masked["_secrets_masked"] = True
    return masked


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
        value = _mask_config(value, _MAILJET_SECRETS)
    elif key == "api_keys":
        value = _mask_config(value, _API_KEY_SECRETS)

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
        secret_fields = _MAILJET_SECRETS if key == "mailjet" else _API_KEY_SECRETS
        value = _merge_secrets(value, existing_config, secret_fields)

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
