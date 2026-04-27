import sqlite3
import os
from datetime import datetime
from typing import List, Optional
from contextlib import contextmanager

_DEFAULT_DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'scores.db')

DB_PATH = _DEFAULT_DB_PATH


def _configure(conn: sqlite3.Connection):
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA synchronous=NORMAL')
    conn.execute('PRAGMA busy_timeout=5000')
    conn.execute('PRAGMA foreign_keys=ON')


class DatabaseManager:
    """
    Encapsulates all SQLite operations for a specific db_path.

    SaaS sessions create one instance per session with their own path.
    Legacy code uses the module-level functions which delegate to the
    module-level DB_PATH (unchanged behaviour).
    """

    def __init__(self, db_path: str):
        self.db_path = db_path

    @contextmanager
    def get_connection(self):
        db_dir = os.path.dirname(self.db_path)
        if db_dir:
            os.makedirs(db_dir, exist_ok=True)
        conn = sqlite3.connect(self.db_path, timeout=10, check_same_thread=False)
        _configure(conn)
        try:
            yield conn
        finally:
            conn.close()

    def init_database(self):
        with self.get_connection() as conn:
            conn.executescript('''
                CREATE TABLE IF NOT EXISTS players (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    total_score INTEGER DEFAULT 0,
                    games_played INTEGER DEFAULT 0,
                    correct_answers INTEGER DEFAULT 0,
                    total_answers INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS game_sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    ended_at TIMESTAMP,
                    total_questions INTEGER,
                    total_players INTEGER DEFAULT 0,
                    status TEXT DEFAULT 'active'
                );

                CREATE TABLE IF NOT EXISTS game_answers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id INTEGER,
                    question_id INTEGER,
                    username TEXT,
                    answer TEXT,
                    is_correct BOOLEAN,
                    points_earned INTEGER,
                    response_time_ms INTEGER,
                    answered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (session_id) REFERENCES game_sessions(id)
                );

                CREATE INDEX IF NOT EXISTS idx_players_score
                    ON players(total_score DESC);

                CREATE INDEX IF NOT EXISTS idx_answers_session
                    ON game_answers(session_id);
            ''')

    def get_or_create_player(self, username: str) -> dict:
        with self.get_connection() as conn:
            conn.execute(
                'INSERT OR IGNORE INTO players (username) VALUES (?)',
                (username,)
            )
            conn.commit()
            cursor = conn.execute('SELECT * FROM players WHERE username = ?', (username,))
            return dict(cursor.fetchone())

    def update_player_score(self, username: str, points: int, is_correct: bool):
        with self.get_connection() as conn:
            conn.execute(
                'INSERT OR IGNORE INTO players (username) VALUES (?)',
                (username,)
            )
            conn.execute('''
                UPDATE players
                SET total_score = total_score + ?,
                    correct_answers = correct_answers + ?,
                    total_answers = total_answers + 1,
                    updated_at = ?
                WHERE username = ?
            ''', (points, 1 if is_correct else 0, datetime.now(), username))
            conn.commit()

    def increment_games_played(self, username: str):
        with self.get_connection() as conn:
            conn.execute(
                'INSERT OR IGNORE INTO players (username) VALUES (?)',
                (username,)
            )
            conn.execute('''
                UPDATE players
                SET games_played = games_played + 1,
                    updated_at = ?
                WHERE username = ?
            ''', (datetime.now(), username))
            conn.commit()

    def get_top_players(self, limit: int = 10) -> List[dict]:
        with self.get_connection() as conn:
            cursor = conn.execute('''
                SELECT username, total_score, correct_answers, total_answers, games_played
                FROM players
                ORDER BY total_score DESC
                LIMIT ?
            ''', (limit,))
            return [dict(row) for row in cursor.fetchall()]

    def get_player_rank(self, username: str) -> Optional[int]:
        with self.get_connection() as conn:
            cursor = conn.execute('''
                SELECT COUNT(*) + 1 as rank
                FROM players
                WHERE total_score > (
                    SELECT total_score FROM players WHERE username = ?
                )
            ''', (username,))
            result = cursor.fetchone()
            return result['rank'] if result else None

    def create_game_session(self, total_questions: int) -> int:
        with self.get_connection() as conn:
            cursor = conn.execute('''
                INSERT INTO game_sessions (total_questions, started_at)
                VALUES (?, ?)
            ''', (total_questions, datetime.now()))
            conn.commit()
            return cursor.lastrowid

    def end_game_session(self, session_id: int, total_players: int):
        with self.get_connection() as conn:
            conn.execute('''
                UPDATE game_sessions
                SET ended_at = ?, total_players = ?, status = 'completed'
                WHERE id = ?
            ''', (datetime.now(), total_players, session_id))
            conn.commit()

    def save_answer(self, session_id: int, question_id: int, username: str,
                    answer: str, is_correct: bool, points: int, response_time_ms: int):
        with self.get_connection() as conn:
            conn.execute('''
                INSERT INTO game_answers
                (session_id, question_id, username, answer, is_correct, points_earned, response_time_ms)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (session_id, question_id, username, answer, is_correct, points, response_time_ms))
            conn.commit()

    def get_session_stats(self, session_id: int) -> dict:
        with self.get_connection() as conn:
            cursor = conn.execute('''
                SELECT
                    COUNT(DISTINCT username) as total_players,
                    COUNT(*) as total_answers,
                    SUM(CASE WHEN is_correct THEN 1 ELSE 0 END) as correct_answers
                FROM game_answers
                WHERE session_id = ?
            ''', (session_id,))
            return dict(cursor.fetchone())

    def reset_all_scores(self):
        with self.get_connection() as conn:
            conn.execute('UPDATE players SET total_score = 0, correct_answers = 0, total_answers = 0')
            conn.commit()

    def reset_database(self):
        if os.path.exists(self.db_path):
            os.remove(self.db_path)
        self.init_database()


_default_db = DatabaseManager(_DEFAULT_DB_PATH)


@contextmanager
def get_connection():
    with _default_db.get_connection() as conn:
        yield conn


def init_database():
    _default_db.init_database()


def get_or_create_player(username: str) -> dict:
    return _default_db.get_or_create_player(username)


def update_player_score(username: str, points: int, is_correct: bool):
    _default_db.update_player_score(username, points, is_correct)


def increment_games_played(username: str):
    _default_db.increment_games_played(username)


def get_top_players(limit: int = 10) -> List[dict]:
    return _default_db.get_top_players(limit)


def get_player_rank(username: str) -> Optional[int]:
    return _default_db.get_player_rank(username)


def create_game_session(total_questions: int) -> int:
    return _default_db.create_game_session(total_questions)


def end_game_session(session_id: int, total_players: int):
    _default_db.end_game_session(session_id, total_players)


def save_answer(session_id: int, question_id: int, username: str,
                answer: str, is_correct: bool, points: int, response_time_ms: int):
    _default_db.save_answer(session_id, question_id, username, answer, is_correct, points, response_time_ms)


def get_session_stats(session_id: int) -> dict:
    return _default_db.get_session_stats(session_id)


def reset_all_scores():
    _default_db.reset_all_scores()


def reset_database():
    _default_db.reset_database()
