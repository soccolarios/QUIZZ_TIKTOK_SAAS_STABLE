"""
Central session manager — single source of truth for all active SaaS sessions.

Responsibilities:
  - Maintain an in-memory registry of active SaasSessionRuntime instances.
  - Allocate isolated WebSocket ports per session.
  - Build a SessionContext for each session (dirs, db path, ws port, etc.)
  - Expose thread-safe create / start / stop / pause / resume operations.
  - Clean up terminated / failed sessions and their resources.
  - Never share state between sessions.
  - On startup, detect sessions that were running when the process last died
    and mark them as 'orphaned' in the DB so the UI can surface them.
"""

from __future__ import annotations

import threading
import secrets
import logging
from typing import Dict, Optional, Tuple

from backend.saas.models.session_context import SessionContext
from backend.saas.services.runtime_adapter import SaasSessionRuntime
from backend.saas.services.session_logger import add_log
from backend.saas.services.session_store import mark_orphaned_sessions, save_ws_port
from backend.saas.services.quiz_runtime_loader import prepare_quiz_for_session, QuizLoadError

logger = logging.getLogger(__name__)

_WS_PORT_BASE = 9100
_WS_PORT_MAX = 9199


class SessionManager:
    def __init__(self):
        self._lock = threading.Lock()
        self._sessions: Dict[str, SaasSessionRuntime] = {}
        self._used_ports: Dict[int, str] = {}
        self._startup_done = False

    def run_startup(self) -> None:
        """
        Call once after the DB is confirmed reachable (post startup_check).
        Marks any sessions that were in-flight when the process last exited.
        Safe to call multiple times — idempotent after first call.
        """
        if self._startup_done:
            return
        self._startup_done = True
        logger.info("SessionManager singleton started: manager_id=%d", id(self))
        try:
            orphaned = mark_orphaned_sessions()
            if orphaned:
                logger.info(
                    "SessionManager startup: %d orphaned session(s) detected: %s",
                    len(orphaned),
                    orphaned,
                )
            else:
                logger.info("SessionManager startup: no orphaned sessions")
        except Exception as e:
            logger.warning("SessionManager startup check failed (non-fatal): %s", e)

    def _allocate_port(self, session_id: str) -> int:
        for port in range(_WS_PORT_BASE, _WS_PORT_MAX + 1):
            if port not in self._used_ports:
                self._used_ports[port] = session_id
                return port
        raise RuntimeError("No available WebSocket ports (max concurrent sessions reached)")

    def _release_port(self, session_id: str):
        ports_to_release = [p for p, sid in self._used_ports.items() if sid == session_id]
        for p in ports_to_release:
            del self._used_ports[p]

    def create_and_start(
        self,
        session_id: str,
        quiz_id: str,
        launch_options: dict,
        user_id: str = "",
        project_id: str = "",
        overlay_token: str = "",
    ) -> Tuple[bool, Optional[str]]:
        """
        Build SessionContext, load quiz, allocate port, create and start runtime.
        Returns (success, error_message).
        """
        # Normalize to str — psycopg2 can return UUID objects from the DB.
        session_id = str(session_id)
        quiz_id = str(quiz_id)

        with self._lock:
            if session_id in self._sessions:
                return False, "Session already active"

            try:
                quiz_questionnaire = prepare_quiz_for_session(quiz_id)
            except QuizLoadError as e:
                return False, str(e)
            except Exception as e:
                logger.exception("Failed to load quiz %s", quiz_id)
                return False, f"Quiz load error: {e}"

            try:
                port = self._allocate_port(session_id)
            except RuntimeError as e:
                return False, str(e)

            ctx = SessionContext(
                session_id=session_id,
                user_id=str(user_id),
                project_id=str(project_id),
                quiz_id=quiz_id,
                ws_port=port,
                overlay_token=str(overlay_token),
                mode="saas",
            )

            runtime = SaasSessionRuntime(
                ctx=ctx,
                quiz_questionnaire=quiz_questionnaire,
                launch_options=launch_options,
                log_handler=lambda sid, msg: add_log(sid, msg),
            )

            self._sessions[session_id] = runtime
            logger.info(
                "SESSION REGISTERED: %s  ws_port=%d  registry_size=%d  manager_id=%d",
                session_id[:8], port, len(self._sessions), id(self),
            )

        logger.info("[SessionManager] Session %s created — allocated ws_port=%d", session_id[:8], port)
        add_log(session_id, f"Session created (quiz={quiz_id}, ws_port={port})")

        threading.Thread(
            target=save_ws_port,
            args=(session_id, port),
            daemon=True,
        ).start()

        try:
            ok = runtime.start()
            if ok:
                add_log(session_id, "Runtime start issued")
                return True, None
            else:
                reason = runtime._failure_reason or "Runtime failed to start"
                with self._lock:
                    self._sessions.pop(session_id, None)
                    self._release_port(session_id)
                add_log(session_id, f"Start failed: {reason}", "ERROR")
                return False, reason
        except Exception as e:
            logger.exception("Runtime start exception for session %s", session_id)
            with self._lock:
                self._sessions.pop(session_id, None)
                self._release_port(session_id)
            return False, str(e)

    def stop(self, session_id: str) -> Tuple[bool, Optional[str]]:
        session_id = str(session_id)
        with self._lock:
            runtime = self._sessions.get(session_id)
        if not runtime:
            return False, "Session not found in active registry"
        try:
            runtime.stop()
        except Exception as e:
            logger.exception("Error stopping session %s", session_id)
        with self._lock:
            self._sessions.pop(session_id, None)
            self._release_port(session_id)
        add_log(session_id, "Session stopped")
        return True, None

    def pause(self, session_id: str) -> Tuple[bool, Optional[str]]:
        session_id = str(session_id)
        runtime = self._get_runtime(session_id)
        if not runtime:
            return False, "Session not active"
        ok = runtime.pause()
        if ok:
            add_log(session_id, "Session paused")
            return True, None
        return False, "Pause not possible in current state"

    def resume(self, session_id: str) -> Tuple[bool, Optional[str]]:
        session_id = str(session_id)
        runtime = self._get_runtime(session_id)
        if not runtime:
            return False, "Session not active"
        ok = runtime.resume()
        if ok:
            add_log(session_id, "Session resumed")
            return True, None
        return False, "Resume not possible in current state"

    def get_runtime_status(self, session_id: str) -> Optional[dict]:
        runtime = self._get_runtime(str(session_id))
        if not runtime:
            return None
        return runtime.get_status()

    def get_ws_port(self, session_id: str) -> Optional[int]:
        runtime = self._get_runtime(str(session_id))
        if not runtime:
            return None
        return getattr(runtime._ctx, "ws_port", None)

    def get_overlay_snapshot(self, session_id: str) -> Optional[dict]:
        runtime = self._get_runtime(str(session_id))
        if not runtime:
            return None
        return runtime.get_overlay_snapshot()

    def is_active(self, session_id: str) -> bool:
        return str(session_id) in self._sessions

    def cleanup_finished(self):
        """
        Remove sessions whose runtime has stopped or failed.
        Should be called periodically or before listing sessions.
        """
        with self._lock:
            finished = []
            for sid, rt in self._sessions.items():
                try:
                    state = rt.get_status().get("state", "")
                    if state in ("stopped", "failed", "error") or rt._failed:
                        finished.append(sid)
                except Exception:
                    finished.append(sid)
            for sid in finished:
                self._sessions.pop(sid, None)
                self._release_port(sid)
                add_log(sid, "Session removed from active registry (finished/failed)")

    def _get_runtime(self, session_id: str) -> Optional[SaasSessionRuntime]:
        sid = str(session_id)
        with self._lock:
            runtime = self._sessions.get(sid)
            found = runtime is not None
            keys = list(self._sessions.keys()) if not found else []
        logger.info(
            "SESSION FETCH: %s  found=%s  manager_id=%d",
            sid[:8], found, id(self),
        )
        if not found:
            if keys:
                logger.warning(
                    "SESSION FETCH MISS: session=%s  registry_keys=%s",
                    sid[:8], [k[:8] for k in keys],
                )
            else:
                logger.warning(
                    "SESSION FETCH MISS: session=%s  registry=EMPTY",
                    sid[:8],
                )
        return runtime

    @staticmethod
    def generate_overlay_token() -> str:
        return secrets.token_urlsafe(32)


session_manager = SessionManager()
