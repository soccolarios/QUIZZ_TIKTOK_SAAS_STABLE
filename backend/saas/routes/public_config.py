import logging

from flask import Blueprint
from backend.saas.config.plans import PLANS, DEFAULT_PLAN
from backend.saas.utils.responses import success

logger = logging.getLogger(__name__)

bp = Blueprint("public_config", __name__, url_prefix="/api/config")


# ---------------------------------------------------------------------------
# DB reader — returns None on any failure so defaults are always served
# ---------------------------------------------------------------------------

def _read_config(key: str):
    """Read a platform_config row by key. Returns the jsonb value or None."""
    try:
        from backend.saas.db.base import fetch_one
        row = fetch_one(
            "SELECT value FROM platform_config WHERE key = %s", (key,)
        )
        if row and row.get("value"):
            return row["value"]
    except Exception:
        logger.debug("platform_config read failed for key=%s, using defaults", key, exc_info=True)
    return None


# ---------------------------------------------------------------------------
# Hardcoded defaults (unchanged from before)
# ---------------------------------------------------------------------------

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
        "features": _plan_feature_list(code, p),
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


def _plan_feature_list(code: str, p) -> list[str]:
    s = f"{p.max_active_sessions} active session{'s' if p.max_active_sessions > 1 else ''}"
    pr = f"{p.max_projects} project{'s' if p.max_projects > 1 else ''}"
    q = f"{p.max_quizzes_per_project} quiz{'zes' if p.max_quizzes_per_project > 1 else ''}"
    base = [s, pr, q]
    if code == "free":
        return base + ["Simulation mode", "OBS overlay"]
    if code == "pro":
        return base + ["X2 bonus mechanic", "TTS audio", "Full analytics"]
    return base + ["Everything in Pro", "Priority support"]


_DEFAULT_BRAND = {
    "name": "LiveGine",
    "tagline": "Interactive live quiz experiences for your audience",
    "legalName": "LiveGine SaaS",
    "supportEmail": "support@livegine.com",
    "dashboardUrl": "https://app.livegine.com",
}

_FEATURE_GROUPS = [
    {
        "groupLabel": "Capacity",
        "iconName": "Layers",
        "rows": [
            {"label": "Active sessions", "values": {"free": "1", "pro": "5", "premium": "20"}},
            {"label": "Projects", "values": {"free": "1", "pro": "10", "premium": "100"}},
            {"label": "Quizzes per project", "values": {"free": "3", "pro": "50", "premium": "500"}},
        ],
    },
    {
        "groupLabel": "Live features",
        "iconName": "RadioTower",
        "rows": [
            {"label": "Simulation mode", "values": {"free": True, "pro": True, "premium": True}},
            {"label": "TikTok live mode", "values": {"free": True, "pro": True, "premium": True}},
            {"label": "Overlay URL", "values": {"free": True, "pro": True, "premium": True}},
            {"label": "Live control dashboard", "values": {"free": True, "pro": True, "premium": True}},
            {"label": "X2 bonus mechanic", "hint": "Double-score bonus round for top players",
             "values": {"free": False, "pro": True, "premium": True}},
        ],
    },
    {
        "groupLabel": "AI & audio",
        "iconName": "Cpu",
        "rows": [
            {"label": "AI quiz generation", "values": {"free": False, "pro": True, "premium": True}},
            {"label": "TTS voice narration", "hint": "Questions read aloud during live sessions",
             "values": {"free": False, "pro": True, "premium": True}},
            {"label": "Music controls", "values": {"free": False, "pro": True, "premium": True}},
            {"label": "Audio volume control", "values": {"free": False, "pro": True, "premium": True}},
        ],
    },
    {
        "groupLabel": "History & data",
        "iconName": "Mic",
        "rows": [
            {"label": "Session history", "values": {"free": True, "pro": True, "premium": True}},
            {"label": "Score persistence", "values": {"free": True, "pro": True, "premium": True}},
            {"label": "Activity logs", "values": {"free": True, "pro": True, "premium": True}},
        ],
    },
    {
        "groupLabel": "Support",
        "iconName": "HeartHandshake",
        "rows": [
            {"label": "Community support", "values": {"free": True, "pro": True, "premium": True}},
            {"label": "Priority support", "values": {"free": False, "pro": False, "premium": True}},
        ],
    },
]

