"""
Session routes.

SESSION LIFECYCLE — definitive reference
=========================================

  prepared  — Row exists in DB, overlay_token and short_code are assigned so
              the overlay URL can be distributed in advance (e.g. on-screen
              before going live). No runtime is running. Transitions to
              'starting' when POST /start is called with the session_id.

  created   — Row exists in DB, start was requested but not yet confirmed.
              Very short-lived; transitions to 'starting' immediately.

  starting  — GameRuntime is being initialised (loading quiz, allocating port,
              spinning up threads). The session is in-memory but not yet
              running a game loop.

  running   — GameRuntime is active and the game loop is executing. Questions
              are being shown, answers collected, scores updated in real-time.
              A periodic snapshot (every 30 s) plus every state-change snapshot
              is written to saas_session_snapshots.

  paused    — GameRuntime is alive in memory but the game loop is suspended.
              The overlay shows a pause screen. Can be resumed.

  stopped   — Session was intentionally stopped by the user via the API.
              The GameRuntime has been shut down. scores.db is preserved at
              scores_db_path. A final snapshot was written before shutdown.
              The session row's ended_at is set.

  failed    — The GameRuntime encountered an unrecoverable error (e.g., quiz
              load failure, engine crash). The session never ran normally or
              crashed mid-game. scores.db may be incomplete or absent.

  orphaned  — The process (gunicorn/flask) was restarted while the session was
              in running, paused or starting state. The in-memory runtime is
              gone. scores.db still exists at scores_db_path (it was in the
              persistent directory). The last snapshot written before the crash
              is available in saas_session_snapshots. The session is NOT
              resumable; a new session must be started.

SCORES AVAILABILITY BY STATUS
==============================

  running / paused   → live scores from in-memory GameRuntime
  stopped            → scores.db is intact; GET /:id/scores always works
  failed             → scores.db may be partial or absent
  orphaned           → scores.db intact up to the moment of the crash
  created / starting → no scores yet

DATA DIRECTORY LIFECYCLE
=========================

  data/saas_sessions/<session_id>/scores.db
    Created: when the session transitions to 'starting'
    Deleted: only by the maintenance cleanup API
              (POST /api/sessions/maintenance/cleanup)
              default retention = 30 days after ended_at

  tmp/saas_sessions/<session_id>/
    Created: when the session starts
    Deleted: immediately when the session is stopped (or on error cleanup)
    Contents: questionnaire JSON, questionnaire symlink (ephemeral)
"""

from __future__ import annotations

import json
import os
import shutil
import logging

from flask import Blueprint, request, g

from backend.saas.auth.middleware import require_auth
from backend.saas.config import settings
from backend.saas.models.session import (
    create_prepared_session,
    update_session_launch_options,
    patch_launch_options,
    create_session,
    get_session_by_id,
    get_sessions_by_user,
    get_sessions_for_cleanup,
    get_session_by_overlay_token,
    reset_session_to_prepared,
    set_session_status,
    set_session_running,
    set_session_ended,
    session_owned_by,
    delete_session,
)
from backend.saas.models.project import project_owned_by
from backend.saas.models.quiz import quiz_owned_by_user, get_quiz_by_id, get_quizzes_by_project
from backend.saas.services.session_manager import session_manager
from backend.saas.services.session_logger import get_logs
from backend.saas.services.session_store import get_snapshot
from backend.saas.services.scores_reader import read_scores, db_exists
from backend.saas.services.plan_guard import check_can_start_session
from backend.saas.utils.responses import success, error, serialize_row, serialize_rows

logger = logging.getLogger(__name__)

bp = Blueprint("sessions", __name__, url_prefix="/api/sessions")


def _build_overlay_url(token: str) -> str:
    return f"{settings.SAAS_BASE_URL}/overlay/{token}"


