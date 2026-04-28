import asyncio
import threading
import time
from datetime import datetime
from typing import Dict, List, Optional
from collections import defaultdict

from models import (
    GameState, GameConfig, Question, PlayerAnswer, PlayMode
)
from questionnaire_manager import QuestionnaireManager
from question_manager import QuestionManager
from answer_parser import AnswerParser
from timer_manager import TimerManager, CountdownTimer
from websocket_server import WebSocketServer
from tts_manager import TTSManager
from tiktok_client import TikTokClient, TikTokComment
from x2_manager import DoubleOrNothingManager
import database as db
from database import DatabaseManager
import config_loader as cfg


class PhaseGuard:
    """
    Ensures a specific phase (identified by phase_id) can only execute once.
    If a second caller tries to enter the same phase_id, it is rejected.
    """
    def __init__(self, phase_id: int, phase_name: str):
        self._phase_id = phase_id
        self._phase_name = phase_name
        self._completed = False
        self._lock = asyncio.Lock()

    async def enter(self) -> bool:
        async with self._lock:
            if self._completed:
                return False
            self._completed = True
            return True

    @property
    def phase_id(self) -> int:
        return self._phase_id

    @property
    def phase_name(self) -> str:
        return self._phase_name


class GameEngine:
    def __init__(self, config: GameConfig = None, tiktok_username: str = None, simulate: bool = False,
                 ws_server: WebSocketServer = None, db_path: str = None, user_id: str = None):
        self.config = config or GameConfig()
        self.tiktok_username = tiktok_username
        self.simulate = simulate
        self.user_id = user_id
        self.db = DatabaseManager(db_path) if db_path else db

        self.questionnaire_mgr = QuestionnaireManager()
        self.question_manager = QuestionManager(self.questionnaire_mgr)
        self.answer_parser = AnswerParser()
        self.timer = TimerManager()
        self.countdown_timer = CountdownTimer()
        self._owns_ws_server = ws_server is None
        if ws_server is not None:
            self.ws_server = ws_server
        else:
            self.ws_server = WebSocketServer()
        self.tts = TTSManager()
        self.tiktok = TikTokClient(username=tiktok_username, simulate=simulate)
        self.x2 = DoubleOrNothingManager(self.config)

        self.state = GameState.IDLE
        self.current_questions: List[Question] = []
        self.current_question_index = 0
        self.session_id: Optional[int] = None

        self.current_answers: Dict[str, PlayerAnswer] = {}
        self.answer_counts: Dict[str, int] = defaultdict(int)
        self.session_scores: Dict[str, int] = defaultdict(int)
        self.display_names: Dict[str, str] = {}
        self.profile_pictures: Dict[str, str] = {}
        self.question_start_time: Optional[datetime] = None
        self._phase_token: int = 0

        self._running = False
        self._paused = False
        self._pause_event = asyncio.Event()
        self._pause_event.set()
        self._questionnaire_queue: List[int] = []
        self._current_qn_index = 0
        self._current_qn_name = ""
        self._background_tasks: List[asyncio.Task] = []
        self._sim_service = None
        self._x2_open_start: Optional[datetime] = None
        self._x2_open_duration: float = 0.0
        self._current_phase_guard: Optional[PhaseGuard] = None

    async def initialize(self):
        print("[Game] Initializing...")

        self.db.init_database()
        db_label = self.db.db_path if hasattr(self.db, 'db_path') else 'default'
        print(f"[Game] Database ready ({db_label})")

        if self._owns_ws_server:
            if not self.ws_server.is_serving():
                print(f"[Game] Binding websocket server on {self.ws_server.host}:{self.ws_server.port}")
                await self.ws_server.start()
            else:
                print(f"[Game] Using existing WebSocket server on {self.ws_server.host}:{self.ws_server.port}")
        else:
            print(f"[Game] Using injected WebSocket server on {self.ws_server.host}:{self.ws_server.port} (serving={self.ws_server.is_serving()})")

        self.tts.set_ws_server(self.ws_server)
        self.ws_server._on_client_connect = self._get_snapshot_for_new_client

        self.tiktok.set_comment_handler(self._on_tiktok_comment)
        tiktok_task = asyncio.create_task(self._connect_tiktok_background())
        self._background_tasks.append(tiktok_task)

        self._tts_ready = asyncio.Event()
        loop = asyncio.get_event_loop()
        tts_future = loop.run_in_executor(None, self._init_tts_background)
        tts_task = asyncio.ensure_future(tts_future)
        self._background_tasks.append(tts_task)

        audio_status = self.tts.get_audio_status()
        for cat, info in audio_status.items():
            print(f"[Game] Audio {cat}: {info['found']}/{info['total']} fichiers disponibles")

        print("[Game] Initialization complete (TikTok/TTS connecting in background)")

    async def _connect_tiktok_background(self):
        try:
            await self.tiktok.connect()
        except Exception as e:
            print(f"[Game] TikTok background connect error: {e}")

    def _init_tts_background(self):
        try:
            self.tts.initialize()
        except Exception as e:
            print(f"[Game] TTS background init error: {e}")
        finally:
            self._tts_ready.set()

    async def _wait_for_overlay(self):
        timeout = 30
        t0 = time.monotonic()
        if self.ws_server.get_client_count() == 0:
            print("[Game] Waiting for overlay to connect via WebSocket...")
            while self.ws_server.get_client_count() == 0:
                if time.monotonic() - t0 >= timeout:
                    break
                await asyncio.sleep(0.05)
        elapsed = time.monotonic() - t0
        if self.ws_server.get_client_count() > 0:
            print(f"[Startup] Overlay connected in {elapsed:.2f}s ({self.ws_server.get_client_count()} client(s))")
        else:
            print(f"[Startup] No overlay connected after {timeout}s, proceeding anyway")

    def _build_questionnaire_queue(self):
        mode = self.config.get_play_mode()
        self._questionnaire_queue = []

        if mode == PlayMode.SINGLE or mode == PlayMode.INFINITE_SINGLE:
            qn_id = self.config.questionnaire_id
            if qn_id:
                self._questionnaire_queue = [qn_id]
            else:
                active = self.questionnaire_mgr.get_active_questionnaires()
                if active:
                    self._questionnaire_queue = [active[0].id]

        elif mode == PlayMode.SEQUENTIAL or mode == PlayMode.INFINITE_ALL:
            if self.config.questionnaire_ids:
                self._questionnaire_queue = list(self.config.questionnaire_ids)
            else:
                active = self.questionnaire_mgr.get_active_questionnaires()
                self._questionnaire_queue = [qn.id for qn in active]

        self._current_qn_index = 0
        print(f"[Game] Questionnaire queue: {self._questionnaire_queue} (mode: {mode.value})")

    async def start_game(self, num_questions: int = None):
        if num_questions:
            self.config.total_questions = num_questions

        self._startup_t0 = time.monotonic()

        self._build_questionnaire_queue()

        if not self._questionnaire_queue:
            print("[Game] Error: No questionnaires available!")
            return

        self.session_scores.clear()
        self.display_names.clear()
        self.profile_pictures.clear()
        self._running = True
        self.x2.reset()

        total_q = self._count_total_questions()
        self.session_id = self.db.create_game_session(total_q)

        self.tts.speak_game_start(total_q)

        await self._wait_for_overlay()

        await self.ws_server.send_game_start(total_q)
        await self.ws_server.broadcast("state_sync", self.get_overlay_snapshot())

        start_delay = cfg.get('game', 'post_start_delay', 3)
        if start_delay > 0:
            print(f"[Game] Starting screen shown, waiting {start_delay}s...")
            await asyncio.sleep(start_delay)

        await self._play_loop()

    def _count_total_questions(self) -> int:
        total = 0
        for qn_id in self._questionnaire_queue:
            qs = self.questionnaire_mgr.get_questions_for_questionnaire(qn_id, active_only=True)
            total += len(qs)
        return total

    async def _play_loop(self):
        mode = self.config.get_play_mode()

        while self._running:
            if self._current_qn_index >= len(self._questionnaire_queue):
                if mode == PlayMode.INFINITE_ALL:
                    self._current_qn_index = 0
                    print("[Game] Infinite loop: restarting all questionnaires")
                else:
                    break

            qn_id = self._questionnaire_queue[self._current_qn_index]
            qn = self.questionnaire_mgr.get_questionnaire(qn_id)

            if not qn:
                print(f"[Game] Questionnaire {qn_id} not found, skipping")
                self._current_qn_index += 1
                continue

            self._current_qn_name = qn.name
            print(f"[Game] Starting questionnaire: {qn.name} (ID: {qn.id})")

            await self._play_questionnaire(qn_id)

            if not self._running:
                break

            self._current_qn_index += 1

            if mode == PlayMode.INFINITE_SINGLE:
                self._current_qn_index = 0
                print(f"[Game] Infinite single: replaying {qn.name}")

            if self._running and self._current_qn_index < len(self._questionnaire_queue):
                next_qn_id = self._questionnaire_queue[self._current_qn_index % len(self._questionnaire_queue)]
                next_qn = self.questionnaire_mgr.get_questionnaire(next_qn_id)
                next_name = next_qn.name if next_qn else "Suivant"
                await self._show_questionnaire_transition(qn.name, next_name)
            elif mode in (PlayMode.INFINITE_ALL, PlayMode.INFINITE_SINGLE):
                next_qn_id = self._questionnaire_queue[0]
                next_qn = self.questionnaire_mgr.get_questionnaire(next_qn_id)
                next_name = next_qn.name if next_qn else "Suivant"
                await self._show_questionnaire_transition(qn.name, next_name)

        await self._end_game()

    async def _play_questionnaire(self, qn_id: int):
        self.questionnaire_mgr.load()
        self.question_manager.load_from_questionnaire(qn_id)
        total_available = self.question_manager.get_total_count()

        if self.config.total_questions > 0:
            questions_to_play = min(self.config.total_questions, total_available)
        else:
            questions_to_play = total_available

        self.current_questions = self.question_manager.get_questions_for_game(questions_to_play, shuffle=False)

        if not self.current_questions:
            print(f"[Game] Warning: questionnaire {qn_id} has no active questions — skipping")
            return

        self.tts.set_questionnaire(qn_id, user_id=self.user_id)
        self.current_question_index = 0
        self.state = GameState.SHOWING_QUESTION

        await self._game_loop()

    async def _game_loop(self):
        while self._running and self.current_question_index < len(self.current_questions):
            print(f"[X2 DEBUG] question_index={self.current_question_index}, x2_enabled={self.config.x2_enabled}")
            print("[X2 DEBUG] calling should_trigger")
            if self.x2.should_trigger(self.current_question_index):
                print("[X2 DEBUG] ENTER DOUBLE MODE")
                await self._double_open()
                await self._double_show()

            await self._show_question()

            await self._collect_answers()

            await self._show_result()

            await self._show_leaderboard()

            self.current_question_index += 1

            if self.current_question_index < len(self.current_questions):
                await self._countdown()

    def _reset_audio_tracking(self):
        self.ws_server._audio_play_count = 0
        self.ws_server._audio_ended_count = 0
        self.ws_server._audio_token_received = False
        self.ws_server._current_audio_sequence = None
        self.ws_server._audio_ended_event = threading.Event()

    def _next_phase(self) -> int:
        self._phase_token += 1
        self.tts.stop_and_flush()
        self._reset_audio_tracking()
        if self._sim_service:
            self._sim_service.notify_phase(GameState.IDLE, self._phase_token)
        return self._phase_token

    def _next_subphase(self) -> int:
        self._phase_token += 1
        self._reset_audio_tracking()
        return self._phase_token

    async def _enter_phase(self, phase_name: str) -> Optional[PhaseGuard]:
        """
        Creates a new PhaseGuard for the current phase token and atomically
        claims it. Returns the guard on success, or None if the phase was
        already entered (duplicate trigger).
        """
        guard = PhaseGuard(self._phase_token, phase_name)
        self._current_phase_guard = guard
        allowed = await guard.enter()
        if not allowed:
            print(f"[Phase] IGNORED duplicate transition into '{phase_name}' (phase_id={self._phase_token})")
            return None
        print(f"[Phase] START '{phase_name}' (phase_id={self._phase_token})")
        return guard

    def _log_phase_end(self, guard: PhaseGuard):
        print(f"[Phase] END   '{guard.phase_name}' (phase_id={guard.phase_id})")

    def _notify_sim_collecting(self):
        if self._sim_service:
            self._sim_service.notify_phase(GameState.COLLECTING_ANSWERS, self._phase_token)

    async def _double_open(self):
        token = self._next_phase()
        guard = await self._enter_phase("double_open")
        if guard is None:
            return
        await asyncio.sleep(0)
        self.state = GameState.DOUBLE_OPEN
        self.x2.open_collection()
        print("[X2] entering DOUBLE_OPEN")
        print("[X2] Double or Nothing: collecting registrations")
        if self._sim_service:
            self._sim_service.notify_phase(GameState.DOUBLE_OPEN, token)

        collection_extra = cfg.get('x2', 'collection_extra_time', 5.0)
        open_min = cfg.get('x2', 'open_duration_min', 15.0)
        audio_seq = self.tts.build_x2_open_sequence()

        audio_timeout = 30.0
        estimated_total = open_min + collection_extra
        self._x2_open_start = datetime.now()
        self._x2_open_duration = estimated_total
        await self.ws_server.send_double_open(estimated_total)

        audio_elapsed = 0.0
        if audio_seq:
            await self.ws_server.send_music_ducking(True)
            self._reset_audio_tracking()
            await asyncio.sleep(0)
            await self.ws_server.send_audio_play(audio_seq)
            audio_start = datetime.now()
            print(f"[X2] Waiting for x2_open audio to finish (timeout={audio_timeout:.1f}s)...")
            ended = await self.ws_server.wait_audio_ended(timeout=audio_timeout, num_files=len(audio_seq))
            audio_elapsed = (datetime.now() - audio_start).total_seconds()
            await self.ws_server.send_music_ducking(False)
            if ended:
                print(f"[X2] x2_open audio finished after {audio_elapsed:.1f}s (confirmed by frontend)")
            else:
                print(f"[X2] x2_open audio timeout after {audio_timeout:.1f}s, continuing")
        else:
            print("[X2] No x2_open audio available")

        remaining_min = max(0, open_min - audio_elapsed)
        post_audio_wait = max(collection_extra, remaining_min)
        print(f"[X2] Collection window: {post_audio_wait:.1f}s after audio (audio={audio_elapsed:.1f}s, min_open={open_min}s, extra={collection_extra}s)")
        await self._pause_aware_sleep(post_audio_wait)
        self._x2_open_start = None
        self.x2.close_collection()
        self._log_phase_end(guard)

    async def _double_show(self):
        self._next_subphase()
        guard = await self._enter_phase("double_show")
        if guard is None:
            return
        self.state = GameState.DOUBLE_SHOW
        print("[X2] entering DOUBLE_SHOW")
        participants = self.x2.get_registered_list()
        count = len(self.x2.state.registered)
        print(f"[X2] {count} participant(s) registered")
        await self.ws_server.send_double_show(participants, count)

        if count == 0:
            audio_seq = self.tts.build_x2_nobody_sequence()
        else:
            audio_seq = self.tts.build_x2_registered_sequence(count)

        show_min = 3.0
        audio_timeout = 30.0
        if audio_seq:
            await self.ws_server.send_music_ducking(True)
            self._reset_audio_tracking()
            await self.ws_server.send_audio_play(audio_seq)
            print(f"[X2] Waiting for x2_show audio to finish (timeout={audio_timeout:.1f}s, files={len(audio_seq)})...")
            ended = await self.ws_server.wait_audio_ended(timeout=audio_timeout, num_files=len(audio_seq))
            await self.ws_server.send_music_ducking(False)
            if ended:
                print("[X2] x2_show audio finished (confirmed by frontend)")
            else:
                print(f"[X2] x2_show audio timeout after {audio_timeout:.1f}s, continuing")

        await self._pause_aware_sleep(show_min)
        self._log_phase_end(guard)

    async def _show_question(self):
        token = self._next_phase()
        guard = await self._enter_phase("show_question")
        if guard is None:
            return

        if self.current_question_index == 0 and hasattr(self, '_startup_t0'):
            elapsed = time.monotonic() - self._startup_t0
            print(f"[Startup] First question in {elapsed:.2f}s")

        question = self.current_questions[self.current_question_index]
        self.tts.set_question_index(self.current_question_index)

        self.current_answers.clear()
        self.answer_counts = defaultdict(int)
        self.tts.reset_fastest_winner()

        delay = self.config.tiktok_delay
        effective_time = self.config.question_time + delay

        is_double = question.is_double()
        question_data = {
            "text": question.text,
            "choices": question.choices,
            "time_limit": effective_time,
            "type": question.question_type,
            "is_double": is_double,
            "questionnaire_name": self._current_qn_name
        }
        if is_double:
            question_data["correct_answers"] = question.correct_answers

        total_in_session = self._count_total_questions()
        global_index = self._get_global_question_index()

        print(f"[Game] Question {self.current_question_index + 1}/{len(self.current_questions)} (global {global_index}/{total_in_session})")
        print(f"[Game] Type: {question.question_type} | Reponse correcte: {question.correct_answer}")
        if is_double:
            print(f"[Game] Reponses correctes (double): {question.correct_answers}")
        if delay > 0:
            print(f"[Game] Temps effectif: {effective_time}s ({self.config.question_time}s + {delay}s delai TikTok)")

        await self.ws_server.send_question(
            self.current_question_index + 1,
            len(self.current_questions),
            question_data
        )

        self.tts.speak_question(
            self.current_question_index + 1,
            len(self.current_questions),
            question.text,
            time_limit=self.config.question_time
        )

        self.question_start_time = datetime.now()
        self.state = GameState.COLLECTING_ANSWERS
        print("[Game] Phase de reponse ACTIVE - les commentaires sont acceptes")
        self._log_phase_end(guard)

    def _get_global_question_index(self) -> int:
        count = 0
        for i in range(self._current_qn_index):
            qn_id = self._questionnaire_queue[i]
            qs = self.questionnaire_mgr.get_questions_for_questionnaire(qn_id, active_only=True)
            count += len(qs)
        count += self.current_question_index + 1
        return count

    async def _collect_answers(self):
        self._next_subphase()
        guard = await self._enter_phase("collect_answers")
        if guard is None:
            return
        token = self._phase_token
        effective_time = self.config.question_time + self.config.tiktok_delay
        self._notify_sim_collecting()

        async def on_tick(remaining: int):
            if self._phase_token != token:
                return
            await self.ws_server.send_timer(remaining)
            if remaining <= 5:
                self.tts.speak_countdown(remaining)

            total = sum(self.answer_counts.values())
            percentages = self._calculate_percentages()
            await self.ws_server.send_answer_update(
                dict(self.answer_counts),
                percentages,
                total
            )

        await self.timer.start(
            effective_time,
            on_tick=on_tick
        )

        if self.timer.current_timer:
            try:
                await self.timer.current_timer
            except asyncio.CancelledError:
                pass

        self.state = GameState.SHOWING_RESULT
        print(f"[Game] Temps ecoule - {len(self.current_answers)} reponses recues")
        self._log_phase_end(guard)

    async def _on_tiktok_comment(self, comment: TikTokComment):
        display_name = comment.display_name if hasattr(comment, 'display_name') else comment.username

        print(f"[COMMENT] raw_display={display_name!r} raw_message={comment.message!r} username={comment.username!r}")

        if self.state == GameState.DOUBLE_OPEN:
            import re
            matched = bool(re.search(r'\bx2\b', comment.message, re.IGNORECASE))
            print(f"[X2 COMMENT] user={comment.username!r} msg={comment.message!r} regex_match={matched}")
            if matched:
                registered = self.x2.try_register(comment.username, display_name)
                if registered:
                    print(f"[X2] Registered: {display_name!r}")
                    participants = self.x2.get_registered_list()
                    count = len(self.x2.state.registered)
                    await self.ws_server.send_x2_registered(participants, count)
                else:
                    print(f"[X2 COMMENT] Registration rejected for user={comment.username!r} (duplicate or closed)")
            else:
                print(f"[X2 COMMENT] No x2 keyword in message from user={comment.username!r}")
            return

        if self.state != GameState.COLLECTING_ANSWERS:
            print(f"[ANSWER] Ignore (hors phase reponse): {display_name!r}")
            return

        if comment.username in self.current_answers:
            print(f"[ANSWER] Ignore (deja repondu): {display_name!r}")
            return

        answer = self.answer_parser.parse(comment.message)
        if not answer:
            print(f"[PARSER] Reponse non reconnue: {display_name!r} -> {comment.message!r}")
            return

        print(f"[PARSER] Reponse reconnue: {display_name!r} -> {answer}")

        question = self.current_questions[self.current_question_index]
        is_correct = question.is_correct(answer)

        response_time = 0
        if self.question_start_time:
            response_time = int((comment.timestamp - self.question_start_time).total_seconds() * 1000)

        points = 0
        if is_correct:
            points = self._calculate_points(response_time)

        player_answer = PlayerAnswer(
            username=comment.username,
            display_name=display_name,
            answer=answer,
            timestamp=comment.timestamp,
            question_id=question.id,
            is_correct=is_correct,
            points_earned=points,
            response_time_ms=response_time
        )

        self.current_answers[comment.username] = player_answer
        self.answer_counts[answer] += 1

        status = "CORRECTE" if is_correct else "incorrecte"
        print(f"[ANSWER] Acceptee: {display_name} -> {answer} ({status}, {response_time}ms)")

        if is_correct:
            is_first_correct = not any(pa.is_correct for pa in self.current_answers.values() if pa.username != comment.username)
            if is_first_correct:
                self.tts.prepare_fastest_winner(display_name)

            self.session_scores[comment.username] += points
            if comment.username not in self.display_names:
                self.display_names[comment.username] = display_name
            if comment.profile_picture_url and not self.profile_pictures.get(comment.username):
                self.profile_pictures[comment.username] = comment.profile_picture_url

        self.db.get_or_create_player(comment.username)

    def _calculate_points(self, response_time_ms: int) -> int:
        base = self.config.base_points
        max_time = self.config.question_time * 1000
        bonus_max = self.config.speed_bonus_max

        delay_ms = self.config.tiktok_delay * 1000
        adjusted_time = max(0, response_time_ms - delay_ms)

        time_ratio = max(0, 1 - (adjusted_time / max_time))
        speed_bonus = int(time_ratio * bonus_max)

        return base + speed_bonus

    def _calculate_percentages(self) -> Dict[str, float]:
        total = sum(self.answer_counts.values())
        if total == 0:
            return {"A": 0, "B": 0, "C": 0, "D": 0}

        return {
            letter: round((self.answer_counts.get(letter, 0) / total) * 100, 1)
            for letter in ["A", "B", "C", "D"]
        }

    async def _show_result(self):
        self._next_phase()
        guard = await self._enter_phase("show_result")
        if guard is None:
            return
        question = self.current_questions[self.current_question_index]

        had_x2_participants = bool(self.x2.state.registered)
        if had_x2_participants:
            self.x2.process_results(self.current_answers)
            print(f"[X2] Processing results: {len(self.x2.state.successful)} success, {len(self.x2.state.failed)} failed, {len(self.x2.state.missed)} missed")
            for pa in self.current_answers.values():
                if not pa.is_correct:
                    continue
                multiplier = self.x2.get_score_multiplier(pa.username)
                if multiplier == 1.0:
                    continue
                old_points = pa.points_earned
                new_points = int(old_points * multiplier)
                delta = new_points - old_points
                pa.points_earned = new_points
                self.session_scores[pa.username] += delta
                print(f"[X2] Score correction: {pa.display_name!r} {old_points} -> {new_points} (x{multiplier}, delta={delta:+d})")

        winners = [
            {
                "username": pa.username,
                "display_name": pa.display_name,
                "points": pa.points_earned,
                "time_ms": pa.response_time_ms,
                "profile_picture_url": self.profile_pictures.get(pa.username, ""),
                "x2": self.x2.get_score_multiplier(pa.username) == 2.0 if had_x2_participants else False
            }
            for pa in self.current_answers.values()
            if pa.is_correct
        ]
        winners.sort(key=lambda x: (x["time_ms"], x["username"]))

        fastest_winner = None
        if winners:
            fastest_winner = {
                "display_name": winners[0]["display_name"],
                "profile_picture_url": winners[0]["profile_picture_url"]
            }

        winner_display_names = [w["display_name"] for w in winners]
        fastest_display_name = fastest_winner["display_name"] if fastest_winner else None

        percentages = self._calculate_percentages()
        total_answers = sum(self.answer_counts.values())

        print(f"[Game] Showing result for question {self.current_question_index + 1}")
        print(f"[Game] Winners: {winner_display_names}")
        print(f"[Game] Fastest: {fastest_display_name}")

        result_data = {
            "correct_answer": question.correct_answer,
            "answer_text": question.choices[question.correct_answer],
            "is_double": question.is_double(),
            "question_type": question.question_type
        }
        if question.is_double():
            result_data["correct_answers"] = question.correct_answers
            result_data["correct_texts"] = {
                a: question.choices.get(a, "") for a in question.correct_answers
            }

        await self.ws_server.send_result(
            question.correct_answer,
            question.choices[question.correct_answer],
            dict(self.answer_counts),
            percentages,
            winners,
            fastest_winner,
            total_answers,
            extra=result_data
        )

        audio_seq = self.tts.build_result_sequence(
            question.correct_answer,
            question.choices[question.correct_answer],
            winner_display_names,
            fastest_display_name,
        )

        for pa in self.current_answers.values():
            self.db.update_player_score(pa.username, pa.points_earned, pa.is_correct)
            if self.session_id:
                self.db.save_answer(
                    self.session_id,
                    pa.question_id,
                    pa.username,
                    pa.answer,
                    pa.is_correct,
                    pa.points_earned,
                    pa.response_time_ms
                )

        config_duration = cfg.get('game', 'result_display_duration', 5)
        result_min = max(config_duration, 2.0)
        result_start = datetime.now()
        if audio_seq:
            await self.ws_server.send_music_ducking(True)
            self._reset_audio_tracking()
            await self.ws_server.send_audio_play(audio_seq)
            file_min = len(audio_seq) * 0.8
            audio_timeout = max(result_min, file_min + 10.0, 15.0)
            print(f"[Game] Result displayed - waiting for real audio end (timeout={audio_timeout:.1f}s, files={len(audio_seq)})")
            ended = await self.ws_server.wait_audio_ended(timeout=audio_timeout, num_files=len(audio_seq))
            await self.ws_server.send_music_ducking(False)
            if not ended:
                print(f"[Game] audio_ended timeout ({audio_timeout:.1f}s), continuing")
        elapsed = (datetime.now() - result_start).total_seconds()
        remaining = result_min - elapsed
        if remaining > 0:
            await self._pause_aware_sleep(remaining)

        if had_x2_participants:
            await self._show_double_result()

        self.x2.reset_cycle()
        self._log_phase_end(guard)

    async def _show_double_result(self):
        self._next_subphase()
        self.tts.stop_and_flush()
        guard = await self._enter_phase("show_double_result")
        if guard is None:
            return
        self.state = GameState.DOUBLE_RESULT

        successful_list = [
            {"username": u, "display_name": self.display_names.get(u, u),
             "profile_picture_url": self.profile_pictures.get(u, "")}
            for u in self.x2.state.successful
        ]
        failed_list = [
            {"username": u, "display_name": self.display_names.get(u, u),
             "profile_picture_url": self.profile_pictures.get(u, "")}
            for u in self.x2.state.failed
        ]

        print(f"[X2] Showing double result: {len(successful_list)} success, {len(failed_list)} failed")
        await self.ws_server.send_double_result(successful_list, failed_list)

        audio_seq = self.tts.build_x2_result_sequence(self.x2.state.successful, self.x2.state.failed)
        display_min = 3.0
        if audio_seq:
            file_min = len(audio_seq) * 0.8
            audio_timeout = max(file_min + 10.0, 15.0)
            await self.ws_server.send_music_ducking(True)
            self._reset_audio_tracking()
            await self.ws_server.send_audio_play(audio_seq)
            print(f"[X2] Waiting for x2_result audio (timeout={audio_timeout:.1f}s, files={len(audio_seq)})")
            ended = await self.ws_server.wait_audio_ended(timeout=audio_timeout, num_files=len(audio_seq))
            await self.ws_server.send_music_ducking(False)
            if not ended:
                print(f"[X2] audio_ended timeout for double result ({audio_timeout:.1f}s)")
        await self._pause_aware_sleep(display_min)
        self._log_phase_end(guard)

    async def _show_leaderboard(self):
        self._next_phase()
        guard = await self._enter_phase("show_leaderboard")
        if guard is None:
            return
        self.state = GameState.SHOWING_LEADERBOARD

        leaderboard = [
            {
                "username": self.display_names.get(username, username),
                "score": score,
                "rank": i + 1,
                "profile_picture_url": self.profile_pictures.get(username, "")
            }
            for i, (username, score) in enumerate(
                sorted(self.session_scores.items(), key=lambda x: (-x[1], x[0]))[:10]
            )
        ]

        print("[Game] Showing leaderboard")
        await self.ws_server.send_leaderboard(leaderboard)

        lb_duration = cfg.get('game', 'leaderboard_display_duration', 5)
        print(f"[Game] Leaderboard displayed - waiting {lb_duration} seconds")
        await self._pause_aware_sleep(lb_duration)
        self._log_phase_end(guard)

    async def _countdown(self):
        token = self._next_phase()
        guard = await self._enter_phase("countdown")
        if guard is None:
            return
        self.state = GameState.COUNTDOWN

        print("[Game] Starting countdown to next question")

        self.tts.speak_next_question(self.config.countdown_time)

        async def on_tick(remaining: int):
            if self._phase_token != token:
                return
            await self.ws_server.send_countdown(remaining)
            if remaining <= 5:
                self.tts.speak_countdown(remaining)

        await self.countdown_timer.start(
            self.config.countdown_time,
            on_tick=on_tick
        )

        if self.countdown_timer.current_timer:
            try:
                await self.countdown_timer.current_timer
            except asyncio.CancelledError:
                pass

        print("[Game] Countdown finished - sending next_question signal")
        await self.ws_server.send_next_question()
        await self._pause_aware_sleep(cfg.get('game', 'post_countdown_delay', 0.2))
        self._log_phase_end(guard)

    async def _show_questionnaire_transition(self, finished_name: str, next_name: str):
        self._next_phase()
        guard = await self._enter_phase("questionnaire_transition")
        if guard is None:
            return
        self.state = GameState.QUESTIONNAIRE_TRANSITION

        print(f"[Game] Questionnaire transition: '{finished_name}' -> '{next_name}'")

        self.tts.speak_transition()
        await self.ws_server.send_questionnaire_transition(finished_name, next_name)

        transition_duration = cfg.get('game', 'questionnaire_transition_duration', 8)
        await self._pause_aware_sleep(transition_duration)
        self._log_phase_end(guard)

    async def _end_game(self):
        self._next_phase()
        guard = await self._enter_phase("end_game")
        if guard is None:
            return
        self.state = GameState.GAME_END
        self._running = False

        final_leaderboard = [
            {
                "username": self.display_names.get(username, username),
                "score": score,
                "rank": i + 1,
                "profile_picture_url": self.profile_pictures.get(username, "")
            }
            for i, (username, score) in enumerate(
                sorted(self.session_scores.items(), key=lambda x: (-x[1], x[0]))[:10]
            )
        ]

        stats = {
            "total_questions": self._count_total_questions(),
            "total_players": len(self.session_scores),
            "total_answers": sum(len(self.current_answers) for _ in self.current_questions)
        }

        if self.session_id:
            self.db.end_game_session(self.session_id, len(self.session_scores))

        for username in self.session_scores.keys():
            self.db.increment_games_played(username)

        winner = final_leaderboard[0]["username"] if final_leaderboard else None
        if winner:
            self.tts.prepare_game_winner(winner)

        await self.ws_server.send_game_end(final_leaderboard, stats)

        end_display_min = cfg.get('game', 'end_display_duration', 10)
        audio_seq = self.tts.build_game_end_sequence(winner)
        if audio_seq:
            await self.ws_server.send_music_ducking(True)
            self._reset_audio_tracking()
            await self.ws_server.send_audio_play(audio_seq)
            file_min = len(audio_seq) * 0.8
            audio_timeout = max(end_display_min, file_min + 10.0, 15.0)
            print(f"[Game] End screen displayed - waiting for final audio (timeout={audio_timeout:.1f}s, files={len(audio_seq)})")
            ended = await self.ws_server.wait_audio_ended(timeout=audio_timeout, num_files=len(audio_seq))
            await self.ws_server.send_music_ducking(False)
            if ended:
                print("[Game] Final winner audio completed")
            else:
                print(f"[Game] Final audio timeout after {audio_timeout:.1f}s")
        else:
            print(f"[Game] End screen displayed - no audio, waiting {end_display_min}s")

        await self._pause_aware_sleep(end_display_min)
        print("[Game] Game ended!")
        self._log_phase_end(guard)

    def pause(self):
        if self._paused:
            return
        self._paused = True
        self._pause_event.clear()
        self.timer.pause()
        self.countdown_timer.pause()
        self.state_before_pause = self.state
        self.state = GameState.PAUSED
        print("[Game] PAUSED")

    def resume(self):
        if not self._paused:
            return
        self._paused = False
        self._pause_event.set()
        self.timer.resume()
        self.countdown_timer.resume()
        if hasattr(self, 'state_before_pause'):
            self.state = self.state_before_pause
        print("[Game] RESUMED")
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.ensure_future(self._broadcast_state_sync())
        except Exception:
            pass

    async def _broadcast_state_sync(self):
        try:
            snapshot = self.get_overlay_snapshot()
            await self.ws_server.broadcast("state_sync", snapshot)
            print("[Game] state_sync broadcast on resume")
        except Exception as e:
            print(f"[Game] state_sync error: {e}")

    async def _pause_aware_sleep(self, seconds: float):
        remaining = seconds
        while remaining > 0 and self._running:
            await self._pause_event.wait()
            if not self._running:
                break
            chunk = min(0.1, remaining)
            await asyncio.sleep(chunk)
            if self._running and not self._paused:
                remaining -= chunk

    async def stop(self):
        self._running = False
        self._paused = False
        self._pause_event.set()

        for task in self._background_tasks:
            if not task.done():
                task.cancel()
        if self._background_tasks:
            await asyncio.gather(*self._background_tasks, return_exceptions=True)
        self._background_tasks.clear()

        await self.timer.stop()
        await self.countdown_timer.stop()
        await self.tiktok.disconnect()
        self.tts.stop()
        if hasattr(self, 'x2'):
            self.x2.close_collection()
            self.x2.reset()
        if self._sim_service:
            await self._sim_service.stop()
        if self._owns_ws_server:
            await self.ws_server.stop()
        print("[Game] Stopped")

    def get_state(self) -> GameState:
        return self.state

    def get_current_question(self) -> Optional[Question]:
        if 0 <= self.current_question_index < len(self.current_questions):
            return self.current_questions[self.current_question_index]
        return None

    async def _get_snapshot_for_new_client(self):
        if not self._running:
            return None
        return self.get_overlay_snapshot()

    def get_overlay_snapshot(self) -> dict:
        state = self.state
        real_state = state
        if state == GameState.PAUSED and hasattr(self, 'state_before_pause'):
            real_state = self.state_before_pause

        state_to_phase = {
            GameState.IDLE: 'starting' if self._running else 'waiting',
            GameState.SHOWING_QUESTION: 'question',
            GameState.COLLECTING_ANSWERS: 'question',
            GameState.SHOWING_RESULT: 'result',
            GameState.SHOWING_LEADERBOARD: 'leaderboard',
            GameState.COUNTDOWN: 'countdown',
            GameState.QUESTIONNAIRE_TRANSITION: 'transition',
            GameState.GAME_END: 'end',
            GameState.DOUBLE_OPEN: 'double_open',
            GameState.DOUBLE_SHOW: 'double_show',
            GameState.DOUBLE_RESULT: 'double_result',
        }
        phase = state_to_phase.get(real_state, 'waiting')

        snapshot: Dict = {
            'engine_state': state.value,
            'phase': phase,
            'paused': self._paused,
            'questionnaire_name': self._current_qn_name or '',
        }

        question = self.get_current_question()
        if question and phase in ('question', 'result'):
            effective_time = self.config.question_time + self.config.tiktok_delay
            snapshot['question'] = {
                'question_number': self.current_question_index + 1,
                'total_questions': len(self.current_questions),
                'text': question.text,
                'choices': question.choices,
                'time_limit': effective_time,
                'is_double': question.is_double(),
                'questionnaire_name': self._current_qn_name,
            }

            percentages = self._calculate_percentages()
            total_answers = sum(self.answer_counts.values())
            snapshot['answer_update'] = {
                'percentages': percentages,
                'total_answers': total_answers,
            }

            if real_state == GameState.COLLECTING_ANSWERS:
                snapshot['timer'] = {'remaining': self.timer.get_remaining()}
            elif real_state == GameState.SHOWING_QUESTION:
                snapshot['timer'] = {'remaining': effective_time}

        if phase == 'result' and question:
            winners = [
                {
                    'username': pa.display_name,
                    'display_name': pa.display_name,
                    'points': pa.points_earned,
                    'time_ms': pa.response_time_ms,
                    'profile_picture_url': self.profile_pictures.get(pa.username, ''),
                }
                for pa in self.current_answers.values()
                if pa.is_correct
            ]
            winners.sort(key=lambda x: (x['time_ms'], x['username']))
            fastest_winner = {
                'display_name': winners[0]['display_name'],
                'profile_picture_url': winners[0]['profile_picture_url'],
            } if winners else None
            total_answers = sum(self.answer_counts.values())

            result_data = {
                'correct_letter': question.correct_answer,
                'correct_answer': question.correct_answer,
                'correct_text': question.choices.get(question.correct_answer, ''),
                'answer_text': question.choices.get(question.correct_answer, ''),
                'percentages': self._calculate_percentages(),
                'winners': winners[:10],
                'winner_count': len(winners),
                'fastest_winner': fastest_winner,
                'total_answers': total_answers,
                'is_double': question.is_double(),
                'question_type': question.question_type,
            }
            if question.is_double():
                result_data['correct_answers'] = question.correct_answers
                result_data['correct_texts'] = {
                    a: question.choices.get(a, '') for a in question.correct_answers
                }
            snapshot['result'] = result_data

        leaderboard = [
            {
                'username': self.display_names.get(uname, uname),
                'score': score,
                'rank': i + 1,
                'profile_picture_url': self.profile_pictures.get(uname, ''),
            }
            for i, (uname, score) in enumerate(
                sorted(self.session_scores.items(), key=lambda x: (-x[1], x[0]))[:10]
            )
        ]
        snapshot['leaderboard'] = leaderboard

        if phase == 'countdown':
            snapshot['countdown'] = {'seconds': self.countdown_timer.get_remaining()}

        if phase == 'end':
            snapshot['game_end'] = {
                'leaderboard': leaderboard,
                'stats': {
                    'total_questions': self._count_total_questions(),
                    'total_players': len(self.session_scores),
                },
            }

        if phase in ('double_open', 'double_show'):
            remaining = self._x2_open_duration
            if phase == 'double_open' and self._x2_open_start:
                elapsed = (datetime.now() - self._x2_open_start).total_seconds()
                remaining = max(0, self._x2_open_duration - elapsed)
            snapshot['x2'] = {
                'phase': phase,
                'participants': self.x2.get_registered_list(),
                'count': self.x2.participant_count,
                'duration': remaining,
            }

        if phase == 'double_result':
            snapshot['double_result'] = {
                'successful': [
                    {"username": u, "display_name": self.display_names.get(u, u),
                     "profile_picture_url": self.profile_pictures.get(u, "")}
                    for u in self.x2.state.successful
                ],
                'failed': [
                    {"username": u, "display_name": self.display_names.get(u, u),
                     "profile_picture_url": self.profile_pictures.get(u, "")}
                    for u in self.x2.state.failed
                ],
                'success_count': len(self.x2.state.successful),
                'fail_count': len(self.x2.state.failed),
            }

        return snapshot
