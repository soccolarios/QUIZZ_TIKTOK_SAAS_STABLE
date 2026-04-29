"""
Public config route — unauthenticated.

GET /api/config/public
  Returns brand config values that the frontend needs before authentication.
"""

from flask import Blueprint
from backend.saas.db.base import fetch_one
from backend.saas.utils.responses import success

bp = Blueprint("public_config", __name__, url_prefix="/api/config")

_DEFAULTS = {
    "brandName": "LiveGine",
    "tagline": "Interactive live quiz experiences",
    "supportEmail": "support@livegine.com",
}


@bp.get("/public")
def get_public_config():
    try:
        row = fetch_one("SELECT value FROM platform_config WHERE key = 'site_config'")
        if row and row.get("value"):
            cfg = row["value"]
            return success({
                "brandName": cfg.get("brandName", _DEFAULTS["brandName"]),
                "tagline": cfg.get("tagline", _DEFAULTS["tagline"]),
                "supportEmail": cfg.get("supportEmail", _DEFAULTS["supportEmail"]),
            })
    except Exception:
        pass
    return success(_DEFAULTS)
