from backend.saas.db.connection import get_db


def fetch_one(query, params=None):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(query, params or ())
            return cur.fetchone()


def fetch_all(query, params=None):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(query, params or ())
            return cur.fetchall()


def execute(query, params=None):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(query, params or ())
            conn.commit()


def execute_returning(query, params=None):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(query, params or ())
            row = cur.fetchone()
            conn.commit()
            return row
