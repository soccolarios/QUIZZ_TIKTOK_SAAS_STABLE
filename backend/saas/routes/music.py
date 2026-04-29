"""
Music library routes.

GET /api/music/
  Returns the admin-managed catalog of background music tracks.
  Authenticated users can browse and select a track at session launch.
  file_name is intentionally excluded from the public response — only
  the backend resolves slug -> file_name internally.
"""

from typing import Optional

from flask import Blueprint
from backend.saas.auth.middleware import require_auth
from backend.saas.db.base import fetch_all, fetch_one
from backend.saas.utils.responses import success

bp = Blueprint("music", __name__, url_prefix="/api/music")


def _serialize_track(row: dict) -> dict:
    return {
        "id":           str(row["id"]),
        "slug":         row["slug"],
        "name":         row["name"],
        "genre":        row["genre"],
        "duration_sec": row["duration_sec"],
        "sort_order":   row["sort_order"],
    }


def resolve_slug_to_file_name(slug: Optional[str]) -> Optional[str]:
    """
    Resolve a music track slug to its on-disk file_name.
    Returns None when slug is absent, is 'none', or has no file_name set.
    """
    if not slug or slug.strip().lower() == "none":
        return None
    row = fetch_one(
        "SELECT file_name FROM saas_music_tracks WHERE slug = %s AND active = true",
        (slug.strip(),),
    )
    if not row:
        return None
    return row["file_name"] or None


@bp.get("/")
@require_auth
def list_tracks():
    rows = fetch_all(
        "SELECT id, slug, name, genre, duration_sec, sort_order "
        "FROM saas_music_tracks WHERE active = true ORDER BY sort_order, name",
    )
    return success([_serialize_track(dict(r)) for r in rows])
