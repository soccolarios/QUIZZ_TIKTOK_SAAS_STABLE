import os
import logging

from flask import Blueprint, request, g

from backend.saas.auth.middleware import require_auth
from backend.saas.models.subscription import (
    get_subscription_by_user,
    get_subscription_by_stripe_customer,
    get_subscription_by_stripe_subscription,
    get_effective_plan_code,
    upsert_subscription,
    set_stripe_customer_id,
    log_billing_event,
)
from backend.saas.models.user import get_user_by_id
from backend.saas.services.stripe_service import (
    StripeNotConfiguredError,
    create_or_get_customer,
    create_checkout_session,
    create_portal_session,
    construct_event,
    get_price_id_for_plan,
    get_plan_code_for_price,
    retrieve_subscription,
)
from backend.saas.config.plans import get_plan, PLANS
from backend.saas.utils.responses import success, error, serialize_row

logger = logging.getLogger(__name__)
bp = Blueprint("billing", __name__, url_prefix="/api/billing")

_APP_BASE_URL = os.environ.get("APP_BASE_URL", "http://localhost:5173")


def _subscription_response(sub: dict | None, user_id: str) -> dict:
    effective = get_effective_plan_code(user_id)
    limits = get_plan(effective)
    raw_plan = (sub["plan_code"] if sub else "free") or "free"
    is_overridden = sub and sub.get("admin_override_plan") is not None
    is_suspended = sub and sub.get("suspended_at") is not None
    return {
        "plan_code": effective,
        "stripe_plan_code": raw_plan,
        "display_name": limits.display_name,
        "status": "suspended" if is_suspended else (sub["status"] if sub else "active"),
        "current_period_end": sub["current_period_end"].isoformat() if sub and sub.get("current_period_end") else None,
        "cancel_at_period_end": sub["cancel_at_period_end"] if sub else False,
        "admin_override": is_overridden,
        "suspended": bool(is_suspended),
        "limits": {
            "max_active_sessions": limits.max_active_sessions,
            "max_projects": limits.max_projects,
            "max_quizzes_per_project": limits.max_quizzes_per_project,
            "x2_enabled": limits.x2_enabled,
            "tts_enabled": limits.tts_enabled,
        },
    }


@bp.get("/subscription")
@require_auth
def get_subscription():
    sub = get_subscription_by_user(g.current_user_id)
    return success(_subscription_response(sub, g.current_user_id))


@bp.post("/create-checkout-session")
@require_auth
def create_checkout():
    data = request.get_json(silent=True) or {}
    plan_code = (data.get("plan_code") or "").strip()

    if plan_code not in ("pro", "premium"):
        return error("Invalid plan. Choose 'pro' or 'premium'.")

    try:
        price_id = get_price_id_for_plan(plan_code)
    except StripeNotConfiguredError as e:
        return error(str(e), 503)

    user = get_user_by_id(g.current_user_id)
    if not user:
        return error("User not found", 404)

    sub = get_subscription_by_user(g.current_user_id)
    existing_customer_id = sub["stripe_customer_id"] if sub else None

    try:
        customer_id = create_or_get_customer(user["email"], existing_customer_id)
    except StripeNotConfiguredError as e:
        return error(str(e), 503)
    except Exception as e:
        logger.exception("Stripe customer creation failed")
        return error("Failed to create Stripe customer", 500)

    set_stripe_customer_id(g.current_user_id, customer_id)

    try:
        checkout_url = create_checkout_session(
            customer_id=customer_id,
            price_id=price_id,
            success_url=f"{_APP_BASE_URL}/?billing=success",
            cancel_url=f"{_APP_BASE_URL}/?billing=cancel",
            metadata={"user_id": g.current_user_id, "plan_code": plan_code},
        )
    except StripeNotConfiguredError as e:
        return error(str(e), 503)
    except Exception as e:
        logger.exception("Stripe checkout creation failed")
        return error("Failed to create checkout session", 500)

    return success({"checkout_url": checkout_url})


