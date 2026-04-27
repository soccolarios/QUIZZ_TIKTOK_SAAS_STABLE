import asyncio
import os
import threading
from typing import List, Optional

import config_loader as cfg


DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
AUDIO_DIR = os.path.join(DATA_DIR, 'audio')
QN_AUDIO_DIR = os.path.join(AUDIO_DIR, 'questionnaires')
USERS_AUDIO_DIR = os.path.join(AUDIO_DIR, 'users')
PLAYERS_AUDIO_DIR = os.path.join(AUDIO_DIR, 'players')


class TTSManager:
    def __init__(self, enabled: bool = True, rate: int = None, volume: float = None):
        self.enabled = enabled
        self._initialized = False
        self.ws_server = None
        self._queue: asyncio.Queue = None
        self._queue_task = None
        self._current_qn_id: Optional[int] = None
        self._current_user_id: Optional[str] = None
        self._current_question_index: int = 0
        self._fastest_winner_audio: Optional[str] = None
        self._fastest_winner_ready = threading.Event()
        self._fastest_winner_generating = False
        self._is_processing = False

    def initialize(self):
        if self._initialized:
            return True
        self._initialized = True
        print("[TTS] Initialized (pre-generated audio mode only)")
        return True

    def set_questionnaire(self, qn_id: int, user_id: Optional[str] = None):
        self._current_qn_id = qn_id
        self._current_user_id = user_id
        self._current_question_index = 0
        has_audio = self._qn_audio_dir_exists(qn_id, user_id)
        print(f"[TTS] Questionnaire set to {qn_id} user={user_id or 'global'} (audio={'found' if has_audio else 'none'})")

    def set_question_index(self, index: int):
        self._current_question_index = index

    def _ensure_queue(self):
        if self._queue is None:
            self._queue = asyncio.Queue()
        if self._queue_task is None or self._queue_task.done():
            loop = asyncio.get_running_loop()
            self._queue_task = loop.create_task(self._process_queue())

    async def _process_queue(self):
        gap_ms = cfg.get('audio_tts', 'sequence_gap_ms', 50)
        try:
            while True:
                files = await self._queue.get()
                self._is_processing = True
                try:
                    if files and self.ws_server:
                        await self.ws_server.send_music_ducking(True)
                        await self.ws_server.send_audio_play(files)
                        total_duration = self._estimate_duration(files)
                        await asyncio.sleep(total_duration + gap_ms / 1000)
                        await self.ws_server.send_music_ducking(False)
                except asyncio.CancelledError:
                    if self.ws_server:
                        try:
                            await self.ws_server.send_music_ducking(False)
                        except Exception:
                            pass
                    raise
                except Exception as e:
                    print(f"[TTS] Queue processing error: {e}")
                    if self.ws_server:
                        try:
                            await self.ws_server.send_music_ducking(False)
                        except Exception:
                            pass
                finally:
                    self._is_processing = False
                    if self._queue is not None:
                        self._queue.task_done()
        except asyncio.CancelledError:
            pass

    def _estimate_duration(self, files: List[str]) -> float:
        total = 0.0
        for f in files:
            if 'questionnaires/' in f:
                if '_question.' in f:
                    total += 4.0
                elif '_correct.' in f:
                    total += 2.0
                else:
                    total += 2.5
            elif 'phrases/' in f:
                total += 3.0
            elif 'words/' in f:
                total += 1.8
            elif 'numbers/' in f:
                total += 1.2
            elif 'players/' in f:
                total += 2.0
            else:
                total += 1.0
        return total

    def speak(self, text: str):
        pass

    async def speak_async(self, text: str):
        pass

    def set_ws_server(self, ws_server):
        self.ws_server = ws_server

    def _audio_exists(self, category: str, key: str) -> bool:
        subdirs = {
            'numbers': os.path.join('system', 'numbers'),
            'words': os.path.join('system', 'words'),
            'phrases': os.path.join('system', 'phrases'),
        }
        subdir = subdirs.get(category, category)
        return os.path.exists(os.path.join(AUDIO_DIR, subdir, f'{key}.mp3'))

    def _audio_path_relative(self, category: str, key: str) -> str:
        subdirs = {
            'numbers': 'system/numbers',
            'words': 'system/words',
            'phrases': 'system/phrases',
        }
        subdir = subdirs.get(category, category)
        return f'{subdir}/{key}.mp3'

    def _qn_audio_dir_exists(self, qn_id: int, user_id: Optional[str] = None) -> bool:
        if user_id:
            user_dir = os.path.join(USERS_AUDIO_DIR, str(user_id), 'questionnaires', str(qn_id))
            if os.path.isdir(user_dir):
                return True
        return os.path.isdir(os.path.join(QN_AUDIO_DIR, str(qn_id)))

    def _qn_audio_exists(self, qn_id: int, filename: str, user_id: Optional[str] = None) -> bool:
        """Check user-scoped path first, fall back to global."""
        if user_id:
            user_path = os.path.join(USERS_AUDIO_DIR, str(user_id), 'questionnaires', str(qn_id), filename)
            if os.path.exists(user_path) and os.path.getsize(user_path) > 0:
                return True
        global_path = os.path.join(QN_AUDIO_DIR, str(qn_id), filename)
        return os.path.exists(global_path) and os.path.getsize(global_path) > 0

    def _qn_audio_path_relative(self, qn_id: int, filename: str, user_id: Optional[str] = None) -> str:
        """
        Return the relative URL path sent to the overlay browser.
        Prefer user-scoped file if it exists on disk; fall back to global.
        The overlay fetches /overlay-assets/audio/<relative_path>.
        """
        if user_id:
            user_path = os.path.join(USERS_AUDIO_DIR, str(user_id), 'questionnaires', str(qn_id), filename)
            if os.path.exists(user_path) and os.path.getsize(user_path) > 0:
                return f'users/{user_id}/questionnaires/{qn_id}/{filename}'
        return f'questionnaires/{qn_id}/{filename}'

    def _player_audio_path(self, name: str) -> str:
        safe_name = "".join(c if c.isalnum() or c in ('-', '_') else '_' for c in name.lower())
        return os.path.join(PLAYERS_AUDIO_DIR, f'{safe_name}.mp3')

    def _player_audio_relative(self, name: str) -> str:
        safe_name = "".join(c if c.isalnum() or c in ('-', '_') else '_' for c in name.lower())
        return f'players/{safe_name}.mp3'

    def prepare_fastest_winner(self, display_name: str):
        self._fastest_winner_audio = None
        self._fastest_winner_ready.clear()
        self._fastest_winner_generating = True

        path = self._player_audio_path(display_name)
        if os.path.exists(path) and os.path.getsize(path) > 0:
            self._fastest_winner_audio = self._player_audio_relative(display_name)
            self._fastest_winner_ready.set()
            self._fastest_winner_generating = False
            print(f"[TTS] Fastest winner audio cached: {display_name}")
            return

        def _generate():
            try:
                from audio_service import AudioService
                from tts_preprocessor import TTSPreprocessor
                svc = AudioService()
                provider = svc.get_provider()
                if not provider:
                    print(f"[TTS] No provider for player name generation")
                    return
                os.makedirs(PLAYERS_AUDIO_DIR, exist_ok=True)
                lang = svc.get_raw_config().get('language', 'fr-FR')
                clean_name = TTSPreprocessor(lang).preprocess(display_name, 'player_name', lang)
                success = provider.generate(clean_name, path)
                if success and os.path.exists(path) and os.path.getsize(path) > 0:
                    self._fastest_winner_audio = self._player_audio_relative(display_name)
                    print(f"[TTS] Fastest winner audio ready: {display_name}")
                else:
                    print(f"[TTS] Failed to generate audio for: {display_name}")
            except Exception as e:
                print(f"[TTS] Error generating fastest winner audio: {e}")
            finally:
                self._fastest_winner_ready.set()
                self._fastest_winner_generating = False

        thread = threading.Thread(target=_generate, daemon=True)
        thread.start()
        print(f"[TTS] Generating fastest winner audio in background: {display_name}")

    def reset_fastest_winner(self):
        self._fastest_winner_audio = None
        self._fastest_winner_ready.clear()
        self._fastest_winner_generating = False

    def _get_fastest_winner_audio(self, timeout: float = 5.0) -> Optional[str]:
        if not self._fastest_winner_generating and not self._fastest_winner_audio:
            return None
        self._fastest_winner_ready.wait(timeout=timeout)
        return self._fastest_winner_audio

    def _build_question_sequence(self, question_num: int, total: int, question_text: str) -> List[str]:
        seq = []
        if self._audio_exists('words', 'question_numero'):
            seq.append(self._audio_path_relative('words', 'question_numero'))
        if self._audio_exists('numbers', str(question_num)):
            seq.append(self._audio_path_relative('numbers', str(question_num)))

        if self._current_qn_id:
            qn_q_file = f'q{self._current_question_index + 1}_question.mp3'
            if self._qn_audio_exists(self._current_qn_id, qn_q_file, self._current_user_id):
                seq.append(self._qn_audio_path_relative(self._current_qn_id, qn_q_file, self._current_user_id))

        return seq

    def _build_choices_sequence(self) -> List[str]:
        seq = []
        if not self._current_qn_id:
            return seq
        q_idx = self._current_question_index + 1
        for letter in ['a', 'b', 'c', 'd']:
            fname = f'q{q_idx}_{letter}.mp3'
            if self._qn_audio_exists(self._current_qn_id, fname, self._current_user_id):
                seq.append(self._qn_audio_path_relative(self._current_qn_id, fname, self._current_user_id))
        return seq

    def _build_timer_sequence(self, seconds: int) -> List[str]:
        seq = []
        if self._audio_exists('words', 'top_cest_parti'):
            seq.append(self._audio_path_relative('words', 'top_cest_parti'))
        return seq

    def _build_answer_sequence(self, correct_letter: str, answer_text: str) -> List[str]:
        seq = []
        if self._audio_exists('words', 'la_bonne_reponse_etait'):
            seq.append(self._audio_path_relative('words', 'la_bonne_reponse_etait'))

        if self._current_qn_id:
            q_idx = self._current_question_index + 1
            correct_file = f'q{q_idx}_correct.mp3'
            if self._qn_audio_exists(self._current_qn_id, correct_file, self._current_user_id):
                seq.append(self._qn_audio_path_relative(self._current_qn_id, correct_file, self._current_user_id))

        return seq

    def _build_winners_sequence(self, winners: list, fastest_winner: str = None, max_announce: int = 3) -> List[str]:
        seq = []
        if not winners:
            if self._audio_exists('words', 'aucun_gagnant'):
                seq.append(self._audio_path_relative('words', 'aucun_gagnant'))
        elif len(winners) == 1:
            if self._audio_exists('words', 'felicitations'):
                seq.append(self._audio_path_relative('words', 'felicitations'))
            if self._audio_exists('words', 'le_gagnant_est'):
                seq.append(self._audio_path_relative('words', 'le_gagnant_est'))
            winner_audio = self._get_fastest_winner_audio()
            if winner_audio:
                seq.append(winner_audio)
        else:
            if self._audio_exists('words', 'felicitations'):
                seq.append(self._audio_path_relative('words', 'felicitations'))
            if self._audio_exists('words', 'nous_avons'):
                seq.append(self._audio_path_relative('words', 'nous_avons'))
            else:
                print(f"[TTS] missing words/nous_avons.mp3")
            if self._audio_exists('numbers', str(len(winners))):
                seq.append(self._audio_path_relative('numbers', str(len(winners))))
            else:
                print(f"[TTS] missing numbers/{len(winners)}.mp3")
            if self._audio_exists('words', 'gagnants'):
                seq.append(self._audio_path_relative('words', 'gagnants'))
            if fastest_winner and self._audio_exists('words', 'le_plus_rapide'):
                seq.append(self._audio_path_relative('words', 'le_plus_rapide'))
                winner_audio = self._get_fastest_winner_audio()
                if winner_audio:
                    seq.append(winner_audio)
        return seq

    def _build_next_question_sequence(self, seconds: int) -> List[str]:
        seq = []
        if self._audio_exists('words', 'prochaine_question_dans'):
            seq.append(self._audio_path_relative('words', 'prochaine_question_dans'))
        if self._audio_exists('numbers', str(seconds)):
            seq.append(self._audio_path_relative('numbers', str(seconds)))
        if self._audio_exists('words', 'secondes'):
            seq.append(self._audio_path_relative('words', 'secondes'))
        return seq

    def _build_countdown_sequence(self, seconds: int) -> List[str]:
        seq = []
        if seconds in (5, 4, 3, 2, 1):
            if self._audio_exists('numbers', str(seconds)):
                seq.append(self._audio_path_relative('numbers', str(seconds)))
        return seq

    def _build_game_start_sequence(self, total_questions: int) -> List[str]:
        seq = []
        if self._audio_exists('phrases', 'intro'):
            seq.append(self._audio_path_relative('phrases', 'intro'))
        return seq

    def _build_transition_sequence(self) -> List[str]:
        seq = []
        if self._audio_exists('phrases', 'transition'):
            seq.append(self._audio_path_relative('phrases', 'transition'))
        return seq

    def prepare_game_winner(self, display_name: str):
        self._game_winner_audio = None
        self._game_winner_ready = threading.Event()
        self._game_winner_generating = True

        path = self._player_audio_path(display_name)
        if os.path.exists(path) and os.path.getsize(path) > 0:
            self._game_winner_audio = self._player_audio_relative(display_name)
            self._game_winner_ready.set()
            self._game_winner_generating = False
            print(f"[TTS] Game winner audio cached: {display_name}")
            return

        def _generate():
            try:
                from audio_service import AudioService
                from tts_preprocessor import TTSPreprocessor
                svc = AudioService()
                provider = svc.get_provider()
                if not provider:
                    print(f"[TTS] No provider for game winner name generation")
                    return
                os.makedirs(PLAYERS_AUDIO_DIR, exist_ok=True)
                lang = svc.get_raw_config().get('language', 'fr-FR')
                clean_name = TTSPreprocessor(lang).preprocess(display_name, 'player_name', lang)
                success = provider.generate(clean_name, path)
                if success and os.path.exists(path) and os.path.getsize(path) > 0:
                    self._game_winner_audio = self._player_audio_relative(display_name)
                    print(f"[TTS] Game winner audio ready: {display_name}")
                else:
                    print(f"[TTS] Failed to generate game winner audio: {display_name}")
            except Exception as e:
                print(f"[TTS] Error generating game winner audio: {e}")
            finally:
                self._game_winner_ready.set()
                self._game_winner_generating = False

        thread = threading.Thread(target=_generate, daemon=True)
        thread.start()
        print(f"[TTS] Generating game winner audio in background: {display_name}")

    def _get_game_winner_audio(self, timeout: float = 5.0) -> Optional[str]:
        if not hasattr(self, '_game_winner_generating') or (not self._game_winner_generating and not getattr(self, '_game_winner_audio', None)):
            return None
        if not self._game_winner_ready.is_set():
            return None
        return getattr(self, '_game_winner_audio', None)

    def _build_game_end_sequence(self, winner: str = None) -> List[str]:
        seq = []
        if winner and self._audio_exists('phrases', 'fin_gagnant'):
            seq.append(self._audio_path_relative('phrases', 'fin_gagnant'))
            winner_audio = self._get_game_winner_audio()
            if winner_audio:
                seq.append(winner_audio)
        elif self._audio_exists('phrases', 'fin'):
            seq.append(self._audio_path_relative('phrases', 'fin'))
        return seq

    def _enqueue(self, files: List[str]):
        if not self.enabled:
            return
        if files and self.ws_server:
            self._ensure_queue()
            self._queue.put_nowait(files)

    async def _send_audio_sequence(self, files: List[str]):
        if files and self.ws_server:
            await self.ws_server.send_audio_play(files)

    def get_audio_status(self) -> dict:
        categories = {
            'numbers': list(range(0, 101)),
            'words': [
                'question_numero', 'sur', 'vous_avez', 'secondes',
                'la_bonne_reponse_etait', 'les_gagnants_sont', 'le_gagnant_est',
                'aucun_gagnant', 'le_plus_rapide', 'et', 'autres_joueurs',
                'prochaine_question_dans', 'felicitations', 'nous_avons',
                'gagnants', 'top_cest_parti'
            ],
            'phrases': [
                'intro', 'transition', 'fin', 'fin_gagnant',
                'x2_open', 'x2_nobody', 'x2_registered', 'x2_registered_suffix',
                'x2_registered_suffix2', 'x2_success', 'x2_fail'
            ]
        }
        status = {}
        for cat, keys in categories.items():
            found = sum(1 for k in keys if self._audio_exists(cat, str(k)))
            status[cat] = {'total': len(keys), 'found': found}
        return status

    def speak_question(self, question_num: int, total: int, question_text: str, time_limit: int = None):
        seq = self._build_question_sequence(question_num, total, question_text)
        choices_seq = self._build_choices_sequence()
        seq.extend(choices_seq)
        if time_limit:
            seq.extend(self._build_timer_sequence(time_limit))
        if seq and self.ws_server:
            self._enqueue(seq)
            return
        message = f"Question {question_num}. {question_text}"
        self.speak(message)

    def speak_answer(self, correct_letter: str, answer_text: str):
        seq = self._build_answer_sequence(correct_letter, answer_text)
        if seq and self.ws_server:
            self._enqueue(seq)
            return
        message = f"La bonne reponse etait {correct_letter}, {answer_text}"
        self.speak(message)

    def build_result_sequence(self, correct_letter: str, answer_text: str, winners: list, fastest_winner: str = None, max_announce: int = 3) -> list:
        seq = self._build_answer_sequence(correct_letter, answer_text)
        seq.extend(self._build_winners_sequence(winners, fastest_winner, max_announce))
        self._last_result_audio_duration = self._estimate_duration(seq)
        return seq

    def speak_result(self, correct_letter: str, answer_text: str, winners: list, fastest_winner: str = None, max_announce: int = 3, countdown_seconds: int = 0):
        seq = self.build_result_sequence(correct_letter, answer_text, winners, fastest_winner, max_announce)
        if seq and self.ws_server:
            self._enqueue(seq)
            return
        if not winners:
            self.speak(f"La bonne reponse etait {correct_letter}. Aucun gagnant.")
        else:
            self.speak(f"La bonne reponse etait {correct_letter}. Felicitations!")

    def get_last_result_audio_duration(self) -> float:
        return getattr(self, '_last_result_audio_duration', 0.0)

    def speak_winners(self, winners: list, fastest_winner: str = None, max_announce: int = 3):
        seq = self._build_winners_sequence(winners, fastest_winner)
        if seq and self.ws_server:
            self._enqueue(seq)
            return
        if not winners:
            self.speak("Aucun gagnant pour cette question")
            return
        if len(winners) == 1:
            self.speak(f"Le gagnant de cette question est {winners[0]}!")
        else:
            names = ", ".join(winners[:max_announce])
            if len(winners) > max_announce:
                self.speak(f"Les gagnants sont {names} et {len(winners) - max_announce} autres joueurs!")
            else:
                self.speak(f"Les gagnants sont {names}!")
        if fastest_winner and len(winners) > 1:
            self.speak(f"Le joueur le plus rapide est {fastest_winner}!")

    def speak_next_question(self, countdown_seconds: int):
        seq = self._build_next_question_sequence(countdown_seconds)
        if seq and self.ws_server:
            self._enqueue(seq)

    def speak_countdown(self, seconds: int):
        seq = self._build_countdown_sequence(seconds)
        if not seq:
            return
        if self.ws_server:
            if self._queue is not None and (not self._queue.empty() or self._is_processing):
                return
            self._enqueue(seq)

    def speak_game_start(self, total_questions: int):
        # No-op: skip intro audio to avoid blocking the startup phase.
        return

    def speak_timer(self, seconds: int):
        seq = self._build_timer_sequence(seconds)
        if seq and self.ws_server:
            self._enqueue(seq)

    def speak_transition(self):
        seq = self._build_transition_sequence()
        if seq and self.ws_server:
            self._enqueue(seq)

    def build_x2_open_sequence(self) -> list:
        seq = []
        if self._audio_exists('phrases', 'x2_open'):
            seq.append(self._audio_path_relative('phrases', 'x2_open'))
        return seq

    def speak_x2_open(self) -> float:
        seq = self.build_x2_open_sequence()
        duration = self._estimate_duration(seq)
        if seq and self.ws_server:
            print(f"[TTS] X2 open audio: {seq}")
            self._enqueue(seq)
        return duration

    def build_x2_nobody_sequence(self) -> list:
        seq = []
        if self._audio_exists('phrases', 'x2_nobody'):
            seq.append(self._audio_path_relative('phrases', 'x2_nobody'))
        return seq

    def speak_x2_nobody(self) -> float:
        seq = self.build_x2_nobody_sequence()
        duration = self._estimate_duration(seq)
        if seq and self.ws_server:
            print(f"[TTS] X2 nobody audio: {seq}")
            self._enqueue(seq)
        return duration

    def build_x2_registered_sequence(self, count: int) -> list:
        seq = []
        has_prefix = self._audio_exists('phrases', 'x2_registered')
        has_prefix_word = self._audio_exists('words', 'nous_avons')
        has_number = self._audio_exists('numbers', str(count))
        has_suffix = self._audio_exists('phrases', 'x2_registered_suffix')
        has_suffix2 = self._audio_exists('phrases', 'x2_registered_suffix2')

        if has_prefix:
            seq.append(self._audio_path_relative('phrases', 'x2_registered'))
        elif has_prefix_word:
            seq.append(self._audio_path_relative('words', 'nous_avons'))

        if has_number:
            seq.append(self._audio_path_relative('numbers', str(count)))

        if has_suffix:
            seq.append(self._audio_path_relative('phrases', 'x2_registered_suffix'))
        if has_suffix2:
            seq.append(self._audio_path_relative('phrases', 'x2_registered_suffix2'))

        missing = []
        if not has_prefix and not has_prefix_word:
            missing.append('phrases/x2_registered OR words/nous_avons')
        if not has_number:
            missing.append(f'numbers/{count}')
        if not has_suffix:
            missing.append('phrases/x2_registered_suffix')
        if missing:
            print(f"[TTS] X2 registered sequence: MISSING files: {missing}")
        print(f"[TTS] X2 registered sequence: {len(seq)} files: {seq}")
        return seq

    def speak_x2_registered(self, count: int) -> float:
        seq = self.build_x2_registered_sequence(count)
        duration = self._estimate_duration(seq)
        if seq and self.ws_server:
            print(f"[TTS] X2 registered audio: {seq}")
            self._enqueue(seq)
        return duration

    def build_x2_result_sequence(self, successful: list, failed: list) -> list:
        seq = []
        if successful and self._audio_exists('phrases', 'x2_success'):
            seq.append(self._audio_path_relative('phrases', 'x2_success'))
        elif failed and self._audio_exists('phrases', 'x2_fail'):
            seq.append(self._audio_path_relative('phrases', 'x2_fail'))
        return seq

    def speak_x2_result(self, successful: list, failed: list) -> float:
        seq = self.build_x2_result_sequence(successful, failed)
        duration = self._estimate_duration(seq)
        if seq and self.ws_server:
            print(f"[TTS] X2 result audio: {seq}")
            self._enqueue(seq)
        return duration

    def build_game_end_sequence(self, winner: str = None) -> List[str]:
        return self._build_game_end_sequence(winner)

    def speak_game_end(self, winner: str = None):
        seq = self._build_game_end_sequence(winner)
        if seq and self.ws_server:
            self._enqueue(seq)
            return
        if winner:
            self.speak(f"Fin du quiz! Le grand gagnant est {winner}! Felicitations!")
        else:
            self.speak("Fin du quiz! Merci d'avoir joue!")

    def flush_queue(self):
        if self._queue is not None:
            while not self._queue.empty():
                try:
                    self._queue.get_nowait()
                    self._queue.task_done()
                except asyncio.QueueEmpty:
                    break

    def stop_and_flush(self):
        self.flush_queue()
        if self._queue_task and not self._queue_task.done():
            self._queue_task.cancel()
        self._queue_task = None
        self._queue = None
        if self.ws_server:
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(self.ws_server.send_music_ducking(False))
            except RuntimeError:
                pass
        print("[TTS] stop_and_flush: queue cleared")

    def set_rate(self, rate: int):
        pass

    def set_volume(self, volume: float):
        pass

    def stop(self):
        self.flush_queue()
        print("[TTS] Stopped")
