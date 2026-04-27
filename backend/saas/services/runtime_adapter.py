"""
SaasSessionRuntime — adapter between the SaaS session layer and the existing
GameRuntime / GameEngine stack.

ISOLATION GUARANTEES:
  - Per-session runtime directory: tmp/saas_sessions/<session_id>/
    ephemeral — questionnaire JSON + symlink only, cleaned up on stop.
  - Per-session persistent directory: data/saas_sessions/<session_id>/
    survives restarts — scores.db lives here.
  - Isolated SQLite DB per session: data/saas_sessions/<session_id>/scores.db
    db_path is passed explicitly through GameRuntime -> GameEngine -> DatabaseManager.
    No global state is mutated. Thread-safe by construction.
  - WebSocket server: own port per session (allocated by SessionManager).
  - TTS: reads pre-generated audio from shared data/audio/ (read-only) — safe.
  - Snapshot persistence: every state change triggers an async upsert to
    saas_session_snapshots so the last known state survives restarts.

LEGACY MODE:
  - The existing game_engine / run.py / admin_panel path is completely unmodified.
  - Isolation code is only activated when SaasSessionRuntime is used.
"""

from __future__ import annotations

import sys
import os
import json
import threading
import logging
from typing import Optional, Callable

from backend.saas.models.session_context import SessionContext
from backend.saas.services.session_logger import add_log
from backend.saas.services.session_store import (
    save_scores_db_path,
    upsert_snapshot,
    build_snapshot_from_overlay,
)

logger = logging.getLogger(__name__)

_ENGINE_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../../..")
)

_QUESTIONNAIRE_DATA_DIR = os.path.join(_ENGINE_ROOT, "data", "questionnaires")

_SNAPSHOT_INTERVAL_SECS = 30


def _ensure_engine_path():
    backend_path = os.path.join(_ENGINE_ROOT, "backend")
    if backend_path not in sys.path:
        sys.path.insert(0, backend_path)


