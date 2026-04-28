import json
import logging
from backend.saas.db.base import fetch_one, fetch_all, execute

logger = logging.getLogger(__name__)

# Subscription statuses that grant paid-plan access
_ACTIVE_STATUSES = {"active", "trialing"}


def get_subscription_by_user(user_id: str) -> dict | None:
    return fetch_one(
        "SELECT * FROM saas_subscriptions WHERE user_id = %s",
        (user_id,),
    )


def get_subscription_by_stripe_customer(stripe_customer_id: str) -> dict | None:
    return fetch_one(
        "SELECT * FROM saas_subscriptions WHERE stripe_customer_id = %s",
        (stripe_customer_id,),
    )


def get_subscription_by_stripe_subscription(stripe_subscription_id: str) -> dict | None:
    return fetch_one(
        "SELECT * FROM saas_subscriptions WHERE stripe_subscription_id = %s",
        (stripe_subscription_id,),
    )


def get_effective_plan_code(user_id: str) -> str:
    """
    Resolve the plan that should actually be enforced for this user.

    Priority order (highest wins):
      1. Suspended -> always "free"
      2. Admin override -> admin_override_plan_code
      3. Subscription status not active/trialing -> "free"
      4. Stripe-managed plan_code from saas_subscriptions
      5. No subscription row -> "free"

    This is the SINGLE authority for plan enforcement. plan_guard.py uses this.
    """
    sub = get_subscription_by_user(user_id)
    if not sub:
        return "free"

    if sub.get("suspended_at") is not None:
        return "free"

    override = sub.get("admin_override_plan_code")
    if override:
        return override

    status = sub.get("status") or "active"
    if status not in _ACTIVE_STATUSES:
        return "free"

    return sub.get("plan_code") or "free"


def set_admin_override(
    user_id: str,
    plan_code: str | None,
    reason: str,
    admin_user_id: str,
) -> dict:
    """Set or clear an admin plan override for a user."""
    sub = get_subscription_by_user(user_id)
    if not sub:
        upsert_subscription(user_id=user_id, plan_code="free", status="active")

    result = fetch_one(
        """
        UPDATE saas_subscriptions
        SET admin_override_plan_code = %s,
            admin_override_reason = %s,
            admin_override_by = %s,
            admin_override_at = CASE WHEN %s IS NOT NULL THEN now() ELSE NULL END,
            updated_at = now()
        WHERE user_id = %s
        RETURNING *
        """,
        (plan_code, reason, admin_user_id, plan_code, user_id),
    )
    effective = get_effective_plan_code(user_id)
    _sync_user_plan_code(user_id, effective)
    return result


def set_suspended(user_id: str, suspended: bool, reason: str, admin_user_id: str) -> dict:
    """Suspend or unsuspend a user's account."""
    sub = get_subscription_by_user(user_id)
    if not sub:
        upsert_subscription(user_id=user_id, plan_code="free", status="active")

    if suspended:
        result = fetch_one(
            """
            UPDATE saas_subscriptions
            SET suspended_at = now(),
                suspension_reason = %s,
                updated_at = now()
            WHERE user_id = %s
            RETURNING *
            """,
            (reason, user_id),
        )
    else:
        result = fetch_one(
            """
            UPDATE saas_subscriptions
            SET suspended_at = NULL,
                suspension_reason = NULL,
                updated_at = now()
            WHERE user_id = %s
            RETURNING *
            """,
            (user_id,),
        )
    effective = get_effective_plan_code(user_id)
    _sync_user_plan_code(user_id, effective)
    return result


def list_subscriptions(limit: int = 100, offset: int = 0) -> list[dict]:
    """List all subscriptions with user email for admin view."""
    return fetch_all(
        """
        SELECT s.*, u.email, u.is_active AS user_is_active
        FROM saas_subscriptions s
        JOIN saas_users u ON u.id = s.user_id
        ORDER BY s.updated_at DESC
        LIMIT %s OFFSET %s
        """,
        (limit, offset),
    )


def get_subscription_with_user(user_id: str) -> dict | None:
    """Get subscription joined with user info for admin display."""
    return fetch_one(
        """
        SELECT s.*, u.email, u.is_active AS user_is_active
        FROM saas_subscriptions s
        JOIN saas_users u ON u.id = s.user_id
        WHERE s.user_id = %s
        """,
        (user_id,),
    )


