"""
Admin billing routes -- Super Admin only.

Minimal implementation for blueprint registration.
Full billing admin is stage 2.15 scope.
"""

from flask import Blueprint
from backend.saas.auth.middleware import require_auth
from backend.saas.utils.responses import success, error

bp = Blueprint("admin_billing", __name__, url_prefix="/api/admin/billing")


def _require_admin():
    from flask import g
    if not g.get("current_user_is_admin"):
        return error("Forbidden", 403)
    return None


@bp.get("/subscriptions")
@require_auth
def list_subscriptions():
    denied = _require_admin()
    if denied:
        return denied
    return success([])
