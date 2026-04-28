import json
import random
import string

from backend.saas.db.base import fetch_one, fetch_all, execute


def _generate_short_code(length: int = 7) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(random.choices(alphabet, k=length))


def _unique_short_code() -> str:
    """Generate a short_code that doesn't already exist in the table."""
    for _ in range(10):
        code = _generate_short_code()
        existing = fetch_one(
            "SELECT 1 FROM saas_game_sessions WHERE short_code = %s", (code,)
        )
        if not existing:
            return code
    # Extremely unlikely; fall back to longer code
    return _generate_short_code(length=10)


def create_prepared_session(
    user_id: str,
    project_id: str,
    quiz_id: str,
    overlay_token: str,
    overlay_url: str,
    overlay_template: str = "default",
    short_code: str | None = None,
) -> dict:
    """
    Create a session row in 'prepared' state.
    overlay_token and short_code are assigned immediately so the overlay URL
    can be distributed before the runtime is started.
    overlay_template is stored in launch_options so the overlay page reads
    the correct theme before the game is started.
    If short_code is provided it is reused as-is (relaunch flow).
    """
    if not short_code:
        short_code = _unique_short_code()
    initial_launch_options = json.dumps({"overlay_template": overlay_template or "default"})
    return fetch_one(
        """
        INSERT INTO saas_game_sessions
          (user_id, project_id, quiz_id, status, overlay_token, overlay_url, short_code, launch_options)
        VALUES (%s, %s, %s, 'prepared', %s, %s, %s, %s)
        RETURNING id, user_id, project_id, quiz_id, status, overlay_token,
                  overlay_url, short_code, tiktok_username, simulation_mode, launch_options,
                  scores_db_path, created_at, updated_at, started_at, ended_at
        """,
        (user_id, project_id, quiz_id, overlay_token, overlay_url, short_code, initial_launch_options),
    )


def update_session_launch_options(
    session_id: str,
    tiktok_username: str | None,
    simulation_mode: bool,
    launch_options: dict,
) -> None:
    """Stamp launch parameters onto an existing prepared session before starting it."""
    execute(
        """
        UPDATE saas_game_sessions
        SET tiktok_username = %s,
            simulation_mode = %s,
            launch_options  = %s
        WHERE id = %s
        """,
        (tiktok_username, simulation_mode, json.dumps(launch_options), session_id),
    )


def patch_launch_options(session_id: str, updates: dict) -> None:
    """Merge updates into the existing launch_options JSON without replacing it."""
    row = fetch_one(
        "SELECT launch_options FROM saas_game_sessions WHERE id = %s",
        (session_id,),
    )
    existing = {}
    if row:
        raw = row.get("launch_options") or {}
        if isinstance(raw, str):
            try:
                existing = json.loads(raw)
            except (ValueError, TypeError):
                existing = {}
        else:
            existing = dict(raw)
    existing.update(updates)
    execute(
        "UPDATE saas_game_sessions SET launch_options = %s WHERE id = %s",
        (json.dumps(existing), session_id),
    )


def create_session(
    user_id: str,
    project_id: str,
    quiz_id: str,
    overlay_token: str,
    overlay_url: str,
    tiktok_username: str | None,
    simulation_mode: bool,
    launch_options: dict,
    short_code: str | None = None,
) -> dict:
    if not short_code:
        short_code = _unique_short_code()
    return fetch_one(
        """
        INSERT INTO saas_game_sessions
          (user_id, project_id, quiz_id, status, overlay_token, overlay_url,
           short_code, tiktok_username, simulation_mode, launch_options)
        VALUES (%s, %s, %s, 'created', %s, %s, %s, %s, %s, %s)
        RETURNING id, user_id, project_id, quiz_id, status, overlay_token,
                  overlay_url, short_code, tiktok_username, simulation_mode, launch_options,
                  scores_db_path, created_at, updated_at, started_at, ended_at
        """,
        (
            user_id, project_id, quiz_id, overlay_token, overlay_url,
            short_code, tiktok_username, simulation_mode, json.dumps(launch_options),
        ),
    )


def get_session_by_id(session_id: str) -> dict | None:
    return fetch_one(
        """
        SELECT id, user_id, project_id, quiz_id, status, overlay_token, overlay_url,
               short_code, tiktok_username, simulation_mode, launch_options,
               scores_db_path, created_at, updated_at, started_at, ended_at
        FROM saas_game_sessions WHERE id = %s
        """,
        (session_id,),
    )


def get_session_by_overlay_token(overlay_token: str) -> dict | None:
    return fetch_one(
        """
        SELECT id, user_id, project_id, quiz_id, status, overlay_token, overlay_url,
               short_code, tiktok_username, simulation_mode, launch_options,
               scores_db_path, created_at, updated_at, started_at, ended_at
        FROM saas_game_sessions WHERE overlay_token = %s
        """,
        (overlay_token,),
    )


