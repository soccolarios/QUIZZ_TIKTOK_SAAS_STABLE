"""
plan_guard.py — backend enforcement of plan-based feature limits.

All checks return (allowed: bool, error_message: str | None).
These are called from route handlers BEFORE performing operations.
They read the DB directly so they cannot be bypassed by manipulating the UI.
"""

import logging

from backend.saas.config.plans import get_plan
from backend.saas.models.subscription import get_effective_plan_code
from backend.saas.models.session import get_active_session_count
from backend.saas.models.project import get_project_count_by_user
from backend.saas.models.quiz import get_quiz_count_by_project

logger = logging.getLogger(__name__)


def _get_plan_limits(user_id: str):
    plan_code = get_effective_plan_code(user_id)
    return get_plan(plan_code), plan_code


def _read_global_flags() -> dict:
    """Read global feature flags from platform_config. Returns {} on any failure."""
    try:
        from backend.saas.db.base import fetch_one
        row = fetch_one(
            "SELECT value FROM platform_config WHERE key = %s", ("feature_flags",)
        )
        if row and isinstance(row.get("value"), dict):
            return row["value"].get("flags") or {}
    except Exception:
        logger.debug("platform_config read failed for feature_flags", exc_info=True)
    return {}


def _is_feature_enabled(user_id: str, plan_attr: str, global_key: str) -> tuple[bool, str | None]:
    """
    Check if a feature is enabled for a user based on:
    1. Their plan allows it (plan_attr on PlanLimits)
    2. The global admin toggle allows it (global_key in platform_config)

    Both must be true. Global disable overrides all plans.
    """
    limits, plan_code = _get_plan_limits(user_id)

    plan_allows = getattr(limits, plan_attr, False)
    if not plan_allows:
        return (
            False,
            f"This feature is not available on the {limits.display_name} plan. "
            f"Upgrade to Pro or Premium to unlock it.",
        )

    global_flags = _read_global_flags()
    if global_flags and not global_flags.get(global_key, True):
        return (
            False,
            "This feature is temporarily disabled by the platform administrator.",
        )

    return True, None


# ── Capacity limits ──────────────────────────────────────────────────────────

def check_can_start_session(user_id: str, x2_requested: bool) -> tuple[bool, str | None]:
    limits, plan_code = _get_plan_limits(user_id)

    active_count = get_active_session_count(user_id)
    if active_count >= limits.max_active_sessions:
        return (
            False,
            f"Your {limits.display_name} plan allows {limits.max_active_sessions} active "
            f"session(s). Upgrade to run more sessions simultaneously.",
        )

    if x2_requested and not limits.x2_enabled:
        return (
            False,
            f"The X2 bonus mechanic is not available on the {limits.display_name} plan. "
            f"Upgrade to Pro or Premium to unlock it.",
        )

    if x2_requested:
        global_flags = _read_global_flags()
        if global_flags and not global_flags.get("x2Enabled", True):
            return (
                False,
                "The X2 bonus mechanic is temporarily disabled by the platform administrator.",
            )

    return True, None


def check_can_create_project(user_id: str) -> tuple[bool, str | None]:
    limits, _ = _get_plan_limits(user_id)
    count = get_project_count_by_user(user_id)
    if count >= limits.max_projects:
        return (
            False,
            f"Your plan allows up to {limits.max_projects} project(s). "
            f"Upgrade to create more.",
        )
    return True, None


def check_can_create_quiz(user_id: str, project_id: str) -> tuple[bool, str | None]:
    limits, _ = _get_plan_limits(user_id)
    count = get_quiz_count_by_project(project_id)
    if count >= limits.max_quizzes_per_project:
        return (
            False,
            f"Your plan allows up to {limits.max_quizzes_per_project} quiz(zes) per project. "
            f"Upgrade to add more.",
        )
    return True, None


# ── Feature flags ────────────────────────────────────────────────────────────

def check_can_use_ai(user_id: str) -> tuple[bool, str | None]:
    return _is_feature_enabled(user_id, "tts_enabled", "aiGeneratorEnabled")


def check_can_use_tts(user_id: str) -> tuple[bool, str | None]:
    return _is_feature_enabled(user_id, "tts_enabled", "ttsEnabled")


def check_can_use_music(user_id: str) -> tuple[bool, str | None]:
    return _is_feature_enabled(user_id, "tts_enabled", "musicEnabled")
