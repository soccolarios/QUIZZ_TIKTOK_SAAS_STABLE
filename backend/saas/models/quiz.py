import json
from backend.saas.db.base import fetch_one, fetch_all, execute


def create_quiz(project_id: str, title: str, description: str | None, data_json: dict) -> dict:
    return fetch_one(
        """
        INSERT INTO saas_quizzes (project_id, title, description, data_json)
        VALUES (%s, %s, %s, %s)
        RETURNING id, project_id, title, description, data_json, created_at, updated_at
        """,
        (project_id, title, description, json.dumps(data_json)),
    )


def get_quizzes_by_project(project_id: str) -> list:
    return fetch_all(
        "SELECT id, project_id, title, description, data_json, created_at, updated_at FROM saas_quizzes WHERE project_id = %s ORDER BY created_at DESC",
        (project_id,),
    )


def get_quizzes_by_user(user_id: str) -> list:
    return fetch_all(
        """
        SELECT q.id, q.project_id, q.title, q.description, q.data_json, q.created_at, q.updated_at
        FROM saas_quizzes q
        JOIN saas_projects p ON p.id = q.project_id
        WHERE p.user_id = %s
        ORDER BY q.created_at DESC
        """,
        (user_id,),
    )


def get_quiz_by_id(quiz_id: str) -> dict | None:
    return fetch_one(
        "SELECT id, project_id, title, description, data_json, created_at, updated_at FROM saas_quizzes WHERE id = %s",
        (quiz_id,),
    )


def update_quiz(quiz_id: str, title: str | None, description: str | None, data_json: dict | None) -> dict | None:
    fields = []
    values = []
    if title is not None:
        fields.append("title = %s")
        values.append(title)
    if description is not None:
        fields.append("description = %s")
        values.append(description)
    if data_json is not None:
        fields.append("data_json = %s")
        values.append(json.dumps(data_json))
    if not fields:
        return get_quiz_by_id(quiz_id)
    values.append(quiz_id)
    return fetch_one(
        f"UPDATE saas_quizzes SET {', '.join(fields)} WHERE id = %s RETURNING id, project_id, title, description, data_json, created_at, updated_at",
        values,
    )


def delete_quiz(quiz_id: str) -> None:
    execute("DELETE FROM saas_quizzes WHERE id = %s", (quiz_id,))


def quiz_owned_by_user(quiz_id: str, user_id: str) -> bool:
    row = fetch_one(
        """
        SELECT 1 FROM saas_quizzes q
        JOIN saas_projects p ON p.id = q.project_id
        WHERE q.id = %s AND p.user_id = %s
        """,
        (quiz_id, user_id),
    )
    return row is not None


def get_quiz_count_by_project(project_id: str) -> int:
    row = fetch_one(
        "SELECT COUNT(*) AS cnt FROM saas_quizzes WHERE project_id = %s",
        (project_id,),
    )
    return int(row["cnt"]) if row else 0
