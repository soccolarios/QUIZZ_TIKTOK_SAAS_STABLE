from backend.saas.db.base import fetch_one, fetch_all, execute_returning


def create_user(email: str, password_hash: str) -> dict:
    return fetch_one(
        """
        INSERT INTO saas_users (email, password_hash)
        VALUES (%s, %s)
        RETURNING id, email, is_active, is_admin, created_at, updated_at
        """,
        (email, password_hash),
    )


def get_user_by_email(email: str) -> dict | None:
    return fetch_one(
        "SELECT id, email, password_hash, is_active, is_admin, created_at, updated_at FROM saas_users WHERE email = %s",
        (email,),
    )


def get_user_by_id(user_id: str) -> dict | None:
    return fetch_one(
        "SELECT id, email, is_active, is_admin, created_at, updated_at FROM saas_users WHERE id = %s",
        (user_id,),
    )


def get_user_with_plan(user_id: str) -> dict | None:
    """Return user fields + live plan_code from saas_subscriptions (single source of truth)."""
    return fetch_one(
        """
        SELECT u.id, u.email, u.is_active, u.is_admin, u.created_at, u.updated_at,
               COALESCE(s.plan_code, 'free') AS plan_code,
               COALESCE(s.status, 'active')  AS subscription_status
        FROM saas_users u
        LEFT JOIN saas_subscriptions s ON s.user_id = u.id
        WHERE u.id = %s
        """,
        (user_id,),
    )


def email_exists(email: str) -> bool:
    row = fetch_one("SELECT 1 FROM saas_users WHERE email = %s", (email,))
    return row is not None


def update_password(user_id: str, password_hash: str) -> None:
    from backend.saas.db.base import execute
    execute(
        "UPDATE saas_users SET password_hash = %s, updated_at = now() WHERE id = %s",
        (password_hash, user_id),
    )