_LANDING = {
    "features": [
        {"iconName": "MonitorPlay", "title": "Live overlay for OBS",
         "description": "Copy a single URL into OBS and your quiz appears instantly on stream. No complex setup."},
        {"iconName": "Users", "title": "TikTok LIVE comments",
         "description": "Participants answer in chat. The engine reads comments in real time and validates answers."},
        {"iconName": "Sparkles", "title": "X2 bonus mechanic",
         "description": "Activate a score multiplier mid-game to boost engagement and keep viewers hooked."},
        {"iconName": "BarChart2", "title": "Session analytics",
         "description": "Track every session: participants, scores, timing. Know what works."},
        {"iconName": "Globe", "title": "Simulation mode",
         "description": "Test your quiz without going live. Simulate answers and validate your setup safely."},
        {"iconName": "Shield", "title": "Multi-project",
         "description": "Organise quizzes by project. Run different themes for different shows or audiences."},
    ],
    "steps": [
        {"step": "01", "title": "Create your quiz",
         "description": "Add questions and answers in the dashboard. Takes 2 minutes."},
        {"step": "02", "title": "Copy the overlay URL",
         "description": "Paste it as a browser source in OBS. Size and position it."},
        {"step": "03", "title": "Go live on TikTok",
         "description": "Start your session from the dashboard. The engine connects automatically."},
        {"step": "04", "title": "Watch participants play",
         "description": "Viewers answer in chat. Scores update in real time on screen."},
    ],
    "faq": [
        {"q": "Do I need to install anything?",
         "a": "No. The dashboard is fully browser-based. Only OBS is needed on your streaming computer to display the overlay."},
        {"q": "Can I test without going live?",
         "a": "Yes. Simulation mode lets you run a full quiz session without a TikTok LIVE, so you can rehearse and validate your setup."},
        {"q": "What happens if I cancel my subscription?",
         "a": "Your account reverts to the Free plan at the end of the billing period. You keep access to your projects and quizzes."},
        {"q": "Can I run multiple sessions at the same time?",
         "a": "Yes, on Pro and Premium plans. Each session runs in full isolation with its own overlay URL and quiz engine."},
        {"q": "Is my data safe?",
         "a": "Yes. Each user's data is isolated. Sessions, quizzes and scores are stored securely and never shared."},
    ],
}

_AI = {
    "categories": [
        {"code": "culture", "label": "Culture g\u00e9n\u00e9rale", "emoji": "\U0001f30d",
         "theme": "Culture g\u00e9n\u00e9rale", "category": "culture_generale"},
        {"code": "sport", "label": "Sport", "emoji": "\u26bd",
         "theme": "Sport et comp\u00e9titions sportives", "category": "sport"},
        {"code": "cinema", "label": "Cin\u00e9ma", "emoji": "\U0001f3ac",
         "theme": "Cin\u00e9ma et films", "category": "cinema"},
        {"code": "sciences", "label": "Sciences", "emoji": "\U0001f52c",
         "theme": "Sciences et d\u00e9couvertes", "category": "sciences"},
        {"code": "histoire", "label": "Histoire", "emoji": "\U0001f4dc",
         "theme": "Histoire mondiale", "category": "histoire"},
        {"code": "musique", "label": "Musique", "emoji": "\U0001f3b5",
         "theme": "Musique et artistes", "category": "musique"},
        {"code": "geographie", "label": "G\u00e9ographie", "emoji": "\U0001f5fa\ufe0f",
         "theme": "G\u00e9ographie mondiale", "category": "geographie"},
        {"code": "tech", "label": "Technologie", "emoji": "\U0001f4bb",
         "theme": "Technologie et informatique", "category": "technologie"},
    ],
    "difficultyLevels": [
        {"value": 1, "label": "Facile", "description": "Questions accessibles \u00e0 tous"},
        {"value": 2, "label": "Moyen", "description": "Niveau interm\u00e9diaire"},
        {"value": 3, "label": "Difficile", "description": "Pour les experts"},
    ],
    "questionCounts": [5, 10, 15, 20],
    "questionStyles": [
        {"id": "standard", "label": "Standard", "desc": "Questions classiques"},
        {"id": "anecdote", "label": "Anecdotes", "desc": "Faits surprenants"},
        {"id": "chiffres", "label": "Chiffres", "desc": "Dates, stats, records"},
        {"id": "personnalites", "label": "Personnalit\u00e9s", "desc": "C\u00e9l\u00e9brit\u00e9s, \u0153uvres"},
    ],
    "supportedLanguages": [
        {"code": "fr", "label": "Fran\u00e7ais"},
        {"code": "en", "label": "English"},
        {"code": "es", "label": "Espa\u00f1ol"},
        {"code": "de", "label": "Deutsch"},
        {"code": "it", "label": "Italiano"},
        {"code": "pt", "label": "Portugu\u00eas"},
    ],
    "defaultLanguage": "fr",
    "defaultModel": "gpt-4o-mini",
    "defaultPreset": "culture",
    "defaultQuestionCount": 10,
    "defaultDifficulty": 2,
    "defaultStyle": "standard",
    "defaultAudience": "general",
    "quizTitlePrefix": "Quiz IA",
}

