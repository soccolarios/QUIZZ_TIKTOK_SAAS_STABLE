"""
Centralized resolver for: overlay_token -> session -> ws_port -> config.

This is the single source of truth for anything overlay-related:
- Validate a token
- Find the associated session in DB
- Look up the live runtime in SessionManager
- Return typed connection info

No auth required to resolve a token — tokens are treated as bearer capabilities
(knowing the token IS the authorization, like a signed overlay link).
"""

from __future__ import annotations

import json
import logging
import os
from typing import Optional

from backend.saas.db.base import fetch_one

logger = logging.getLogger(__name__)

_LOCALHOST_ALIASES = {"localhost", "127.0.0.1", "0.0.0.0", "::1", "::"}


def _is_internal(host: str) -> bool:
    return not host or host.strip() in _LOCALHOST_ALIASES


def _ws_proto() -> str:
    saas_base_url = os.environ.get("SAAS_BASE_URL", "")
    if saas_base_url.startswith("https"):
        return "wss"
    return "ws"


def _build_ws_url(ws_port: int, request_host: str) -> Optional[str]:
    """
    Build a path-based WebSocket URL routed through nginx on port 443.

    Format: wss://<public-domain>/saas-ws/<ws_port>

    nginx proxies /saas-ws/<port> -> http://127.0.0.1:<port>
    so the browser never needs to reach raw ports 9100-9199 directly.

    Host resolution priority:
      1. SAAS_PUBLIC_HOST env var
      2. request.host (stripped of port)
      3. hostname parsed from SAAS_BASE_URL
    Internal/loopback hosts are rejected at every step.
    """
    proto = _ws_proto()

    candidates = [
        os.environ.get("SAAS_PUBLIC_HOST", "").strip(),
        request_host.split(":")[0].strip(),
        os.environ.get("SAAS_BASE_URL", "").split("//")[-1].split(":")[0].split("/")[0].strip(),
    ]

    host = None
    for candidate in candidates:
        if candidate and not _is_internal(candidate):
            host = candidate
            break

    if not host:
        logger.error(
            "[OverlayResolver] Cannot determine a public host for ws_url — "
            "set SAAS_PUBLIC_HOST or SAAS_BASE_URL to a public domain. "
            "Candidates were: %r",
            candidates,
        )
        return None

    return f"{proto}://{host}/saas-ws/{ws_port}"


class OverlayInfo:
    __slots__ = (
        "session_id",
        "overlay_token",
        "session_status",
        "ws_url",
        "ws_port",
        "is_active",
        "engine_state",
        "overlay_template",
        "music_enabled",
        "music_file_name",
        "music_volume",
        "music_track_slug",
    )

    def __init__(
        self,
        session_id: str,
        overlay_token: str,
        session_status: str,
        ws_url: Optional[str],
        ws_port: Optional[int],
        is_active: bool,
        engine_state: Optional[str],
        overlay_template: str = "default",
        music_enabled: bool = False,
        music_file_name: Optional[str] = None,
        music_volume: int = 40,
        music_track_slug: Optional[str] = None,
    ):
        self.session_id = session_id
        self.overlay_token = overlay_token
        self.session_status = session_status
        self.ws_url = ws_url
        self.ws_port = ws_port
        self.is_active = is_active
        self.engine_state = engine_state
        self.overlay_template = overlay_template or "default"
        self.music_enabled = music_enabled
        self.music_file_name = music_file_name
        self.music_volume = music_volume
        self.music_track_slug = music_track_slug

    def _music_dict(self) -> dict:
        return {
            "music_enabled":    self.music_enabled,
            "music_file_name":  self.music_file_name,
            "music_volume":     self.music_volume,
            "music_track_slug": self.music_track_slug,
        }

    def to_dict(self) -> dict:
        if self.ws_url is None:
            return {
                "ok": False,
                "overlay_token": self.overlay_token,
                "session_status": self.session_status,
                "ws_url": None,
                "is_active": self.is_active,
                "engine_state": self.engine_state,
                "overlay_template": self.overlay_template,
                "error": "ws_port not allocated — session not yet started or port lost after restart",
                **self._music_dict(),
            }
        return {
            "ok": True,
            "overlay_token": self.overlay_token,
            "session_status": self.session_status,
            "ws_url": self.ws_url,
            "is_active": self.is_active,
            "engine_state": self.engine_state,
            "overlay_template": self.overlay_template,
            **self._music_dict(),
        }