def _get_base_url() -> str:
    """
    Resolve the deployment base URL dynamically from the current request host
    so the short overlay URL works on any domain where the SaaS is installed.
    Falls back to settings.SAAS_BASE_URL when called outside a request context.
    """
    try:
        from flask import has_request_context
        if has_request_context():
            scheme = request.scheme
            host = request.host  # includes port if non-standard
            return f"{scheme}://{host}"
    except Exception:
        pass
    return settings.SAAS_BASE_URL


def _build_short_overlay_url(short_code: str | None) -> str | None:
    if not short_code:
        return None
    return f"{_get_base_url()}/o/{short_code}"


_ORPHANED_STATUSES = {"orphaned", "stopped", "failed"}
_LIVE_STATUSES = {"running", "paused", "starting"}


def _serialize_session(row: dict, runtime_status: dict | None = None) -> dict:
    s = serialize_row(row)

    status = str(row.get("status") or "")
    runtime_attached = runtime_status is not None
    # degraded_runtime_view: DB says it should be live but in-memory runtime is absent
    degraded_runtime_view = not runtime_attached and status in _LIVE_STATUSES

    _default_tiktok = {"connected": False, "connecting": False, "retry_count": 0, "last_error": None}
    sid_short = str(row.get("id", ""))[:8]

    if runtime_status:
        logger.debug("runtime HIT: session=%s status=%s", sid_short, status)
        s["runtime"] = {
            "is_active":           runtime_status.get("running", False),
            "runtime_attached":    True,
            "degraded_runtime_view": False,
            "state":               runtime_status.get("state"),
            "engine_state":        runtime_status.get("engine_state"),
            "paused":              runtime_status.get("paused", False),
            "uptime":              runtime_status.get("uptime"),
            "ws_connected":        runtime_status.get("ws_connected", 0),
            "ws_port":             runtime_status.get("ws_port"),
            "error":               runtime_status.get("error"),
            "tiktok":              runtime_status.get("tiktok", _default_tiktok),
        }
    else:
        logger.debug("runtime MISS: session=%s status=%s", sid_short, status)
        s["runtime"] = {
            "is_active":           False,
            "runtime_attached":    False,
            "degraded_runtime_view": degraded_runtime_view,
            "state":               None,
            "engine_state":        None,
            # Derive paused and ws_port from DB row when runtime is absent
            "paused":              status == "paused",
            "uptime":              None,
            "ws_connected":        0,
            "ws_port":             row.get("ws_port"),
            "error":               "Runtime not attached — process restarted" if degraded_runtime_view else None,
            "tiktok":              _default_tiktok,
        }

    s["has_scores"] = db_exists(row.get("scores_db_path") or "")
    s["short_overlay_url"] = _build_short_overlay_url(row.get("short_code"))

    # Enriched list fields (only present when JOINed in get_sessions_by_user)
    s["quiz_title"]   = row.get("quiz_title")
    s["project_name"] = row.get("project_name")
    s["summary"] = {
        "participant_count": row.get("snap_participant_count"),
        "top_player":        row.get("snap_top_player"),
        "top_score":         row.get("snap_top_score"),
    }

    return s


# Translate frontend play_mode values to the engine's PlayMode enum strings.
# Frontend uses: 'single', 'loop_single', 'sequential', 'loop_all'
# Engine enum:   'single', 'infinite_single', 'sequential', 'infinite_all'
_PLAY_MODE_MAP = {
    "single":      "single",
    "loop_single": "infinite_single",
    "sequential":  "sequential",
    "loop_all":    "infinite_all",
}
_MULTI_QUIZ_MODES = {"sequential", "loop_all"}


