import random
from typing import List, Optional
from models import Question
from questionnaire_manager import QuestionnaireManager


class QuestionManager:
    def __init__(self, questionnaire_mgr: QuestionnaireManager = None):
        self.qm = questionnaire_mgr or QuestionnaireManager()
        self.questions: List[Question] = []
        self.used_questions: set = set()
        self.current_index: int = 0

    def load_from_questionnaire(self, questionnaire_id: int):
        self.questions = self.qm.get_questions_for_questionnaire(questionnaire_id, active_only=True)
        self.used_questions.clear()
        self.current_index = 0
        print(f"[QuestionManager] Loaded {len(self.questions)} questions from questionnaire {questionnaire_id}")

    def load_from_questionnaires(self, questionnaire_ids: List[int] = None):
        self.questions = []
        if questionnaire_ids:
            for qn_id in questionnaire_ids:
                qs = self.qm.get_questions_for_questionnaire(qn_id, active_only=True)
                self.questions.extend(qs)
        else:
            for qn in self.qm.get_active_questionnaires():
                self.questions.extend(qn.get_active_questions())
        self.used_questions.clear()
        self.current_index = 0
        print(f"[QuestionManager] Loaded {len(self.questions)} questions total")

    def get_questions_for_game(self, count: int = 10, shuffle: bool = True) -> List[Question]:
        available = [q for q in self.questions if q.id not in self.used_questions]

        if len(available) < count:
            self.used_questions.clear()
            available = self.questions.copy()

        if shuffle:
            random.shuffle(available)

        selected = available[:count]
        for q in selected:
            self.used_questions.add(q.id)

        self.current_index = 0
        return selected

    def get_all_active_questions(self) -> List[Question]:
        return [q for q in self.questions if q.active]

    def get_question_by_id(self, question_id: int) -> Optional[Question]:
        for q in self.questions:
            if q.id == question_id:
                return q
        return None

    def get_random_question(self) -> Optional[Question]:
        available = [q for q in self.questions if q.id not in self.used_questions]
        if not available:
            self.used_questions.clear()
            available = self.questions.copy()

        if available:
            question = random.choice(available)
            self.used_questions.add(question.id)
            return question
        return None

    def reset(self):
        self.used_questions.clear()
        self.current_index = 0

    def get_total_count(self) -> int:
        return len(self.questions)

    def get_questions_by_category(self, category: str) -> List[Question]:
        return [q for q in self.questions if q.category.lower() == category.lower()]

    def get_questions_by_difficulty(self, difficulty: int) -> List[Question]:
        return [q for q in self.questions if q.difficulty == difficulty]
