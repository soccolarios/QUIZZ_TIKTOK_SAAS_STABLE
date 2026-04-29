"""
Admin media upload routes -- Super Admin only.

POST /api/admin/upload/<category>   -- upload a file
GET  /api/admin/upload/<category>   -- list uploaded files in category
DELETE /api/admin/upload/<category>/<filename> -- delete a file

Categories: music, sounds, brand

Security:
  - Admin-only
  - Strict extension + MIME whitelist per category
  - File size limits
  - Sanitized filenames (no path traversal, no unsafe chars)
  - Collision-safe naming
  - No executable files ever accepted
"""

import logging
import os
from flask import Blueprint, request as req, send_from_directory
from backend.saas.auth.middleware import require_auth
from backend.saas.services.file_sanitizer import (
    sanitize_filename,
    collision_safe_path,
    validate_upload,
    ALLOWED_EXTENSIONS,
)
from backend.saas.utils.responses import success, error

logger = logging.getLogger(__name__)
bp = Blueprint("admin_upload", __name__, url_prefix="/api/admin/upload")

# Base upload directory — on VPS this resolves to /opt/tiktok-quiz-saas/data/
# In dev it's relative to the project root.
_DATA_DIR = os.environ.get(
    "UPLOAD_DATA_DIR",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../data")),
)

# Category → subdirectory mapping
_CATEGORY_DIRS = {
    "music": "music",
    "sounds": "sounds",
    "brand": "brand",
}

VALID_CATEGORIES = set(_CATEGORY_DIRS.keys())


def _require_admin():
    from flask import g
    if not g.get("current_user_is_admin"):
        return error("Forbidden", 403)
    return None


def _get_category_dir(category: str) -> str:
    subdir = _CATEGORY_DIRS[category]
    path = os.path.join(_DATA_DIR, subdir)
    os.makedirs(path, exist_ok=True)
    return path


@bp.post("/<category>")
@require_auth
def upload_file(category: str):
    denied = _require_admin()
    if denied:
        return denied

    if category not in VALID_CATEGORIES:
        return error(f"Unknown category: {category}", 404)

    if "file" not in req.files:
        return error("No file provided. Use multipart/form-data with field name 'file'.")

    file = req.files["file"]
    if not file.filename:
        return error("Empty filename")

    # Read file content to check size
    file_data = file.read()
    file_size = len(file_data)

    # Validate
    valid, err_msg = validate_upload(
        filename=file.filename,
        content_type=file.content_type,
        file_size=file_size,
        category=category,
    )
    if not valid:
        return error(err_msg, 400)

    # Sanitize filename
    safe_name = sanitize_filename(file.filename)

    # Resolve collision-safe path
    target_dir = _get_category_dir(category)
    final_path = collision_safe_path(target_dir, safe_name)
    final_name = os.path.basename(final_path)

    # Write file
    try:
        with open(final_path, "wb") as f:
            f.write(file_data)
    except OSError as e:
        logger.error("File write failed: %s", e)
        return error("Failed to save file on server", 500)

    from flask import g
    logger.info(
        "Admin upload: category=%s file=%s size=%d by=%s (original=%s)",
        category, final_name, file_size, g.current_user_id,
        file.filename[:50],
    )

    return success({
        "file_name": final_name,
        "category": category,
        "size": file_size,
        "original_name": file.filename,
    }, 201)


@bp.get("/<category>")
@require_auth
def list_files(category: str):
    denied = _require_admin()
    if denied:
        return denied

    if category not in VALID_CATEGORIES:
        return error(f"Unknown category: {category}", 404)

    target_dir = _get_category_dir(category)
    allowed_exts = ALLOWED_EXTENSIONS[category]

    files = []
    try:
        for fname in sorted(os.listdir(target_dir)):
            _, ext = os.path.splitext(fname.lower())
            if ext in allowed_exts:
                fpath = os.path.join(target_dir, fname)
                stat = os.stat(fpath)
                files.append({
                    "file_name": fname,
                    "size": stat.st_size,
                    "modified_at": int(stat.st_mtime),
                })
    except OSError:
        pass

    return success(files)


@bp.delete("/<category>/<filename>")
@require_auth
def delete_file(category: str, filename: str):
    denied = _require_admin()
    if denied:
        return denied

    if category not in VALID_CATEGORIES:
        return error(f"Unknown category: {category}", 404)

    # Sanitize to prevent path traversal
    safe = os.path.basename(filename)
    if not safe or safe != filename:
        return error("Invalid filename", 400)

    target_dir = _get_category_dir(category)
    file_path = os.path.join(target_dir, safe)

    if not os.path.isfile(file_path):
        return error("File not found", 404)

    try:
        os.remove(file_path)
    except OSError as e:
        logger.error("File delete failed: %s", e)
        return error("Failed to delete file", 500)

    from flask import g
    logger.info("Admin delete: category=%s file=%s by=%s", category, safe, g.current_user_id)
    return success({"deleted": True, "file_name": safe})


@bp.get("/<category>/<filename>")
@require_auth
def serve_file(category: str, filename: str):
    """Serve an uploaded file for admin preview. In production, nginx serves directly."""
    denied = _require_admin()
    if denied:
        return denied

    if category not in VALID_CATEGORIES:
        return error(f"Unknown category: {category}", 404)

    safe = os.path.basename(filename)
    if not safe or safe != filename:
        return error("Invalid filename", 400)

    target_dir = _get_category_dir(category)
    if not os.path.isfile(os.path.join(target_dir, safe)):
        return error("File not found", 404)

    return send_from_directory(target_dir, safe)