def _resolve_launch_options(data: dict, quiz_id: str, quiz_row: dict, project_id: str) -> tuple[dict, str, bool, list]:
    """
    Parse and validate launch-time parameters from the request body.
    Returns (launch_options, tiktok_username, simulation_mode, all_quiz_ids).
    """
    raw_play_mode = (data.get("play_mode") or "single").strip()
    play_mode = _PLAY_MODE_MAP.get(raw_play_mode, "single")
    tiktok_username = data.get("tiktok_username") or None
    simulation_mode = bool(data.get("simulation_mode", True))

    if raw_play_mode in _MULTI_QUIZ_MODES:
        project_quiz_rows = get_quizzes_by_project(project_id)
        selected_first = [str(quiz_row["id"])]
        others = [str(r["id"]) for r in project_quiz_rows if str(r["id"]) != quiz_id]
        all_quiz_ids = selected_first + others
    else:
        all_quiz_ids = [quiz_id]

    launch_options = {
        "tiktok_username": tiktok_username,
        "simulation_mode": simulation_mode,
        "play_mode": play_mode,
        "quiz_ids": all_quiz_ids,
        "question_time": data.get("question_time"),
        "countdown_time": data.get("countdown_time"),
        "total_questions": data.get("total_questions", 0),
        "x2_enabled": bool(data.get("x2_enabled", False)),
        "no_tts": bool(data.get("no_tts", True)),
        "overlay_template": (data.get("overlay_template") or "default").strip(),
        "music_track_slug": (data.get("music_track_slug") or "none").strip(),
    }
    return launch_options, tiktok_username, simulation_mode, all_quiz_ids


@bp.post("/prepare")
@require_auth
def prepare_session():
    """
    Create a session row in 'prepared' state.

    Assigns overlay_token and short_code immediately so the overlay URL can be
    distributed (e.g. shown on-screen or shared) before the game starts.
    No runtime is allocated. Call POST /start with session_id to go live.

    Required body fields: project_id, quiz_id
    Optional relaunch fields: overlay_token, short_code
      When provided, the existing overlay identity is reused so OBS/TikTok
      Studio URLs already configured by the user remain valid. The source
      session must be terminal (stopped / failed / orphaned) and owned by
      the same user.
    """
    data = request.get_json(silent=True) or {}
    project_id = (data.get("project_id") or "").strip()
    quiz_id = (data.get("quiz_id") or "").strip()
    overlay_template = (data.get("overlay_template") or "default").strip()

    if not project_id or not quiz_id:
        return error("project_id and quiz_id are required")

    if not project_owned_by(project_id, g.current_user_id):
        return error("Project not found", 404)

    if not quiz_owned_by_user(quiz_id, g.current_user_id):
        return error("Quiz not found", 404)

    reuse_token = (data.get("overlay_token") or "").strip() or None
    reuse_short_code = (data.get("short_code") or "").strip() or None

    if reuse_token:
        source = get_session_by_overlay_token(reuse_token)
        if not source or str(source.get("user_id")) != g.current_user_id:
            return error("overlay_token not found or not owned by you", 403)
        if source["status"] not in _ORPHANED_STATUSES:
            return error(
                f"Cannot reuse overlay_token: source session is '{source['status']}' "
                "(only stopped / failed / orphaned sessions may be relaunched with the same identity)",
                409,
            )
        source_id = str(source["id"])
        if session_manager.is_active(source_id):
            session_manager.stop(source_id)
        updated = reset_session_to_prepared(source_id)
        return success(_serialize_session(updated), 200)

    overlay_token = session_manager.generate_overlay_token()
    overlay_url = _build_overlay_url(overlay_token)

    session_row = create_prepared_session(
        user_id=g.current_user_id,
        project_id=project_id,
        quiz_id=quiz_id,
        overlay_token=overlay_token,
        overlay_url=overlay_url,
        overlay_template=overlay_template,
        short_code=None,
    )

    return success(_serialize_session(session_row), 201)


