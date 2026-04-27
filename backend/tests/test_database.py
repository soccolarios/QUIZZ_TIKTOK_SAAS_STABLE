import sys
import os
import tempfile
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    db_path = str(tmp_path / "test_scores.db")
    import database as db
    monkeypatch.setattr(db, "DB_PATH", db_path)
    db.init_database()
    yield db


class TestInitDatabase:
    def test_creates_players_table(self, isolated_db):
        with isolated_db.get_connection() as conn:
            cursor = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='players'"
            )
            assert cursor.fetchone() is not None

    def test_creates_game_sessions_table(self, isolated_db):
        with isolated_db.get_connection() as conn:
            cursor = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='game_sessions'"
            )
            assert cursor.fetchone() is not None

    def test_creates_game_answers_table(self, isolated_db):
        with isolated_db.get_connection() as conn:
            cursor = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='game_answers'"
            )
            assert cursor.fetchone() is not None

    def test_idempotent(self, isolated_db):
        isolated_db.init_database()
        isolated_db.init_database()
        with isolated_db.get_connection() as conn:
            cursor = conn.execute("SELECT COUNT(*) FROM players")
            assert cursor.fetchone()[0] == 0


class TestGetOrCreatePlayer:
    def test_creates_new_player(self, isolated_db):
        player = isolated_db.get_or_create_player("user1")
        assert player["username"] == "user1"
        assert player["total_score"] == 0

    def test_idempotent(self, isolated_db):
        isolated_db.get_or_create_player("user1")
        player = isolated_db.get_or_create_player("user1")
        assert player["username"] == "user1"

        with isolated_db.get_connection() as conn:
            cursor = conn.execute("SELECT COUNT(*) FROM players WHERE username='user1'")
            assert cursor.fetchone()[0] == 1

    def test_returns_dict(self, isolated_db):
        player = isolated_db.get_or_create_player("user2")
        assert isinstance(player, dict)
        assert "username" in player
        assert "total_score" in player
        assert "games_played" in player


class TestUpdatePlayerScore:
    def test_adds_points_on_correct(self, isolated_db):
        isolated_db.get_or_create_player("user1")
        isolated_db.update_player_score("user1", 100, True)
        player = isolated_db.get_or_create_player("user1")
        assert player["total_score"] == 100
        assert player["correct_answers"] == 1
        assert player["total_answers"] == 1

    def test_no_points_on_incorrect(self, isolated_db):
        isolated_db.get_or_create_player("user1")
        isolated_db.update_player_score("user1", 0, False)
        player = isolated_db.get_or_create_player("user1")
        assert player["total_score"] == 0
        assert player["correct_answers"] == 0
        assert player["total_answers"] == 1

    def test_accumulates_across_calls(self, isolated_db):
        isolated_db.get_or_create_player("user1")
        isolated_db.update_player_score("user1", 100, True)
        isolated_db.update_player_score("user1", 50, True)
        player = isolated_db.get_or_create_player("user1")
        assert player["total_score"] == 150
        assert player["correct_answers"] == 2
        assert player["total_answers"] == 2

    def test_creates_player_if_not_exists(self, isolated_db):
        isolated_db.update_player_score("newuser", 200, True)
        player = isolated_db.get_or_create_player("newuser")
        assert player["total_score"] == 200


class TestIncrementGamesPlayed:
    def test_increments_games_played(self, isolated_db):
        isolated_db.get_or_create_player("user1")
        isolated_db.increment_games_played("user1")
        player = isolated_db.get_or_create_player("user1")
        assert player["games_played"] == 1

    def test_multiple_increments(self, isolated_db):
        isolated_db.get_or_create_player("user1")
        isolated_db.increment_games_played("user1")
        isolated_db.increment_games_played("user1")
        isolated_db.increment_games_played("user1")
        player = isolated_db.get_or_create_player("user1")
        assert player["games_played"] == 3


class TestGetTopPlayers:
    def test_returns_empty_list(self, isolated_db):
        result = isolated_db.get_top_players()
        assert result == []

    def test_returns_top_players_sorted(self, isolated_db):
        isolated_db.update_player_score("alice", 300, True)
        isolated_db.update_player_score("bob", 100, True)
        isolated_db.update_player_score("charlie", 200, True)

        result = isolated_db.get_top_players()
        assert result[0]["username"] == "alice"
        assert result[1]["username"] == "charlie"
        assert result[2]["username"] == "bob"

    def test_respects_limit(self, isolated_db):
        for i in range(15):
            isolated_db.update_player_score(f"user{i:02d}", i * 10, True)

        result = isolated_db.get_top_players(limit=5)
        assert len(result) == 5

    def test_default_limit_ten(self, isolated_db):
        for i in range(12):
            isolated_db.update_player_score(f"user{i:02d}", i * 10, True)

        result = isolated_db.get_top_players()
        assert len(result) == 10