@bp.post("/create-portal-session")
@require_auth
def create_portal():
    sub = get_subscription_by_user(g.current_user_id)
    if not sub or not sub.get("stripe_customer_id"):
        return error("No billing account found. Please subscribe first.", 400)

    try:
        portal_url = create_portal_session(
            customer_id=sub["stripe_customer_id"],
            return_url=f"{_APP_BASE_URL}/",
        )
    except StripeNotConfiguredError as e:
        return error(str(e), 503)
    except Exception as e:
        logger.exception("Stripe portal creation failed")
        return error("Failed to create billing portal session", 500)

    return success({"portal_url": portal_url})


@bp.post("/webhook")
def stripe_webhook():
    payload = request.get_data()
    sig_header = request.headers.get("Stripe-Signature", "")

    try:
        event = construct_event(payload, sig_header)
    except StripeNotConfiguredError as e:
        logger.warning("Stripe webhook: %s", e)
        return error(str(e), 503)
    except Exception as e:
        logger.warning("Stripe webhook signature verification failed: %s", e)
        return error("Webhook signature verification failed", 400)

    event_payload = event.to_dict()
    event_type = event_payload["type"]
    event_id = event_payload["id"]
    data_obj = event_payload["data"]["object"]

    user_id = None

    try:
        if event_type == "checkout.session.completed":
            _handle_checkout_completed(data_obj)
            user_id = (data_obj.get("metadata") or {}).get("user_id")

        elif event_type in ("customer.subscription.created", "customer.subscription.updated"):
            user_id = _handle_subscription_upsert(data_obj)

        elif event_type == "customer.subscription.deleted":
            user_id = _handle_subscription_deleted(data_obj)

        elif event_type == "invoice.paid":
            customer_id = data_obj.get("customer")
            sub = get_subscription_by_stripe_customer(customer_id)
            if sub:
                user_id = str(sub["user_id"])

        elif event_type == "invoice.payment_failed":
            customer_id = data_obj.get("customer")
            sub_row = get_subscription_by_stripe_customer(customer_id)
            if sub_row:
                user_id = str(sub_row["user_id"])
                logger.warning(
                    "invoice.payment_failed customer=%s user=%s — marking past_due, keeping plan=%s",
                    customer_id, user_id, sub_row["plan_code"],
                )
                upsert_subscription(
                    user_id=user_id,
                    plan_code=sub_row["plan_code"],
                    status="past_due",
                    allow_downgrade=True,
                )

    except Exception:
        logger.exception("Error processing Stripe event %s", event_id)

    try:
        log_billing_event(
            stripe_event_id=event_id,
            event_type=event_type,
            payload=event_payload,
            user_id=user_id,
        )
    except Exception:
        logger.exception("Failed to log billing event %s", event_id)

    return success({"received": True})


def _handle_checkout_completed(session_obj: dict):
    session_id = session_obj.get("id", "unknown")
    metadata = session_obj.get("metadata") or {}
    user_id = metadata.get("user_id")
    metadata_plan = metadata.get("plan_code", "")
    stripe_subscription_id = session_obj.get("subscription")
    customer_id = session_obj.get("customer")

    logger.info(
        "checkout.session.completed session=%s user=%s metadata_plan=%s stripe_sub=%s customer=%s",
        session_id, user_id, metadata_plan, stripe_subscription_id, customer_id,
    )

    if not user_id:
        logger.error(
            "checkout.session.completed session=%s: no user_id in metadata — subscription NOT updated",
            session_id,
        )
        return

    if not stripe_subscription_id:
        logger.error(
            "checkout.session.completed session=%s user=%s: no stripe_subscription_id in session — "
            "this is a one-time payment, not a subscription. Subscription NOT updated.",
            session_id, user_id,
        )
        return

    try:
        sub_obj = retrieve_subscription(stripe_subscription_id)
    except Exception:
        logger.exception(
            "checkout.session.completed session=%s user=%s: failed to retrieve Stripe subscription %s — "
            "subscription NOT updated to avoid incorrect plan assignment",
            session_id, user_id, stripe_subscription_id,
        )
        return

    items = (sub_obj.get("items") or {}).get("data") or []
    if not items:
        logger.error(
            "checkout: session=%s user=%s stripe_sub=%s: subscription has no line items — "
            "cannot determine price_id. Subscription NOT updated.",
            session_id, user_id, stripe_subscription_id,
        )
        return

    price_id = (items[0].get("price") or {}).get("id")
    if not price_id:
        logger.error(
            "checkout: session=%s user=%s stripe_sub=%s: could not extract price.id from "
            "subscription items. Subscription NOT updated.",
            session_id, user_id, stripe_subscription_id,
        )
        return

    logger.info(
        "checkout: session=%s user=%s stripe_sub=%s price_id=%s status=%s",
        session_id, user_id, stripe_subscription_id, price_id, sub_obj.get("status"),
    )

    try:
        resolved_plan = get_plan_code_for_price(price_id)
    except ValueError:
        logger.error(
            "checkout: session=%s user=%s price_id=%s does not match any configured plan — "
            "subscription NOT updated. Check STRIPE_PRICE_PRO / STRIPE_PRICE_PREMIUM env vars.",
            session_id, user_id, price_id,
        )
        return

    logger.info(
        "checkout: session=%s user=%s resolved plan=%s from price_id=%s — persisting",
        session_id, user_id, resolved_plan, price_id,
    )

    upsert_subscription(
        user_id=user_id,
        stripe_customer_id=customer_id,
        stripe_subscription_id=stripe_subscription_id,
        stripe_price_id=price_id,
        plan_code=resolved_plan,
        status=sub_obj.get("status", "active"),
        current_period_start=sub_obj.get("current_period_start"),
        current_period_end=sub_obj.get("current_period_end"),
        cancel_at_period_end=sub_obj.get("cancel_at_period_end", False),
        allow_downgrade=True,
    )