@bp.post("/start")
@require_auth
def start_session():
    """
    Start a session.

    Two modes:
      A) session_id provided → activate an existing 'prepared' session.
         Supply all launch params (same as mode B).
      B) no session_id → create a new DB row and start immediately (legacy flow).
    """
    data = request.get_json(silent=True) or {}
    session_id_from_body = (data.get("session_id") or "").strip()

    # ── Mode A: start a pre-prepared session ────────────────────────────────
    if session_id_from_body:
        if not session_owned_by(session_id_from_body, g.current_user_id):
            return error("Session not found", 404)

        session_row = get_session_by_id(session_id_from_body)
        if not session_row:
            return error("Session not found", 404)

        if session_row["status"] != "prepared":
            return error(
                f"Session is already in '{session_row['status']}' state. "
                "Only 'prepared' sessions can be started this way.",
                409,
            )

        project_id = str(session_row["project_id"])
        quiz_id = str(session_row["quiz_id"])

        quiz_row = get_quiz_by_id(quiz_id)
        if not quiz_row:
            return error("Quiz not found", 404)

        x2_requested = bool(data.get("x2_enabled", False))
        allowed, guard_msg = check_can_start_session(g.current_user_id, x2_requested)
        if not allowed:
            return error(guard_msg, 403)

        launch_options, tiktok_username, simulation_mode, _ = _resolve_launch_options(
            data, quiz_id, quiz_row, project_id
        )

        update_session_launch_options(
            session_id_from_body, tiktok_username, simulation_mode, launch_options
        )

        session_id = session_id_from_body
        overlay_token = str(session_row["overlay_token"])
        set_session_status(session_id, "starting")

        ok, err_msg = session_manager.create_and_start(
            session_id=session_id,
            quiz_id=quiz_id,
            launch_options=launch_options,
            user_id=g.current_user_id,
            project_id=project_id,
            overlay_token=overlay_token,
        )

        if ok:
            set_session_running(session_id)
            session_row = get_session_by_id(session_id)
            runtime_status = session_manager.get_runtime_status(session_id)
            return success(_serialize_session(session_row, runtime_status))
        else:
            set_session_ended(session_id, "failed")
            return error(f"Failed to start session: {err_msg}", 500)

    # ── Mode B: create-and-start (legacy) ───────────────────────────────────
    project_id = (data.get("project_id") or "").strip()
    quiz_id = (data.get("quiz_id") or "").strip()

    if not project_id or not quiz_id:
        return error("project_id and quiz_id are required")

    if not project_owned_by(project_id, g.current_user_id):
        return error("Project not found", 404)

    if not quiz_owned_by_user(quiz_id, g.current_user_id):
        return error("Quiz not found", 404)

    quiz_row = get_quiz_by_id(quiz_id)
    if not quiz_row:
        return error("Quiz not found", 404)

    x2_requested = bool(data.get("x2_enabled", False))
    allowed, guard_msg = check_can_start_session(g.current_user_id, x2_requested)
    if not allowed:
        return error(guard_msg, 403)

    launch_options, tiktok_username, simulation_mode, _ = _resolve_launch_options(
        data, quiz_id, quiz_row, project_id
    )

    reuse_token = (data.get("overlay_token") or "").strip() or None
    reuse_short_code = (data.get("short_code") or "").strip() or None

    if reuse_token:
        source = get_session_by_overlay_token(reuse_token)
        if not source or str(source.get("user_id")) != g.current_user_id:
            return error("overlay_token not found or not owned by you", 403)
        if source["status"] not in _ORPHANED_STATUSES:
            return error(
                f"Cannot reuse overlay_token: source session is '{source['status']}' "
                "(only stopped / failed / orphaned sessions may be relaunched with the same identity)",
                409,
            )
        source_id = str(source["id"])
        if session_manager.is_active(source_id):
            session_manager.stop(source_id)
        overlay_token = reuse_token
        short_code = reuse_short_code or str(source.get("short_code") or "") or None
    else:
        overlay_token = session_manager.generate_overlay_token()
        short_code = None

    overlay_url = _build_overlay_url(overlay_token)

    session_row = create_session(
        user_id=g.current_user_id,
        project_id=project_id,
        quiz_id=quiz_id,
        overlay_token=overlay_token,
        overlay_url=overlay_url,
        tiktok_username=tiktok_username,
        simulation_mode=simulation_mode,
        launch_options=launch_options,
        short_code=short_code,
    )

    session_id = str(session_row["id"])
    set_session_status(session_id, "starting")

    ok, err_msg = session_manager.create_and_start(
        session_id=session_id,
        quiz_id=quiz_id,
        launch_options=launch_options,
        user_id=g.current_user_id,
        project_id=project_id,
        overlay_token=overlay_token,
    )

    if ok:
        set_session_running(session_id)
        session_row = get_session_by_id(session_id)
        runtime_status = session_manager.get_runtime_status(session_id)
        return success(_serialize_session(session_row, runtime_status), 201)
    else:
        set_session_ended(session_id, "failed")
        return error(f"Failed to start session: {err_msg}", 500)


