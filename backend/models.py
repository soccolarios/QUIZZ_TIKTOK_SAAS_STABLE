from dataclasses import dataclass, field
from typing import Optional, List
from datetime import datetime
from enum import Enum

import config_loader as cfg


class GameState(Enum):
    IDLE = "idle"
    SHOWING_QUESTION = "showing_question"
    COLLECTING_ANSWERS = "collecting_answers"
    SHOWING_RESULT = "showing_result"
    SHOWING_LEADERBOARD = "showing_leaderboard"
    COUNTDOWN = "countdown"
    QUESTIONNAIRE_TRANSITION = "questionnaire_transition"
    GAME_END = "game_end"
    PAUSED = "paused"
    DOUBLE_OPEN = "double_open"
    DOUBLE_SHOW = "double_show"
    DOUBLE_RESULT = "double_result"


class PlayMode(Enum):
    SINGLE = "single"
    SEQUENTIAL = "sequential"
    INFINITE_ALL = "infinite_all"
    INFINITE_SINGLE = "infinite_single"


class QuestionType(Enum):
    STANDARD = "standard"
    DOUBLE = "double"


@dataclass
class Question:
    id: int
    text: str
    choices: dict
    correct_answer: str
    category: str = "general"
    difficulty: int = 1
    question_type: str = "standard"
    correct_answers: List[str] = field(default_factory=list)
    active: bool = True

    def __post_init__(self):
        if self.question_type == "double" and not self.correct_answers:
            self.correct_answers = [self.correct_answer]
        elif self.question_type == "standard":
            self.correct_answers = [self.correct_answer]

    def is_correct(self, answer: str) -> bool:
        if self.question_type == "double":
            return answer.upper() in [a.upper() for a in self.correct_answers]
        return answer.upper() == self.correct_answer.upper()

    def is_double(self) -> bool:
        return self.question_type == "double"


@dataclass
class Questionnaire:
    id: int
    name: str
    description: str = ""
    category: str = ""
    active: bool = True
    order: int = 0
    questions: List[Question] = field(default_factory=list)

    def get_active_questions(self) -> List[Question]:
        return [q for q in self.questions if q.active]

    def question_count(self) -> int:
        return len(self.questions)

    def active_question_count(self) -> int:
        return len(self.get_active_questions())


@dataclass
class Player:
    username: str
    score: int = 0
    correct_answers: int = 0
    total_answers: int = 0
    last_answer_time: Optional[datetime] = None

    @property
    def accuracy(self) -> float:
        if self.total_answers == 0:
            return 0.0
        return (self.correct_answers / self.total_answers) * 100


@dataclass
class PlayerAnswer:
    username: str
    display_name: str
    answer: str
    timestamp: datetime
    question_id: int
    is_correct: bool = False
    points_earned: int = 0
    response_time_ms: int = 0


@dataclass
class QuestionResult:
    question: Question
    correct_answer: str
    answer_counts: dict = field(default_factory=dict)
    total_answers: int = 0
    winners: list = field(default_factory=list)
    percentages: dict = field(default_factory=dict)


def _game_defaults():
    return cfg.get_section('game')

@dataclass
class GameConfig:
    question_time: int = None
    countdown_time: int = None
    total_questions: int = 0
    base_points: int = None
    speed_bonus_max: int = None
    min_answer_delay: float = None
    tiktok_delay: int = None
    play_mode: str = "single"
    questionnaire_id: int = None
    questionnaire_ids: List[int] = field(default_factory=list)
    x2_enabled: bool = None
    x2_frequency: str = None
    x2_max_displayed: int = None

    def __post_init__(self):
        defaults = _game_defaults()
        if self.question_time is None:
            self.question_time = defaults.get('question_time', 20)
        if self.countdown_time is None:
            self.countdown_time = defaults.get('countdown_time', 10)
        if self.base_points is None:
            self.base_points = defaults.get('base_points', 100)
        if self.speed_bonus_max is None:
            self.speed_bonus_max = defaults.get('speed_bonus_max', 50)
        if self.min_answer_delay is None:
            self.min_answer_delay = defaults.get('min_answer_delay', 1.0)
        if self.tiktok_delay is None:
            self.tiktok_delay = defaults.get('tiktok_delay', 4)
        if self.x2_enabled is None:
            self.x2_enabled = defaults.get('x2_enabled', False)
        if self.x2_frequency is None:
            self.x2_frequency = str(defaults.get('x2_frequency', 3))
        if self.x2_max_displayed is None:
            self.x2_max_displayed = defaults.get('x2_max_displayed', 10)

    def get_play_mode(self) -> PlayMode:
        try:
            return PlayMode(self.play_mode)
        except ValueError:
            return PlayMode.SINGLE


@dataclass
class WebSocketMessage:
    type: str
    data: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "type": self.type,
            "data": self.data
        }