_SESSION = {
    "questionTimerMin": 5,
    "questionTimerMax": 120,
    "questionTimerDefault": 15,
    "countdownMin": 3,
    "countdownMax": 30,
    "countdownDefault": 5,
    "overlayTemplates": [
        {"value": "default", "label": "Default", "hint": "Animated gradient with depth orbs."},
        {"value": "football", "label": "Football", "hint": "Stadium-themed sports design."},
    ],
    "playModes": [
        {"value": "single", "label": "Single quiz", "hint": "Play the selected quiz once."},
        {"value": "loop_single", "label": "Loop this quiz", "hint": "Repeat the selected quiz continuously."},
        {"value": "sequential", "label": "All quizzes", "hint": "Play all project quizzes in order, once."},
        {"value": "loop_all", "label": "Loop all quizzes", "hint": "Cycle through all project quizzes continuously."},
    ],
}


# ---------------------------------------------------------------------------
# Merge helpers — DB values override defaults, shape is always preserved
# ---------------------------------------------------------------------------

def _resolve_brand() -> dict:
    """Merge site_config from DB into the default brand dict."""
    db = _read_config("site_config")
    if not db or not isinstance(db, dict):
        return dict(_DEFAULT_BRAND)

    return {
        "name": db.get("brandName") or _DEFAULT_BRAND["name"],
        "tagline": db.get("tagline") or _DEFAULT_BRAND["tagline"],
        "legalName": db.get("legalName") or _DEFAULT_BRAND["legalName"],
        "supportEmail": db.get("supportEmail") or _DEFAULT_BRAND["supportEmail"],
        "dashboardUrl": db.get("dashboardUrl") or _DEFAULT_BRAND["dashboardUrl"],
    }


def _resolve_plans() -> list[dict]:
    """Return plan list from DB if saved, otherwise from hardcoded PLANS."""
    db = _read_config("plans")
    if not db or not isinstance(db, list) or len(db) == 0:
        return [_plan_to_dict(code, p) for code, p in PLANS.items()]

    result = []
    for raw in db:
        if not isinstance(raw, dict):
            continue
        if raw.get("enabled") is False:
            continue
        code = raw.get("code", "")
        limits = raw.get("limits") or {}
        max_sessions = limits.get("maxActiveSessions", 1)
        max_projects = limits.get("maxProjects", 1)
        max_quizzes = limits.get("maxQuizzesPerProject", 3)
        result.append({
            "code": code,
            "name": raw.get("name", code),
            "price": raw.get("price", "$0"),
            "period": raw.get("period", "/month"),
            "tagline": raw.get("tagline", ""),
            "description": raw.get("tagline", ""),
            "recommended": bool(raw.get("recommended")),
            "cta": raw.get("cta", "Get started"),
            "features": _build_feature_list_from_limits(code, max_sessions, max_projects, max_quizzes),
            "limits": {
                "maxActiveSessions": max_sessions,
                "maxProjects": max_projects,
                "maxQuizzesPerProject": max_quizzes,
            },
            "flags": _resolve_plan_flags(code),
        })
    return result if result else [_plan_to_dict(code, p) for code, p in PLANS.items()]


def _build_feature_list_from_limits(code: str, sessions: int, projects: int, quizzes: int) -> list[str]:
    s = f"{sessions} active session{'s' if sessions > 1 else ''}"
    pr = f"{projects} project{'s' if projects > 1 else ''}"
    q = f"{quizzes} quiz{'zes' if quizzes > 1 else ''}"
    base = [s, pr, q]
    if code == "free":
        return base + ["Simulation mode", "OBS overlay"]
    if code == "pro":
        return base + ["X2 bonus mechanic", "TTS audio", "Full analytics"]
    return base + ["Everything in Pro", "Priority support"]


def _resolve_plan_flags(code: str) -> dict:
    """Compute per-plan flags from the global feature_flags config."""
    db = _read_config("feature_flags")
    if not db or not isinstance(db, dict):
        plan = PLANS.get(code)
        if plan:
            return {
                "x2Enabled": plan.x2_enabled,
                "ttsEnabled": plan.tts_enabled,
                "aiEnabled": plan.tts_enabled,
                "musicEnabled": plan.tts_enabled,
            }
        return {"x2Enabled": False, "ttsEnabled": False, "aiEnabled": False, "musicEnabled": False}

    flags = db.get("flags") or {}
    is_paid = code not in ("free",)
    return {
        "x2Enabled": bool(flags.get("x2Enabled", True)) and is_paid,
        "ttsEnabled": bool(flags.get("ttsEnabled", True)) and is_paid,
        "aiEnabled": bool(flags.get("aiGeneratorEnabled", True)) and is_paid,
        "musicEnabled": bool(flags.get("musicEnabled", True)) and is_paid,
    }


