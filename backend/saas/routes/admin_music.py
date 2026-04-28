"""
Admin music bank routes -- Super Admin only.

GET    /api/admin/music/          -- list all tracks (including inactive)
POST   /api/admin/music/          -- create a track
PUT    /api/admin/music/<id>      -- update a track
PATCH  /api/admin/music/<id>/active -- toggle active status
"""

import logging
from flask import Blueprint, request as req
from backend.saas.auth.middleware import require_auth
from backend.saas.db.base import fetch_all, fetch_one, execute, execute_returning
from backend.saas.utils.responses import success, error

logger = logging.getLogger(__name__)
bp = Blueprint("admin_music", __name__, url_prefix="/api/admin/music")


def _require_admin():
    from flask import g
    if not g.get("current_user_is_admin"):
        return error("Forbidden", 403)
    return None


def _serialize(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "slug": row["slug"],
        "name": row["name"],
        "genre": row["genre"],
        "duration_sec": row["duration_sec"],
        "file_name": row["file_name"],
        "active": row["active"],
        "sort_order": row["sort_order"],
        "required_plan_code": row.get("required_plan_code"),
        "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
    }


@bp.get("/")
@require_auth
def list_tracks():
    denied = _require_admin()
    if denied:
        return denied

    rows = fetch_all(
        "SELECT id, slug, name, genre, duration_sec, file_name, active, sort_order, "
        "required_plan_code, created_at "
        "FROM saas_music_tracks ORDER BY sort_order, name",
    )
    return success([_serialize(dict(r)) for r in rows])


@bp.post("/")
@require_auth
def create_track():
    denied = _require_admin()
    if denied:
        return denied

    body = req.get_json(silent=True) or {}
    slug = (body.get("slug") or "").strip().lower().replace(" ", "_")
    name = (body.get("name") or "").strip()

    if not slug or not name:
        return error("slug and name are required")

    existing = fetch_one(
        "SELECT id FROM saas_music_tracks WHERE slug = %s", (slug,),
    )
    if existing:
        return error("A track with this slug already exists", 409)

    row = execute_returning(
        """
        INSERT INTO saas_music_tracks (slug, name, genre, duration_sec, file_name, active, sort_order, required_plan_code)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id, slug, name, genre, duration_sec, file_name, active, sort_order, required_plan_code, created_at
        """,
        (
            slug,
            name,
            (body.get("genre") or "General").strip(),
            body.get("duration_sec"),
            (body.get("file_name") or "").strip() or None,
            body.get("active", True),
            body.get("sort_order", 0),
            (body.get("required_plan_code") or "").strip() or None,
        ),
    )
    logger.info("Admin created music track: slug=%s", slug)
    return success(_serialize(dict(row)), 201)


@bp.put("/<track_id>")
@require_auth
def update_track(track_id: str):
    denied = _require_admin()
    if denied:
        return denied

    body = req.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        return error("name is required")

    slug = (body.get("slug") or "").strip().lower().replace(" ", "_")
    if not slug:
        return error("slug is required")

    conflict = fetch_one(
        "SELECT id FROM saas_music_tracks WHERE slug = %s AND id != %s::uuid",
        (slug, track_id),
    )
    if conflict:
        return error("A track with this slug already exists", 409)

    row = execute_returning(
        """
        UPDATE saas_music_tracks
        SET slug = %s, name = %s, genre = %s, duration_sec = %s,
            file_name = %s, sort_order = %s, required_plan_code = %s
        WHERE id = %s::uuid
        RETURNING id, slug, name, genre, duration_sec, file_name, active, sort_order, required_plan_code, created_at
        """,
        (
            slug,
            name,
            (body.get("genre") or "General").strip(),
            body.get("duration_sec"),
            (body.get("file_name") or "").strip() or None,
            body.get("sort_order", 0),
            (body.get("required_plan_code") or "").strip() or None,
            track_id,
        ),
    )
    if not row:
        return error("Track not found", 404)

    logger.info("Admin updated music track: id=%s slug=%s", track_id, slug)
    return success(_serialize(dict(row)))


@bp.patch("/<track_id>/active")
@require_auth
def toggle_active(track_id: str):
    denied = _require_admin()
    if denied:
        return denied

    body = req.get_json(silent=True) or {}
    active = bool(body.get("active", True))

    row = execute_returning(
        """
        UPDATE saas_music_tracks SET active = %s
        WHERE id = %s::uuid
        RETURNING id, slug, name, genre, duration_sec, file_name, active, sort_order, required_plan_code, created_at
        """,
        (active, track_id),
    )
    if not row:
        return error("Track not found", 404)

    logger.info("Admin toggled music track active: id=%s active=%s", track_id, active)
    return success(_serialize(dict(row)))
