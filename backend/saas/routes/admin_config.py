"""
Admin config routes — Super Admin only.

GET  /api/admin/config/<key>   — read a config namespace
PUT  /api/admin/config/<key>   — upsert a config namespace

Keys: site_config, plans, feature_flags
"""

import json
from flask import Blueprint, request as req
from backend.saas.auth.middleware import require_auth
from backend.saas.db.base import fetch_one, execute
from backend.saas.utils.responses import success, error

bp = Blueprint("admin_config", __name__, url_prefix="/api/admin/config")


def _require_admin():
    from flask import g
    if not g.get("current_user_is_admin"):
        return error("Forbidden", 403)
    return None


ALLOWED_KEYS = {"site_config", "plans", "feature_flags"}


@bp.get("/<key>")
@require_auth
def get_config(key: str):
    denied = _require_admin()
    if denied:
        return denied

    if key not in ALLOWED_KEYS:
        return error("Unknown config key", 404)

    row = fetch_one(
        "SELECT value, updated_at FROM platform_config WHERE key = %s",
        (key,),
    )
    if not row:
        return success({"key": key, "value": None, "updated_at": None})

    return success({
        "key": key,
        "value": row["value"],
        "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
    })


@bp.put("/<key>")
@require_auth
def put_config(key: str):
    denied = _require_admin()
    if denied:
        return denied

    if key not in ALLOWED_KEYS:
        return error("Unknown config key", 404)

    body = req.get_json(silent=True)
    if not body or "value" not in body:
        return error("Request body must contain 'value'", 400)

    value = body["value"]

    from flask import g
    user_id = g.current_user_id

    execute(
        """
        INSERT INTO platform_config (key, value, updated_at, updated_by)
        VALUES (%s, %s, now(), %s)
        ON CONFLICT (key) DO UPDATE
          SET value = EXCLUDED.value,
              updated_at = now(),
              updated_by = EXCLUDED.updated_by
        """,
        (key, json.dumps(value), user_id),
    )

    return success({"key": key, "saved": True})
