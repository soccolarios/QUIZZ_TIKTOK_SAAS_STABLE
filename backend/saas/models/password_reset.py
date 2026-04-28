"""
Password reset token CRUD.

Tokens are SHA-256 hashed before storage. The raw token is sent in the
reset link and never persisted.
"""

from datetime import datetime, timezone
from backend.saas.db.base import fetch_one, execute


def create_reset_token(user_id: str, token_hash: str, expires_at: datetime) -> dict:
    return fetch_one(
        """
        INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
        VALUES (%s, %s, %s)
        RETURNING id, user_id, token_hash, expires_at, created_at
        """,
        (user_id, token_hash, expires_at),
    )


def get_valid_token(token_hash: str) -> dict | None:
    """Return the token row if it exists, is not consumed, and has not expired."""
    return fetch_one(
        """
        SELECT id, user_id, token_hash, expires_at, consumed_at, created_at
        FROM password_reset_tokens
        WHERE token_hash = %s
          AND consumed_at IS NULL
          AND expires_at > now()
        """,
        (token_hash,),
    )


def consume_token(token_id: str) -> None:
    execute(
        "UPDATE password_reset_tokens SET consumed_at = now() WHERE id = %s",
        (token_id,),
    )


def invalidate_user_tokens(user_id: str) -> None:
    """Mark all unconsumed tokens for this user as consumed (prevents reuse)."""
    execute(
        """
        UPDATE password_reset_tokens
        SET consumed_at = now()
        WHERE user_id = %s AND consumed_at IS NULL
        """,
        (user_id,),
    )
