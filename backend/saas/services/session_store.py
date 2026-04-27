"""
session_store — PostgreSQL persistence for SaaS session runtime state.

Responsibilities:
  - Write a compact snapshot of the running session to saas_session_snapshots
    on every relevant state change (question start, result, stop, pause, resume).
  - Record scores_db_path on session start so it can be found after restart.
  - Mark orphaned sessions on process startup.
  - Read the last snapshot for a session (used by overlay after restart).

Design constraints:
  - All writes are fire-and-forget (called from background threads).
    Failures are logged but never raised to the caller.
  - Never imports anything from the runtime layer to avoid circular imports.
  - Thread-safe: each call opens and closes its own connection.
"""

from __future__ import annotations

import json
import logging
from typing import Optional

from backend.saas.db.base import execute, fetch_one, fetch_all

logger = logging.getLogger(__name__)


def save_ws_port(session_id: str, ws_port: int) -> None:
    try:
        execute(
            "UPDATE saas_game_sessions SET ws_port = %s WHERE id = %s",
            (ws_port, session_id),
        )
        logger.info("[SessionStore] Persisted ws_port=%d for session %s", ws_port, session_id[:8])
    except Exception as e:
        logger.warning("save_ws_port failed for %s: %s", session_id, e)


def get_ws_port(session_id: str) -> Optional[int]:
    try:
        row = fetch_one(
            "SELECT ws_port FROM saas_game_sessions WHERE id = %s",
            (session_id,),
        )
        if row and row["ws_port"] is not None:
            return int(row["ws_port"])
    except Exception as e:
        logger.warning("get_ws_port failed for %s: %s", session_id, e)
    return None


def save_scores_db_path(session_id: str, db_path: str) -> None:
    try:
        execute(
            "UPDATE saas_game_sessions SET scores_db_path = %s WHERE id = %s",
            (db_path, session_id),
        )
    except Exception as e:
        logger.warning("save_scores_db_path failed for %s: %s", session_id, e)


def upsert_snapshot(session_id: str, snapshot: dict) -> None:
    # ON CONFLICT DO UPDATE is atomic in PostgreSQL — no application-level lock needed.
    try:
        execute(
            """
            INSERT INTO saas_session_snapshots (session_id, snapshot)
            VALUES (%s, %s)
            ON CONFLICT (session_id) DO UPDATE
              SET snapshot = EXCLUDED.snapshot,
                  updated_at = now()
            """,
            (session_id, json.dumps(snapshot)),
        )
    except Exception as e:
        logger.warning("upsert_snapshot failed for %s: %s", session_id, e)


def get_snapshot(session_id: str) -> Optional[dict]:
    try:
        row = fetch_one(
            "SELECT snapshot, updated_at FROM saas_session_snapshots WHERE session_id = %s",
            (session_id,),
        )
        if row:
            data = row["snapshot"]
            if isinstance(data, str):
                data = json.loads(data)
            return {
                "snapshot": data,
                "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
            }
    except Exception as e:
        logger.warning("get_snapshot failed for %s: %s", session_id, e)
    return None


def mark_orphaned_sessions() -> list[str]:
    """
    Called once at process startup. Any session still in running/paused/starting
    state was interrupted by a restart. Mark them as 'orphaned'.

    Returns list of session_ids that were marked.
    """
    try:
        rows = fetch_all(
            """
            SELECT id FROM saas_game_sessions
            WHERE status IN ('running', 'paused', 'starting')
            """,
            (),
        )
        if not rows:
            return []

        ids = [str(row["id"]) for row in rows]
        for sid in ids:
            execute(
                "UPDATE saas_game_sessions SET status = 'orphaned', ended_at = now() WHERE id = %s",
                (sid,),
            )
        logger.info(
            "Marked %d session(s) as orphaned at startup: %s",
            len(ids),
            ids,
        )
        return ids
    except Exception as e:
        logger.warning("mark_orphaned_sessions failed: %s", e)
        return []


def build_snapshot_from_overlay(overlay: dict, session_id: str) -> dict:
    """
    Converts an overlay snapshot dict (from GameRuntime.get_overlay_snapshot)
    into the compact structure stored in saas_session_snapshots.
    """
    leaderboard_raw = overlay.get("leaderboard") or []
    leaderboard = [
        {
            "rank": i + 1,
            "username": p.get("username") or p.get("name") or f"player_{i+1}",
            "score": p.get("score", 0),
        }
        for i, p in enumerate(leaderboard_raw[:20])
    ]

    return {
        "session_id": session_id,
        "phase": overlay.get("phase", "unknown"),
        "runtime_state": overlay.get("runtime_state", "unknown"),
        "engine_state": overlay.get("engine_state"),
        "paused": bool(overlay.get("paused", False)),
        "question_index": overlay.get("question_index"),
        "question_total": overlay.get("question_total"),
        "question_text": overlay.get("question", {}).get("text") if overlay.get("question") else None,
        "participant_count": len(leaderboard_raw),
        "leaderboard_top20": leaderboard,
    }