@bp.post("/<session_id>/stop")
@require_auth
def stop_session(session_id):
    if not session_owned_by(session_id, g.current_user_id):
        return error("Session not found", 404)

    session_row = get_session_by_id(session_id)
    if session_row and session_row["status"] in ("stopped", "failed"):
        return error("Session is already stopped")

    session_manager.stop(session_id)
    set_session_ended(session_id, "stopped")

    session_row = get_session_by_id(session_id)
    return success(_serialize_session(session_row))


@bp.post("/<session_id>/pause")
@require_auth
def pause_session(session_id):
    if not session_owned_by(session_id, g.current_user_id):
        return error("Session not found", 404)

    ok, err_msg = session_manager.pause(session_id)
    if not ok:
        return error(err_msg or "Cannot pause session in current state")

    set_session_status(session_id, "paused")
    session_row = get_session_by_id(session_id)
    runtime_status = session_manager.get_runtime_status(session_id)
    return success(_serialize_session(session_row, runtime_status))


@bp.post("/<session_id>/resume")
@require_auth
def resume_session(session_id):
    if not session_owned_by(session_id, g.current_user_id):
        return error("Session not found", 404)

    ok, err_msg = session_manager.resume(session_id)
    if not ok:
        return error(err_msg or "Cannot resume session in current state")

    set_session_status(session_id, "running")
    session_row = get_session_by_id(session_id)
    runtime_status = session_manager.get_runtime_status(session_id)
    return success(_serialize_session(session_row, runtime_status))


@bp.post("/<session_id>/replay")
@require_auth
def replay_session(session_id):
    if not session_owned_by(session_id, g.current_user_id):
        return error("Session not found", 404)

    runtime = session_manager._get_runtime(session_id)
    if not runtime:
        return error("Session not active", 404)

    ok = runtime.replay()
    if not ok:
        return error("Replay not possible in current state")

    set_session_status(session_id, "running")
    session_row = get_session_by_id(session_id)
    runtime_status = session_manager.get_runtime_status(session_id)
    return success(_serialize_session(session_row, runtime_status))


@bp.get("/")
@require_auth
def list_sessions():
    session_manager.cleanup_finished()
    rows = get_sessions_by_user(g.current_user_id)
    result = []
    for row in rows:
        sid = str(row["id"])
        runtime_status = session_manager.get_runtime_status(sid)
        result.append(_serialize_session(row, runtime_status))
    return success(result)


@bp.get("/<session_id>")
@require_auth
def get_session(session_id):
    if not session_owned_by(session_id, g.current_user_id):
        return error("Session not found", 404)

    session_row = get_session_by_id(session_id)
    if not session_row:
        return error("Session not found", 404)

    runtime_status = session_manager.get_runtime_status(session_id)
    return success(_serialize_session(session_row, runtime_status))


