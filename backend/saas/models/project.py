from backend.saas.db.base import fetch_one, fetch_all, execute_returning, execute


def create_project(user_id: str, name: str) -> dict:
    return fetch_one(
        """
        INSERT INTO saas_projects (user_id, name)
        VALUES (%s, %s)
        RETURNING id, user_id, name, created_at, updated_at
        """,
        (user_id, name),
    )


def get_projects_by_user(user_id: str) -> list:
    return fetch_all(
        "SELECT id, user_id, name, created_at, updated_at FROM saas_projects WHERE user_id = %s ORDER BY created_at DESC",
        (user_id,),
    )


def get_project_by_id(project_id: str) -> dict | None:
    return fetch_one(
        "SELECT id, user_id, name, created_at, updated_at FROM saas_projects WHERE id = %s",
        (project_id,),
    )


def update_project(project_id: str, name: str) -> dict | None:
    return fetch_one(
        """
        UPDATE saas_projects SET name = %s
        WHERE id = %s
        RETURNING id, user_id, name, created_at, updated_at
        """,
        (name, project_id),
    )


def delete_project(project_id: str) -> None:
    execute("DELETE FROM saas_projects WHERE id = %s", (project_id,))


def project_owned_by(project_id: str, user_id: str) -> bool:
    row = fetch_one(
        "SELECT 1 FROM saas_projects WHERE id = %s AND user_id = %s",
        (project_id, user_id),
    )
    return row is not None


def get_project_count_by_user(user_id: str) -> int:
    row = fetch_one(
        "SELECT COUNT(*) AS cnt FROM saas_projects WHERE user_id = %s",
        (user_id,),
    )
    return int(row["cnt"]) if row else 0
