import asyncio
import math
import random
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable, List, Optional

from tiktok_client import TikTokComment
from models import GameState


@dataclass
class SimConfig:
    enabled: bool = True
    num_players: int = 80
    correct_rate: float = 0.62
    speed_profile: str = "normal"
    intensity: str = "normal"
    noise_enabled: bool = True
    x2_participation_rate: float = 0.35
    x2_late_rate: float = 0.15
    x2_spam_rate: float = 0.05


@dataclass
class SimPlayer:
    id: str
    display_name: str
    behavior: str
    delay_min: float
    delay_max: float
    response_probability: float


_BEHAVIOR_PROFILES = [
    ("fast",   0.15, 0.3,  1.5,  0.95),
    ("normal", 0.50, 1.5,  7.0,  0.72),
    ("slow",   0.25, 7.0,  14.0, 0.45),
    ("lurker", 0.10, 10.0, 18.0, 0.08),
]

_SPEED_MULTIPLIERS = {
    "slow": 1.8,
    "normal": 1.0,
    "fast": 0.45,
}

_INTENSITY_RATES = {
    "low": 0.40,
    "normal": 0.65,
    "high": 0.90,
}

_FAKE_NAMES = [
    "Jean_Dupont", "Marie_Claire", "Lucas_Martin", "Emma_Dubois",
    "Hugo_Moreau", "Lea_Laurent", "Nathan_Roux", "Camille_Petit",
    "Antoine_Bernard", "Chloe_Thomas", "Maxime_Richard", "Juliette_Simon",
    "Alexandre_Michel", "Manon_Lefevre", "Theo_Garcia", "Pauline_David",
    "Romain_Martinez", "Amelie_Robert", "Florian_Blanc", "Oceane_Henry",
    "Bastien_Moreau", "Elisa_Fournier", "Kevin_Girard", "Sophie_Bonnet",
    "Damien_Morin", "Laetitia_Rousseau", "Julien_Vincent", "Noemie_Mercier",
    "Quentin_Dupuis", "Clara_Bertin",
]

_NOISE_WORDS = ["lol", "gg", "super", "wsh", "omg", "ok", "yes", "non", "???", "!!!"]


def _build_player_pool(num_players: int) -> List[SimPlayer]:
    players = []
    names = list(_FAKE_NAMES)
    random.shuffle(names)
    while len(names) < num_players:
        names.extend([f"user_{i}" for i in range(num_players)])

    idx = 0
    for behavior, ratio, dmin, dmax, prob in _BEHAVIOR_PROFILES:
        count = max(1, int(num_players * ratio))
        for _ in range(count):
            name = names[idx % len(names)]
            idx += 1
            player = SimPlayer(
                id=f"sim_{name.lower()}_{idx}",
                display_name=name.replace("_", " "),
                behavior=behavior,
                delay_min=dmin,
                delay_max=dmax,
                response_probability=prob,
            )
            players.append(player)
            if len(players) >= num_players:
                break
        if len(players) >= num_players:
            break

    return players[:num_players]


def _sample_delay(dmin: float, dmax: float, speed_multiplier: float) -> float:
    mu = math.log((dmin + dmax) / 2)
    sigma = 0.5
    raw = random.lognormvariate(mu, sigma)
    raw = raw * speed_multiplier
    return max(dmin * speed_multiplier, min(dmax * speed_multiplier, raw))


