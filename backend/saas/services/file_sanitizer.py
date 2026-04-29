"""
Safe filename sanitizer for media uploads.

Rules:
  - Lowercase
  - Remove accents (unicode normalization)
  - Remove emojis and special characters
  - Replace spaces/underscores with hyphens
  - Keep only a-z, 0-9, hyphen
  - Collapse multiple hyphens
  - Preserve file extension
  - Collision-safe: appends -2, -3, etc. if file already exists
  - Never exposes the original unsafe filename as a file path
"""

import os
import re
import unicodedata


def sanitize_filename(original: str) -> str:
    """
    Sanitize a filename to safe characters.

    Returns only the sanitized filename (no path components).
    Extension is preserved and lowercased.
    """
    basename = os.path.basename(original)

    name, ext = os.path.splitext(basename)
    ext = ext.lower().strip()

    # Normalize unicode and strip accents
    name = unicodedata.normalize("NFKD", name)
    name = "".join(c for c in name if not unicodedata.combining(c))

    # Lowercase
    name = name.lower()

    # Replace spaces, underscores, and dots (non-extension) with hyphens
    name = re.sub(r"[\s_\.]+", "-", name)

    # Remove everything that isn't a-z, 0-9, or hyphen
    name = re.sub(r"[^a-z0-9\-]", "", name)

    # Collapse multiple hyphens
    name = re.sub(r"-{2,}", "-", name)

    # Strip leading/trailing hyphens
    name = name.strip("-")

    # Fallback if nothing remains
    if not name:
        name = "upload"

    return f"{name}{ext}"


def collision_safe_path(directory: str, filename: str) -> str:
    """
    Return a full path that doesn't collide with existing files.

    If 'track.mp3' exists, returns path for 'track-2.mp3', then 'track-3.mp3', etc.
    """
    name, ext = os.path.splitext(filename)
    candidate = os.path.join(directory, filename)

    if not os.path.exists(candidate):
        return candidate

    counter = 2
    while True:
        new_name = f"{name}-{counter}{ext}"
        candidate = os.path.join(directory, new_name)
        if not os.path.exists(candidate):
            return candidate
        counter += 1
        if counter > 999:
            import secrets
            suffix = secrets.token_hex(4)
            return os.path.join(directory, f"{name}-{suffix}{ext}")


# Extension whitelists per upload category
ALLOWED_EXTENSIONS = {
    "music": {".mp3", ".wav", ".ogg", ".m4a"},
    "sounds": {".mp3", ".wav", ".ogg"},
    "brand": {".png", ".jpg", ".jpeg", ".svg", ".ico", ".webp"},
}

# Max file sizes (bytes) per category
MAX_FILE_SIZES = {
    "music": 20 * 1024 * 1024,   # 20 MB
    "sounds": 5 * 1024 * 1024,   # 5 MB
    "brand": 5 * 1024 * 1024,    # 5 MB
}

# MIME type whitelists per category
ALLOWED_MIMES = {
    "music": {
        "audio/mpeg", "audio/wav", "audio/x-wav", "audio/ogg",
        "audio/mp4", "audio/x-m4a", "audio/aac",
    },
    "sounds": {
        "audio/mpeg", "audio/wav", "audio/x-wav", "audio/ogg",
    },
    "brand": {
        "image/png", "image/jpeg", "image/svg+xml", "image/x-icon",
        "image/vnd.microsoft.icon", "image/webp",
    },
}


def validate_upload(
    filename: str,
    content_type: str | None,
    file_size: int,
    category: str,
) -> tuple[bool, str]:
    """
    Validate an upload against the category's rules.

    Returns (is_valid, error_message).
    """
    if category not in ALLOWED_EXTENSIONS:
        return False, f"Unknown upload category: {category}"

    _, ext = os.path.splitext(filename.lower())
    if ext not in ALLOWED_EXTENSIONS[category]:
        allowed = ", ".join(sorted(ALLOWED_EXTENSIONS[category]))
        return False, f"File type {ext} not allowed. Accepted: {allowed}"

    max_size = MAX_FILE_SIZES[category]
    if file_size > max_size:
        mb = max_size // (1024 * 1024)
        return False, f"File too large. Maximum size is {mb} MB."

    if content_type:
        clean_mime = content_type.split(";")[0].strip().lower()
        if clean_mime not in ALLOWED_MIMES[category]:
            return False, f"MIME type {clean_mime} not allowed for {category} uploads."

    return True, ""
