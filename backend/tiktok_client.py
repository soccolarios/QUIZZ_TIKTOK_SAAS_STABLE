import asyncio
import re
import time
from typing import Callable, Optional, Any
from datetime import datetime
from dataclasses import dataclass
import config_loader as cfg

_INVISIBLE_PATTERN = re.compile(
    r'^[\s\u200b\u200c\u200d\u200e\u200f\u2060\u2061\u2062\u2063\u2064\ufeff\u00ad\u034f\u180e]*$'
)

# ---------------------------------------------------------------------------
# Reconnect / retry parameters
# ---------------------------------------------------------------------------

_RETRY_BASE_DELAY   = 5      # seconds between first retry
_RETRY_MAX_DELAY    = 60     # cap on per-attempt delay (exponential backoff)
_RETRY_MAX_SECONDS  = 300    # give up after 5 minutes total
_RETRY_BACKOFF      = 2.0    # multiply delay by this after each failure


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _has_visible_chars(text: str) -> bool:
    if not text:
        return False
    cleaned = text.strip()
    if not cleaned:
        return False
    if _INVISIBLE_PATTERN.match(cleaned):
        return False
    return True


def get_display_name(user: Any) -> str:
    if user is None:
        return "Anonyme"

    candidates = []

    if isinstance(user, dict):
        candidates = [
            user.get('nickname', ''),
            user.get('display_name', ''),
            user.get('unique_id', ''),
            user.get('username', ''),
        ]
    else:
        for attr in ('nickname', 'display_name', 'unique_id', 'username'):
            if hasattr(user, attr):
                val = getattr(user, attr, None)
                if val is not None:
                    candidates.append(str(val))

    for candidate in candidates:
        if _has_visible_chars(candidate):
            return candidate.strip()

    return "Anonyme"


@dataclass
class TikTokComment:
    username: str
    display_name: str
    message: str
    timestamp: datetime
    user_id: str = ""
    profile_picture_url: str = ""


# ---------------------------------------------------------------------------
# TikTokClient
# ---------------------------------------------------------------------------

