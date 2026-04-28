"""
Simple database-backed rate limiter for auth actions.

Tracks attempts in the auth_rate_limits table and enforces configurable
cooldowns per (action, identifier) pair.
"""

import logging
from backend.saas.db.base import fetch_one, execute

logger = logging.getLogger(__name__)


def record_attempt(action: str, identifier: str) -> None:
    """Record a rate-limited action attempt."""
    try:
        execute(
            "INSERT INTO auth_rate_limits (action, identifier) VALUES (%s, %s)",
            (action, identifier),
        )
    except Exception:
        logger.warning("Failed to record rate limit attempt", exc_info=True)


def check_rate_limit(
    action: str,
    identifier: str,
    max_attempts: int,
    window_seconds: int,
) -> bool:
    """
    Check if the identifier has exceeded the rate limit for this action.

    Returns True if the request should be ALLOWED, False if it should be BLOCKED.
    """
    try:
        row = fetch_one(
            """
            SELECT count(*) AS cnt
            FROM auth_rate_limits
            WHERE action = %s
              AND identifier = %s
              AND created_at > now() - make_interval(secs => %s)
            """,
            (action, identifier, window_seconds),
        )
        count = row["cnt"] if row else 0
        return count < max_attempts
    except Exception:
        logger.warning("Rate limit check failed, allowing request", exc_info=True)
        return True


def cleanup_old_records(max_age_hours: int = 24) -> int:
    """Delete rate limit records older than max_age_hours. Returns count deleted."""
    try:
        row = fetch_one(
            """
            WITH deleted AS (
                DELETE FROM auth_rate_limits
                WHERE created_at < now() - make_interval(hours => %s)
                RETURNING 1
            )
            SELECT count(*) AS cnt FROM deleted
            """,
            (max_age_hours,),
        )
        return row["cnt"] if row else 0
    except Exception:
        logger.warning("Rate limit cleanup failed", exc_info=True)
        return 0
