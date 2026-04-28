import asyncio
import threading
import traceback
import time
from enum import Enum
from typing import Optional, Callable

from game_engine import GameEngine
from websocket_server import WebSocketServer
from models import GameConfig
import database as db
import config_loader as cfg


class RuntimeState(Enum):
    STOPPED = "stopped"
    STARTING = "starting"
    RUNNING = "running"
    PAUSED = "paused"
    STOPPING = "stopping"
    ERROR = "error"


class GameRuntime:
    def __init__(self, db_path: str = None):
        self._db_path = db_path
        self._state = RuntimeState.STOPPED
        self._engine: Optional[GameEngine] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        self._error_message: Optional[str] = None
        self._start_time: Optional[float] = None
        self._on_state_change: Optional[Callable] = None
        self._on_log: Optional[Callable] = None
        self._config_snapshot: Optional[dict] = None

        self._timeline_t0: Optional[float] = None
        self._session_label: str = "?"
        self._ws_server: Optional[WebSocketServer] = None
        self._ws_loop: Optional[asyncio.AbstractEventLoop] = None
        self._ws_thread: Optional[threading.Thread] = None
        self._ws_ready = threading.Event()
        self._loop_exited = threading.Event()
        self._loop_exited.set()

    @property
    def state(self) -> RuntimeState:
        return self._state

    @property
    def is_running(self) -> bool:
        return self._state in (RuntimeState.RUNNING, RuntimeState.PAUSED)

    @property
    def uptime(self) -> Optional[int]:
        if self._start_time and self._state in (RuntimeState.RUNNING, RuntimeState.PAUSED, RuntimeState.STARTING):
            return int(time.time() - self._start_time)
        return None

    @property
    def error_message(self) -> Optional[str]:
        return self._error_message

    @property
    def ws_server(self) -> Optional[WebSocketServer]:
        return self._ws_server

    def set_state_change_handler(self, handler: Callable):
        self._on_state_change = handler

    def set_log_handler(self, handler: Callable):
        self._on_log = handler

    def _set_state(self, new_state: RuntimeState, error_msg: str = None):
        old_state = self._state
        if old_state == new_state and not error_msg:
            return
        self._state = new_state
        if error_msg:
            self._error_message = error_msg
        elif new_state != RuntimeState.ERROR:
            self._error_message = None
        self._log(f"State: {old_state.value} -> {new_state.value}")
        if self._on_state_change:
            try:
                self._on_state_change(old_state, new_state)
            except Exception:
                pass

    def _log(self, message: str):
        timestamp = time.strftime('%H:%M:%S')
        entry = f"[{timestamp}] [Runtime] {message}"
        if self._on_log:
            try:
                self._on_log(entry)
            except Exception:
                pass
        print(entry)

    def _tl(self, event: str):
        if self._timeline_t0 is not None:
            elapsed = time.monotonic() - self._timeline_t0
            print(f"[Timeline][session:{self._session_label}] +{elapsed:.2f}s {event}")
        else:
            print(f"[Timeline][session:{self._session_label}] {event}")

    def start_ws_server(self, port: int = None):
        if self._ws_server and self._ws_server.is_serving():
            self._log(f"WebSocket server already running on port {self._ws_server.port}")
            return

        if self._ws_server is None:
            self._ws_server = WebSocketServer(port=port)
            self._log(f"[WS] Created WebSocketServer on port {self._ws_server.port}")
        else:
            self._log(f"[WS] Reusing pre-assigned WebSocketServer on port {self._ws_server.port}")
        self._ws_ready.clear()

        self._ws_thread = threading.Thread(
            target=self._ws_server_thread,
            daemon=True,
            name="ws-server"
        )
        self._ws_thread.start()

        if self._ws_ready.wait(timeout=10):
            self._log(f"[WS] WebSocket server bound on port {self._ws_server.port}")
            self._tl("WS bound")
        else:
            self._log(f"[WS] WebSocket server failed to start on port {self._ws_server.port} within timeout")

    def _ws_server_thread(self):
        try:
            self._ws_loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self._ws_loop)

            self._ws_loop.run_until_complete(self._ws_server.start())
            self._ws_ready.set()

            self._ws_loop.run_forever()
        except Exception as e:
            print(f"[WebSocket] Server thread error: {e}")
            traceback.print_exc()
        finally:
            if self._ws_loop and not self._ws_loop.is_closed():
                self._ws_loop.close()

    def get_ws_client_count(self) -> int:
        if self._ws_server:
            return self._ws_server.get_client_count()
        return 0

    def start(self, tiktok_username: str, simulate: bool = False, **kwargs) -> bool:
        with self._lock:
            if self._state not in (RuntimeState.STOPPED, RuntimeState.ERROR):
                return False

            self._set_state(RuntimeState.STARTING)
            self._error_message = None
            self._start_time = time.time()
            self._timeline_t0 = time.monotonic()
            self._tl("Session created")
            self._loop_exited.clear()

            self._config_snapshot = {
                'tiktok_username': tiktok_username,
                'simulate': simulate,
                **kwargs
            }

            self._thread = threading.Thread(
                target=self._run_thread,
                args=(tiktok_username, simulate, kwargs),
                daemon=True,
                name="game-runtime"
            )
            self._thread.start()
            return True

    def _run_thread(self, tiktok_username: str, simulate: bool, kwargs: dict):
        try:
            self._loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self._loop)
            self._loop.run_until_complete(
                self._run_game(tiktok_username, simulate, kwargs)
            )
        except Exception as e:
            self._log(f"Fatal error: {e}")
            traceback.print_exc()
            self._set_state(RuntimeState.ERROR, str(e))
        finally:
            if self._loop and not self._loop.is_closed():
                self._loop.close()
            self._loop = None
            self._engine = None
            if self._state not in (RuntimeState.ERROR, RuntimeState.STOPPED):
                self._set_state(RuntimeState.STOPPED)
            self._start_time = None
            self._loop_exited.set()

    async def _run_game(self, tiktok_username: str, simulate: bool, kwargs: dict):
        questionnaire_ids = kwargs.get('questionnaire_ids', [])
        if isinstance(questionnaire_ids, str):
            questionnaire_ids = [int(x.strip()) for x in questionnaire_ids.split(',') if x.strip()]

        config = GameConfig(
            question_time=kwargs.get('question_time'),
            countdown_time=kwargs.get('countdown_time'),
            total_questions=kwargs.get('questions', 0) or 0,
            tiktok_delay=kwargs.get('delay'),
            play_mode=kwargs.get('play_mode', 'single'),
            questionnaire_id=kwargs.get('questionnaire_id'),
            questionnaire_ids=questionnaire_ids,
            x2_enabled=kwargs.get('x2_enabled'),
            x2_frequency=kwargs.get('x2_frequency'),
        )

        print(f"[Config] x2_enabled={config.x2_enabled!r}, x2_frequency={config.x2_frequency!r}")

        self._engine = GameEngine(
            config=config,
            tiktok_username=tiktok_username,
            simulate=simulate,
            ws_server=self._ws_server,
            db_path=self._db_path,
            user_id=kwargs.get('user_id'),
        )
        self._engine._timeline_t0 = self._timeline_t0

        if kwargs.get('no_tts', False):
            self._engine.tts.enabled = False

        if simulate:
            from simulation_service import AdvancedSimulator, SimConfig
            sim_cfg = SimConfig(
                enabled=True,
                num_players=kwargs.get('sim_players', 80),
                correct_rate=kwargs.get('sim_correct_rate', 0.62),
                speed_profile=kwargs.get('sim_speed', 'normal'),
                intensity=kwargs.get('sim_intensity', 'normal'),
                noise_enabled=kwargs.get('sim_noise', True),
            )
            sim = AdvancedSimulator(
                config=sim_cfg,
                callback=self._engine._on_tiktok_comment,
                get_state=self._engine.get_state,
                get_token=lambda: self._engine._phase_token,
            )
            sim.start_session()
            self._engine._sim_service = sim
            self._engine.tiktok._advanced_sim_active = True
            print(f"[Sim] engine.config.x2_enabled={self._engine.config.x2_enabled!r}, x2_frequency={self._engine.config.x2_frequency!r}")

        db_label = self._db_path or "default (data/scores.db)"
        self._log(f"Initializing game engine (db={db_label})...")
        self._tl("Runtime start")
        await self._engine.initialize()

        self._set_state(RuntimeState.RUNNING)
        self._log("Game engine ready, starting game...")

        await self._engine.start_game()

        self._log("Game finished normally")
        self._set_state(RuntimeState.STOPPED)

    def stop(self) -> bool:
        with self._lock:
            if self._state not in (RuntimeState.RUNNING, RuntimeState.PAUSED, RuntimeState.STARTING):
                return False

            self._set_state(RuntimeState.STOPPING)

        self._tl("Runtime stop")
        self._log("Stopping game engine...")

        if self._engine and self._loop and not self._loop.is_closed():
            future = asyncio.run_coroutine_threadsafe(
                self._engine.stop(), self._loop
            )
            try:
                future.result(timeout=15)
            except Exception as e:
                self._log(f"Error during stop: {e}")

        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=10)

        self._stop_ws_server()

        self._engine = None
        self._start_time = None
        self._set_state(RuntimeState.STOPPED)
        return True

    def _stop_ws_server(self):
        ws = self._ws_server
        ws_loop = self._ws_loop
        ws_thread = self._ws_thread

        if ws and ws_loop and not ws_loop.is_closed():
            self._tl("WS stop")
            self._log("Stopping WS server...")
            try:
                future = asyncio.run_coroutine_threadsafe(ws.stop(), ws_loop)
                future.result(timeout=5)
            except Exception as e:
                self._log(f"WS server stop error: {e}")
            try:
                ws_loop.call_soon_threadsafe(ws_loop.stop)
            except RuntimeError:
                pass
            self._log("WS loop stopped")

        if ws_thread and ws_thread.is_alive():
            ws_thread.join(timeout=5)
            self._log("WS thread joined")

        self._ws_server = None
        self._ws_loop = None
        self._ws_thread = None

    def pause(self) -> bool:
        with self._lock:
            if self._state != RuntimeState.RUNNING:
                return False
            if self._engine and self._loop and not self._loop.is_closed():
                self._loop.call_soon_threadsafe(self._engine.pause)
                self._set_state(RuntimeState.PAUSED)
                return True
            return False

    def resume(self) -> bool:
        with self._lock:
            if self._state != RuntimeState.PAUSED:
                return False
            if self._engine and self._loop and not self._loop.is_closed():
                self._loop.call_soon_threadsafe(self._engine.resume)
                self._set_state(RuntimeState.RUNNING)
                return True
            return False

    def replay(self) -> bool:
        """
        Restart the game inside the current session.

        Returns immediately after spawning a background thread that stops
        the old engine and launches a new game.  The WebSocket server and
        session identity are kept intact.
        """
        with self._lock:
            snapshot = self._config_snapshot
            if not snapshot:
                return False
            if self._state in (RuntimeState.STOPPING, RuntimeState.STARTING):
                return False
            self._set_state(RuntimeState.STARTING)
            self._error_message = None
            self._start_time = time.time()

        threading.Thread(
            target=self._replay_background,
            args=(snapshot,),
            daemon=True,
            name="game-runtime-replay-bg",
        ).start()

        return True

    def _replay_background(self, snapshot: dict):
        """Blocking stop-and-restart sequence, runs on a background thread."""
        if self._engine and self._loop and not self._loop.is_closed():
            future = asyncio.run_coroutine_threadsafe(
                self._engine.stop(), self._loop
            )
            try:
                future.result(timeout=15)
            except Exception as e:
                self._log(f"Replay: engine stop error (non-fatal): {e}")

        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=10)

        self._engine = None

        if not self._loop_exited.wait(timeout=5):
            self._log("Replay: old event loop did not exit within 5s")

        with self._lock:
            self._loop_exited.clear()

            tiktok_username = snapshot.get('tiktok_username', 'saas_session')
            simulate = snapshot.get('simulate', True)
            kwargs = {k: v for k, v in snapshot.items()
                      if k not in ('tiktok_username', 'simulate')}

            self._thread = threading.Thread(
                target=self._run_thread,
                args=(tiktok_username, simulate, kwargs),
                daemon=True,
                name="game-runtime-replay",
            )
            self._thread.start()

    def get_status(self) -> dict:
        engine_state = None
        if self._engine:
            try:
                engine_state = self._engine.get_state().value
            except Exception:
                pass

        return {
            'state': self._state.value,
            'running': self._state in (RuntimeState.RUNNING, RuntimeState.PAUSED),
            'paused': self._state == RuntimeState.PAUSED,
            'uptime': self.uptime,
            'error': self._error_message,
            'engine_state': engine_state,
            'ws_connected': self.get_ws_client_count(),
            'ws_serving': self._ws_server.is_serving() if self._ws_server else False,
        }

    def get_game_state_detail(self) -> Optional[str]:
        if self._engine:
            try:
                return self._engine.get_state().value
            except Exception:
                return None
        return None

    def get_overlay_snapshot(self) -> dict:
        base = {
            'runtime_state': self._state.value,
            'phase': 'waiting',
            'engine_state': None,
            'paused': False,
            'leaderboard': [],
        }
        if self._state == RuntimeState.STARTING:
            base['phase'] = 'starting'
            return base
        if self._engine is None:
            return base
        try:
            snap = self._engine.get_overlay_snapshot()
            snap['runtime_state'] = self._state.value
            return snap
        except Exception as e:
            self._log(f"Snapshot error: {e}")
            return base