class SaasSessionRuntime:
    """
    Wraps a GameRuntime instance for a single SaaS session.

    Each instance is fully isolated: own thread, own engine, own WS server,
    own SQLite database, own questionnaire file.
    """

    def __init__(
        self,
        ctx: SessionContext,
        quiz_questionnaire: dict,
        launch_options: dict,
        log_handler: Optional[Callable[[str, str], None]] = None,
    ):
        self.session_id = ctx.session_id
        self._ctx = ctx
        self._quiz_questionnaire = quiz_questionnaire
        self._launch_options = launch_options
        self._log_handler = log_handler

        self._runtime = None
        self._questionnaire_symlink: Optional[str] = None  # kept for compat
        self._questionnaire_symlinks: list = []
        self._started = False
        self._failed = False
        self._failure_reason: Optional[str] = None

        self._snapshot_timer: Optional[threading.Timer] = None

        raw_vol = launch_options.get("music_volume")
        if raw_vol is not None:
            try:
                self._music_volume: int = int(raw_vol)
            except (ValueError, TypeError):
                self._music_volume = 40
        else:
            self._music_volume = 40
        self._music_enabled: bool = bool(launch_options.get("music_enabled", True))

        _ensure_engine_path()

    def _log(self, message: str, level: str = "INFO"):
        entry = f"{self._ctx.log_prefix()} {message}"
        logger.info(entry)
        add_log(self.session_id, entry, level)
        if self._log_handler:
            try:
                self._log_handler(self.session_id, entry)
            except Exception:
                pass

    def _persist_snapshot_async(self):
        snapshot = self.get_overlay_snapshot()
        if snapshot:
            compact = build_snapshot_from_overlay(snapshot, self.session_id)
            t = threading.Thread(
                target=upsert_snapshot,
                args=(self.session_id, compact),
                daemon=True,
                name=f"snap-{self.session_id[:8]}",
            )
            t.start()

    def _schedule_periodic_snapshot(self):
        self._cancel_periodic_snapshot()
        self._snapshot_timer = threading.Timer(
            _SNAPSHOT_INTERVAL_SECS, self._periodic_snapshot_tick
        )
        self._snapshot_timer.daemon = True
        self._snapshot_timer.start()

    def _periodic_snapshot_tick(self):
        if self._started and not self._failed:
            self._persist_snapshot_async()
            self._schedule_periodic_snapshot()

    def _cancel_periodic_snapshot(self):
        if self._snapshot_timer:
            self._snapshot_timer.cancel()
            self._snapshot_timer = None

    def _write_one_questionnaire(self, questionnaire: dict, label: str) -> int:
        """Write a single questionnaire dict to the data dir and return its int ID."""
        qn_id = questionnaire.get("id", 9000)

        tmp_dir = self._ctx.runtime_dir
        os.makedirs(tmp_dir, exist_ok=True)
        tmp_path = os.path.join(tmp_dir, f"qn_{qn_id}.json")

        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(questionnaire, f, ensure_ascii=False, indent=2)

        os.makedirs(_QUESTIONNAIRE_DATA_DIR, exist_ok=True)
        symlink_path = os.path.join(
            _QUESTIONNAIRE_DATA_DIR, f"saas_{self.session_id}_{qn_id}.json"
        )
        if os.path.islink(symlink_path) or os.path.exists(symlink_path):
            try:
                os.remove(symlink_path)
            except Exception:
                pass
        try:
            os.symlink(tmp_path, symlink_path)
            self._log(f"Symlink created: {symlink_path} ({label})")
        except Exception as e:
            import shutil
            shutil.copy2(tmp_path, symlink_path)
            self._log(f"Symlink failed ({e}), used file copy ({label})")

        self._questionnaire_symlinks.append(symlink_path)
        return qn_id

    def _write_questionnaire(self) -> int:
        """Write the primary questionnaire (backwards-compat) and return its int ID."""
        self._ctx.create_dirs()
        return self._write_one_questionnaire(self._quiz_questionnaire, "primary")

    def _write_all_questionnaires(self) -> list:
        """
        Write all questionnaires for multi-quiz modes.

        Returns the ordered list of integer questionnaire IDs as the engine expects.
        The primary quiz (self._quiz_questionnaire) is always first; additional
        questionnaires are loaded from launch_options["quiz_ids"].
        """
        self._ctx.create_dirs()

        quiz_ids: list = self._launch_options.get("quiz_ids") or []

        if len(quiz_ids) <= 1:
            # Single-quiz path — nothing extra to load
            return [self._write_one_questionnaire(self._quiz_questionnaire, "primary")]

        # Load additional quizzes from the DB
        try:
            from backend.saas.services.quiz_runtime_loader import prepare_quiz_for_session, QuizLoadError
        except ImportError:
            _ensure_engine_path()
            from backend.saas.services.quiz_runtime_loader import prepare_quiz_for_session, QuizLoadError

        ordered_int_ids = []
        for uuid_str in quiz_ids:
            if str(uuid_str) == str(self._ctx.quiz_id):
                qn = self._quiz_questionnaire
                label = "primary"
            else:
                try:
                    qn = prepare_quiz_for_session(str(uuid_str))
                    label = f"quiz={str(uuid_str)[:8]}"
                except QuizLoadError as e:
                    self._log(f"Skipping quiz {uuid_str}: {e}", "WARNING")
                    continue
                except Exception as e:
                    self._log(f"Skipping quiz {uuid_str} (unexpected error): {e}", "WARNING")
                    continue
            int_id = self._write_one_questionnaire(qn, label)
            ordered_int_ids.append(int_id)

        if not ordered_int_ids:
            # Fallback: at minimum write the primary quiz
            ordered_int_ids = [self._write_one_questionnaire(self._quiz_questionnaire, "fallback")]

        return ordered_int_ids

    def _cleanup_questionnaire(self):
        for path in getattr(self, "_questionnaire_symlinks", []):
            if path and os.path.exists(path):
                try:
                    os.remove(path)
                except Exception as e:
                    self._log(f"Symlink cleanup failed ({path}): {e}", "WARNING")
        self._questionnaire_symlinks = []
        # Legacy single-symlink attribute kept for safety
        self._questionnaire_symlink = None

    def _pre_generate_audio(self, questionnaire: dict) -> None:
        """
        Pre-generate (or reuse cached) TTS audio for all questions in the
        given questionnaire dict before the game runtime starts.

        Uses QuestionnaireAudioService with mode='missing':
          - Files whose content hash matches meta.json are skipped (cache hit).
          - Only truly absent or stale files are sent to the TTS API.
          - Audio is stored at: data/audio/questionnaires/<qn_id>/

        The qn_id in the questionnaire dict is already the stable per-quiz key
        produced by _audio_dir_key_from_uuid(), so each quiz has its own dir.

        Runs synchronously — blocks until generation finishes or times out
        (max 5 minutes for very large quizzes).  Never raises; any failure is
        logged and the session proceeds without TTS audio.
        """
        qn_id = questionnaire.get("id")
        questions = questionnaire.get("questions", [])
        if not qn_id or not questions:
            self._log("Audio pre-generation skipped (no qn_id or no questions)", "WARNING")
            return

        user_id = self._ctx.user_id or None
        self._log(
            f"Audio pre-generation: qn_id={qn_id}, user={user_id or 'global'}, {len(questions)} questions "
            f"(mode=missing, reuses existing cache)"
        )

        try:
            _ensure_engine_path()
            from audio_service import AudioService
            from questionnaire_audio_service import QuestionnaireAudioService

            audio_svc = AudioService()
            qn_audio_svc = QuestionnaireAudioService(audio_svc)

            # Quick status check — if everything is up-to-date, skip entirely
            status = qn_audio_svc.get_status(qn_id, questions, user_id=user_id)
            if status.get("up_to_date"):
                self._log(
                    f"Audio cache HIT: all {status['existing']} files valid, "
                    f"no generation needed"
                )
                return

            self._log(
                f"Audio cache status: existing={status['existing']}, "
                f"missing={status['missing']}, obsolete={status['obsolete']} — generating"
            )

            job_id = qn_audio_svc.start_generation_job(qn_id, questions, mode="missing", user_id=user_id)

            # Poll until the job finishes (max 5 minutes)
            import time as _time
            deadline = _time.time() + 300
            while _time.time() < deadline:
                job = qn_audio_svc.get_job_status(job_id) or {}
                if job.get("status") in ("completed", "partial", "error"):
                    break
                _time.sleep(0.5)

            job = qn_audio_svc.get_job_status(job_id) or {}
            final = job.get("status", "unknown")
            self._log(
                f"Audio pre-generation done: status={final} "
                f"generated={job.get('generated', 0)} "
                f"cached={job.get('cached', 0)} "
                f"errors={job.get('errors', 0)}"
            )

        except Exception as e:
            self._log(f"Audio pre-generation error (non-fatal): {e}", "WARNING")
            logger.exception(
                "SaasSessionRuntime._pre_generate_audio failed for session %s",
                self.session_id,
            )

    def start(self) -> bool:
        if self._started or self._failed:
            return False

        try:
            from game_runtime import GameRuntime
            from websocket_server import WebSocketServer
        except ImportError:
            _ensure_engine_path()
            from game_runtime import GameRuntime
            from websocket_server import WebSocketServer

        try:
            all_qn_ids = self._write_all_questionnaires()
            qn_id = all_qn_ids[0] if all_qn_ids else 9000
        except Exception as e:
            self._log(f"Failed to write questionnaire(s): {e}", "ERROR")
            self._failed = True
            self._failure_reason = str(e)
            return False

        self._ctx.create_dirs()
        self._log(f"Using persistent DB: {self._ctx.db_path}")

        threading.Thread(
            target=save_scores_db_path,
            args=(self.session_id, self._ctx.db_path),
            daemon=True,
        ).start()

        opts = self._launch_options
        tiktok_username = opts.get("tiktok_username") or "saas_session"
        simulate = opts.get("simulation_mode", True)

        # Pre-generate TTS audio in a background thread so it never blocks
        # the runtime start.  The game proceeds immediately; audio files are
        # available once generation finishes (cache hits are nearly instant).
        if not opts.get("no_tts", True):
            threading.Thread(
                target=self._pre_generate_audio,
                args=(self._quiz_questionnaire,),
                daemon=True,
                name=f"tts-{self.session_id[:8]}",
            ).start()

        try:
            self._runtime = GameRuntime(db_path=self._ctx.db_path)

            self._runtime.set_log_handler(lambda msg: self._log(msg))
            self._runtime.set_state_change_handler(self._on_state_change)

            ws = WebSocketServer(port=self._ctx.ws_port)
            self._log(f"[WS] Pre-assigning WebSocketServer port={ws.port} for session {self.session_id[:8]}")
            self._runtime._ws_server = ws

            self._runtime.start_ws_server()

            result = self._runtime.start(
                tiktok_username=tiktok_username,
                simulate=simulate,
                questionnaire_id=qn_id,
                questionnaire_ids=all_qn_ids,
                play_mode=opts.get("play_mode", "single"),
                question_time=opts.get("question_time"),
                countdown_time=opts.get("countdown_time"),
                questions=opts.get("total_questions", 0),
                x2_enabled=opts.get("x2_enabled", False),
                no_tts=opts.get("no_tts", True),
                user_id=self._ctx.user_id or None,
            )

            if result:
                self._started = True
                self._log(f"Runtime started successfully on ws_port={self._ctx.ws_port}")
                self._schedule_periodic_snapshot()
            else:
                self._failed = True
                self._failure_reason = "GameRuntime.start() returned False"
                self._log("Runtime start returned False", "ERROR")

            return result

        except Exception as e:
            self._failed = True
            self._failure_reason = str(e)
            self._log(f"Exception during start: {e}", "ERROR")
            logger.exception("SaasSessionRuntime.start() exception for %s", self.session_id)
            self._emergency_cleanup()
            return False

    def _on_state_change(self, old_state, new_state):
        from game_runtime import RuntimeState
        self._log(f"Runtime state: {old_state.value} -> {new_state.value}")
        self._persist_snapshot_async()
        if new_state == RuntimeState.ERROR:
            self._failed = True
            self._failure_reason = self._runtime.error_message if self._runtime else "unknown"
            self._log(f"Runtime entered ERROR state: {self._failure_reason}", "ERROR")
            self._cancel_periodic_snapshot()
            self._schedule_failed_cleanup()

    def _schedule_failed_cleanup(self):
        t = threading.Thread(
            target=self._emergency_cleanup,
            daemon=True,
            name=f"cleanup-{self.session_id[:8]}",
        )
        t.start()

    def _emergency_cleanup(self):
        self._log("Emergency cleanup triggered", "WARNING")
        self._cancel_periodic_snapshot()
        try:
            if self._runtime:
                try:
                    self._runtime.stop()
                except Exception:
                    pass
        finally:
            self._cleanup_questionnaire()
            self._ctx.cleanup_dirs()
            self._log("Emergency cleanup complete")

    def stop(self) -> bool:
        self._log("Stop requested")
        self._cancel_periodic_snapshot()
        self._persist_snapshot_async()
        ok = False
        if self._runtime:
            try:
                ok = self._runtime.stop()
            except Exception as e:
                self._log(f"Error during stop: {e}", "ERROR")
        self._cleanup_questionnaire()
        self._ctx.cleanup_dirs()
        return ok

    def pause(self) -> bool:
        if not self._runtime:
            return False
        result = self._runtime.pause()
        if result:
            self._log("Runtime paused")
            self._persist_snapshot_async()
        else:
            self._log("Pause not possible in current state", "WARNING")
        return result

    def resume(self) -> bool:
        if not self._runtime:
            return False
        result = self._runtime.resume()
        if result:
            self._log("Runtime resumed")
            self._persist_snapshot_async()
        else:
            self._log("Resume not possible in current state", "WARNING")
        return result

    def replay(self) -> bool:
        if not self._runtime:
            return False
        result = self._runtime.replay()
        if result:
            self._log("Replay requested — game restarting within same session")
            self._persist_snapshot_async()
        else:
            self._log("Replay not possible in current state", "WARNING")
        return result

    def _get_tiktok_stats(self) -> dict:
        """
        Pull live TikTok connection stats from the engine's TikTokClient.
        Returns a safe default when the engine or client is not available.
        """
        default = {
            "connected":   False,
            "connecting":  False,
            "retry_count": 0,
            "last_error":  None,
        }
        try:
            engine = self._runtime._engine if self._runtime else None
            if engine is None:
                return default
            tiktok = getattr(engine, "tiktok", None)
            if tiktok is None:
                return default
            stats = tiktok.get_stats()
            return {
                "connected":   bool(stats.get("connected",   False)),
                "connecting":  bool(stats.get("connecting",  False)),
                "retry_count": int(stats.get("retry_count",  0)),
                "last_error":  stats.get("last_error"),
            }
        except Exception:
            return default

    def get_status(self) -> dict:
        base = {
            "state": "not_started",
            "running": False,
            "paused": False,
            "uptime": None,
            "error": self._failure_reason,
            "engine_state": None,
            "ws_connected": 0,
            "ws_port": self._ctx.ws_port,
            "session_id": self.session_id,
            "tiktok": self._get_tiktok_stats(),
        }
        if self._failed and not self._runtime:
            base["state"] = "failed"
            return base
        if not self._runtime:
            return base
        status = self._runtime.get_status()
        status["ws_port"]    = self._ctx.ws_port
        status["session_id"] = self.session_id
        status["tiktok"]     = self._get_tiktok_stats()
        if self._failure_reason and not status.get("error"):
            status["error"] = self._failure_reason
        return status

    def get_engine_state(self) -> Optional[str]:
        if self._runtime:
            return self._runtime.get_game_state_detail()
        return None

    def get_overlay_snapshot(self) -> dict:
        if self._runtime:
            try:
                return self._runtime.get_overlay_snapshot()
            except Exception as e:
                self._log(f"Snapshot error: {e}", "WARNING")
        return {}

    def set_tts_enabled(self, enabled: bool) -> bool:
        if not self._runtime or not self._runtime._engine:
            return False
        try:
            self._runtime._engine.tts.enabled = enabled
            self._log(f"TTS {'enabled' if enabled else 'disabled'}")
            return True
        except Exception as e:
            self._log(f"set_tts_enabled error: {e}", "WARNING")
            return False

    def _broadcast_music_config(self, enabled: bool, volume_pct: int) -> None:
        """Push a music_config event to the overlay over the live WS connection."""
        try:
            ws_server = self._runtime._ws_server if self._runtime else None
            ws_loop = self._runtime._ws_loop if self._runtime else None
            if ws_server is None or ws_loop is None or ws_loop.is_closed():
                self._log("_broadcast_music_config skipped: WS not ready", "WARNING")
                return
            import asyncio
            future = asyncio.run_coroutine_threadsafe(
                ws_server.broadcast("music_config", {
                    "enabled": enabled,
                    "volume": volume_pct / 100.0,
                }),
                ws_loop,
            )
            future.result(timeout=5)
        except Exception as e:
            self._log(f"_broadcast_music_config error: {e}", "WARNING")

    def set_music_enabled(self, enabled: bool) -> bool:
        try:
            self._music_enabled = enabled
            self._broadcast_music_config(enabled, self._music_volume)
            self._persist_audio_to_launch_options()
            self._log(f"Music {'enabled' if enabled else 'disabled'}")
            return True
        except Exception as e:
            self._log(f"set_music_enabled error: {e}", "WARNING")
            return False

    def set_volume(self, volume: int) -> bool:
        """Set music volume (0-100)."""
        try:
            self._music_volume = max(0, min(100, volume))
            self._broadcast_music_config(self._music_enabled, self._music_volume)
            self._persist_audio_to_launch_options()
            self._log(f"Music volume set to {self._music_volume}%")
            return True
        except Exception as e:
            self._log(f"set_volume error: {e}", "WARNING")
            return False

    def _persist_audio_to_launch_options(self) -> None:
        """Persist current audio state into the DB launch_options JSON."""
        try:
            from backend.saas.models.session import patch_launch_options
            patch_launch_options(self.session_id, {
                "music_enabled": self._music_enabled,
                "music_volume": self._music_volume,
            })
        except Exception as e:
            self._log(f"_persist_audio error: {e}", "WARNING")

    def get_audio_state(self) -> dict:
        tts_enabled = True
        if self._runtime and self._runtime._engine:
            try:
                tts_enabled = bool(self._runtime._engine.tts.enabled)
            except Exception:
                pass
        return {
            "tts_enabled": tts_enabled,
            "music_enabled": self._music_enabled,
            "music_volume": self._music_volume,
        }

    def cleanup(self):
        self.stop()