def _handle_subscription_upsert(sub_obj: dict) -> str | None:
    stripe_subscription_id = sub_obj.get("id")
    customer_id = sub_obj.get("customer")
    sub_row = get_subscription_by_stripe_customer(customer_id)
    if not sub_row:
        logger.warning(
            "subscription.upsert stripe_sub=%s customer=%s: no matching saas_subscriptions row — skipping",
            stripe_subscription_id, customer_id,
        )
        return None

    user_id = str(sub_row["user_id"])
    items = (sub_obj.get("items") or {}).get("data") or []
    if not items:
        logger.error(
            "subscription.upsert stripe_sub=%s user=%s: no line items in subscription object — "
            "cannot determine price_id",
            stripe_subscription_id, user_id,
        )
    price_id = (items[0].get("price") or {}).get("id") if items else None

    logger.info(
        "subscription.upsert stripe_sub=%s user=%s price_id=%s status=%s",
        stripe_subscription_id, user_id, price_id, sub_obj.get("status"),
    )

    try:
        plan_code = get_plan_code_for_price(price_id)
    except ValueError:
        logger.error(
            "subscription.upsert stripe_sub=%s user=%s price_id=%s not in plan mapping — "
            "NOT updating plan_code to avoid incorrect downgrade. Check STRIPE_PRICE_* env vars.",
            stripe_subscription_id, user_id, price_id,
        )
        plan_code = None

    if plan_code is not None:
        upsert_subscription(
            user_id=user_id,
            stripe_customer_id=customer_id,
            stripe_subscription_id=stripe_subscription_id,
            stripe_price_id=price_id,
            plan_code=plan_code,
            status=sub_obj.get("status", "active"),
            current_period_start=sub_obj.get("current_period_start"),
            current_period_end=sub_obj.get("current_period_end"),
            cancel_at_period_end=sub_obj.get("cancel_at_period_end", False),
            allow_downgrade=True,
        )
    else:
        upsert_subscription(
            user_id=user_id,
            stripe_customer_id=customer_id,
            stripe_subscription_id=stripe_subscription_id,
            stripe_price_id=price_id,
            status=sub_obj.get("status", "active"),
            current_period_start=sub_obj.get("current_period_start"),
            current_period_end=sub_obj.get("current_period_end"),
            cancel_at_period_end=sub_obj.get("cancel_at_period_end", False),
        )
    return user_id


def _handle_subscription_deleted(sub_obj: dict) -> str | None:
    customer_id = sub_obj.get("customer")
    sub_row = get_subscription_by_stripe_customer(customer_id)
    if not sub_row:
        return None

    user_id = str(sub_row["user_id"])
    upsert_subscription(
        user_id=user_id,
        stripe_customer_id=customer_id,
        stripe_subscription_id=sub_obj["id"],
        plan_code="free",
        status="canceled",
        cancel_at_period_end=False,
    )
    return user_id
