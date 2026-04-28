"""
Admin billing routes — Super Admin only.

GET   /api/admin/billing/subscriptions          — list all subscriptions
GET   /api/admin/billing/subscriptions/<user_id> — get one user's subscription
POST  /api/admin/billing/subscriptions/<user_id>/override — set/clear plan override
POST  /api/admin/billing/subscriptions/<user_id>/suspend  — suspend/unsuspend
"""

import logging
from flask import Blueprint, request as req, g

from backend.saas.auth.middleware import require_auth
from backend.saas.config.plans import PLANS
from backend.saas.models.subscription import (
    get_effective_plan_code,
    get_subscription_with_user,
    list_subscriptions,
    set_admin_override,
    set_suspended,
    log_billing_event,
)
from backend.saas.services.email_service import send_email
from backend.saas.services.email_templates import (
    render_account_suspended,
    render_account_unsuspended,
    render_plan_override,
)
from backend.saas.utils.responses import success, error, serialize_row, serialize_rows

logger = logging.getLogger(__name__)
bp = Blueprint("admin_billing", __name__, url_prefix="/api/admin/billing")


def _require_admin():
    if not g.get("current_user_is_admin"):
        return error("Forbidden", 403)
    return None


def _sub_response(sub: dict) -> dict:
    row = serialize_row(sub)
    row["effective_plan"] = get_effective_plan_code(str(sub["user_id"]))
    return row


@bp.get("/subscriptions")
@require_auth
def admin_list_subscriptions():
    denied = _require_admin()
    if denied:
        return denied

    limit = min(int(req.args.get("limit", 100)), 500)
    offset = int(req.args.get("offset", 0))
    rows = list_subscriptions(limit=limit, offset=offset)
    result = []
    for row in rows:
        r = serialize_row(row)
        r["effective_plan"] = get_effective_plan_code(str(row["user_id"]))
        result.append(r)
    return success(result)


@bp.get("/subscriptions/<user_id>")
@require_auth
def admin_get_subscription(user_id: str):
    denied = _require_admin()
    if denied:
        return denied

    sub = get_subscription_with_user(user_id)
    if not sub:
        return error("Subscription not found", 404)
    return success(_sub_response(sub))


@bp.post("/subscriptions/<user_id>/override")
@require_auth
def admin_set_override(user_id: str):
    """
    Set or clear an admin plan override.

    Body:
      { "plan_code": "pro" | "premium" | null, "reason": "Comp access for partner" }

    Setting plan_code to null clears the override and restores Stripe-managed plan.
    """
    denied = _require_admin()
    if denied:
        return denied

    body = req.get_json(silent=True) or {}
    plan_code = body.get("plan_code")
    reason = (body.get("reason") or "").strip()

    if plan_code is not None and plan_code not in PLANS:
        return error(f"Invalid plan_code. Must be one of: {', '.join(PLANS.keys())}", 400)

    if not reason:
        return error("reason is required", 400)

    logger.info(
        "admin_override: admin=%s target_user=%s plan=%s reason=%s",
        g.current_user_id, user_id, plan_code, reason,
    )

    result = set_admin_override(
        user_id=user_id,
        plan_code=plan_code,
        reason=reason,
        admin_user_id=g.current_user_id,
    )
    if not result:
        return error("User not found", 404)

    try:
        log_billing_event(
            stripe_event_id=f"admin_override_{user_id}_{int(__import__('time').time())}",
            event_type="admin.plan_override",
            payload={
                "admin_user_id": g.current_user_id,
                "target_user_id": user_id,
                "plan_code": plan_code,
                "reason": reason,
            },
            user_id=user_id,
        )
    except Exception:
        logger.warning("Failed to log admin override event", exc_info=True)

    try:
        email = result.get("email") or ""
        if email:
            subj, html, text = render_plan_override(email, plan_code, reason)
            send_email(
                to_email=email, to_name=email, subject=subj,
                html_body=html, text_body=text,
                template_key="plan_override", user_id=user_id,
            )
    except Exception:
        logger.warning("Failed to send override notification email", exc_info=True)

    return success(_sub_response(result))


@bp.post("/subscriptions/<user_id>/suspend")
@require_auth
def admin_set_suspended(user_id: str):
    """
    Suspend or unsuspend a user.

    Body:
      { "suspended": true, "reason": "TOS violation" }
    """
    denied = _require_admin()
    if denied:
        return denied

    body = req.get_json(silent=True) or {}
    suspended = bool(body.get("suspended", True))
    reason = (body.get("reason") or "").strip()

    if suspended and not reason:
        return error("reason is required when suspending", 400)

    logger.info(
        "admin_suspend: admin=%s target_user=%s suspended=%s reason=%s",
        g.current_user_id, user_id, suspended, reason,
    )

    result = set_suspended(
        user_id=user_id,
        suspended=suspended,
        reason=reason,
        admin_user_id=g.current_user_id,
    )
    if not result:
        return error("User not found", 404)

    try:
        log_billing_event(
            stripe_event_id=f"admin_suspend_{user_id}_{int(__import__('time').time())}",
            event_type="admin.suspension" if suspended else "admin.unsuspension",
            payload={
                "admin_user_id": g.current_user_id,
                "target_user_id": user_id,
                "suspended": suspended,
                "reason": reason,
            },
            user_id=user_id,
        )
    except Exception:
        logger.warning("Failed to log admin suspension event", exc_info=True)

    try:
        email = result.get("email") or ""
        if email:
            if suspended:
                subj, html, text = render_account_suspended(email, reason)
                tpl_key = "account_suspended"
            else:
                subj, html, text = render_account_unsuspended(email)
                tpl_key = "account_unsuspended"
            send_email(
                to_email=email, to_name=email, subject=subj,
                html_body=html, text_body=text,
                template_key=tpl_key, user_id=user_id,
            )
    except Exception:
        logger.warning("Failed to send suspension notification email", exc_info=True)

    return success(_sub_response(result))
