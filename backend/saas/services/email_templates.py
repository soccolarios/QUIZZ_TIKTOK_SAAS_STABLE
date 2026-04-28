"""
HTML + text email templates for all transactional emails.

Templates use simple string formatting with {placeholders}.
Brand values are resolved from platform_config at render time.
"""

import logging
from backend.saas.db.base import fetch_one

logger = logging.getLogger(__name__)

_DEFAULT_BRAND = {
    "name": "LiveGine",
    "tagline": "Interactive live quiz experiences",
    "support_email": "support@livegine.com",
    "legal_name": "LiveGine SaaS",
    "dashboard_url": "https://app.livegine.com",
}


def _get_brand() -> dict:
    try:
        row = fetch_one("SELECT value FROM platform_config WHERE key = 'site_config'")
        if row and row.get("value"):
            cfg = row["value"]
            return {
                "name": cfg.get("brandName", _DEFAULT_BRAND["name"]),
                "tagline": cfg.get("tagline", _DEFAULT_BRAND["tagline"]),
                "support_email": cfg.get("supportEmail", _DEFAULT_BRAND["support_email"]),
                "legal_name": cfg.get("legalName", _DEFAULT_BRAND["legal_name"]),
                "dashboard_url": cfg.get("dashboardUrl", _DEFAULT_BRAND["dashboard_url"]),
            }
    except Exception:
        logger.debug("Could not load brand config for email template")
    return dict(_DEFAULT_BRAND)