class AdvancedSimulator:
    def __init__(self, config: SimConfig, callback: Callable, get_state: Callable, get_token: Callable):
        self._config = config
        self._callback = callback
        self._get_state = get_state
        self._get_token = get_token
        self._players: List[SimPlayer] = []
        self._wave_tasks: List[asyncio.Task] = []
        self._current_phase_token: int = -1
        self._answered_this_wave: set = set()

    def start_session(self):
        self._players = _build_player_pool(self._config.num_players)
        print(f"[SIM] Player pool built: {len(self._players)} players")

    def notify_phase(self, state: GameState, phase_token: int):
        self._cancel_wave()
        self._current_phase_token = phase_token
        self._answered_this_wave = set()

        if state == GameState.COLLECTING_ANSWERS:
            self._launch_wave(phase_token)
        elif state == GameState.DOUBLE_OPEN:
            self._launch_x2_wave(phase_token)

    def _cancel_wave(self):
        for task in self._wave_tasks:
            if not task.done():
                task.cancel()
        self._wave_tasks.clear()

    def _launch_wave(self, phase_token: int):
        intensity_rate = _INTENSITY_RATES.get(self._config.intensity, 0.65)
        speed_mul = _SPEED_MULTIPLIERS.get(self._config.speed_profile, 1.0)

        participating = [p for p in self._players if random.random() < intensity_rate]

        for player in participating:
            if random.random() > player.response_probability:
                continue

            delay = _sample_delay(player.delay_min, player.delay_max, speed_mul)
            task = asyncio.create_task(
                self._inject_answer(player, delay, phase_token)
            )
            self._wave_tasks.append(task)

        print(f"[SIM] Wave launched: {len(self._wave_tasks)} players scheduled")

    async def _inject_answer(self, player: SimPlayer, delay: float, phase_token: int):
        try:
            await asyncio.sleep(delay)

            if self._get_state() != GameState.COLLECTING_ANSWERS:
                return
            if self._get_token() != phase_token:
                return
            if player.id in self._answered_this_wave:
                return

            roll = random.random()
            if self._config.noise_enabled and roll < 0.05:
                message = random.choice(_NOISE_WORDS)
            elif self._config.noise_enabled and roll < 0.08:
                if player.id in self._answered_this_wave:
                    return
                message = random.choice(["A", "B", "C", "D"])
            else:
                if random.random() < self._config.correct_rate:
                    message = "A"
                else:
                    choices = ["A", "B", "C", "D"]
                    message = random.choice(choices)

            self._answered_this_wave.add(player.id)

            comment = TikTokComment(
                username=player.id,
                display_name=player.display_name,
                message=message,
                timestamp=datetime.now(),
                user_id=player.id,
                profile_picture_url="",
            )

            await self._callback(comment)

        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"[SIM] Inject error for {player.id}: {e}")

    def _launch_x2_wave(self, phase_token: int):
        cfg = self._config
        speed_mul = _SPEED_MULTIPLIERS.get(cfg.speed_profile, 1.0)
        scheduled = 0
        print(f"[SIM X2] X2 wave starting: total_players={len(self._players)} participation_rate={cfg.x2_participation_rate} phase_token={phase_token}")

        for player in self._players:
            roll = random.random()
            if roll >= cfg.x2_participation_rate:
                continue

            is_late = random.random() < cfg.x2_late_rate
            if is_late:
                delay = random.uniform(5.0 * speed_mul, 12.0 * speed_mul)
            else:
                delay = _sample_delay(player.delay_min, player.delay_max, speed_mul)

            print(f"[SIM X2] Scheduling X2 for player={player.id!r} delay={delay:.2f}s late={is_late}")
            task = asyncio.create_task(
                self._inject_x2(player, delay, phase_token, spam=False)
            )
            self._wave_tasks.append(task)
            scheduled += 1

            if random.random() < cfg.x2_spam_rate:
                spam_delay = delay + random.uniform(0.5, 2.0)
                task2 = asyncio.create_task(
                    self._inject_x2(player, spam_delay, phase_token, spam=True)
                )
                self._wave_tasks.append(task2)

        print(f"[SIM X2] X2 wave launched: {scheduled} players chosen out of {len(self._players)}")

    async def _inject_x2(self, player: SimPlayer, delay: float, phase_token: int, spam: bool):
        try:
            await asyncio.sleep(delay)

            current_state = self._get_state()
            current_token = self._get_token()
            if current_state != GameState.DOUBLE_OPEN:
                if not spam:
                    print(f"[SIM X2] Injection cancelled (state={current_state!r} expected=DOUBLE_OPEN) player={player.id!r}")
                return
            if current_token != phase_token:
                if not spam:
                    print(f"[SIM X2] Injection cancelled (token mismatch: got={current_token} expected={phase_token}) player={player.id!r}")
                return

            comment = TikTokComment(
                username=player.id,
                display_name=player.display_name,
                message="X2",
                timestamp=datetime.now(),
                user_id=player.id,
                profile_picture_url="",
            )

            if spam:
                print(f"[SIM X2] Spam X2 injected by player={player.id!r}")
            else:
                print(f"[SIM X2] Injecting X2 comment: player={player.id!r} msg='X2'")
            await self._callback(comment)

        except asyncio.CancelledError:
            if not spam:
                print(f"[SIM X2] Injection task cancelled for player={player.id!r}")
        except Exception as e:
            print(f"[SIM X2] Inject error for player={player.id!r}: {e}")

    async def stop(self):
        self._cancel_wave()
        print("[SIM] Stopped")
