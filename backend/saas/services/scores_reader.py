"""
scores_reader — read persisted scores from a session's SQLite database.

Used exclusively for finished, stopped, orphaned and failed sessions whose
GameRuntime is no longer in memory. The scores.db file lives at
data/saas_sessions/<session_id>/scores.db (never in tmp/).

This module is read-only: it never writes to the SQLite file.
"""

from __future__ import annotations

import os
import sqlite3
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def _open_readonly(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def read_scores(db_path: str, limit: int = 50) -> Optional[dict]:
    """
    Read the leaderboard and basic stats from a session's scores.db.

    Returns None if the file does not exist or is unreadable.
    Returns a dict:
      {
        "leaderboard": [ {rank, username, total_score, correct_answers,
                          total_answers, games_played} ... ],
        "total_players": int,
        "total_answers": int,
        "correct_answers": int,
        "accuracy_pct": float | None,
      }
    """
    if not db_path or not os.path.exists(db_path):
        return None

    try:
        conn = _open_readonly(db_path)
        try:
            cur = conn.execute(
                """
                SELECT username, total_score, correct_answers, total_answers, games_played
                FROM players
                WHERE total_score > 0 OR total_answers > 0
                ORDER BY total_score DESC
                LIMIT ?
                """,
                (limit,),
            )
            rows = [dict(r) for r in cur.fetchall()]

            stats_cur = conn.execute(
                """
                SELECT
                    COUNT(*) AS total_players,
                    SUM(total_answers) AS total_answers,
                    SUM(correct_answers) AS correct_answers
                FROM players
                WHERE total_score > 0 OR total_answers > 0
                """
            )
            stats = dict(stats_cur.fetchone())
        finally:
            conn.close()

        total_answers = stats.get("total_answers") or 0
        correct = stats.get("correct_answers") or 0
        accuracy = round(correct / total_answers * 100, 1) if total_answers > 0 else None

        leaderboard = [
            {
                "rank": i + 1,
                "username": r["username"],
                "total_score": r["total_score"],
                "correct_answers": r["correct_answers"],
                "total_answers": r["total_answers"],
                "games_played": r["games_played"],
            }
            for i, r in enumerate(rows)
        ]

        return {
            "leaderboard": leaderboard,
            "total_players": stats.get("total_players") or 0,
            "total_answers": total_answers,
            "correct_answers": correct,
            "accuracy_pct": accuracy,
        }

    except sqlite3.OperationalError as e:
        logger.warning("scores_reader: DB not ready at %s: %s", db_path, e)
        return None
    except Exception as e:
        logger.warning("scores_reader: unexpected error reading %s: %s", db_path, e)
        return None


def db_exists(db_path: str) -> bool:
    return bool(db_path) and os.path.isfile(db_path)
