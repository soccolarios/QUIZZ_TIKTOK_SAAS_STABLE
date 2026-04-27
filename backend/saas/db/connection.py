import threading
import psycopg2
import psycopg2.extras
import psycopg2.pool
from contextlib import contextmanager
from backend.saas.config.settings import DATABASE_URL

# ThreadedConnectionPool is safe across gthread worker threads.
# minconn=2 keeps connections warm; maxconn=20 comfortably covers gunicorn's
# 8 threads plus concurrent background snapshot threads.
_pool: psycopg2.pool.ThreadedConnectionPool | None = None
_pool_lock = threading.Lock()


def _get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                _pool = psycopg2.pool.ThreadedConnectionPool(
                    minconn=2,
                    maxconn=20,
                    dsn=DATABASE_URL,
                    cursor_factory=psycopg2.extras.RealDictCursor,
                )
    return _pool


@contextmanager
def get_db():
    pool = _get_pool()
    conn = pool.getconn()
    try:
        conn.autocommit = False
        yield conn
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        # Return the connection in a clean state regardless of what happened.
        try:
            conn.autocommit = False
        except Exception:
            pass
        pool.putconn(conn)
