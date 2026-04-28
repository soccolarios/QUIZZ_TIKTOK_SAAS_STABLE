"""
Mailjet email service — sends transactional emails with HTML + text fallback.

Configuration priority:
  1. platform_config 'mailjet' key (admin-configurable at runtime)
  2. Environment variables (MAILJET_API_KEY, etc.)
  3. Disabled (logs but does not send)

All sends are logged to the email_log table regardless of outcome.
"""

import hashlib
import hmac
import json
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from urllib.request import Request, urlopen
from urllib.error import URLError

from backend.saas.config import settings
from backend.saas.db.base import fetch_one, execute

logger = logging.getLogger(__name__)

_MAILJET_SEND_URL = "https://api.mailjet.com/v3.1/send"


def _get_mailjet_config() -> dict:
    """Resolve Mailjet config: DB first, then env vars."""
    try:
        row = fetch_one(
            "SELECT value FROM platform_config WHERE key = 'mailjet'",
        )
        if row and row.get("value"):
            cfg = row["value"]
            if cfg.get("api_key") and cfg.get("secret_key"):
                return cfg
    except Exception:
        logger.debug("Could not read mailjet config from DB, falling back to env")

    api_key = settings.MAILJET_API_KEY
    secret_key = settings.MAILJET_SECRET_KEY
    if not api_key or not secret_key:
        return {}

    return {
        "api_key": api_key,
        "secret_key": secret_key,
        "sender_email": settings.MAILJET_SENDER_EMAIL,
        "sender_name": settings.MAILJET_SENDER_NAME,
    }


def _get_sender(cfg: dict) -> tuple[str, str]:
    """Return (email, name) for the From field."""
    email = cfg.get("sender_email") or settings.MAILJET_SENDER_EMAIL or "noreply@livegine.com"
    name = cfg.get("sender_name") or settings.MAILJET_SENDER_NAME or "LiveGine"
    return email, name


def _is_email_enabled() -> bool:
    """Check if email sending is globally enabled via feature flags."""
    try:
        row = fetch_one(
            "SELECT value FROM platform_config WHERE key = 'feature_flags'",
        )
        if row and row.get("value"):
            flags = row["value"]
            if isinstance(flags, dict):
                inner = flags.get("flags", flags)
                return inner.get("emailEnabled", True)
    except Exception:
        pass
    return True


def _log_email(
    user_id: str | None,
    recipient_email: str,
    template_key: str,
    subject: str,
    provider: str,
    provider_message_id: str | None,
    status: str,
    error_message: str | None = None,
) -> None:
    try:
        execute(
            """
            INSERT INTO email_log
              (user_id, recipient_email, template_key, subject, provider,
               provider_message_id, status, error_message)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (user_id, recipient_email, template_key, subject, provider,
             provider_message_id, status, error_message),
        )
    except Exception:
        logger.warning("Failed to log email send", exc_info=True)


def send_email(
    to_email: str,
    to_name: str,
    subject: str,
    html_body: str,
    text_body: str,
    template_key: str,
    user_id: str | None = None,
) -> bool:
    """
    Send a transactional email via Mailjet.

    Returns True if sent successfully, False otherwise.
    Failures are logged but never raise — email must not break caller flows.
    """
    if not _is_email_enabled():
        logger.info("Email disabled globally, skipping %s to %s", template_key, to_email)
        _log_email(user_id, to_email, template_key, subject, "none", None, "skipped", "Email disabled globally")
        return False

    cfg = _get_mailjet_config()
    if not cfg:
        logger.warning("Mailjet not configured, skipping %s to %s", template_key, to_email)
        _log_email(user_id, to_email, template_key, subject, "none", None, "skipped", "Mailjet not configured")
        return False

    sender_email, sender_name = _get_sender(cfg)

    payload = {
        "Messages": [
            {
                "From": {"Email": sender_email, "Name": sender_name},
                "To": [{"Email": to_email, "Name": to_name}],
                "Subject": subject,
                "HTMLPart": html_body,
                "TextPart": text_body,
            }
        ]
    }

    try:
        import base64
        credentials = base64.b64encode(
            f"{cfg['api_key']}:{cfg['secret_key']}".encode()
        ).decode()

        req = Request(
            _MAILJET_SEND_URL,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Basic {credentials}",
            },
            method="POST",
        )

        with urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode("utf-8"))

        messages = result.get("Messages", [])
        msg_id = None
        if messages and messages[0].get("To"):
            msg_id = str(messages[0]["To"][0].get("MessageID", ""))

        _log_email(user_id, to_email, template_key, subject, "mailjet", msg_id, "sent")
        logger.info("Email sent: %s to %s (message_id=%s)", template_key, to_email, msg_id)
        return True

    except URLError as e:
        err_msg = str(e)
        logger.error("Mailjet send failed for %s to %s: %s", template_key, to_email, err_msg)
        _log_email(user_id, to_email, template_key, subject, "mailjet", None, "failed", err_msg)
        return False
    except Exception as e:
        err_msg = str(e)
        logger.error("Mailjet send failed for %s to %s: %s", template_key, to_email, err_msg, exc_info=True)
        _log_email(user_id, to_email, template_key, subject, "mailjet", None, "failed", err_msg)
        return False


def generate_reset_token() -> tuple[str, str]:
    """
    Generate a password reset token.

    Returns (raw_token, token_hash).
    The raw_token goes in the email link. The token_hash is stored in the DB.
    """
    raw_token = secrets.token_urlsafe(48)
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    return raw_token, token_hash


def hash_token(raw_token: str) -> str:
    """Hash a raw token for DB lookup."""
    return hashlib.sha256(raw_token.encode()).hexdigest()
