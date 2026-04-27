import hashlib
import json
import logging
import os
import re
import threading
import time
import unicodedata
import uuid
from dataclasses import dataclass, field
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

FINGERPRINTS_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'question_fingerprints.json')

OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'


@dataclass
class GenerationConfig:
    theme: str
    category: str
    difficulty: int = 2
    count: int = 10
    language: str = 'fr'
    target_audience: str = 'general'
    style: str = 'standard'
    subcategory: str = ''


@dataclass
class GenerationJob:
    job_id: str
    config: GenerationConfig
    status: str = 'pending'
    progress: int = 0
    total: int = 0
    candidates: List[dict] = field(default_factory=list)
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None
    stats: dict = field(default_factory=dict)


class QuestionNormalizer:
    @staticmethod
    def normalize(text: str) -> str:
        text = text.lower().strip()
        text = unicodedata.normalize('NFD', text)
        text = ''.join(c for c in text if unicodedata.category(c) != 'Mn')
        text = re.sub(r'[^\w\s]', ' ', text)
        text = re.sub(r'\s+', ' ', text).strip()
        return text

    @staticmethod
    def tokenize(text: str) -> set:
        normalized = QuestionNormalizer.normalize(text)
        return {w for w in normalized.split() if len(w) > 3}

    @staticmethod
    def jaccard(set_a: set, set_b: set) -> float:
        if not set_a and not set_b:
            return 1.0
        if not set_a or not set_b:
            return 0.0
        intersection = len(set_a & set_b)
        union = len(set_a | set_b)
        return intersection / union if union > 0 else 0.0


class FingerprintRegistry:
    def __init__(self):
        self._lock = threading.Lock()
        self._fingerprints: Dict[str, str] = {}
        self._load()

    def _load(self):
        try:
            if os.path.exists(FINGERPRINTS_FILE):
                with open(FINGERPRINTS_FILE, 'r', encoding='utf-8') as f:
                    self._fingerprints = json.load(f)
                logger.info(f'[GENERATOR] Loaded {len(self._fingerprints)} fingerprints')
        except Exception as e:
            logger.warning(f'[GENERATOR] Could not load fingerprints: {e}')
            self._fingerprints = {}

    def _save(self):
        try:
            os.makedirs(os.path.dirname(FINGERPRINTS_FILE), exist_ok=True)
            tmp = FINGERPRINTS_FILE + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(self._fingerprints, f, ensure_ascii=False, indent=2)
            os.replace(tmp, FINGERPRINTS_FILE)
        except Exception as e:
            logger.warning(f'[GENERATOR] Could not save fingerprints: {e}')

    @staticmethod
    def _md5(text: str, choices: dict) -> str:
        normalized = text.strip().lower() + json.dumps(choices, sort_keys=True).lower()
        return hashlib.md5(normalized.encode()).hexdigest()

    def has_exact(self, text: str, choices: dict) -> bool:
        h = self._md5(text, choices)
        with self._lock:
            return h in self._fingerprints

    def is_similar(self, text: str, existing_texts: List[str], threshold: float = 0.6) -> bool:
        tokens_a = QuestionNormalizer.tokenize(text)
        for existing in existing_texts:
            tokens_b = QuestionNormalizer.tokenize(existing)
            score = QuestionNormalizer.jaccard(tokens_a, tokens_b)
            if score > threshold:
                return True
        return False

    def register(self, text: str, choices: dict):
        h = self._md5(text, choices)
        with self._lock:
            self._fingerprints[h] = QuestionNormalizer.normalize(text)
            self._save()

    def get_all_normalized_texts(self) -> List[str]:
        with self._lock:
            return list(self._fingerprints.values())


_fingerprint_registry = FingerprintRegistry()