def _sync_user_plan_code(user_id: str, plan_code: str) -> None:
    """Keep saas_users.plan_code in sync for backward-compat guard queries."""
    try:
        execute(
            "UPDATE saas_users SET plan_code = %s, updated_at = now() WHERE id = %s",
            (plan_code, user_id),
        )
    except Exception:
        logger.warning("Could not sync plan_code to saas_users for user %s (column may not exist)", user_id)


_PAID_PLANS = {"pro", "premium"}


def upsert_subscription(
    user_id: str,
    stripe_customer_id: str | None = None,
    stripe_subscription_id: str | None = None,
    stripe_price_id: str | None = None,
    plan_code: str | None = None,
    status: str = "active",
    current_period_start=None,
    current_period_end=None,
    cancel_at_period_end: bool = False,
    allow_downgrade: bool = False,
) -> dict:
    logger.info(
        "upsert_subscription user=%s plan=%s status=%s stripe_sub=%s allow_downgrade=%s",
        user_id, plan_code, status, stripe_subscription_id, allow_downgrade,
    )
    existing = get_subscription_by_user(user_id)

    if existing and plan_code is not None:
        current_plan = existing.get("plan_code") or "free"
        if current_plan in _PAID_PLANS and plan_code not in _PAID_PLANS and not allow_downgrade:
            logger.error(
                "upsert_subscription BLOCKED: attempt to overwrite paid plan '%s' with '%s' "
                "for user=%s without allow_downgrade=True. Use allow_downgrade=True only for "
                "explicit Stripe cancellation/downgrade events.",
                current_plan, plan_code, user_id,
            )
            plan_code = current_plan
    if existing:
        fields = ["status = %s", "cancel_at_period_end = %s", "updated_at = now()"]
        values = [status, cancel_at_period_end]
        if plan_code is not None:
            fields.insert(0, "plan_code = %s")
            values.insert(0, plan_code)
        if stripe_customer_id is not None:
            fields.append("stripe_customer_id = %s")
            values.append(stripe_customer_id)
        if stripe_subscription_id is not None:
            fields.append("stripe_subscription_id = %s")
            values.append(stripe_subscription_id)
        if stripe_price_id is not None:
            fields.append("stripe_price_id = %s")
            values.append(stripe_price_id)
        if current_period_start is not None:
            fields.append("current_period_start = to_timestamp(%s)")
            values.append(current_period_start)
        if current_period_end is not None:
            fields.append("current_period_end = to_timestamp(%s)")
            values.append(current_period_end)
        values.append(user_id)
        result = fetch_one(
            f"UPDATE saas_subscriptions SET {', '.join(fields)} WHERE user_id = %s RETURNING *",
            values,
        )
    else:
        insert_plan = plan_code if plan_code is not None else "free"
        result = fetch_one(
            """
            INSERT INTO saas_subscriptions
              (user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id,
               plan_code, status, current_period_start, current_period_end, cancel_at_period_end)
            VALUES (%s, %s, %s, %s, %s, %s,
                    CASE WHEN %s IS NOT NULL THEN to_timestamp(%s) ELSE NULL END,
                    CASE WHEN %s IS NOT NULL THEN to_timestamp(%s) ELSE NULL END,
                    %s)
            RETURNING *
            """,
            (
                user_id,
                stripe_customer_id,
                stripe_subscription_id,
                stripe_price_id,
                insert_plan,
                status,
                current_period_start, current_period_start,
                current_period_end, current_period_end,
                cancel_at_period_end,
            ),
        )

    effective = get_effective_plan_code(user_id)
    logger.info("upsert_subscription complete user=%s effective_plan=%s", user_id, effective)
    _sync_user_plan_code(user_id, effective)
    return result


def set_stripe_customer_id(user_id: str, stripe_customer_id: str) -> None:
    execute(
        """
        INSERT INTO saas_subscriptions (user_id, stripe_customer_id, plan_code, status)
        VALUES (%s, %s, 'free', 'active')
        ON CONFLICT (user_id) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id, updated_at = now()
        """,
        (user_id, stripe_customer_id),
    )


def log_billing_event(
    stripe_event_id: str,
    event_type: str,
    payload: dict,
    user_id: str | None = None,
) -> None:
    execute(
        """
        INSERT INTO saas_billing_events (user_id, stripe_event_id, event_type, payload)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (stripe_event_id) DO NOTHING
        """,
        (user_id, stripe_event_id, event_type, json.dumps(payload)),
    )