def resolve_token(overlay_token: str, request_host: str = "") -> Optional[OverlayInfo]:
    """
    Resolve an overlay_token to full connection info.
    Returns None if the token is invalid or session not found.
    """
    if not overlay_token or len(overlay_token) < 8:
        return None

    row = fetch_one(
        """
        SELECT id, status, overlay_token, launch_options
        FROM saas_game_sessions
        WHERE overlay_token = %s
        """,
        (overlay_token,),
    )
    if not row:
        logger.warning("overlay_resolver: unknown token %s...", overlay_token[:8])
        return None

    session_id = str(row["id"])
    session_status = str(row["status"])

    raw_opts = row.get("launch_options") or {}
    if isinstance(raw_opts, str):
        try:
            raw_opts = json.loads(raw_opts)
        except (ValueError, TypeError):
            raw_opts = {}
    overlay_template = (raw_opts.get("overlay_template") or "default").strip()

    _TERMINAL_STATUSES = {"stopped", "failed", "orphaned", "expired"}

    if session_status in _TERMINAL_STATUSES:
        logger.info(
            "[OverlayResolver] token=%s... session=%s is terminal (%s) — no WS",
            overlay_token[:8], session_id[:8], session_status,
        )
        return OverlayInfo(
            session_id=session_id,
            overlay_token=overlay_token,
            session_status=session_status,
            ws_url=None,
            ws_port=None,
            is_active=False,
            engine_state=None,
            overlay_template=overlay_template,
        )

    # Resolve music config from launch_options.
    music_track_slug = (raw_opts.get("music_track_slug") or "none").strip()
    try:
        from backend.saas.routes.music import resolve_slug_to_file_name
        music_file_name = resolve_slug_to_file_name(music_track_slug)
    except Exception:
        music_file_name = None

    persisted_music_enabled = raw_opts.get("music_enabled")
    if persisted_music_enabled is not None:
        music_enabled = bool(persisted_music_enabled)
    else:
        music_enabled = music_file_name is not None

    raw_music_volume = raw_opts.get("music_volume")
    if raw_music_volume is None:
        music_volume = 40
    else:
        try:
            music_volume = int(raw_music_volume)
        except (ValueError, TypeError):
            music_volume = 40

    from backend.saas.services.session_manager import session_manager
    from backend.saas.services.session_store import get_ws_port as get_ws_port_db

    runtime_status = session_manager.get_runtime_status(session_id)
    is_active = bool(
        runtime_status
        and (runtime_status.get("running") or runtime_status.get("state") == "starting")
    )
    ws_port = runtime_status.get("ws_port") if runtime_status else None
    engine_state = runtime_status.get("engine_state") if runtime_status else None

    _ACTIVE_STATUSES = {"running", "starting", "paused"}

    if ws_port is None and session_status in _ACTIVE_STATUSES:
        ws_port = session_manager.get_ws_port(session_id)
        if ws_port:
            logger.debug("[OverlayResolver] ws_port=%d from in-memory context for session %s", ws_port, session_id[:8])

    if ws_port is None and session_status in _ACTIVE_STATUSES:
        ws_port = get_ws_port_db(session_id)
        if ws_port:
            logger.debug("[OverlayResolver] ws_port=%d from DB for session %s", ws_port, session_id[:8])

    if ws_port:
        ws_url = _build_ws_url(ws_port, request_host)
        logger.info("[OverlayResolver] token=%s... session=%s ws_target=%s", overlay_token[:8], session_id[:8], ws_url)
    else:
        ws_url = None
        logger.warning("[OverlayResolver] token=%s... session=%s has no allocated ws_port (runtime not started?)", overlay_token[:8], session_id[:8])

    return OverlayInfo(
        session_id=session_id,
        overlay_token=overlay_token,
        session_status=session_status,
        ws_url=ws_url,
        ws_port=ws_port,
        is_active=is_active,
        engine_state=engine_state,
        overlay_template=overlay_template,
        music_enabled=music_enabled,
        music_file_name=music_file_name,
        music_volume=music_volume,
        music_track_slug=music_track_slug,
    )


def get_session_snapshot(session_id: str) -> Optional[dict]:
    """
    Return the current overlay snapshot from the live runtime, or None.
    """
    from backend.saas.services.session_manager import session_manager
    return session_manager.get_overlay_snapshot(session_id)