class OpenAIClient:
    def __init__(self, api_key: str):
        self.api_key = api_key

    def generate_questions(self, config: GenerationConfig) -> List[dict]:
        import requests

        difficulty_labels = {1: 'facile', 2: 'moyen', 3: 'difficile'}
        diff_label = difficulty_labels.get(config.difficulty, 'moyen')

        style_instructions = {
            'standard': 'Questions classiques avec 4 choix de reponse.',
            'anecdote': 'Questions basees sur des anecdotes et faits surprenants.',
            'chiffres': 'Questions autour de dates, chiffres, statistiques, records.',
            'personnalites': 'Questions sur des personnalites celebres, leurs œuvres ou actions.',
        }
        style_hint = style_instructions.get(config.style, style_instructions['standard'])

        subcategory_hint = f', sous-categorie : {config.subcategory}' if config.subcategory else ''

        prompt = (
            f"Genere exactement {config.count} questions de quiz en langue '{config.language}'.\n"
            f"Theme : {config.theme}{subcategory_hint}\n"
            f"Categorie : {config.category}\n"
            f"Difficulte : {diff_label}\n"
            f"Public cible : {config.target_audience}\n"
            f"Style : {style_hint}\n\n"
            "Reponds UNIQUEMENT avec un tableau JSON valide. Chaque element doit avoir exactement cette structure :\n"
            '{\n'
            '  "text": "Texte de la question",\n'
            '  "choices": {"A": "Choix A", "B": "Choix B", "C": "Choix C", "D": "Choix D"},\n'
            '  "correct_answer": "A",\n'
            '  "difficulty": 2,\n'
            '  "category": "nom de categorie"\n'
            '}\n\n'
            'Regles strictes :\n'
            '- correct_answer doit etre une seule lettre parmi A, B, C, D\n'
            '- Chaque choix doit etre different et plausible\n'
            '- Les questions doivent etre factuellement correctes\n'
            '- Ne pas inclure la reponse correcte dans le texte de la question\n'
            '- Reponds UNIQUEMENT avec le tableau JSON, sans texte avant ni apres\n'
        )

        payload = {
            'model': 'gpt-4o-mini',
            'messages': [
                {
                    'role': 'system',
                    'content': 'Tu es un generateur expert de questions de quiz. Tu reponds uniquement avec du JSON valide, sans markdown, sans explication.'
                },
                {
                    'role': 'user',
                    'content': prompt
                }
            ],
            'temperature': 0.8,
            'max_tokens': 4000,
        }

        headers = {
            'Authorization': f'Bearer {self.api_key}',
            'Content-Type': 'application/json',
        }

        logger.info(f'[GENERATOR] Calling OpenAI for {config.count} questions on "{config.theme}"')
        resp = requests.post(OPENAI_CHAT_URL, json=payload, headers=headers, timeout=60)

        if resp.status_code != 200:
            raise RuntimeError(f'OpenAI API error {resp.status_code}: {resp.text[:300]}')

        content = resp.json()['choices'][0]['message']['content'].strip()
        content = re.sub(r'^```(?:json)?\s*', '', content)
        content = re.sub(r'\s*```$', '', content)

        questions = json.loads(content)
        if not isinstance(questions, list):
            raise ValueError('La reponse OpenAI n\'est pas un tableau JSON')
        return questions


def _validate_question(q: dict) -> List[str]:
    errors = []
    if not isinstance(q, dict):
        return ['pas un objet JSON']
    text = q.get('text', '').strip()
    if not text:
        errors.append('texte vide')
    choices = q.get('choices', {})
    if not isinstance(choices, dict) or len(choices) < 2:
        errors.append('choix invalides (minimum 2)')
    else:
        for k, v in choices.items():
            if not str(v).strip():
                errors.append(f'choix {k} vide')
    correct = q.get('correct_answer', '')
    if not correct or correct.upper() not in (choices or {}).keys():
        errors.append(f'reponse correcte "{correct}" invalide')
    return errors