def _base_html(brand: dict, title: str, body_content: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:40px 0;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
  <tr><td style="padding:32px 40px 24px;text-align:center;border-bottom:1px solid #eef0f3;">
    <h1 style="margin:0;font-size:22px;font-weight:700;color:#111827;">{brand['name']}</h1>
    <p style="margin:4px 0 0;font-size:13px;color:#6b7280;">{brand['tagline']}</p>
  </td></tr>
  <tr><td style="padding:32px 40px;">
    {body_content}
  </td></tr>
  <tr><td style="padding:24px 40px;text-align:center;border-top:1px solid #eef0f3;background-color:#fafbfc;">
    <p style="margin:0;font-size:12px;color:#9ca3af;">
      {brand['legal_name']} &middot;
      <a href="mailto:{brand['support_email']}" style="color:#6b7280;">{brand['support_email']}</a>
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""


def _cta_button(url: str, label: str) -> str:
    return f"""<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto;">
<tr><td style="border-radius:8px;background-color:#2563eb;">
  <a href="{url}" target="_blank" style="display:inline-block;padding:12px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">{label}</a>
</td></tr>
</table>"""


# ---------------------------------------------------------------------------
# AUTH TEMPLATES
# ---------------------------------------------------------------------------

def render_welcome(email: str) -> tuple[str, str, str]:
    brand = _get_brand()
    subject = f"Welcome to {brand['name']}"
    body = f"""<h2 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#111827;">Welcome aboard!</h2>
<p style="margin:0 0 12px;font-size:15px;color:#374151;line-height:1.6;">
  Hi there, your {brand['name']} account is ready. You can start creating interactive quizzes and launching live sessions right away.
</p>
{_cta_button(brand['dashboard_url'], 'Go to Dashboard')}
<p style="margin:16px 0 0;font-size:13px;color:#6b7280;">
  If you have any questions, reply to this email or contact <a href="mailto:{brand['support_email']}" style="color:#2563eb;">{brand['support_email']}</a>.
</p>"""
    html = _base_html(brand, subject, body)
    text = f"""Welcome to {brand['name']}!

Your account ({email}) is ready. Start creating quizzes and launching live sessions at:
{brand['dashboard_url']}

Questions? Contact {brand['support_email']}
"""
    return subject, html, text


def render_password_reset(email: str, reset_url: str, expires_minutes: int) -> tuple[str, str, str]:
    brand = _get_brand()
    subject = f"Reset your {brand['name']} password"
    body = f"""<h2 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#111827;">Password Reset</h2>
<p style="margin:0 0 12px;font-size:15px;color:#374151;line-height:1.6;">
  We received a request to reset the password for <strong>{email}</strong>. Click the button below to choose a new password.
</p>
{_cta_button(reset_url, 'Reset Password')}
<p style="margin:16px 0 8px;font-size:13px;color:#6b7280;">
  This link expires in {expires_minutes} minutes. If you didn't request this, you can safely ignore this email.
</p>
<p style="margin:0;font-size:12px;color:#9ca3af;word-break:break-all;">
  Link: {reset_url}
</p>"""
    html = _base_html(brand, subject, body)
    text = f"""Reset your {brand['name']} password

We received a request to reset the password for {email}.

Click this link to choose a new password (expires in {expires_minutes} minutes):
{reset_url}

If you didn't request this, ignore this email.
"""
    return subject, html, text


def render_password_changed(email: str) -> tuple[str, str, str]:
    brand = _get_brand()
    subject = f"Your {brand['name']} password was changed"
    body = f"""<h2 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#111827;">Password Changed</h2>
<p style="margin:0 0 12px;font-size:15px;color:#374151;line-height:1.6;">
  The password for <strong>{email}</strong> was successfully changed.
</p>
<p style="margin:0;font-size:13px;color:#6b7280;">
  If you did not make this change, contact us immediately at <a href="mailto:{brand['support_email']}" style="color:#2563eb;">{brand['support_email']}</a>.
</p>"""
    html = _base_html(brand, subject, body)
    text = f"""Your {brand['name']} password was changed

The password for {email} was successfully updated.

If you did not make this change, contact {brand['support_email']} immediately.
"""
    return subject, html, text


# ---------------------------------------------------------------------------
# BILLING TEMPLATES
# ---------------------------------------------------------------------------

def render_subscription_activated(email: str, plan_name: str) -> tuple[str, str, str]:
    brand = _get_brand()
    subject = f"Your {brand['name']} {plan_name} plan is active"
    body = f"""<h2 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#111827;">Subscription Activated</h2>
<p style="margin:0 0 12px;font-size:15px;color:#374151;line-height:1.6;">
  Your <strong>{plan_name}</strong> plan is now active. All features included in this plan are ready to use.
</p>
{_cta_button(brand['dashboard_url'], 'Go to Dashboard')}"""
    html = _base_html(brand, subject, body)
    text = f"""{plan_name} plan activated on {brand['name']}

Your {plan_name} subscription is now active. All features are ready to use.

Dashboard: {brand['dashboard_url']}
"""
    return subject, html, text


def render_payment_success(email: str, plan_name: str) -> tuple[str, str, str]:
    brand = _get_brand()
    subject = f"Payment received for {brand['name']} {plan_name}"
    body = f"""<h2 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#111827;">Payment Received</h2>
<p style="margin:0 0 12px;font-size:15px;color:#374151;line-height:1.6;">
  We've received your payment for the <strong>{plan_name}</strong> plan. Thank you for your continued support.
</p>
<p style="margin:0;font-size:13px;color:#6b7280;">
  You can manage your billing at any time from your dashboard.
</p>"""
    html = _base_html(brand, subject, body)
    text = f"""Payment received for {brand['name']} {plan_name}

We've received your payment for the {plan_name} plan. Thank you!

Manage billing: {brand['dashboard_url']}
"""
    return subject, html, text


def render_payment_failed(email: str, plan_name: str) -> tuple[str, str, str]:
    brand = _get_brand()
    subject = f"Payment failed for your {brand['name']} {plan_name} plan"
    body = f"""<h2 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#111827;">Payment Failed</h2>
<p style="margin:0 0 12px;font-size:15px;color:#374151;line-height:1.6;">
  We were unable to process payment for your <strong>{plan_name}</strong> plan. Please update your payment method to avoid service interruption.
</p>
{_cta_button(brand['dashboard_url'] + '/?page=billing', 'Update Payment Method')}
<p style="margin:16px 0 0;font-size:13px;color:#6b7280;">
  If you believe this is an error, contact <a href="mailto:{brand['support_email']}" style="color:#2563eb;">{brand['support_email']}</a>.
</p>"""
    html = _base_html(brand, subject, body)
    text = f"""Payment failed for {brand['name']} {plan_name}

We couldn't process your payment. Please update your payment method to avoid service interruption.

Update billing: {brand['dashboard_url']}/?page=billing

Questions? Contact {brand['support_email']}
"""
    return subject, html, text


def render_subscription_canceled(email: str, plan_name: str) -> tuple[str, str, str]:
    brand = _get_brand()
    subject = f"Your {brand['name']} {plan_name} plan has been canceled"
    body = f"""<h2 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#111827;">Subscription Canceled</h2>
<p style="margin:0 0 12px;font-size:15px;color:#374151;line-height:1.6;">
  Your <strong>{plan_name}</strong> subscription has been canceled. You now have access to the Free plan features.
</p>
<p style="margin:0 0 12px;font-size:13px;color:#6b7280;">
  You can resubscribe at any time from your dashboard.
</p>
{_cta_button(brand['dashboard_url'] + '/?page=billing', 'View Plans')}"""
    html = _base_html(brand, subject, body)
    text = f"""Your {brand['name']} {plan_name} plan has been canceled

You now have access to Free plan features. Resubscribe any time.

View plans: {brand['dashboard_url']}/?page=billing
"""
    return subject, html, text


# ---------------------------------------------------------------------------
# ADMIN TEMPLATES
# ---------------------------------------------------------------------------

def render_account_suspended(email: str, reason: str) -> tuple[str, str, str]:
    brand = _get_brand()
    subject = f"Your {brand['name']} account has been suspended"
    body = f"""<h2 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#111827;">Account Suspended</h2>
<p style="margin:0 0 12px;font-size:15px;color:#374151;line-height:1.6;">
  Your {brand['name']} account has been suspended and access to paid features has been restricted.
</p>
<div style="margin:16px 0;padding:12px 16px;background-color:#fef2f2;border-radius:8px;border-left:4px solid #ef4444;">
  <p style="margin:0;font-size:14px;color:#991b1b;"><strong>Reason:</strong> {reason}</p>
</div>
<p style="margin:0;font-size:13px;color:#6b7280;">
  If you believe this is an error, contact <a href="mailto:{brand['support_email']}" style="color:#2563eb;">{brand['support_email']}</a>.
</p>"""
    html = _base_html(brand, subject, body)
    text = f"""Your {brand['name']} account has been suspended

Reason: {reason}

Paid features have been restricted. If you believe this is an error, contact {brand['support_email']}.
"""
    return subject, html, text


def render_account_unsuspended(email: str) -> tuple[str, str, str]:
    brand = _get_brand()
    subject = f"Your {brand['name']} account has been reactivated"
    body = f"""<h2 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#111827;">Account Reactivated</h2>
<p style="margin:0 0 12px;font-size:15px;color:#374151;line-height:1.6;">
  Your {brand['name']} account suspension has been lifted. Your previous plan and features have been restored.
</p>
{_cta_button(brand['dashboard_url'], 'Go to Dashboard')}"""
    html = _base_html(brand, subject, body)
    text = f"""Your {brand['name']} account has been reactivated

Your suspension has been lifted and your previous plan has been restored.

Dashboard: {brand['dashboard_url']}
"""
    return subject, html, text


def render_plan_override(email: str, new_plan: str | None, reason: str) -> tuple[str, str, str]:
    brand = _get_brand()
    if new_plan:
        subject = f"Your {brand['name']} plan has been updated to {new_plan}"
        action_text = f"Your plan has been manually set to <strong>{new_plan}</strong> by a {brand['name']} administrator."
    else:
        subject = f"Your {brand['name']} plan override has been removed"
        action_text = f"A previous plan override has been removed. Your plan now reflects your Stripe subscription."
    body = f"""<h2 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#111827;">Plan Updated</h2>
<p style="margin:0 0 12px;font-size:15px;color:#374151;line-height:1.6;">{action_text}</p>
<div style="margin:16px 0;padding:12px 16px;background-color:#eff6ff;border-radius:8px;border-left:4px solid #2563eb;">
  <p style="margin:0;font-size:14px;color:#1e40af;"><strong>Reason:</strong> {reason}</p>
</div>
{_cta_button(brand['dashboard_url'], 'Go to Dashboard')}"""
    html = _base_html(brand, subject, body)
    text_action = f"Your plan has been set to {new_plan}." if new_plan else "A plan override has been removed."
    text = f"""{subject}

{text_action}

Reason: {reason}

Dashboard: {brand['dashboard_url']}
"""
    return subject, html, text


def render_admin_alert(alert_type: str, details: str) -> tuple[str, str, str]:
    """Alert email sent to the platform support/admin email."""
    brand = _get_brand()
    subject = f"[{brand['name']} Admin] {alert_type}"
    body = f"""<h2 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#111827;">Admin Alert: {alert_type}</h2>
<div style="margin:0;padding:16px;background-color:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
  <pre style="margin:0;font-size:13px;color:#374151;white-space:pre-wrap;word-break:break-word;font-family:monospace;">{details}</pre>
</div>"""
    html = _base_html(brand, subject, body)
    text = f"""[{brand['name']} Admin] {alert_type}

{details}
"""
    return subject, html, text


# ---------------------------------------------------------------------------
# TEST TEMPLATE
# ---------------------------------------------------------------------------

def render_test_email(to_email: str) -> tuple[str, str, str]:
    brand = _get_brand()
    subject = f"Test email from {brand['name']}"
    body = f"""<h2 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#111827;">Email Test Successful</h2>
<p style="margin:0 0 12px;font-size:15px;color:#374151;line-height:1.6;">
  This is a test email from {brand['name']}. If you received this, your Mailjet configuration is working correctly.
</p>
<p style="margin:0;font-size:13px;color:#6b7280;">
  Sent to: {to_email}
</p>"""
    html = _base_html(brand, subject, body)
    text = f"""Test email from {brand['name']}

If you received this, your Mailjet configuration is working correctly.

Sent to: {to_email}
"""
    return subject, html, text
