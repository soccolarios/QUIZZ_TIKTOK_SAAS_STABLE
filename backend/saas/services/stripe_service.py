"""
stripe_service.py — thin wrapper around the Stripe API.

All Stripe interaction is centralised here so routes stay clean.
If STRIPE_SECRET_KEY is not set, every function raises StripeNotConfiguredError
so callers can return a readable 503 response instead of crashing.
"""

import os
import logging

logger = logging.getLogger(__name__)

try:
    import stripe as _stripe_module
    _stripe_available = True
except ImportError:
    _stripe_available = False
    _stripe_module = None


class StripeNotConfiguredError(Exception):
    pass


def _get_stripe():
    if not _stripe_available:
        raise StripeNotConfiguredError("stripe package is not installed")
    key = os.environ.get("STRIPE_SECRET_KEY", "")
    if not key:
        raise StripeNotConfiguredError("STRIPE_SECRET_KEY is not set")
    _stripe_module.api_key = key
    return _stripe_module


def create_or_get_customer(email: str, existing_customer_id: str | None = None) -> str:
    stripe = _get_stripe()
    if existing_customer_id:
        try:
            customer = stripe.Customer.retrieve(existing_customer_id)
            if not getattr(customer, "deleted", False):
                return existing_customer_id
        except stripe.error.InvalidRequestError:
            pass
    customer = stripe.Customer.create(email=email)
    return customer.id


def create_checkout_session(
    customer_id: str,
    price_id: str,
    success_url: str,
    cancel_url: str,
    metadata: dict | None = None,
) -> str:
    stripe = _get_stripe()
    session = stripe.checkout.Session.create(
        customer=customer_id,
        payment_method_types=["card"],
        line_items=[{"price": price_id, "quantity": 1}],
        mode="subscription",
        success_url=success_url,
        cancel_url=cancel_url,
        metadata=metadata or {},
        allow_promotion_codes=True,
    )
    return session.url


def create_portal_session(customer_id: str, return_url: str) -> str:
    stripe = _get_stripe()
    session = stripe.billing_portal.Session.create(
        customer=customer_id,
        return_url=return_url,
    )
    return session.url


def construct_event(payload: bytes, sig_header: str):
    stripe = _get_stripe()
    webhook_secret = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
    if not webhook_secret:
        raise StripeNotConfiguredError("STRIPE_WEBHOOK_SECRET is not set")
    return stripe.Webhook.construct_event(payload, sig_header, webhook_secret)


def get_price_id_for_plan(plan_code: str) -> str:
    mapping = {
        "pro": os.environ.get("STRIPE_PRICE_PRO", ""),
        "premium": os.environ.get("STRIPE_PRICE_PREMIUM", ""),
    }
    price_id = mapping.get(plan_code, "")
    if not price_id:
        raise StripeNotConfiguredError(
            f"No Stripe price ID configured for plan '{plan_code}'. "
            f"Set STRIPE_PRICE_{plan_code.upper()} in your environment."
        )
    return price_id


def get_plan_code_for_price(price_id: str) -> str:
    """Resolve a Stripe price ID to an internal plan code.

    Raises ValueError for unknown or unconfigured price IDs so callers can
    decide explicitly how to handle the failure — never silently returns 'free'.
    """
    pro_price = os.environ.get("STRIPE_PRICE_PRO", "")
    premium_price = os.environ.get("STRIPE_PRICE_PREMIUM", "")

    if not price_id:
        raise ValueError("price_id is empty — cannot resolve plan code")

    if pro_price and price_id == pro_price:
        return "pro"
    if premium_price and price_id == premium_price:
        return "premium"

    configured = [p for p in (pro_price, premium_price) if p]
    raise ValueError(
        f"Unknown Stripe price_id '{price_id}'. "
        f"Configured price IDs: {configured}. "
        f"Check STRIPE_PRICE_PRO / STRIPE_PRICE_PREMIUM env vars."
    )


def retrieve_subscription(stripe_subscription_id: str) -> dict:
    """Fetch a Stripe Subscription object and return it as a deep plain dict."""
    stripe = _get_stripe()
    sub = stripe.Subscription.retrieve(stripe_subscription_id)
    return sub.to_dict()