@bp.delete("/<session_id>")
@require_auth
def delete_session_route(session_id):
    """
    Permanently delete a session.

    Rules:
      - Only the owning user may delete their session.
      - Active sessions (running, paused, starting) cannot be deleted — stop them first.
      - Deletes the scores data directory (scores.db + parent dir) if it exists.
      - Deletes the DB row (cascades to session_snapshots and session_logs).
    """
    if not session_owned_by(session_id, g.current_user_id):
        return error("Session not found", 404)

    session_row = get_session_by_id(session_id)
    if not session_row:
        return error("Session not found", 404)

    active_statuses = ("running", "paused", "starting")
    if session_row["status"] in active_statuses or session_manager.is_active(session_id):
        return error("Cannot delete an active session — stop it first", 409)

    # Remove scores directory if present
    scores_db_path = session_row.get("scores_db_path") or ""
    if scores_db_path:
        data_dir = os.path.dirname(scores_db_path)
        if data_dir and os.path.isdir(data_dir):
            try:
                shutil.rmtree(data_dir)
                logger.info("delete_session: removed data dir %s for session %s", data_dir, session_id)
            except Exception as exc:
                logger.warning("delete_session: could not remove %s: %s", data_dir, exc)

    delete_session(session_id)
    return success({"deleted": True, "session_id": session_id})


@bp.get("/<session_id>/logs")
@require_auth
def get_session_logs(session_id):
    if not session_owned_by(session_id, g.current_user_id):
        return error("Session not found", 404)

    limit = min(int(request.args.get("limit", 200)), 500)
    logs = get_logs(session_id, limit=limit)
    return success({"session_id": session_id, "logs": logs, "count": len(logs)})


@bp.get("/<session_id>/snapshot")
@require_auth
def get_session_snapshot(session_id):
    if not session_owned_by(session_id, g.current_user_id):
        return error("Session not found", 404)

    session_row = get_session_by_id(session_id)
    if not session_row:
        return error("Session not found", 404)

    def _null_snapshot() -> dict:
        return {
            "source":     "none",
            "snapshot":   None,
            "session_id": session_id,
            "status":     session_row["status"],
        }

    try:
        runtime = session_manager._get_runtime(session_id)
        if runtime is not None:
            live_snap = session_manager.get_overlay_snapshot(session_id)
            return success({
                "source":                "live",
                "runtime_attached":      True,
                "degraded_runtime_view": False,
                "snapshot":              live_snap or {},
                "session_id":            session_id,
                "status":                session_row["status"],
            })

        logger.warning(
            "FALLBACK /snapshot: session=%s status=%s runtime absent",
            session_id[:8], session_row["status"],
        )
        stored = get_snapshot(session_id)
        if stored:
            return success({
                "source":                "stored",
                "runtime_attached":      False,
                "degraded_runtime_view": session_row["status"] in _LIVE_STATUSES,
                "session_id":            session_id,
                "status":                session_row["status"],
                **stored,
            })

        return success(_null_snapshot())
    except Exception:
        logger.exception("get_session_snapshot error for %s", session_id)
        return success(_null_snapshot())