class QuestionnaireGenerator:
    def __init__(self, audio_svc=None, questionnaire_manager=None):
        self._audio_svc = audio_svc
        self._qm = questionnaire_manager
        self._jobs: Dict[str, GenerationJob] = {}
        self._jobs_lock = threading.Lock()

    def _get_api_key(self) -> str:
        if self._audio_svc is None:
            raise RuntimeError('AudioService non disponible')
        try:
            raw = self._audio_svc.get_raw_config()
            key = raw.get('providers', {}).get('openai', {}).get('api_key', '')
            if not key:
                raise RuntimeError('Cle API OpenAI non configuree (configurez-la dans l\'onglet Audio)')
            return key
        except RuntimeError:
            raise
        except Exception as e:
            raise RuntimeError(f'Impossible de lire la cle API OpenAI: {e}')

    def _collect_existing_texts(self) -> List[str]:
        texts = _fingerprint_registry.get_all_normalized_texts()
        if self._qm:
            for qn in self._qm.questionnaires:
                for q in qn.questions:
                    texts.append(QuestionNormalizer.normalize(q.text))
        return texts

    def _run_job(self, job: GenerationJob):
        logger.info(f'[GENERATOR] Starting job {job.job_id}')
        try:
            api_key = self._get_api_key()
            client = OpenAIClient(api_key)

            job.status = 'running'
            job.progress = 0
            job.total = job.config.count

            raw_questions = client.generate_questions(job.config)
            job.progress = len(raw_questions)

            existing_texts = self._collect_existing_texts()
            session_texts: List[str] = []

            accepted = []
            rejected_invalid = 0
            rejected_duplicate = 0

            for q in raw_questions:
                errors = _validate_question(q)
                if errors:
                    logger.warning(f'[GENERATOR] Invalid question: {errors}')
                    rejected_invalid += 1
                    continue

                text = q['text'].strip()
                choices = q['choices']

                if _fingerprint_registry.has_exact(text, choices):
                    logger.info(f'[GENERATOR] Exact duplicate skipped: {text[:60]}')
                    rejected_duplicate += 1
                    continue

                all_existing = existing_texts + session_texts
                if _fingerprint_registry.is_similar(text, all_existing):
                    logger.info(f'[GENERATOR] Similar question skipped: {text[:60]}')
                    rejected_duplicate += 1
                    continue

                session_texts.append(QuestionNormalizer.normalize(text))
                accepted.append({
                    'text': text,
                    'choices': choices,
                    'correct_answer': q.get('correct_answer', 'A').upper(),
                    'difficulty': max(1, min(3, int(q.get('difficulty', job.config.difficulty)))),
                    'category': q.get('category', job.config.category),
                    'type': 'standard',
                    'selected': True,
                })

            job.candidates = accepted
            job.stats = {
                'total_generated': len(raw_questions),
                'accepted': len(accepted),
                'rejected_invalid': rejected_invalid,
                'rejected_duplicate': rejected_duplicate,
            }
            job.status = 'done'
            job.finished_at = time.time()
            logger.info(f'[GENERATOR] Job {job.job_id} done: {job.stats}')
        except Exception as e:
            logger.error(f'[GENERATOR] Job {job.job_id} failed: {e}')
            job.status = 'error'
            job.error = str(e)
            job.finished_at = time.time()

    def start_job(self, config: GenerationConfig) -> str:
        job_id = str(uuid.uuid4())[:8]
        job = GenerationJob(job_id=job_id, config=config)
        with self._jobs_lock:
            self._jobs[job_id] = job
        t = threading.Thread(target=self._run_job, args=(job,), daemon=True)
        t.start()
        return job_id

    def get_job(self, job_id: str) -> Optional[GenerationJob]:
        with self._jobs_lock:
            return self._jobs.get(job_id)

    def cancel_job(self, job_id: str) -> bool:
        job = self.get_job(job_id)
        if not job:
            return False
        if job.status in ('pending', 'running'):
            job.status = 'cancelled'
            job.finished_at = time.time()
            return True
        return False

    def confirm_job(self, job_id: str, selected_indices: List[int], target_qn_id: Optional[int], new_qn_name: Optional[str]) -> dict:
        job = self.get_job(job_id)
        if not job:
            raise ValueError('Job introuvable')
        if job.status != 'done':
            raise ValueError(f'Job non termine (statut: {job.status})')
        if not self._qm:
            raise RuntimeError('QuestionnaireManager non disponible')

        candidates = job.candidates
        selected = [candidates[i] for i in selected_indices if 0 <= i < len(candidates)]
        if not selected:
            raise ValueError('Aucune question selectionnee')

        if target_qn_id:
            qn = self._qm.get_questionnaire(target_qn_id)
            if not qn:
                raise ValueError(f'Questionnaire {target_qn_id} introuvable')
        else:
            name = (new_qn_name or f'IA - {job.config.theme}').strip()
            qn = self._qm.create_questionnaire(
                name=name,
                description=f'Genere par IA - Theme: {job.config.theme}, Difficulte: {job.config.difficulty}',
                category=job.config.category
            )

        imported = 0
        for q in selected:
            try:
                self._qm.add_question(
                    qn_id=qn.id,
                    text=q['text'],
                    choices=q['choices'],
                    correct_answer=q['correct_answer'],
                    category=q.get('category', job.config.category),
                    difficulty=q.get('difficulty', job.config.difficulty),
                    question_type=q.get('type', 'standard'),
                )
                _fingerprint_registry.register(q['text'], q['choices'])
                imported += 1
            except Exception as e:
                logger.warning(f'[GENERATOR] Could not import question: {e}')

        return {'questionnaire_id': qn.id, 'questionnaire_name': qn.name, 'imported': imported}

    def serialize_job(self, job: GenerationJob) -> dict:
        return {
            'job_id': job.job_id,
            'status': job.status,
            'progress': job.progress,
            'total': job.total,
            'error': job.error,
            'stats': job.stats,
            'candidate_count': len(job.candidates),
            'created_at': job.created_at,
            'finished_at': job.finished_at,
        }