class TikTokClient:
    def __init__(self, username: str = None, simulate: bool = False):
        self.username      = username
        self.simulate      = simulate
        self.is_connected  = False
        self.on_comment: Optional[Callable] = None
        self.client        = None

        # Simulation internals
        self._simulation_task: Optional[asyncio.Task] = None
        self._simulation_mode  = False
        self._advanced_sim_active = False

        # Stats
        self._comment_count = 0
        self._connecting    = False   # True while a connect attempt is in flight
        self._retry_count   = 0
        self._last_error: Optional[str] = None
        self._connected_at: Optional[float] = None  # wall-clock epoch of last connect

        # Reconnect loop control
        self._stop_flag = False       # set by disconnect() to kill the retry loop
        self._reconnect_task: Optional[asyncio.Task] = None

    # -----------------------------------------------------------------------
    # Public API
    # -----------------------------------------------------------------------

    async def connect(self):
        """
        Entry-point called once by GameEngine.initialize().

        Simulation mode: starts the comment generator and returns immediately.
        Live mode:       starts the resilient reconnect loop in the background
                         (connect → on disconnect → retry with exponential backoff).
        """
        self._stop_flag = False

        if self.simulate:
            if self._advanced_sim_active:
                print("[MODE] Simulation avancee active - simulation de base desactivee")
                self.is_connected = True
                return
            print("[MODE] Simulation activee (--simulate)")
            await self._start_simulation()
            return

        if not self.username:
            print("[ERREUR] Aucun username TikTok fourni!")
            print("[ERREUR] Utilisez --tiktok <username> pour le mode reel")
            print("[ERREUR] Ou --simulate pour le mode simulation")
            self.is_connected = False
            self._last_error  = "No TikTok username provided"
            return

        print(f"[MODE] TikTok reel active pour @{self.username}")

        try:
            from TikTokLive import TikTokLiveClient  # noqa: F401 — import check only
        except ImportError:
            print("[ERREUR] Bibliotheque TikTokLive non installee!")
            print("[ERREUR] Installez avec: pip install TikTokLive")
            self.is_connected = False
            self._last_error  = "TikTokLive library not installed"
            return

        # Launch the resilient loop as a background task and return immediately.
        # TikTok connection proceeds in the background; game startup is never delayed.
        loop = asyncio.get_event_loop()
        self._reconnect_task = loop.create_task(self._resilient_connect_loop())

    async def disconnect(self):
        """Graceful shutdown: stop retry loop + simulation, disconnect the client."""
        self._stop_flag       = True
        self._simulation_mode = False

        # Cancel simulation task
        if self._simulation_task and not self._simulation_task.done():
            self._simulation_task.cancel()
            try:
                await self._simulation_task
            except asyncio.CancelledError:
                pass

        # Cancel reconnect loop
        if self._reconnect_task and not self._reconnect_task.done():
            self._reconnect_task.cancel()
            try:
                await self._reconnect_task
            except asyncio.CancelledError:
                pass

        # Disconnect the underlying TikTokLiveClient
        if self.client:
            try:
                await self.client.disconnect()
            except Exception:
                pass
            self.client = None

        self.is_connected  = False
        self._connecting   = False
        print(f"[TIKTOK] Deconnecte - {self._comment_count} commentaires recus au total")

    def set_comment_handler(self, handler: Callable):
        self.on_comment = handler

    def get_stats(self) -> dict:
        return {
            "connected":     self.is_connected,
            "connecting":    self._connecting,
            "retry_count":   self._retry_count,
            "last_error":    self._last_error,
            "simulation":    self._simulation_mode,
            "comment_count": self._comment_count,
            "username":      self.username,
            "connected_at":  self._connected_at,
        }

    # -----------------------------------------------------------------------
    # Resilient connect loop (live mode only)
    # -----------------------------------------------------------------------

    async def _resilient_connect_loop(self):
        """
        Background coroutine that keeps trying to connect to TikTok Live.

        On each attempt:
          - Builds a fresh TikTokLiveClient
          - Registers ConnectEvent / DisconnectEvent / CommentEvent handlers
          - Runs client.connect() until it raises or returns
          - On disconnect or error: waits with exponential backoff, then retries

        Stops when:
          - self._stop_flag is set (graceful shutdown)
          - 5 minutes of cumulative retry time have elapsed
        """
        delay          = _RETRY_BASE_DELAY
        deadline       = time.monotonic() + _RETRY_MAX_SECONDS

        while not self._stop_flag:
            if time.monotonic() > deadline:
                msg = f"[TIKTOK] Max retry time ({_RETRY_MAX_SECONDS}s) exceeded — giving up"
                print(msg)
                self._last_error  = f"Max retry time ({_RETRY_MAX_SECONDS}s) exceeded"
                self._connecting  = False
                break

            self._connecting = True
            attempt_no = self._retry_count + 1
            print(f"[TIKTOK] Connexion en cours a @{self.username}... (tentative {attempt_no})")

            connected_this_attempt = asyncio.Event()
            disconnected_this_attempt = asyncio.Event()

            try:
                from TikTokLive import TikTokLiveClient
                from TikTokLive.events import CommentEvent, ConnectEvent, DisconnectEvent

                self.client = TikTokLiveClient(unique_id=self.username)

                @self.client.on(ConnectEvent)
                async def on_connect(event: ConnectEvent):
                    print(f"[TIKTOK] Connecte au live de @{self.username} (tentative {attempt_no})")
                    self.is_connected  = True
                    self._connecting   = False
                    self._connected_at = time.time()
                    self._last_error   = None
                    delay = _RETRY_BASE_DELAY  # reset backoff on success
                    connected_this_attempt.set()

                @self.client.on(DisconnectEvent)
                async def on_disconnect(event: DisconnectEvent):
                    print("[TIKTOK] Deconnecte du live")
                    self.is_connected = False
                    disconnected_this_attempt.set()

                @self.client.on(CommentEvent)
                async def on_comment_event(event: CommentEvent):
                    self._comment_count += 1
                    raw_nickname = getattr(event.user, 'nickname', None) if event.user else None
                    display_name = get_display_name(event.user)
                    unique_id    = event.user.unique_id if hasattr(event.user, 'unique_id') else ""

                    avatar_url = ""
                    try:
                        avatar = getattr(event.user, 'avatar', None)
                        if avatar:
                            urls = getattr(avatar, 'urls', None)
                            if urls and len(urls) > 0:
                                avatar_url = urls[-1]
                    except Exception:
                        pass

                    print(f"[TIKTOK] raw_nickname={raw_nickname!r} display_name={display_name!r} comment={event.comment!r}")

                    comment = TikTokComment(
                        username=unique_id or display_name,
                        display_name=display_name,
                        message=event.comment,
                        timestamp=datetime.now(),
                        user_id=unique_id,
                        profile_picture_url=avatar_url,
                    )
                    if self.on_comment:
                        await self._safe_callback(self.on_comment, comment)

                # Run the client — blocks until disconnect or error
                client_task = asyncio.create_task(self.client.connect())

                # Wait until connected (or give up if stop requested)
                try:
                    conn_timeout = cfg.get('tiktok', 'connection_timeout', 15)
                    await asyncio.wait_for(connected_this_attempt.wait(), timeout=conn_timeout)
                except asyncio.TimeoutError:
                    print(f"[TIKTOK] Timeout connexion ({conn_timeout}s) — en attente en arriere-plan...")
                    # Don't cancel — keep running in case the server is slow

                # Wait until the client disconnects (or stop is requested)
                await disconnected_this_attempt.wait()

                # Clean up the client task
                if not client_task.done():
                    client_task.cancel()
                    try:
                        await client_task
                    except (asyncio.CancelledError, Exception):
                        pass

            except asyncio.CancelledError:
                # disconnect() cancelled us — exit cleanly
                self._connecting  = False
                self.is_connected = False
                raise

            except Exception as e:
                msg = str(e)
                print(f"[TIKTOK] Erreur connexion (tentative {attempt_no}): {msg}")
                self._last_error  = msg
                self.is_connected = False

            finally:
                self._connecting = False
                if self.client:
                    try:
                        await self.client.disconnect()
                    except Exception:
                        pass
                    self.client = None

            if self._stop_flag:
                break

            self._retry_count += 1
            wait = min(delay, _RETRY_MAX_DELAY)
            print(f"[TIKTOK] Nouvelle tentative dans {wait:.0f}s (retry #{self._retry_count})")
            try:
                await asyncio.sleep(wait)
            except asyncio.CancelledError:
                break
            delay = min(delay * _RETRY_BACKOFF, _RETRY_MAX_DELAY)

    # -----------------------------------------------------------------------
    # Simulation
    # -----------------------------------------------------------------------

    async def _start_simulation(self):
        self._simulation_mode = True
        self.is_connected     = True
        self._connected_at    = time.time()
        print("[SIMULATION] Mode simulation actif - generation de commentaires fictifs")
        self._simulation_task = asyncio.create_task(self._simulate_comments())

    async def _simulate_comments(self):
        import random
        fake_users = [
            {"display_name": "Jean Dupont \U0001f525", "unique_id": "jeandupont"},
            {"display_name": "\u2b50 Marie Claire \U0001f1eb\U0001f1f7", "unique_id": "marieclaire"},
            {"display_name": "El Kesolar \U0001f1e8\U0001f1f2\U0001f451", "unique_id": "elkesolar"},
            {"display_name": "Lucas \U0001f3ae Martin", "unique_id": "lucasmartin"},
            {"display_name": "christ.!\U0001f60d\U0001f923\U0001f198", "unique_id": "christfan"},
            {"display_name": "Thomas \U0001f1e8\U0001f1ee Petit \U0001f4aa", "unique_id": "thomaspetit"},
            {"display_name": "\U0001f338 Emma \U0001f1e7\U0001f1ea Dubois", "unique_id": "emmadubois"},
            {"display_name": "Hugo \U0001f1f8\U0001f1f3 Moreau", "unique_id": "hugomoreau"},
            {"display_name": "Lea \u2764\ufe0f Laurent \U0001f1ed\U0001f1f9", "unique_id": "lealaurent"},
            {"display_name": "Nathan \U0001f1e7\U0001f1f7\U0001f680", "unique_id": "nathanroux"},
        ]
        fake_answers = ["A", "B", "C", "D", "a", "b", "c", "d"]

        try:
            sim_min = cfg.get('tiktok', 'simulation_min_delay', 0.5)
            sim_max = cfg.get('tiktok', 'simulation_max_delay', 2.0)
            while self._simulation_mode:
                await asyncio.sleep(random.uniform(sim_min, sim_max))
                if not self._simulation_mode:
                    break

                user    = random.choice(fake_users)
                message = random.choice(fake_answers)
                self._comment_count += 1
                print(f"[SIMULATION] raw_nickname={user['display_name']!r} comment={message!r}")

                comment = TikTokComment(
                    username=user["unique_id"],
                    display_name=user["display_name"],
                    message=message,
                    timestamp=datetime.now(),
                    user_id=f"sim_{random.randint(1000, 9999)}",
                )
                if self.on_comment:
                    await self._safe_callback(self.on_comment, comment)
        except asyncio.CancelledError:
            pass

    # -----------------------------------------------------------------------
    # Internal helpers
    # -----------------------------------------------------------------------

    async def _safe_callback(self, callback: Callable, *args):
        try:
            result = callback(*args)
            if asyncio.iscoroutine(result):
                await result
        except Exception as e:
            print(f"[TIKTOK] Erreur callback: {e}")