@bp.get("/<session_id>/scores")
@require_auth
def get_session_scores(session_id):
    """
    Return the persisted leaderboard for any session (active or not).

    For active sessions, reads live scores from the in-memory runtime when
    available; falls back to scores.db otherwise.
    For stopped/orphaned/failed sessions, always reads from scores.db.
    """
    if not session_owned_by(session_id, g.current_user_id):
        return error("Session not found", 404)

    session_row = get_session_by_id(session_id)
    if not session_row:
        return error("Session not found", 404)

    limit = min(int(request.args.get("limit", 50)), 200)

    def _leaderboard_response(source: str, runtime_attached: bool, scores_data: dict | None = None) -> dict:
        base = {
            "source":                source,
            "session_id":            session_id,
            "status":                session_row["status"],
            "runtime_attached":      runtime_attached,
            "degraded_runtime_view": (
                not runtime_attached and str(session_row.get("status") or "") in _LIVE_STATUSES
            ),
        }
        if scores_data:
            return {**base, **scores_data}
        return {
            **base,
            "leaderboard":    [],
            "total_players":  0,
            "total_answers":  0,
            "correct_answers": 0,
            "accuracy_pct":   None,
        }

    try:
        runtime = session_manager._get_runtime(session_id)
        if runtime is not None:
            # Live runtime — read scores directly from in-memory state.
            runtime_snap = session_manager.get_overlay_snapshot(session_id) or {}
            leaderboard_raw = runtime_snap.get("leaderboard") or []
            leaderboard = [
                {
                    "rank": i + 1,
                    "username": p.get("username") or p.get("name") or f"player_{i + 1}",
                    "total_score": p.get("score", 0),
                    "correct_answers": None,
                    "total_answers": None,
                    "games_played": None,
                }
                for i, p in enumerate(leaderboard_raw[:limit])
            ]
            return success(_leaderboard_response("live", True, {
                "leaderboard": leaderboard,
                "total_players": len(leaderboard_raw),
                "total_answers": None,
                "correct_answers": None,
                "accuracy_pct": None,
            }))

        # Runtime absent — fall back to scores.db.
        logger.warning(
            "FALLBACK /scores: session=%s runtime absent, reading from scores.db",
            session_id[:8],
        )
        db_path = session_row.get("scores_db_path")
        if db_path:
            scores = read_scores(db_path, limit=limit)
            if scores is not None:
                return success(_leaderboard_response("db", False, scores))

        return success(_leaderboard_response("db", False))
    except Exception:
        logger.exception("get_session_scores error for %s", session_id)
        return success(_leaderboard_response("db", False))


_AUDIO_DEFAULT = {"tts_enabled": True, "music_enabled": True, "music_volume": 40}


@bp.get("/<session_id>/audio")
@require_auth
def get_session_audio(session_id):
    if not session_owned_by(session_id, g.current_user_id):
        return error("Session not found", 404)

    session_row = get_session_by_id(session_id)
    if not session_row:
        return error("Session not found", 404)

    try:
        runtime = session_manager._get_runtime(session_id)
        if runtime:
            return success({
                **runtime.get_audio_state(),
                "source":                "live",
                "runtime_attached":      True,
                "degraded_runtime_view": False,
            })

        # Runtime absent — derive from persisted launch_options.
        logger.warning(
            "FALLBACK /audio: session=%s status=%s runtime absent, using launch_options",
            session_id[:8], session_row["status"],
        )
        raw_opts = session_row.get("launch_options") or {}
        if isinstance(raw_opts, str):
            try:
                raw_opts = json.loads(raw_opts)
            except Exception:
                raw_opts = {}
        persisted_music_enabled = raw_opts.get("music_enabled")
        if persisted_music_enabled is not None:
            fb_music_enabled = bool(persisted_music_enabled)
        else:
            fb_music_enabled = (raw_opts.get("music_track_slug") or "none") != "none"

        raw_music_volume = raw_opts.get("music_volume")
        if raw_music_volume is None:
            fb_music_volume = _AUDIO_DEFAULT["music_volume"]
        else:
            try:
                fb_music_volume = int(raw_music_volume)
            except (ValueError, TypeError):
                fb_music_volume = _AUDIO_DEFAULT["music_volume"]

        persisted_tts = raw_opts.get("tts_enabled")
        if persisted_tts is not None:
            fb_tts_enabled = bool(persisted_tts)
        else:
            fb_tts_enabled = not bool(raw_opts.get("no_tts", True))

        return success({
            "tts_enabled":         fb_tts_enabled,
            "music_enabled":       fb_music_enabled,
            "music_volume":        fb_music_volume,
            "source":              "fallback",
            "runtime_attached":    False,
            "degraded_runtime_view": session_row["status"] in _LIVE_STATUSES,
        })
    except Exception:
        logger.exception("get_session_audio error for %s", session_id)
        return success({
            **_AUDIO_DEFAULT,
            "source":                "fallback",
            "runtime_attached":      False,
            "degraded_runtime_view": False,
        })


