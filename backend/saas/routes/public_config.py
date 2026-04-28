from flask import Blueprint
from backend.saas.config.plans import PLANS, DEFAULT_PLAN
from backend.saas.utils.responses import success

bp = Blueprint("public_config", __name__, url_prefix="/api/config")


def _plan_to_dict(code: str, p) -> dict:
    return {
        "code": code,
        "name": p.display_name,
        "price": p.price_monthly,
        "period": "forever" if code == "free" else "/month",
        "tagline": p.description,
        "description": p.description,
        "recommended": code == "pro",
        "cta": "Get started" if code == "free" else "Start free trial",
        "features": [],
        "limits": {
            "maxActiveSessions": p.max_active_sessions,
            "maxProjects": p.max_projects,
            "maxQuizzesPerProject": p.max_quizzes_per_project,
        },
        "flags": {
            "x2Enabled": p.x2_enabled,
            "ttsEnabled": p.tts_enabled,
            "aiEnabled": p.tts_enabled,
            "musicEnabled": p.tts_enabled,
        },
    }


@bp.get("/public")
def get_public_config():
    """Return platform configuration.

    Currently returns plan data derived from the backend plan definitions.
    The frontend merges this with its local defaults for any missing fields.
    When the Super Admin panel is built, this will read from the database
    instead of from the hardcoded PLANS dict.
    """
    plans = [_plan_to_dict(code, p) for code, p in PLANS.items()]

    return success({
        "plans": plans,
        "defaultPlanCode": DEFAULT_PLAN,
    })