def get_sessions_by_user(user_id: str) -> list:
    return fetch_all(
        """
        SELECT
            s.id, s.user_id, s.project_id, s.quiz_id, s.status,
            s.overlay_token, s.overlay_url, s.short_code, s.tiktok_username,
            s.simulation_mode, s.scores_db_path,
            s.created_at, s.updated_at, s.started_at, s.ended_at,
            q.title  AS quiz_title,
            p.name   AS project_name,
            snap.participant_count AS snap_participant_count,
            snap.top_player        AS snap_top_player,
            snap.top_score         AS snap_top_score
        FROM saas_game_sessions s
        LEFT JOIN saas_quizzes   q ON q.id = s.quiz_id
        LEFT JOIN saas_projects  p ON p.id = s.project_id
        LEFT JOIN LATERAL (
            SELECT
                (snapshot->>'participant_count')::int  AS participant_count,
                snapshot->'leaderboard_top20'->0->>'username' AS top_player,
                (snapshot->'leaderboard_top20'->0->>'score')::int AS top_score
            FROM saas_session_snapshots
            WHERE session_id = s.id
            ORDER BY updated_at DESC
            LIMIT 1
        ) snap ON true
        WHERE s.user_id = %s
        ORDER BY s.created_at DESC
        """,
        (user_id,),
    )


def reset_session_to_prepared(session_id: str) -> dict:
    """
    Transition an existing terminal session back to 'prepared' state.
    Clears runtime-only fields (ended_at, started_at, ws_port, scores_db_path)
    while preserving overlay_token, overlay_url, and short_code.
    """
    execute(
        "DELETE FROM saas_session_snapshots WHERE session_id = %s",
        (session_id,),
    )
    return fetch_one(
        """
        UPDATE saas_game_sessions
        SET status         = 'prepared',
            ended_at       = NULL,
            started_at     = NULL,
            ws_port        = NULL,
            scores_db_path = NULL,
            tiktok_username = NULL,
            simulation_mode = true,
            updated_at     = now()
        WHERE id = %s
        RETURNING id, user_id, project_id, quiz_id, status, overlay_token,
                  overlay_url, short_code, tiktok_username, simulation_mode, launch_options,
                  scores_db_path, created_at, updated_at, started_at, ended_at
        """,
        (session_id,),
    )


def set_session_status(session_id: str, status: str) -> None:
    execute(
        "UPDATE saas_game_sessions SET status = %s WHERE id = %s",
        (status, session_id),
    )


def set_session_running(session_id: str) -> None:
    execute(
        "UPDATE saas_game_sessions SET status = 'running', started_at = now() WHERE id = %s",
        (session_id,),
    )


def set_session_ended(session_id: str, status: str = "stopped") -> None:
    execute(
        "UPDATE saas_game_sessions SET status = %s, ended_at = now(), ws_port = NULL WHERE id = %s",
        (status, session_id),
    )


def get_session_by_short_code(short_code: str) -> dict | None:
    return fetch_one(
        """
        SELECT id, overlay_token, overlay_url, short_code, status
        FROM saas_game_sessions WHERE short_code = %s
        """,
        (short_code,),
    )


def delete_session(session_id: str) -> None:
    execute("DELETE FROM saas_game_sessions WHERE id = %s", (session_id,))


def session_owned_by(session_id: str, user_id: str) -> bool:
    row = fetch_one(
        "SELECT 1 FROM saas_game_sessions WHERE id = %s AND user_id = %s",
        (session_id, user_id),
    )
    return row is not None


def get_active_session_count(user_id: str) -> int:
    row = fetch_one(
        "SELECT COUNT(*) AS cnt FROM saas_game_sessions WHERE user_id = %s AND status IN ('running', 'paused', 'starting')",
        (user_id,),
    )
    return int(row["cnt"]) if row else 0


def get_sessions_for_cleanup(older_than_days: int = 30) -> list:
    """
    Return sessions that are candidates for data directory cleanup:
      - status in (stopped, failed, orphaned)
      - ended_at older than <older_than_days> days
      - scores_db_path is set (meaning a data dir was created)
    """
    return fetch_all(
        """
        SELECT id, scores_db_path, status, ended_at
        FROM saas_game_sessions
        WHERE status IN ('stopped', 'failed', 'orphaned')
          AND ended_at IS NOT NULL
          AND ended_at < now() - INTERVAL '%s days'
          AND scores_db_path IS NOT NULL
        ORDER BY ended_at ASC
        """,
        (older_than_days,),
    )