class TestGetPlayerRank:
    def test_rank_of_single_player_is_one(self, isolated_db):
        isolated_db.update_player_score("alice", 100, True)
        rank = isolated_db.get_player_rank("alice")
        assert rank == 1

    def test_rank_ordering(self, isolated_db):
        isolated_db.update_player_score("alice", 300, True)
        isolated_db.update_player_score("bob", 100, True)
        isolated_db.update_player_score("charlie", 200, True)

        assert isolated_db.get_player_rank("alice") == 1
        assert isolated_db.get_player_rank("charlie") == 2
        assert isolated_db.get_player_rank("bob") == 3


class TestGameSessions:
    def test_create_game_session_returns_id(self, isolated_db):
        session_id = isolated_db.create_game_session(10)
        assert isinstance(session_id, int)
        assert session_id > 0

    def test_multiple_sessions_unique_ids(self, isolated_db):
        id1 = isolated_db.create_game_session(5)
        id2 = isolated_db.create_game_session(10)
        assert id1 != id2

    def test_end_game_session(self, isolated_db):
        session_id = isolated_db.create_game_session(10)
        isolated_db.end_game_session(session_id, 5)

        with isolated_db.get_connection() as conn:
            cursor = conn.execute(
                "SELECT status, total_players FROM game_sessions WHERE id=?",
                (session_id,)
            )
            row = cursor.fetchone()
            assert row["status"] == "completed"
            assert row["total_players"] == 5


class TestSaveAnswer:
    def test_saves_answer(self, isolated_db):
        session_id = isolated_db.create_game_session(5)
        isolated_db.save_answer(session_id, 1, "user1", "A", True, 100, 2500)

        with isolated_db.get_connection() as conn:
            cursor = conn.execute(
                "SELECT * FROM game_answers WHERE session_id=?",
                (session_id,)
            )
            row = cursor.fetchone()
            assert row["username"] == "user1"
            assert row["answer"] == "A"
            assert row["is_correct"] == 1
            assert row["points_earned"] == 100

    def test_saves_multiple_answers(self, isolated_db):
        session_id = isolated_db.create_game_session(5)
        isolated_db.save_answer(session_id, 1, "user1", "A", True, 100, 2500)
        isolated_db.save_answer(session_id, 1, "user2", "B", False, 0, 3000)

        with isolated_db.get_connection() as conn:
            cursor = conn.execute(
                "SELECT COUNT(*) FROM game_answers WHERE session_id=?",
                (session_id,)
            )
            assert cursor.fetchone()[0] == 2


class TestGetSessionStats:
    def test_stats_for_empty_session(self, isolated_db):
        session_id = isolated_db.create_game_session(5)
        stats = isolated_db.get_session_stats(session_id)
        assert stats["total_players"] == 0
        assert stats["total_answers"] == 0
        assert (stats["correct_answers"] or 0) == 0

    def test_stats_with_answers(self, isolated_db):
        session_id = isolated_db.create_game_session(5)
        isolated_db.save_answer(session_id, 1, "user1", "A", True, 100, 2500)
        isolated_db.save_answer(session_id, 1, "user2", "B", False, 0, 3000)
        isolated_db.save_answer(session_id, 2, "user1", "C", True, 80, 1500)

        stats = isolated_db.get_session_stats(session_id)
        assert stats["total_players"] == 2
        assert stats["total_answers"] == 3
        assert stats["correct_answers"] == 2


class TestResetAllScores:
    def test_resets_scores_to_zero(self, isolated_db):
        isolated_db.update_player_score("user1", 500, True)
        isolated_db.update_player_score("user2", 300, True)

        isolated_db.reset_all_scores()

        for username in ["user1", "user2"]:
            player = isolated_db.get_or_create_player(username)
            assert player["total_score"] == 0
            assert player["correct_answers"] == 0
            assert player["total_answers"] == 0

    def test_players_still_exist_after_reset(self, isolated_db):
        isolated_db.update_player_score("user1", 500, True)
        isolated_db.reset_all_scores()

        with isolated_db.get_connection() as conn:
            cursor = conn.execute("SELECT COUNT(*) FROM players")
            assert cursor.fetchone()[0] >= 1
