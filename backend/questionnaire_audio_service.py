import os
import json
import hashlib
import threading
import time
from typing import Dict, List, Any, Optional

from audio_service import AudioService, AUDIO_DIR
from tts_preprocessor import TTSPreprocessor


QUESTIONNAIRE_AUDIO_DIR = os.path.join(AUDIO_DIR, 'questionnaires')
USERS_AUDIO_DIR = os.path.join(AUDIO_DIR, 'users')

CHOICE_LABELS = {
    'A': 'Choix A',
    'B': 'Choix B',
    'C': 'Choix C',
    'D': 'Choix D',
}

FILES_PER_QUESTION = 6


class QuestionnaireAudioService:
    def __init__(self, audio_service: AudioService):
        self._audio_svc = audio_service
        self._lock = threading.Lock()
        self._jobs: Dict[str, Dict] = {}

    # ------------------------------------------------------------------
    # Path helpers
    # When user_id is provided, the primary (write) path is per-user.
    # The global path is the legacy fallback for reads.
    # ------------------------------------------------------------------

    def _qn_audio_dir(self, qn_id: int, user_id: Optional[str] = None) -> str:
        if user_id:
            return os.path.join(USERS_AUDIO_DIR, str(user_id), 'questionnaires', str(qn_id))
        return os.path.join(QUESTIONNAIRE_AUDIO_DIR, str(qn_id))

    def _global_qn_audio_dir(self, qn_id: int) -> str:
        return os.path.join(QUESTIONNAIRE_AUDIO_DIR, str(qn_id))

    def _meta_path(self, qn_id: int, user_id: Optional[str] = None) -> str:
        return os.path.join(self._qn_audio_dir(qn_id, user_id), 'meta.json')

    def _audio_path(self, qn_id: int, filename: str, user_id: Optional[str] = None) -> str:
        """Return the primary (write) path for an audio file."""
        return os.path.join(self._qn_audio_dir(qn_id, user_id), filename)

    def _resolve_audio_path(self, qn_id: int, filename: str, user_id: Optional[str] = None) -> Optional[str]:
        """
        Resolve the best existing path for an audio file.
        Read order: user-scoped → global → None.
        """
        if user_id:
            user_path = self._audio_path(qn_id, filename, user_id)
            if os.path.exists(user_path) and os.path.getsize(user_path) > 0:
                return user_path
        global_path = os.path.join(self._global_qn_audio_dir(qn_id), filename)
        if os.path.exists(global_path) and os.path.getsize(global_path) > 0:
            return global_path
        return None

    def _content_hash(self, text: str) -> str:
        cfg = self._audio_svc.get_raw_config()
        provider = cfg.get('provider', 'openai')
        language = cfg.get('language', 'fr-FR')
        pcfg = cfg.get('providers', {}).get(provider, {})
        voice = pcfg.get('voice') or pcfg.get('voice_id') or pcfg.get('voice_name') or ''
        model = pcfg.get('model') or pcfg.get('model_id') or ''
        speed = str(pcfg.get('speed', ''))
        composite = f"{text}|{provider}|{voice}|{model}|{language}|{speed}"
        return hashlib.md5(composite.encode('utf-8')).hexdigest()

    def _build_items_for_question(self, q_index: int, question: dict) -> Dict[str, str]:
        prefix = f"q{q_index + 1}"
        items = {}
        lang = self._audio_svc.get_raw_config().get('language', 'fr-FR')
        prep = TTSPreprocessor(lang)
        items[f"{prefix}_question"] = prep.preprocess(question.get('text', ''), 'question', lang)
        choices = question.get('choices', {})
        for letter in ['A', 'B', 'C', 'D']:
            if letter in choices:
                label = CHOICE_LABELS.get(letter, f'Choix {letter}')
                raw = f"{label}... {choices[letter]}"
                items[f"{prefix}_{letter.lower()}"] = prep.preprocess(raw, 'choice', lang)
        correct = question.get('correct_answer', '')
        if correct and correct in choices:
            items[f"{prefix}_correct"] = prep.preprocess(choices[correct], 'answer', lang)
        return items

    def _load_meta(self, qn_id: int, user_id: Optional[str] = None) -> Optional[dict]:
        # Try user-scoped meta first, fall back to global meta.
        paths = []
        if user_id:
            paths.append(self._meta_path(qn_id, user_id))
        paths.append(os.path.join(self._global_qn_audio_dir(qn_id), 'meta.json'))
        for path in paths:
            if not os.path.exists(path):
                continue
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError):
                continue
        return None

    def _save_meta(self, qn_id: int, meta: dict, user_id: Optional[str] = None):
        d = self._qn_audio_dir(qn_id, user_id)
        os.makedirs(d, exist_ok=True)
        path = self._meta_path(qn_id, user_id)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)
        print(f"[AUDIO QCM] meta saved for questionnaire={qn_id} user={user_id or 'global'}")

    def _build_meta(self, qn_id: int, questions: list, hashes: dict) -> dict:
        cfg = self._audio_svc.get_raw_config()
        provider = cfg.get('provider', 'openai')
        language = cfg.get('language', 'fr-FR')
        pcfg = cfg.get('providers', {}).get(provider, {})
        voice = pcfg.get('voice') or pcfg.get('voice_id') or pcfg.get('voice_name') or ''
        model = pcfg.get('model') or pcfg.get('model_id') or ''
        return {
            'questionnaire_id': qn_id,
            'provider': provider,
            'model': model,
            'voice': voice,
            'language': language,
            'generated_at': time.strftime('%Y-%m-%d %H:%M:%S'),
            'total_questions': len(questions),
            'content_hashes': hashes,
        }

    def get_status(self, qn_id: int, questions: list, user_id: Optional[str] = None) -> dict:
        total_expected = len(questions) * FILES_PER_QUESTION
        existing = 0
        missing = 0
        obsolete = 0
        meta = self._load_meta(qn_id, user_id)
        stored_hashes = meta.get('content_hashes', {}) if meta else {}

        for idx, q in enumerate(questions):
            items = self._build_items_for_question(idx, q)
            for key, text in items.items():
                resolved = self._resolve_audio_path(qn_id, f"{key}.mp3", user_id)
                if resolved:
                    current_hash = self._content_hash(text)
                    if stored_hashes.get(key) == current_hash:
                        existing += 1
                    else:
                        obsolete += 1
                else:
                    missing += 1

        return {
            'total_expected': total_expected,
            'existing': existing,
            'missing': missing,
            'obsolete': obsolete,
            'up_to_date': existing == total_expected and missing == 0 and obsolete == 0,
            'has_meta': meta is not None,
        }

    def _generate_items(self, qn_id: int, questions: list, mode: str = 'missing',
                        job_id: str = None, user_id: Optional[str] = None) -> Dict[str, Any]:
        # Write directory is always user-scoped when user_id provided.
        write_dir = self._qn_audio_dir(qn_id, user_id)
        os.makedirs(write_dir, exist_ok=True)
        provider = self._audio_svc.get_provider()
        if not provider:
            msg = "Aucun provider TTS configure"
            print(f"[AUDIO QCM] FAILED: {msg}")
            return {'status': 'error', 'message': msg}

        meta = self._load_meta(qn_id, user_id)
        stored_hashes = meta.get('content_hashes', {}) if meta else {}
        new_hashes = dict(stored_hashes)

        total_items = 0
        items_list = []
        for idx, q in enumerate(questions):
            items = self._build_items_for_question(idx, q)
            for key, text in items.items():
                items_list.append((idx, key, text))
            total_items += len(items)

        if job_id and job_id in self._jobs:
            self._jobs[job_id]['total'] = total_items

        generated = 0
        cached = 0
        errors = 0
        error_details = []

        for i, (q_idx, key, text) in enumerate(items_list):
            if job_id and self._jobs.get(job_id, {}).get('cancelled'):
                print(f"[AUDIO QCM] questionnaire={qn_id} CANCELLED at {i}/{total_items}")
                break

            current_hash = self._content_hash(text)
            # Write path is always user-scoped (or global when no user_id).
            write_path = self._audio_path(qn_id, f"{key}.mp3", user_id)
            # For cache-hit check, resolve best existing file (user → global).
            resolved = self._resolve_audio_path(qn_id, f"{key}.mp3", user_id)
            file_exists = resolved is not None

            if mode == 'missing' and file_exists and stored_hashes.get(key) == current_hash:
                cached += 1
            elif mode == 'all' or not file_exists or stored_hashes.get(key) != current_hash:
                parts = key.split('_', 1)
                audio_type = parts[1] if len(parts) > 1 else key
                print(f"[AUDIO QCM] questionnaire={qn_id} question={q_idx + 1} type={audio_type} output={write_path}")

                try:
                    success = provider.generate(text, write_path)
                except Exception as e:
                    success = False
                    err_msg = f"{key}: {e}"
                    print(f"[AUDIO QCM] ERROR {err_msg}")
                    error_details.append(err_msg)

                if success and os.path.exists(write_path) and os.path.getsize(write_path) > 0:
                    generated += 1
                    new_hashes[key] = current_hash
                elif success:
                    errors += 1
                    err_msg = f"{key}: fichier vide ou manquant apres generation"
                    print(f"[AUDIO QCM] ERROR {err_msg}")
                    error_details.append(err_msg)
                else:
                    errors += 1
                    if not error_details or not error_details[-1].startswith(key):
                        error_details.append(f"{key}: echec generation")

                if errors >= 5 and generated == 0 and cached == 0:
                    msg = f"Arret apres {errors} erreurs consecutives sans succes"
                    print(f"[AUDIO QCM] questionnaire={qn_id} ABORT: {msg}")
                    error_details.append(msg)
                    break

                time.sleep(0.05)
            else:
                cached += 1

            if job_id and job_id in self._jobs:
                progress = int(((i + 1) / total_items) * 100) if total_items > 0 else 0
                self._jobs[job_id].update({
                    'progress': progress,
                    'generated': generated,
                    'cached': cached,
                    'errors': errors,
                })

        new_meta = self._build_meta(qn_id, questions, new_hashes)
        self._save_meta(qn_id, new_meta, user_id)

        status = 'completed' if errors == 0 else ('partial' if generated > 0 or cached > 0 else 'error')
        result = {
            'status': status,
            'total': total_items,
            'generated': generated,
            'cached': cached,
            'errors': errors,
        }
        if error_details:
            result['error_details'] = error_details[:20]
        print(f"[AUDIO QCM] questionnaire={qn_id} user={user_id or 'global'} END: {status} generated={generated} cached={cached} errors={errors}")
        return result

    def start_generation_job(self, qn_id: int, questions: list, mode: str = 'missing',
                             user_id: Optional[str] = None) -> str:
        cfg = self._audio_svc.get_raw_config()
        provider_name = cfg.get('provider', 'openai')
        language = cfg.get('language', 'fr-FR')

        job_id = f"qn_{qn_id}_{int(time.time())}"
        self._jobs[job_id] = {
            'questionnaire_id': qn_id,
            'user_id': user_id,
            'mode': mode,
            'status': 'running',
            'progress': 0,
            'generated': 0,
            'cached': 0,
            'errors': 0,
            'total': len(questions) * FILES_PER_QUESTION,
            'cancelled': False,
            'provider': provider_name,
            'language': language,
            'started_at': time.strftime('%Y-%m-%d %H:%M:%S'),
        }

        print(f"[AUDIO QCM] JOB CREATED: {job_id} qn={qn_id} user={user_id or 'global'} mode={mode} provider={provider_name} lang={language}")

        def run():
            try:
                result = self._generate_items(qn_id, questions, mode=mode, job_id=job_id, user_id=user_id)
                job = self._jobs[job_id]
                job['status'] = result.get('status', 'completed')
                job['generated'] = result.get('generated', 0)
                job['cached'] = result.get('cached', 0)
                job['errors'] = result.get('errors', 0)
                job['total'] = result.get('total', 0)
                if result.get('error_details'):
                    job['error_details'] = result['error_details']
                if job['status'] == 'completed':
                    job['progress'] = 100
                job['finished_at'] = time.strftime('%Y-%m-%d %H:%M:%S')
                print(f"[AUDIO QCM] JOB FINISHED: {job_id} status={job['status']}")
            except Exception as e:
                print(f"[AUDIO QCM] JOB EXCEPTION: {job_id} {e}")
                self._jobs[job_id]['status'] = 'error'
                self._jobs[job_id]['message'] = str(e)
                self._jobs[job_id]['finished_at'] = time.strftime('%Y-%m-%d %H:%M:%S')

        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        return job_id

    def cancel_job(self, job_id: str) -> bool:
        if job_id in self._jobs:
            self._jobs[job_id]['cancelled'] = True
            return True
        return False

    def get_job_status(self, job_id: str) -> Optional[Dict]:
        return self._jobs.get(job_id)

    def get_all_jobs(self) -> Dict[str, Dict]:
        return dict(self._jobs)

    def delete_audio(self, qn_id: int, user_id: Optional[str] = None) -> Dict[str, Any]:
        d = self._qn_audio_dir(qn_id, user_id)
        count = 0
        if os.path.isdir(d):
            for f in os.listdir(d):
                fpath = os.path.join(d, f)
                if os.path.isfile(fpath):
                    os.remove(fpath)
                    count += 1
        print(f"[AUDIO QCM] questionnaire={qn_id} user={user_id or 'global'} deleted {count} files")
        return {'success': True, 'deleted': count}

    def audio_file_exists(self, qn_id: int, filename: str, user_id: Optional[str] = None) -> bool:
        return self._resolve_audio_path(qn_id, filename, user_id) is not None

    def get_audio_file_path(self, qn_id: int, filename: str, user_id: Optional[str] = None) -> Optional[str]:
        return self._resolve_audio_path(qn_id, filename, user_id)
