import re
import random
from dataclasses import dataclass, field
from typing import Dict, Optional

import config_loader as cfg


@dataclass
class DoubleOrNothingState:
    active: bool = False
    registered: Dict[str, str] = field(default_factory=dict)
    successful: list = field(default_factory=list)
    failed: list = field(default_factory=list)
    missed: list = field(default_factory=list)


class DoubleOrNothingManager:
    def __init__(self, config):
        self.config = config
        self.state = DoubleOrNothingState()
        self._X2_PATTERN = re.compile(r'\bx2\b', re.IGNORECASE)
        self._next_trigger: Optional[int] = None

    @property
    def participant_count(self) -> int:
        return len(self.state.registered)

    def _compute_next_trigger(self) -> int:
        freq = str(self.config.x2_frequency).strip()
        if freq == 'random':
            rmin = cfg.get('x2', 'frequency_random_min', 2)
            rmax = cfg.get('x2', 'frequency_random_max', 5)
            return random.randint(int(rmin), int(rmax))
        try:
            return int(freq)
        except (ValueError, TypeError):
            return 3

    def should_trigger(self, question_index: int) -> bool:
        print(f"[X2 DEBUG] enabled={self.config.x2_enabled}, index={question_index}, next={self._next_trigger}")
        if not self.config.x2_enabled:
            if question_index == 0:
                print(f"[X2] disabled in config (x2_enabled={self.config.x2_enabled!r})")
            return False
        if self._next_trigger is None:
            freq = self._compute_next_trigger()
            self._next_trigger = question_index + freq - 1
            print(f"[X2] initialized: freq={freq}, first trigger at index={self._next_trigger}")
            print(f"[X2 DEBUG] computed next_trigger={self._next_trigger}")
        result = question_index == self._next_trigger
        if result:
            self._next_trigger = question_index + self._compute_next_trigger()
            print(f"[X2 DEBUG] computed next_trigger={self._next_trigger}")
            print("[X2 DEBUG] TRIGGER TRUE")
        print(f"[X2] should_trigger(index={question_index}, next={self._next_trigger}) -> {result}")
        return result

    def open_collection(self):
        self.state.active = True
        self.state.registered.clear()

    def close_collection(self):
        self.state.active = False

    def try_register(self, username: str, display_name: str) -> bool:
        if not self.state.active:
            print(f"[X2 REGISTER] Rejected (collection not active): user={username!r}")
            return False
        if username in self.state.registered:
            print(f"[X2 REGISTER] Rejected (duplicate): user={username!r}")
            return False
        self.state.registered[username] = display_name
        print(f"[X2 REGISTER] Accepted: user={username!r} display={display_name!r} total={len(self.state.registered)}")
        return True

    def is_registered(self, username: str) -> bool:
        return username in self.state.registered

    def process_results(self, current_answers: dict):
        self.state.successful.clear()
        self.state.failed.clear()
        self.state.missed.clear()

        for username, pa in current_answers.items():
            if username in self.state.registered:
                if pa.is_correct:
                    self.state.successful.append(username)
                else:
                    self.state.failed.append(username)
            else:
                if pa.is_correct:
                    self.state.missed.append(username)

    def get_score_multiplier(self, username: str) -> float:
        if username in self.state.successful:
            return 2.0
        if username in self.state.failed:
            return 0.0
        return 1.0

    def get_registered_list(self) -> list:
        max_disp = self.config.x2_max_displayed
        items = list(self.state.registered.items())
        if max_disp > 0:
            items = items[:max_disp]
        return [{"username": u, "display_name": d} for u, d in items]

    def reset_cycle(self):
        print(f"[X2 DEBUG] reset_cycle called: next_trigger was {self._next_trigger}")
        self.state = DoubleOrNothingState()

    def reset(self):
        print(f"[X2 DEBUG] reset called: next_trigger was {self._next_trigger}")
        self.state = DoubleOrNothingState()
        self._next_trigger = None
