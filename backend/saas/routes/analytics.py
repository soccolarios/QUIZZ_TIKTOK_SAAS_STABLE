from flask import Blueprint, g
from backend.saas.auth.middleware import require_auth
from backend.saas.db.base import fetch_one
from backend.saas.utils.responses import success, serialize_row

bp = Blueprint("analytics", __name__, url_prefix="/api/analytics")


@bp.get("/stats")
@require_auth
def get_stats():
    uid = g.current_user_id

    row = fetch_one(
        """
        SELECT
          (SELECT COUNT(*) FROM saas_projects WHERE user_id = %s)       AS total_projects,
          (SELECT COUNT(*) FROM saas_quizzes q
             JOIN saas_projects p ON p.id = q.project_id
             WHERE p.user_id = %s)                                       AS total_quizzes,
          (SELECT COUNT(*) FROM saas_game_sessions WHERE user_id = %s)  AS total_sessions,
          (SELECT COUNT(*) FROM saas_game_sessions
             WHERE user_id = %s AND status IN ('running','paused','starting')) AS active_sessions,
          (SELECT MAX(created_at) FROM saas_game_sessions WHERE user_id = %s) AS last_session_at
        """,
        (uid, uid, uid, uid, uid),
    )

    if row is None:
        return success({
            "total_projects": 0,
            "total_quizzes": 0,
            "total_sessions": 0,
            "active_sessions": 0,
            "last_session_at": None,
        })

    return success(serialize_row(row))
