import json
import os
import copy
import hashlib
import re
import tempfile
from datetime import datetime
from typing import List, Optional, Dict
from models import Question, Questionnaire


DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'questionnaires')
META_FILE = os.path.join(DATA_DIR, 'meta.json')
LEGACY_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'questionnaires.json')


class QuestionnaireManager:
    def __init__(self, data_dir: str = None):
        self.data_dir = data_dir or DATA_DIR
        self.meta_file = os.path.join(self.data_dir, 'meta.json')
        self.questionnaires: List[Questionnaire] = []
        self.meta: Dict = {}
        self._ensure_data_dir()
        self._migrate_legacy()
        self.load()

    def _ensure_data_dir(self):
        os.makedirs(self.data_dir, exist_ok=True)

    def _migrate_legacy(self):
        if os.path.exists(self.meta_file):
            return
        legacy = LEGACY_FILE
        if not os.path.exists(legacy):
            return
        try:
            with open(legacy, 'r', encoding='utf-8') as f:
                raw = json.load(f)
            meta = raw.get('meta', {})
            for qn_data in raw.get('questionnaires', []):
                qn_id = qn_data.get('id', 0)
                filename = self._make_filename(qn_data.get('name', f'questionnaire_{qn_id}'), qn_id)
                filepath = os.path.join(self.data_dir, filename)
                self._atomic_write(filepath, qn_data)
            self._save_meta(meta)
            print(f"[QuestionnaireManager] Migrated {len(raw.get('questionnaires', []))} questionnaires from legacy file")
        except (json.JSONDecodeError, IOError) as e:
            print(f"[QuestionnaireManager] Legacy migration error: {e}")

    def _make_filename(self, name: str, qn_id: int) -> str:
        slug = re.sub(r'[^a-z0-9]+', '_', name.lower().strip())
        slug = slug.strip('_')[:40]
        return f"{qn_id}_{slug}.json"

    def _get_filepath(self, qn_id: int) -> Optional[str]:
        for fname in os.listdir(self.data_dir):
            if fname == 'meta.json':
                continue
            if fname.startswith(f"{qn_id}_") and fname.endswith('.json'):
                return os.path.join(self.data_dir, fname)
        return None

    def load(self):
        try:
            if os.path.exists(self.meta_file):
                with open(self.meta_file, 'r', encoding='utf-8') as f:
                    self.meta = json.load(f)
            else:
                self._init_empty()

            self.questionnaires = []
            for fname in sorted(os.listdir(self.data_dir)):
                if fname == 'meta.json' or not fname.endswith('.json'):
                    continue
                filepath = os.path.join(self.data_dir, fname)
                try:
                    with open(filepath, 'r', encoding='utf-8') as f:
                        qn_data = json.load(f)
                    qn = self._parse_questionnaire(qn_data)
                    self.questionnaires.append(qn)
                except (json.JSONDecodeError, IOError) as e:
                    print(f"[QuestionnaireManager] Error loading {fname}: {e}")

            print(f"[QuestionnaireManager] Loaded {len(self.questionnaires)} questionnaires")
        except IOError as e:
            print(f"[QuestionnaireManager] Load error: {e}")
            self._init_empty()

    def _init_empty(self):
        self.meta = {"version": 2, "next_questionnaire_id": 1, "next_question_id": 1}
        self.questionnaires = []

    def _parse_questionnaire(self, data: dict) -> Questionnaire:
        questions = []
        for q_data in data.get('questions', []):
            q = Question(
                id=q_data.get('id', 0),
                text=q_data.get('text', ''),
                choices=q_data.get('choices', {}),
                correct_answer=q_data.get('correct_answer', 'A').upper(),
                category=q_data.get('category', 'general'),
                difficulty=q_data.get('difficulty', 1),
                question_type=q_data.get('type', 'standard'),
                correct_answers=[a.upper() for a in q_data.get('correct_answers', [])],
                active=q_data.get('active', True)
            )
            questions.append(q)
        return Questionnaire(
            id=data.get('id', 0),
            name=data.get('name', ''),
            description=data.get('description', ''),
            category=data.get('category', ''),
            active=data.get('active', True),
            order=data.get('order', 0),
            questions=questions
        )

    def _atomic_write(self, target_path: str, data: dict):
        dir_path = os.path.dirname(target_path)
        os.makedirs(dir_path, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(dir=dir_path, suffix='.tmp')
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp_path, target_path)
        except Exception:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise

    def _save_meta(self, meta: Dict = None):
        m = meta or self.meta
        m['last_modified'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        self._atomic_write(self.meta_file, m)
        if meta is None:
            self.meta = m

    def _save_questionnaire(self, qn: Questionnaire):
        old_path = self._get_filepath(qn.id)
        new_filename = self._make_filename(qn.name, qn.id)
        new_path = os.path.join(self.data_dir, new_filename)
        data = self._serialize_questionnaire(qn)
        self._atomic_write(new_path, data)
        if old_path and old_path != new_path and os.path.exists(old_path):
            os.remove(old_path)

    def _delete_questionnaire_file(self, qn_id: int):
        path = self._get_filepath(qn_id)
        if path and os.path.exists(path):
            os.remove(path)

    def save(self):
        self._save_meta()
        for qn in self.questionnaires:
            self._save_questionnaire(qn)

    def _serialize_questionnaire(self, qn: Questionnaire) -> dict:
        return {
            "id": qn.id,
            "name": qn.name,
            "description": qn.description,
            "category": qn.category,
            "active": qn.active,
            "order": qn.order,
            "questions": [self._serialize_question(q) for q in qn.questions]
        }

    def _serialize_question(self, q: Question) -> dict:
        d = {
            "id": q.id,
            "text": q.text,
            "type": q.question_type,
            "choices": q.choices,
            "correct_answer": q.correct_answer,
            "category": q.category,
            "difficulty": q.difficulty,
            "active": q.active
        }
        if q.question_type == "double":
            d["correct_answers"] = q.correct_answers
        return d

    def _next_questionnaire_id(self) -> int:
        nid = self.meta.get('next_questionnaire_id', 1)
        self.meta['next_questionnaire_id'] = nid + 1
        return nid

    def _next_question_id(self) -> int:
        nid = self.meta.get('next_question_id', 1)
        self.meta['next_question_id'] = nid + 1
        return nid

    def list_questionnaires(self, include_inactive: bool = True) -> List[dict]:
        result = []
        for qn in sorted(self.questionnaires, key=lambda x: x.order):
            if not include_inactive and not qn.active:
                continue
            result.append({
                "id": qn.id,
                "name": qn.name,
                "description": qn.description,
                "category": qn.category,
                "active": qn.active,
                "order": qn.order,
                "question_count": qn.question_count(),
                "active_question_count": qn.active_question_count()
            })
        return result

    def get_questionnaire(self, qn_id: int) -> Optional[Questionnaire]:
        for qn in self.questionnaires:
            if qn.id == qn_id:
                return qn
        return None

    def create_questionnaire(self, name: str, description: str = "", category: str = "") -> Questionnaire:
        name = name.strip()
        if not name:
            raise ValueError("Le nom du questionnaire est obligatoire")
        qn = Questionnaire(
            id=self._next_questionnaire_id(),
            name=name,
            description=description,
            category=category,
            active=True,
            order=len(self.questionnaires) + 1
        )
        self.questionnaires.append(qn)
        self._save_questionnaire(qn)
        self._save_meta()
        return qn

    def update_questionnaire(self, qn_id: int, **kwargs) -> Optional[Questionnaire]:
        qn = self.get_questionnaire(qn_id)
        if not qn:
            return None
        for key in ['name', 'description', 'category', 'active', 'order']:
            if key in kwargs:
                val = kwargs[key]
                if key == 'name':
                    val = val.strip()
                    if not val:
                        raise ValueError("Le nom du questionnaire est obligatoire")
                setattr(qn, key, val)
        self._save_questionnaire(qn)
        self._save_meta()
        return qn

    def delete_questionnaire(self, qn_id: int) -> bool:
        before = len(self.questionnaires)
        self._delete_questionnaire_file(qn_id)
        self.questionnaires = [qn for qn in self.questionnaires if qn.id != qn_id]
        if len(self.questionnaires) < before:
            self._save_meta()
            return True
        return False

    def duplicate_questionnaire(self, qn_id: int) -> Optional[Questionnaire]:
        source = self.get_questionnaire(qn_id)
        if not source:
            return None
        new_qn = Questionnaire(
            id=self._next_questionnaire_id(),
            name=f"{source.name} (copie)",
            description=source.description,
            category=source.category,
            active=True,
            order=len(self.questionnaires) + 1,
            questions=[]
        )
        for q in source.questions:
            new_q = copy.deepcopy(q)
            new_q.id = self._next_question_id()
            new_qn.questions.append(new_q)
        self.questionnaires.append(new_qn)
        self._save_questionnaire(new_qn)
        self._save_meta()
        return new_qn

    def reorder_questionnaires(self, ordered_ids: List[int]):
        id_map = {qn.id: qn for qn in self.questionnaires}
        for i, qn_id in enumerate(ordered_ids):
            if qn_id in id_map:
                id_map[qn_id].order = i + 1
        for qn in self.questionnaires:
            self._save_questionnaire(qn)
        self._save_meta()

    def export_questionnaire(self, qn_id: int) -> Optional[dict]:
        qn = self.get_questionnaire(qn_id)
        if not qn:
            return None
        return self._serialize_questionnaire(qn)

    def add_question(self, qn_id: int, text: str, choices: dict, correct_answer: str,
                     category: str = "general", difficulty: int = 1,
                     question_type: str = "standard", correct_answers: List[str] = None) -> Optional[Question]:
        qn = self.get_questionnaire(qn_id)
        if not qn:
            return None
        errors = self._validate_question_data(text, choices, correct_answer, question_type, correct_answers)
        if errors:
            raise ValueError("; ".join(errors))
        q = Question(
            id=self._next_question_id(),
            text=text.strip(),
            choices=choices,
            correct_answer=correct_answer.upper(),
            category=category,
            difficulty=difficulty,
            question_type=question_type,
            correct_answers=[a.upper() for a in (correct_answers or [correct_answer])],
            active=True
        )
        qn.questions.append(q)
        self._save_questionnaire(qn)
        self._save_meta()
        return q

    def update_question(self, qn_id: int, q_id: int, **kwargs) -> Optional[Question]:
        qn = self.get_questionnaire(qn_id)
        if not qn:
            return None
        for q in qn.questions:
            if q.id == q_id:
                if 'text' in kwargs:
                    q.text = kwargs['text'].strip()
                if 'choices' in kwargs:
                    q.choices = kwargs['choices']
                if 'correct_answer' in kwargs:
                    q.correct_answer = kwargs['correct_answer'].upper()
                if 'category' in kwargs:
                    q.category = kwargs['category']
                if 'difficulty' in kwargs:
                    q.difficulty = kwargs['difficulty']
                if 'question_type' in kwargs:
                    q.question_type = kwargs['question_type']
                if 'correct_answers' in kwargs:
                    q.correct_answers = [a.upper() for a in kwargs['correct_answers']]
                if 'active' in kwargs:
                    q.active = kwargs['active']
                self._save_questionnaire(qn)
                self._save_meta()
                return q
        return None

    def delete_question(self, qn_id: int, q_id: int) -> bool:
        qn = self.get_questionnaire(qn_id)
        if not qn:
            return False
        before = len(qn.questions)
        qn.questions = [q for q in qn.questions if q.id != q_id]
        if len(qn.questions) < before:
            self._save_questionnaire(qn)
            self._save_meta()
            return True
        return False

    def duplicate_question(self, qn_id: int, q_id: int) -> Optional[Question]:
        qn = self.get_questionnaire(qn_id)
        if not qn:
            return None
        source = None
        source_idx = -1
        for i, q in enumerate(qn.questions):
            if q.id == q_id:
                source = q
                source_idx = i
                break
        if not source:
            return None
        new_q = copy.deepcopy(source)
        new_q.id = self._next_question_id()
        qn.questions.insert(source_idx + 1, new_q)
        self._save_questionnaire(qn)
        self._save_meta()
        return new_q

    def move_question(self, from_qn_id: int, to_qn_id: int, q_id: int) -> bool:
        from_qn = self.get_questionnaire(from_qn_id)
        to_qn = self.get_questionnaire(to_qn_id)
        if not from_qn or not to_qn:
            return False
        question = None
        for q in from_qn.questions:
            if q.id == q_id:
                question = q
                break
        if not question:
            return False
        from_qn.questions = [q for q in from_qn.questions if q.id != q_id]
        to_qn.questions.append(question)
        self._save_questionnaire(from_qn)
        self._save_questionnaire(to_qn)
        self._save_meta()
        return True

    def reorder_questions(self, qn_id: int, ordered_ids: List[int]):
        qn = self.get_questionnaire(qn_id)
        if not qn:
            return
        id_map = {q.id: q for q in qn.questions}
        reordered = []
        for q_id in ordered_ids:
            if q_id in id_map:
                reordered.append(id_map.pop(q_id))
        for q in id_map.values():
            reordered.append(q)
        qn.questions = reordered
        self._save_questionnaire(qn)
        self._save_meta()

    def import_questionnaire(self, data: dict, merge_into_id: int = None,
                             mode: str = "add") -> dict:
        report = {"imported": 0, "ignored": 0, "invalid": 0, "duplicates": 0, "errors": []}

        if merge_into_id:
            return self._import_questions_into(merge_into_id, data.get('questions', []), mode, report)

        name = data.get('name', '').strip()
        if not name:
            report['errors'].append("Nom du questionnaire manquant")
            return report

        qn = Questionnaire(
            id=self._next_questionnaire_id(),
            name=name,
            description=data.get('description', ''),
            category=data.get('category', ''),
            active=True,
            order=len(self.questionnaires) + 1,
            questions=[]
        )

        for q_data in data.get('questions', []):
            errors = self._validate_question_data(
                q_data.get('text', ''),
                q_data.get('choices', {}),
                q_data.get('correct_answer', ''),
                q_data.get('type', 'standard'),
                q_data.get('correct_answers')
            )
            if errors:
                report['invalid'] += 1
                report['errors'].append(f"Question invalide: {'; '.join(errors)}")
                continue

            q = Question(
                id=self._next_question_id(),
                text=q_data.get('text', '').strip(),
                choices=q_data.get('choices', {}),
                correct_answer=q_data.get('correct_answer', 'A').upper(),
                category=q_data.get('category', 'general'),
                difficulty=q_data.get('difficulty', 1),
                question_type=q_data.get('type', 'standard'),
                correct_answers=[a.upper() for a in q_data.get('correct_answers', [q_data.get('correct_answer', 'A')])],
                active=q_data.get('active', True)
            )
            qn.questions.append(q)
            report['imported'] += 1

        if report['imported'] > 0:
            self.questionnaires.append(qn)
            self._save_questionnaire(qn)
            self._save_meta()

        return report

    def _import_questions_into(self, qn_id: int, questions_data: list,
                               mode: str, report: dict) -> dict:
        qn = self.get_questionnaire(qn_id)
        if not qn:
            report['errors'].append("Questionnaire cible introuvable")
            return report

        existing_hashes = set()
        for q in qn.questions:
            existing_hashes.add(self._question_hash(q.text, q.choices))

        if mode == "replace":
            qn.questions.clear()
            existing_hashes.clear()

        for q_data in questions_data:
            errors = self._validate_question_data(
                q_data.get('text', ''),
                q_data.get('choices', {}),
                q_data.get('correct_answer', ''),
                q_data.get('type', 'standard'),
                q_data.get('correct_answers')
            )
            if errors:
                report['invalid'] += 1
                report['errors'].append(f"Question invalide: {'; '.join(errors)}")
                continue

            h = self._question_hash(q_data.get('text', ''), q_data.get('choices', {}))
            if h in existing_hashes:
                report['duplicates'] += 1
                report['ignored'] += 1
                continue

            q = Question(
                id=self._next_question_id(),
                text=q_data.get('text', '').strip(),
                choices=q_data.get('choices', {}),
                correct_answer=q_data.get('correct_answer', 'A').upper(),
                category=q_data.get('category', 'general'),
                difficulty=q_data.get('difficulty', 1),
                question_type=q_data.get('type', 'standard'),
                correct_answers=[a.upper() for a in q_data.get('correct_answers', [q_data.get('correct_answer', 'A')])],
                active=q_data.get('active', True)
            )
            qn.questions.append(q)
            existing_hashes.add(h)
            report['imported'] += 1

        self._save_questionnaire(qn)
        self._save_meta()
        return report

    def _question_hash(self, text: str, choices: dict) -> str:
        normalized = text.strip().lower() + json.dumps(choices, sort_keys=True).lower()
        return hashlib.md5(normalized.encode()).hexdigest()

    def _validate_question_data(self, text: str, choices: dict, correct_answer: str,
                                question_type: str = "standard",
                                correct_answers: List[str] = None) -> List[str]:
        errors = []
        if not text or not text.strip():
            errors.append("Le texte de la question est vide")
        if not choices or not isinstance(choices, dict):
            errors.append("Les choix sont invalides")
        elif len(choices) < 2:
            errors.append("Il faut au moins 2 choix")
        else:
            for key, val in choices.items():
                if not val or not str(val).strip():
                    errors.append(f"Le choix {key} est vide")
        valid_letters = set(choices.keys()) if choices else set()
        if correct_answer and correct_answer.upper() not in valid_letters:
            errors.append(f"La reponse correcte '{correct_answer}' ne correspond a aucun choix")
        if question_type == "double":
            if not correct_answers or len(correct_answers) < 2:
                errors.append("Une question double doit avoir au moins 2 reponses correctes")
            elif correct_answers:
                for a in correct_answers:
                    if a.upper() not in valid_letters:
                        errors.append(f"La reponse correcte '{a}' ne correspond a aucun choix")
        return errors

    def get_questions_for_questionnaire(self, qn_id: int, active_only: bool = True) -> List[Question]:
        qn = self.get_questionnaire(qn_id)
        if not qn:
            return []
        if active_only:
            return qn.get_active_questions()
        return qn.questions

    def get_active_questionnaires(self) -> List[Questionnaire]:
        return sorted(
            [qn for qn in self.questionnaires if qn.active],
            key=lambda x: x.order
        )

    def search_questions(self, qn_id: int, query: str) -> List[Question]:
        qn = self.get_questionnaire(qn_id)
        if not qn:
            return []
        query_lower = query.lower()
        return [q for q in qn.questions
                if query_lower in q.text.lower()
                or query_lower in q.category.lower()
                or any(query_lower in str(v).lower() for v in q.choices.values())]
