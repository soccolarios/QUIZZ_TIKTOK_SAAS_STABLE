"""
Startup validation — run before create_app() to fail fast with clear messages.

Checks:
  1. Required env vars are present and non-empty.
  2. JWT_SECRET is not the default placeholder.
  3. DATABASE_URL is reachable.
  4. Critical tables exist in the database.
"""

from __future__ import annotations

import sys
import logging

logger = logging.getLogger(__name__)

_REQUIRED_VARS = ["DATABASE_URL", "JWT_SECRET", "APP_BASE_URL", "SAAS_BASE_URL"]

_CRITICAL_TABLES = [
    "saas_users",
    "saas_projects",
    "saas_quizzes",
    "saas_game_sessions",
]

_PLACEHOLDER_SECRETS = {
    "change_me_in_production",
    "change_me_use_a_strong_random_secret",
    "change_me_use_a_strong_random_secret_min_32_chars",
    "secret",
    "jwt_secret",
}


def _fail(message: str) -> None:
    logger.critical("[STARTUP] %s", message)
    print(f"\n[STARTUP ERROR] {message}\n", file=sys.stderr)
    sys.exit(1)


def _warn(message: str) -> None:
    logger.warning("[STARTUP] %s", message)
    print(f"[STARTUP WARNING] {message}")


def check_required_env_vars() -> None:
    from backend.saas.config import settings

    missing = []
    for var in _REQUIRED_VARS:
        value = getattr(settings, var, None)
        if not value:
            missing.append(var)

    if missing:
        _fail(
            f"Missing required environment variables: {', '.join(missing)}\n"
            "  Set them in your .env file or system environment before starting."
        )

    if settings.JWT_SECRET in _PLACEHOLDER_SECRETS:
        _fail(
            "JWT_SECRET is set to a placeholder value.\n"
            "  Generate a strong secret: python3 -c \"import secrets; print(secrets.token_hex(32))\"\n"
            "  Then set JWT_SECRET=<generated_value> in your environment."
        )

    if len(settings.JWT_SECRET) < 32:
        _warn(
            "JWT_SECRET is shorter than 32 characters. "
            "Use a longer secret for better security."
        )

    if settings.IS_PRODUCTION and settings.FLASK_DEBUG:
        _warn("FLASK_DEBUG is enabled in production mode. Set FLASK_DEBUG=0.")


def check_database_connection() -> None:
    from backend.saas.config import settings

    try:
        import psycopg2
        conn = psycopg2.connect(settings.DATABASE_URL, connect_timeout=5)
        conn.close()
    except ImportError:
        _fail("psycopg2 is not installed. Run: pip install psycopg2-binary")
    except Exception as e:
        _fail(
            f"Cannot connect to the database: {e}\n"
            f"  DATABASE_URL: {settings.DATABASE_URL[:40]}...\n"
            "  Verify the database is running and the credentials are correct."
        )


def check_critical_tables() -> None:
    from backend.saas.config import settings

    try:
        import psycopg2
        import psycopg2.extras
        conn = psycopg2.connect(settings.DATABASE_URL, connect_timeout=5)
        cur = conn.cursor()
        missing_tables = []
        for table in _CRITICAL_TABLES:
            cur.execute(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = %s)",
                (table,),
            )
            row = cur.fetchone()
            if not row or not row[0]:
                missing_tables.append(table)
        cur.close()
        conn.close()

        if missing_tables:
            _fail(
                f"Critical database tables are missing: {', '.join(missing_tables)}\n"
                "  Run the database bootstrap to create all required tables:\n"
                "    python3 -m backend.saas.db.bootstrap\n"
                "  Or apply migrations manually from supabase/migrations/"
            )
    except Exception as e:
        _fail(f"Error checking database tables: {e}")


def check_gunicorn_workers() -> None:
    import os
    raw = os.environ.get("WEB_CONCURRENCY") or os.environ.get("GUNICORN_WORKERS")
    if raw and raw.strip() not in ("", "1"):
        _warn(
            f"Gunicorn workers detected as {raw}. "
            "SessionManager is an in-memory singleton — workers MUST be 1. "
            "Set workers=1 in gunicorn.conf.py or unset WEB_CONCURRENCY."
        )


def run_startup_checks() -> None:
    print("[STARTUP] Running pre-flight checks...")
    check_required_env_vars()
    print("[STARTUP] ✓ Environment variables OK")
    check_gunicorn_workers()
    check_database_connection()
    print("[STARTUP] ✓ Database connection OK")
    check_critical_tables()
    print("[STARTUP] ✓ Database schema OK")
    print("[STARTUP] All checks passed. Starting server.")
