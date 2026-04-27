"""
Overlay routes for the SaaS layer.

Public (no JWT required — token IS the credential):
  GET  /overlay/<overlay_token>            → serve the overlay HTML page
  GET  /api/overlay/<overlay_token>/config → return WS connection info
  GET  /api/overlay/<overlay_token>/state  → return current game snapshot

These endpoints are intentionally unauthenticated so OBS browser sources
can load them without any login flow.
"""

import os
import logging
from flask import Blueprint, jsonify, render_template_string, abort, request

from backend.saas.services.overlay_resolver import resolve_token, get_session_snapshot
from backend.saas.services.session_logger import add_log
from backend.saas.models.session import get_session_by_short_code

logger = logging.getLogger(__name__)

bp = Blueprint("overlay", __name__)

_FRONTEND_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../../../frontend")
)


def _read_frontend_file(filename: str) -> str:
    path = os.path.join(_FRONTEND_DIR, filename)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


_ASSETS_BASE = "/overlay-assets"


def _build_overlay_html(overlay_token: str) -> str:
    """
    Reads frontend/overlay.html and:
    1. Rewrites relative asset references (CSS, JS, fonts) to /overlay-assets/.
    2. Injects a SaaS bootstrap block before config-loader.js.
    """
    try:
        html = _read_frontend_file("overlay.html")
    except FileNotFoundError:
        abort(500, "overlay.html not found")

    html = html.replace('href="styles.css"', f'href="{_ASSETS_BASE}/styles.css"')
    html = html.replace('href="template-football.css"', f'href="{_ASSETS_BASE}/template-football.css"')
    html = html.replace('src="audio-manager.js"', f'src="{_ASSETS_BASE}/audio-manager.js"')
    html = html.replace('src="script.js"', f'src="{_ASSETS_BASE}/script.js"')

    bootstrap = f"""    <script>
    (function() {{
        window.__SAAS_OVERLAY_TOKEN = {repr(overlay_token)};
        window.__SAAS_MODE = true;
    }})();
    </script>
    <script src="{_ASSETS_BASE}/config-loader.js"></script>"""

    html = html.replace(
        '<script src="config-loader.js"></script>',
        bootstrap,
        1,
    )

    return html


@bp.get("/overlay/<overlay_token>")
def serve_overlay(overlay_token: str):
    info = resolve_token(overlay_token, request_host=request.host)
    if not info:
        return (
            "<html><body style='background:#000;color:#f44;font-family:monospace;padding:2rem'>"
            "<h2>Overlay introuvable</h2><p>Token invalide ou session inexistante.</p></body></html>",
            404,
        )

    add_log(info.session_id, f"Overlay page loaded (token={overlay_token[:8]}...)")

    html = _build_overlay_html(overlay_token)
    return html, 200, {"Content-Type": "text/html; charset=utf-8"}


@bp.get("/api/overlay/<overlay_token>/config")
def overlay_config(overlay_token: str):
    info = resolve_token(overlay_token, request_host=request.host)
    if not info:
        return jsonify({"ok": False, "error": "Invalid or expired overlay token"}), 404

    add_log(info.session_id, f"Overlay config requested (token={overlay_token[:8]}...)")

    return jsonify(info.to_dict())


@bp.get("/api/overlay/<overlay_token>/state")
def overlay_state(overlay_token: str):
    info = resolve_token(overlay_token, request_host=request.host)
    if not info:
        return jsonify({"ok": False, "error": "Invalid or expired overlay token"}), 404

    if not info.is_active:
        return jsonify({
            "ok": True,
            "session_status": info.session_status,
            "phase": "waiting",
            "runtime_state": info.session_status,
        })

    snapshot = get_session_snapshot(info.session_id)
    if snapshot is None:
        return jsonify({
            "ok": True,
            "session_status": info.session_status,
            "phase": "starting" if info.session_status == "running" else "waiting",
            "runtime_state": info.session_status,
        })

    snapshot["ok"] = True
    snapshot["session_status"] = info.session_status
    return jsonify(snapshot)


def _serve_short_code(short_code: str):
    row = get_session_by_short_code(short_code.upper())
    if not row or not row.get("overlay_token"):
        return (
            "<html><body style='background:#000;color:#f44;font-family:monospace;padding:2rem'>"
            "<h2>Overlay introuvable</h2><p>Short code invalide ou session inexistante.</p></body></html>",
            404,
        )
    overlay_token = row["overlay_token"]
    info = resolve_token(overlay_token, request_host=request.host)
    if not info:
        return (
            "<html><body style='background:#000;color:#f44;font-family:monospace;padding:2rem'>"
            "<h2>Overlay introuvable</h2><p>Token invalide ou session inexistante.</p></body></html>",
            404,
        )
    add_log(info.session_id, f"Overlay page loaded via short code (code={short_code.upper()}, token={overlay_token[:8]}...)")
    html = _build_overlay_html(overlay_token)
    return html, 200, {"Content-Type": "text/html; charset=utf-8"}


@bp.get("/o/<short_code>")
def short_overlay_redirect(short_code: str):
    """Public short URL: GET /o/<short_code> — serves overlay HTML directly (no redirect)."""
    return _serve_short_code(short_code)


@bp.get("/s/<short_code>")
def short_overlay_redirect_s(short_code: str):
    """Alternate short URL: GET /s/<short_code> — serves overlay HTML directly (no redirect)."""
    return _serve_short_code(short_code)