def _resolve_feature_groups(plans_list: list[dict]) -> list[dict]:
    """Rebuild the feature comparison table from resolved plan data."""
    plan_by_code = {p["code"]: p for p in plans_list}
    free = plan_by_code.get("free", {})
    pro = plan_by_code.get("pro", {})
    premium = plan_by_code.get("premium", {})

    def _lim(plan: dict, key: str) -> str:
        return str(plan.get("limits", {}).get(key, "--"))

    def _flag(plan: dict, key: str) -> bool:
        return bool(plan.get("flags", {}).get(key, False))

    return [
        {
            "groupLabel": "Capacity",
            "iconName": "Layers",
            "rows": [
                {"label": "Active sessions", "values": {"free": _lim(free, "maxActiveSessions"), "pro": _lim(pro, "maxActiveSessions"), "premium": _lim(premium, "maxActiveSessions")}},
                {"label": "Projects", "values": {"free": _lim(free, "maxProjects"), "pro": _lim(pro, "maxProjects"), "premium": _lim(premium, "maxProjects")}},
                {"label": "Quizzes per project", "values": {"free": _lim(free, "maxQuizzesPerProject"), "pro": _lim(pro, "maxQuizzesPerProject"), "premium": _lim(premium, "maxQuizzesPerProject")}},
            ],
        },
        {
            "groupLabel": "Live features",
            "iconName": "RadioTower",
            "rows": [
                {"label": "Simulation mode", "values": {"free": True, "pro": True, "premium": True}},
                {"label": "TikTok live mode", "values": {"free": True, "pro": True, "premium": True}},
                {"label": "Overlay URL", "values": {"free": True, "pro": True, "premium": True}},
                {"label": "Live control dashboard", "values": {"free": True, "pro": True, "premium": True}},
                {"label": "X2 bonus mechanic", "hint": "Double-score bonus round for top players",
                 "values": {"free": _flag(free, "x2Enabled"), "pro": _flag(pro, "x2Enabled"), "premium": _flag(premium, "x2Enabled")}},
            ],
        },
        {
            "groupLabel": "AI & audio",
            "iconName": "Cpu",
            "rows": [
                {"label": "AI quiz generation", "values": {"free": _flag(free, "aiEnabled"), "pro": _flag(pro, "aiEnabled"), "premium": _flag(premium, "aiEnabled")}},
                {"label": "TTS voice narration", "hint": "Questions read aloud during live sessions",
                 "values": {"free": _flag(free, "ttsEnabled"), "pro": _flag(pro, "ttsEnabled"), "premium": _flag(premium, "ttsEnabled")}},
                {"label": "Music controls", "values": {"free": _flag(free, "musicEnabled"), "pro": _flag(pro, "musicEnabled"), "premium": _flag(premium, "musicEnabled")}},
                {"label": "Audio volume control", "values": {"free": _flag(free, "musicEnabled"), "pro": _flag(pro, "musicEnabled"), "premium": _flag(premium, "musicEnabled")}},
            ],
        },
        {
            "groupLabel": "History & data",
            "iconName": "Mic",
            "rows": [
                {"label": "Session history", "values": {"free": True, "pro": True, "premium": True}},
                {"label": "Score persistence", "values": {"free": True, "pro": True, "premium": True}},
                {"label": "Activity logs", "values": {"free": True, "pro": True, "premium": True}},
            ],
        },
        {
            "groupLabel": "Support",
            "iconName": "HeartHandshake",
            "rows": [
                {"label": "Community support", "values": {"free": True, "pro": True, "premium": True}},
                {"label": "Priority support", "values": {"free": False, "pro": False, "premium": True}},
            ],
        },
    ]


# ---------------------------------------------------------------------------
# Public endpoint
# ---------------------------------------------------------------------------

@bp.get("/public")
def get_public_config():
    """Return full platform configuration.

    Reads from platform_config DB table for any admin-saved overrides,
    then falls back to hardcoded defaults for anything not yet saved.
    On any DB failure, returns full defaults — never breaks the frontend.
    """
    brand = _resolve_brand()
    plans = _resolve_plans()
    feature_groups = _resolve_feature_groups(plans)

    return success({
        "brand": brand,
        "plans": plans,
        "defaultPlanCode": DEFAULT_PLAN,
        "featureGroups": feature_groups,
        "landing": _LANDING,
        "ai": _AI,
        "session": _SESSION,
    })
