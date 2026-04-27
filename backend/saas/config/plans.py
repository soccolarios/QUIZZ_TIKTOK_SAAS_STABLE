from dataclasses import dataclass, field


@dataclass(frozen=True)
class PlanLimits:
    max_active_sessions: int
    max_projects: int
    max_quizzes_per_project: int
    x2_enabled: bool
    tts_enabled: bool
    display_name: str
    description: str
    price_monthly: str


PLANS: dict[str, PlanLimits] = {
    "free": PlanLimits(
        max_active_sessions=1,
        max_projects=1,
        max_quizzes_per_project=3,
        x2_enabled=False,
        tts_enabled=False,
        display_name="Free",
        description="Get started for free",
        price_monthly="$0",
    ),
    "pro": PlanLimits(
        max_active_sessions=5,
        max_projects=10,
        max_quizzes_per_project=50,
        x2_enabled=True,
        tts_enabled=True,
        display_name="Pro",
        description="For creators going live regularly",
        price_monthly="$19",
    ),
    "premium": PlanLimits(
        max_active_sessions=20,
        max_projects=100,
        max_quizzes_per_project=500,
        x2_enabled=True,
        tts_enabled=True,
        display_name="Premium",
        description="For agencies and power users",
        price_monthly="$49",
    ),
}

DEFAULT_PLAN = "free"


def get_plan(plan_code: str | None) -> PlanLimits:
    return PLANS.get(plan_code or DEFAULT_PLAN, PLANS[DEFAULT_PLAN])
