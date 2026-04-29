"""
plan_guard.py — backend enforcement of plan-based feature limits.

All checks return (allowed: bool, error_message: str | None).
These are called from route handlers BEFORE performing operations.
They read the DB directly so they cannot be bypassed by manipulating the UI.
"""

from backend.saas.config.plans import get_plan
from backend.saas.models.subscription import get_subscription_by_user
from backend.saas.models.session import get_active_session_count
from backend.saas.models.project import get_project_count_by_user
from backend.saas.models.quiz import get_quiz_count_by_project


def _get_plan_limits(user_id: str):
    sub = get_subscription_by_user(user_id)
    plan_code = sub["plan_code"] if sub else "free"
    return get_plan(plan_code), plan_code


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