@bp.post("/<session_id>/audio/tts")
@require_auth
def set_session_tts(session_id):
    if not session_owned_by(session_id, g.current_user_id):
        return error("Session not found", 404)
    data = request.get_json(silent=True) or {}
    if "enabled" not in data:
        return error("enabled field required")
    runtime = session_manager._get_runtime(session_id)
    if not runtime:
        return error("Session not active", 404)
    ok = runtime.set_tts_enabled(bool(data["enabled"]))
    if not ok:
        return error("TTS not available (engine not running)", 422)
    state = runtime.get_audio_state()
    patch_launch_options(session_id, {
        "tts_enabled": state.get("tts_enabled", True),
        "no_tts": not state.get("tts_enabled", True),
    })
    return success(state)


@bp.post("/<session_id>/audio/music")
@require_auth
def set_session_music(session_id):
    if not session_owned_by(session_id, g.current_user_id):
        return error("Session not found", 404)
    data = request.get_json(silent=True) or {}
    if "enabled" not in data:
        return error("enabled field required")
    runtime = session_manager._get_runtime(session_id)
    if not runtime:
        return error("Session not active", 404)
    ok = runtime.set_music_enabled(bool(data["enabled"]))
    if not ok:
        return error("Music control unavailable", 422)
    state = runtime.get_audio_state()
    patch_launch_options(session_id, {
        "music_enabled": state.get("music_enabled", True),
        "music_volume": state.get("music_volume", 40),
    })
    return success(state)


@bp.post("/<session_id>/audio/volume")
@require_auth
def set_session_volume(session_id):
    if not session_owned_by(session_id, g.current_user_id):
        return error("Session not found", 404)
    data = request.get_json(silent=True) or {}
    if "volume" not in data:
        return error("volume field required (0-100)")
    try:
        vol = int(data["volume"])
    except (TypeError, ValueError):
        return error("volume must be an integer 0-100")
    if not (0 <= vol <= 100):
        return error("volume must be 0-100")
    runtime = session_manager._get_runtime(session_id)
    if not runtime:
        return error("Session not active", 404)
    ok = runtime.set_volume(vol)
    if not ok:
        return error("Volume control unavailable", 422)
    state = runtime.get_audio_state()
    patch_launch_options(session_id, {"music_volume": vol})
    return success(state)


@bp.post("/maintenance/cleanup")
@require_auth
def run_maintenance_cleanup():
    """
    Delete data directories (scores.db files) for sessions older than
    `retention_days` (default 30). Only applies to stopped/failed/orphaned
    sessions. Never touches active sessions.

    Request body (optional JSON):
      { "retention_days": 30, "dry_run": false }
    """
    data = request.get_json(silent=True) or {}
    retention_days = int(data.get("retention_days", 30))
    dry_run = bool(data.get("dry_run", False))

    if retention_days < 1:
        return error("retention_days must be >= 1")

    candidates = get_sessions_for_cleanup(older_than_days=retention_days)

    deleted = []
    skipped = []
    errors_list = []

    for row in candidates:
        sid = str(row["id"])
        db_path = row.get("scores_db_path") or ""
        data_dir = os.path.dirname(db_path) if db_path else None

        if not data_dir or not os.path.isdir(data_dir):
            skipped.append({"session_id": sid, "reason": "directory not found"})
            continue

        if dry_run:
            deleted.append({"session_id": sid, "path": data_dir, "dry_run": True})
            continue

        try:
            shutil.rmtree(data_dir)
            deleted.append({"session_id": sid, "path": data_dir})
            logger.info("Cleanup: removed %s for session %s", data_dir, sid)
        except Exception as e:
            errors_list.append({"session_id": sid, "error": str(e)})
            logger.warning("Cleanup: failed to remove %s: %s", data_dir, e)

    return success({
        "retention_days": retention_days,
        "dry_run": dry_run,
        "candidates_found": len(candidates),
        "deleted": deleted,
        "skipped": skipped,
        "errors": errors_list,
    })
