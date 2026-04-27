#!/usr/bin/env python3
import sys
import os
import time
import json
import queue
import threading
import functools
import datetime
from collections import deque
from flask import Flask, render_template, jsonify, request, send_from_directory, Response, session, redirect, url_for
from werkzeug.security import generate_password_hash, check_password_hash

_DEFAULT_USERNAME = 'admin'
_DEFAULT_PASSWORD = 'Admin12345'
_DEFAULT_HASH = generate_password_hash(_DEFAULT_PASSWORD)

ADMIN_USERNAME = os.environ.get('ADMIN_USERNAME', _DEFAULT_USERNAME)
_env_hash = os.environ.get('ADMIN_PASSWORD_HASH', '')
ADMIN_PASSWORD_HASH = _env_hash if _env_hash else _DEFAULT_HASH

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', os.urandom(32))
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['PERMANENT_SESSION_LIFETIME'] = datetime.timedelta(hours=8)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024


def check_credentials(username: str, password: str) -> bool:
    return username == ADMIN_USERNAME and check_password_hash(ADMIN_PASSWORD_HASH, password)


def require_login(f):
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('admin'):
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated


def require_auth(f):
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('admin'):
            return jsonify({'success': False, 'message': 'Non autorise'}), 401
        return f(*args, **kwargs)
    return decorated

import re as _re

_USERNAME_RE = _re.compile(r'^[A-Za-z0-9._\-]{1,64}$')

VALID_PLAY_MODES = {'single', 'sequential', 'infinite_all', 'infinite_single'}


def _validate_start_payload(data: dict, simulate: bool):
    errors = []

    username = data.get('username', '').strip()
    if not simulate:
        if not username:
            errors.append("Le pseudo TikTok est requis")
        elif not _USERNAME_RE.match(username):
            errors.append("Pseudo TikTok invalide (caracteres autorises: lettres, chiffres, . _ -)")

    question_time = data.get('question_time')
    if question_time is not None:
        try:
            qt = int(question_time)
            if not (1 <= qt <= 120):
                errors.append("question_time doit etre entre 1 et 120 secondes")
        except (ValueError, TypeError):
            errors.append("question_time doit etre un entier")

    countdown_time = data.get('countdown_time')
    if countdown_time is not None:
        try:
            ct = int(countdown_time)
            if not (1 <= ct <= 30):
                errors.append("countdown_time doit etre entre 1 et 30 secondes")
        except (ValueError, TypeError):
            errors.append("countdown_time doit etre un entier")

    delay = data.get('delay', 3)
    try:
        d = int(delay)
        if not (0 <= d <= 60):
            errors.append("delay doit etre entre 0 et 60 secondes")
    except (ValueError, TypeError):
        errors.append("delay doit etre un entier")

    play_mode = data.get('play_mode', 'single')
    if play_mode not in VALID_PLAY_MODES:
        errors.append(f"play_mode invalide (valeurs: {', '.join(sorted(VALID_PLAY_MODES))})")

    return errors


PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
BACKEND_DIR = os.path.join(PROJECT_ROOT, 'backend')
FRONTEND_DIR = os.path.join(PROJECT_ROOT, 'frontend')
AUDIO_DIR = os.path.join(PROJECT_ROOT, 'data', 'audio')

sys.path.insert(0, BACKEND_DIR)
from logging_config import setup_logging
setup_logging()

from questionnaire_manager import QuestionnaireManager
from audio_service import AudioService
from questionnaire_audio_service import QuestionnaireAudioService
from game_runtime import GameRuntime, RuntimeState
from questionnaire_generator import QuestionnaireGenerator, GenerationConfig
from music_service import MusicService

LOG_MAX = 500
log_buffer = deque(maxlen=LOG_MAX)
log_seq = 0
log_lock = threading.Lock()
_last_log_line = None

sse_clients = []
sse_lock = threading.Lock()

qm = QuestionnaireManager()
audio_svc = AudioService()
qn_audio_svc = QuestionnaireAudioService(audio_svc)
qn_generator = QuestionnaireGenerator(audio_svc=audio_svc, questionnaire_manager=qm)
music_svc = MusicService()

current_overlay_template = 'standard'

game_runtime = GameRuntime()


def _add_log(entry: str):
    global log_seq, _last_log_line
    stripped = entry.rstrip()
    if not stripped:
        return
    with log_lock:
        if stripped == _last_log_line:
            return
        _last_log_line = stripped
        log_seq += 1
        log_buffer.append((log_seq, stripped))


def _on_state_change(old_state: RuntimeState, new_state: RuntimeState):
    event_map = {
        RuntimeState.RUNNING: 'game_start',
        RuntimeState.STOPPED: 'game_stop',
        RuntimeState.PAUSED: 'game_pause',
        RuntimeState.ERROR: 'game_stop',
    }
    if old_state == RuntimeState.PAUSED and new_state == RuntimeState.RUNNING:
        sse_publish('game_resume')
    elif new_state in event_map:
        sse_publish(event_map[new_state], {'state': new_state.value})


game_runtime.set_log_handler(_add_log)
game_runtime.set_state_change_handler(_on_state_change)


def sse_publish(event_type, data=None):
    print(f"[SSE] {event_type} → {len(sse_clients)} clients")
    payload = json.dumps({'event': event_type, **(data or {})})
    msg = f"event: {event_type}\ndata: {payload}\n\n"
    with sse_lock:
        dead = []
        for q in sse_clients:
            try:
                q.put_nowait(msg)
            except Exception:
                dead.append(q)
        for q in dead:
            sse_clients.remove(q)


@app.route('/login', methods=['GET'])
def login():
    if session.get('admin'):
        return redirect(url_for('index'))
    error = request.args.get('error', '')
    return render_template('login.html', error=error)


@app.route('/login', methods=['POST'])
def login_post():
    username = request.form.get('username', '').strip()
    password = request.form.get('password', '')
    if check_credentials(username, password):
        session.permanent = True
        session['admin'] = True
        return redirect(url_for('index'))
    return redirect(url_for('login', error='Identifiants incorrects'))


@app.route('/logout', methods=['POST'])
def logout():
    session.clear()
    return redirect(url_for('login'))


@app.route('/')
@require_login
def index():
    return render_template('index.html')


@app.route('/overlay')
def overlay():
    return render_template('overlay.html')


@app.route('/overlay/<path:filename>')
def overlay_assets(filename):
    return send_from_directory(FRONTEND_DIR, filename)


@app.route('/overlay/audio/<path:filename>')
def overlay_audio(filename):
    return send_from_directory(AUDIO_DIR, filename)


@app.route('/audio/<path:filename>')
def serve_audio(filename):
    return send_from_directory(AUDIO_DIR, filename)


@app.route('/music/<path:filename>')
def serve_music(filename):
    path = music_svc.get_track_path(filename)
    if not path:
        return jsonify({'error': 'Not found'}), 404
    return send_from_directory(os.path.dirname(path), os.path.basename(path))


@app.route('/overlay/music/<path:filename>')
def overlay_music(filename):
    path = music_svc.get_track_path(filename)
    if not path:
        return jsonify({'error': 'Not found'}), 404
    return send_from_directory(os.path.dirname(path), os.path.basename(path))


@app.route('/overlay/api/music/config')
def overlay_music_config():
    return jsonify(music_svc.get_playback_config())


@app.route('/config.json')
def config_json():
    return send_from_directory(PROJECT_ROOT, 'config.json')


@app.route('/health')
def health():
    ws = game_runtime.ws_server
    runtime_state = game_runtime.get_status().get('state', 'unknown')
    is_error = runtime_state == 'error'
    ws_ok = ws.is_serving() if ws else False
    body = {
        'status': 'error' if is_error else 'ok',
        'game_runtime': runtime_state,
        'ws_serving': ws_ok,
        'ws_clients': ws.get_client_count() if ws else 0,
    }
    return jsonify(body), (503 if is_error else 200)


@app.route('/api/events')
def api_events():
    def stream():
        q = queue.Queue(maxsize=50)
        with sse_lock:
            sse_clients.append(q)
        try:
            yield f"event: connected\ndata: {json.dumps({'event': 'connected'})}\n\n"
            while True:
                try:
                    msg = q.get(timeout=25)
                    yield msg
                except queue.Empty:
                    yield ": heartbeat\n\n"
        except GeneratorExit:
            pass
        finally:
            with sse_lock:
                if q in sse_clients:
                    sse_clients.remove(q)

    return Response(stream(), mimetype='text/event-stream', headers={
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*'
    })


@app.route('/api/start', methods=['POST'])
@require_auth
def api_start():
    status = game_runtime.get_status()
    if status['state'] in ('running', 'paused', 'starting'):
        return jsonify({'success': False, 'message': 'Un jeu est deja en cours'}), 409

    data = request.get_json() or {}
    simulate = bool(data.get('simulate', False))

    errors = _validate_start_payload(data, simulate)
    if errors:
        return jsonify({'success': False, 'message': errors[0], 'errors': errors}), 400

    username = data.get('username', '').strip()
    delay = max(0, min(60, int(data.get('delay', 3))))

    raw_x2 = data.get('x2_enabled', False)
    x2_enabled = raw_x2 in (True, 1, '1', 'true', 'on') or str(raw_x2).lower() in ('true', '1', 'on')
    raw_freq = str(data.get('x2_frequency', '') or '').strip()
    x2_frequency = raw_freq if raw_freq else '3'

    print(f"[Admin] x2_enabled={raw_x2!r} type={type(raw_x2).__name__} -> {x2_enabled}, x2_frequency={x2_frequency!r} type={type(x2_frequency).__name__}")

    kwargs = {
        'delay': delay,
        'questions': data.get('questions', 0),
        'question_time': data.get('question_time'),
        'no_tts': data.get('no_tts', False),
        'play_mode': data.get('play_mode', 'single'),
        'questionnaire_id': data.get('questionnaire_id'),
        'questionnaire_ids': data.get('questionnaire_ids', []),
        'x2_enabled': x2_enabled,
        'x2_frequency': x2_frequency,
    }

    try:
        started = game_runtime.start(
            tiktok_username=username,
            simulate=simulate,
            **kwargs
        )
        if started:
            return jsonify({'success': True, 'message': 'Jeu en cours de demarrage'})
        else:
            return jsonify({'success': False, 'message': 'Impossible de demarrer (etat actuel: ' + status['state'] + ')'}), 409
    except Exception as e:
        return jsonify({'success': False, 'message': f'Erreur au lancement: {str(e)}'}), 500


@app.route('/api/stop', methods=['POST'])
@require_auth
def api_stop():
    status = game_runtime.get_status()
    if not status['running'] and status['state'] not in ('starting', 'stopping'):
        return jsonify({'success': False, 'message': 'Aucun jeu en cours'}), 404

    try:
        stopped = game_runtime.stop()
        if stopped:
            return jsonify({'success': True, 'message': 'Jeu arrete'})
        else:
            return jsonify({'success': False, 'message': 'Erreur lors de l\'arret'}), 500
    except Exception as e:
        return jsonify({'success': False, 'message': f'Erreur: {str(e)}'}), 500


@app.route('/api/pause', methods=['POST'])
@require_auth
def api_pause():
    status = game_runtime.get_status()
    if status['state'] != 'running':
        return jsonify({'success': False, 'message': 'Le jeu n\'est pas en cours'}), 409

    if game_runtime.pause():
        timestamp = time.strftime('%H:%M:%S')
        log_buffer.append(f"[{timestamp}] [Admin] Jeu mis en pause")
        return jsonify({'success': True, 'message': 'Jeu mis en pause'})
    return jsonify({'success': False, 'message': 'Impossible de mettre en pause'}), 500


@app.route('/api/resume', methods=['POST'])
@require_auth
def api_resume():
    status = game_runtime.get_status()
    if status['state'] != 'paused':
        return jsonify({'success': False, 'message': 'Le jeu n\'est pas en pause'}), 409

    if game_runtime.resume():
        timestamp = time.strftime('%H:%M:%S')
        log_buffer.append(f"[{timestamp}] [Admin] Jeu repris")
        return jsonify({'success': True, 'message': 'Jeu repris'})
    return jsonify({'success': False, 'message': 'Impossible de reprendre'}), 500


@app.route('/api/restart', methods=['POST'])
@require_auth
def api_restart():
    data = request.get_json() or {}
    simulate = bool(data.get('simulate', False))

    errors = _validate_start_payload(data, simulate)
    if errors:
        return jsonify({'success': False, 'message': errors[0], 'errors': errors}), 400

    username = data.get('username', '').strip()
    delay = max(0, min(60, int(data.get('delay', 3))))

    status = game_runtime.get_status()
    if status['running'] or status['state'] in ('starting', 'stopping'):
        game_runtime.stop()
        time.sleep(0.5)

    kwargs = {
        'delay': delay,
        'questions': data.get('questions', 0),
        'question_time': data.get('question_time'),
        'no_tts': data.get('no_tts', False),
        'play_mode': data.get('play_mode', 'single'),
        'questionnaire_id': data.get('questionnaire_id'),
        'questionnaire_ids': data.get('questionnaire_ids', []),
    }

    try:
        started = game_runtime.start(
            tiktok_username=username,
            simulate=simulate,
            **kwargs
        )
        if started:
            sse_publish('game_restart')
            return jsonify({'success': True, 'message': 'Jeu redemarre'})
        else:
            return jsonify({'success': False, 'message': 'Impossible de redemarrer'}), 500
    except Exception as e:
        return jsonify({'success': False, 'message': f'Erreur au redemarrage: {str(e)}'}), 500


@app.route('/api/status')
def api_status():
    return jsonify(game_runtime.get_status())


@app.route('/api/ws-status')
def api_ws_status():
    ws = game_runtime.ws_server
    return jsonify({
        'serving': ws.is_serving() if ws else False,
        'port': ws.port if ws else None,
        'clients': ws.get_client_count() if ws else 0,
    })


@app.route('/api/logs')
def api_logs():
    cursor = request.args.get('cursor', 0, type=int)
    with log_lock:
        entries = list(log_buffer)
    new_entries = [(seq, text) for seq, text in entries if seq > cursor]
    new_cursor = new_entries[-1][0] if new_entries else cursor
    return jsonify({
        'logs': [text for _, text in new_entries],
        'cursor': new_cursor,
    })


@app.route('/api/logs/clear', methods=['POST'])
@require_auth
def api_clear_logs():
    global log_seq, _last_log_line
    with log_lock:
        log_buffer.clear()
        _last_log_line = None
    return jsonify({'success': True, 'cursor': log_seq})


@app.route('/api/overlay-state')
def api_overlay_state():
    snapshot = game_runtime.get_overlay_snapshot()
    snapshot['template'] = current_overlay_template
    return jsonify(snapshot)


@app.route('/api/template', methods=['GET'])
def api_get_template():
    print(f"[TEMPLATE GET] {current_overlay_template} PID={os.getpid()}")
    return jsonify({'template': current_overlay_template})


@app.route('/api/template', methods=['POST'])
@require_auth
def api_set_template():
    global current_overlay_template
    data = request.get_json() or {}
    template = data.get('template', 'standard').strip()
    allowed = ['standard', 'football']
    if template not in allowed:
        return jsonify({'success': False, 'message': f'Template inconnu: {template}'}), 400
    current_overlay_template = template
    print(f"[TEMPLATE SET] {template} PID={os.getpid()}")
    sse_publish('template_change', {'template': template})
    return jsonify({'success': True, 'template': template})


@app.route('/api/questionnaires')
def api_list_questionnaires():
    return jsonify(qm.list_questionnaires(include_inactive=True))


@app.route('/api/questionnaires', methods=['POST'])
@require_auth
def api_create_questionnaire():
    data = request.get_json() or {}
    name = data.get('name', '').strip()
    if not name:
        return jsonify({'success': False, 'message': 'Nom requis'}), 400
    try:
        qn_obj = qm.create_questionnaire(
            name=name,
            description=data.get('description', ''),
            category=data.get('category', '')
        )
        return jsonify({'success': True, 'id': qn_obj.id, 'name': qn_obj.name})
    except ValueError as e:
        return jsonify({'success': False, 'message': str(e)}), 400


@app.route('/api/questionnaires/<int:qn_id>')
def api_get_questionnaire(qn_id):
    qn_obj = qm.get_questionnaire(qn_id)
    if not qn_obj:
        return jsonify({'success': False, 'message': 'Introuvable'}), 404
    return jsonify(qm._serialize_questionnaire(qn_obj))


@app.route('/api/questionnaires/<int:qn_id>', methods=['PUT'])
@require_auth
def api_update_questionnaire(qn_id):
    data = request.get_json() or {}
    try:
        qn_obj = qm.update_questionnaire(qn_id, **data)
        if not qn_obj:
            return jsonify({'success': False, 'message': 'Introuvable'}), 404
        return jsonify({'success': True})
    except ValueError as e:
        return jsonify({'success': False, 'message': str(e)}), 400


@app.route('/api/questionnaires/<int:qn_id>', methods=['DELETE'])
@require_auth
def api_delete_questionnaire(qn_id):
    if qm.delete_questionnaire(qn_id):
        return jsonify({'success': True})
    return jsonify({'success': False, 'message': 'Introuvable'}), 404


@app.route('/api/questionnaires/<int:qn_id>/duplicate', methods=['POST'])
@require_auth
def api_duplicate_questionnaire(qn_id):
    qn_obj = qm.duplicate_questionnaire(qn_id)
    if not qn_obj:
        return jsonify({'success': False, 'message': 'Introuvable'}), 404
    return jsonify({'success': True, 'id': qn_obj.id, 'name': qn_obj.name})


@app.route('/api/questionnaires/<int:qn_id>/export')
def api_export_questionnaire(qn_id):
    data = qm.export_questionnaire(qn_id)
    if not data:
        return jsonify({'success': False, 'message': 'Introuvable'}), 404
    return jsonify(data)


@app.route('/api/questionnaires/import', methods=['POST'])
@require_auth
def api_import_questionnaire():
    data = request.get_json() or {}
    merge_into = data.get('merge_into_id')
    mode = data.get('mode', 'add')
    questionnaire_data = data.get('data', {})
    if not questionnaire_data:
        return jsonify({'success': False, 'message': 'Donnees manquantes'}), 400
    report = qm.import_questionnaire(questionnaire_data, merge_into_id=merge_into, mode=mode)
    return jsonify({'success': True, 'report': report})


@app.route('/api/questionnaires/reorder', methods=['POST'])
@require_auth
def api_reorder_questionnaires():
    data = request.get_json() or {}
    ordered_ids = data.get('ids', [])
    qm.reorder_questionnaires(ordered_ids)
    return jsonify({'success': True})


@app.route('/api/questionnaires/<int:qn_id>/questions')
def api_list_questions(qn_id):
    qn_obj = qm.get_questionnaire(qn_id)
    if not qn_obj:
        return jsonify({'success': False, 'message': 'Introuvable'}), 404
    return jsonify([qm._serialize_question(q) for q in qn_obj.questions])


def _parse_difficulty(val):
    mapping = {'easy': 1, 'medium': 2, 'hard': 3}
    if isinstance(val, str) and val in mapping:
        return mapping[val]
    try:
        return int(val)
    except (ValueError, TypeError):
        return 1


@app.route('/api/questionnaires/<int:qn_id>/questions', methods=['POST'])
@require_auth
def api_add_question(qn_id):
    data = request.get_json() or {}
    try:
        q = qm.add_question(
            qn_id=qn_id,
            text=data.get('text', ''),
            choices=data.get('choices', {}),
            correct_answer=data.get('correct_answer', ''),
            category=data.get('category', 'general'),
            difficulty=_parse_difficulty(data.get('difficulty', 1)),
            question_type=data.get('type', 'standard'),
            correct_answers=data.get('correct_answers')
        )
        if not q:
            return jsonify({'success': False, 'message': 'Questionnaire introuvable'}), 404
        return jsonify({'success': True, 'id': q.id})
    except ValueError as e:
        return jsonify({'success': False, 'message': str(e)}), 400


@app.route('/api/questionnaires/<int:qn_id>/questions/<int:q_id>', methods=['PUT'])
@require_auth
def api_update_question(qn_id, q_id):
    data = request.get_json() or {}
    if 'difficulty' in data:
        data['difficulty'] = _parse_difficulty(data['difficulty'])
    if 'type' in data:
        data['question_type'] = data.pop('type')
    q = qm.update_question(qn_id, q_id, **data)
    if not q:
        return jsonify({'success': False, 'message': 'Introuvable'}), 404
    return jsonify({'success': True})


@app.route('/api/questionnaires/<int:qn_id>/questions/<int:q_id>', methods=['DELETE'])
@require_auth
def api_delete_question(qn_id, q_id):
    if qm.delete_question(qn_id, q_id):
        return jsonify({'success': True})
    return jsonify({'success': False, 'message': 'Introuvable'}), 404


@app.route('/api/questionnaires/<int:qn_id>/questions/<int:q_id>/duplicate', methods=['POST'])
@require_auth
def api_duplicate_question(qn_id, q_id):
    q = qm.duplicate_question(qn_id, q_id)
    if not q:
        return jsonify({'success': False, 'message': 'Introuvable'}), 404
    return jsonify({'success': True, 'id': q.id})


@app.route('/api/questionnaires/<int:qn_id>/questions/move', methods=['POST'])
@require_auth
def api_move_question(qn_id):
    data = request.get_json() or {}
    to_qn_id = data.get('to_questionnaire_id')
    q_id = data.get('question_id')
    if not to_qn_id or not q_id:
        return jsonify({'success': False, 'message': 'Parametres manquants'}), 400
    if qm.move_question(qn_id, to_qn_id, q_id):
        return jsonify({'success': True})
    return jsonify({'success': False, 'message': 'Erreur lors du deplacement'}), 400


@app.route('/api/questionnaires/<int:qn_id>/questions/reorder', methods=['POST'])
@require_auth
def api_reorder_questions(qn_id):
    data = request.get_json() or {}
    ordered_ids = data.get('ids', [])
    qm.reorder_questions(qn_id, ordered_ids)
    return jsonify({'success': True})


@app.route('/api/questionnaires/<int:qn_id>/questions/search')
def api_search_questions(qn_id):
    query = request.args.get('q', '')
    results = qm.search_questions(qn_id, query)
    return jsonify([qm._serialize_question(q) for q in results])


@app.route('/api/questionnaires/<int:qn_id>/questions/import', methods=['POST'])
@require_auth
def api_import_questions(qn_id):
    data = request.get_json() or {}
    questions_data = data.get('questions', [])
    mode = data.get('mode', 'add')
    if not questions_data:
        return jsonify({'success': False, 'message': 'Aucune question'}), 400
    report = qm.import_questionnaire(
        {'questions': questions_data},
        merge_into_id=qn_id,
        mode=mode
    )
    return jsonify({'success': True, 'report': report})


@app.route('/api/audio/config', methods=['GET'])
def api_audio_config():
    return jsonify(audio_svc.get_config())


@app.route('/api/audio/config', methods=['PUT'])
@require_auth
def api_audio_config_update():
    data = request.get_json() or {}
    result = audio_svc.update_config(data)
    return jsonify({'success': True, 'config': result})


@app.route('/api/audio/config/api-key', methods=['POST'])
@require_auth
def api_audio_set_key():
    data = request.get_json() or {}
    provider = data.get('provider', '')
    api_key = data.get('api_key', '')
    if not provider or not api_key:
        return jsonify({'success': False, 'message': 'Provider et cle requis'}), 400
    if audio_svc.set_api_key(provider, api_key):
        return jsonify({'success': True})
    return jsonify({'success': False, 'message': 'Provider inconnu'}), 400


@app.route('/api/audio/test-provider', methods=['POST'])
@require_auth
def api_audio_test_provider():
    data = request.get_json() or {}
    provider = data.get('provider', '')
    if not provider:
        return jsonify({'success': False, 'message': 'Provider requis'}), 400
    result = audio_svc.test_provider(provider)
    return jsonify(result)


@app.route('/api/audio/voices')
def api_audio_voices():
    provider = request.args.get('provider', '')
    voices = audio_svc.get_voices(provider or None)
    return jsonify({'voices': voices})


@app.route('/api/audio/models')
def api_audio_models():
    provider = request.args.get('provider', '')
    models = audio_svc.get_models(provider or None)
    return jsonify({'models': models})


@app.route('/api/audio/languages')
def api_audio_languages():
    languages = audio_svc.get_languages()
    return jsonify({'languages': languages})


@app.route('/api/audio/status')
def api_audio_status():
    gen_status = audio_svc.get_generation_status()
    jobs = audio_svc.get_all_jobs()
    modified = audio_svc.get_modified_texts()
    return jsonify({
        'generation': gen_status,
        'jobs': {k: v for k, v in jobs.items() if v.get('status') == 'running'},
        'modified': modified
    })


@app.route('/api/audio/generate/<category>', methods=['POST'])
@require_auth
def api_audio_generate(category):
    if category not in ('numbers', 'words', 'phrases'):
        return jsonify({'success': False, 'message': 'Categorie invalide'}), 400
    data = request.get_json() or {}
    force = data.get('force', False)
    job_id = audio_svc.start_generation_job(category, force=force)
    return jsonify({'success': True, 'job_id': job_id})


@app.route('/api/audio/generate/single', methods=['POST'])
@require_auth
def api_audio_generate_single():
    data = request.get_json() or {}
    category = data.get('category', '')
    key = data.get('key', '')
    text = data.get('text', '')
    force = data.get('force', False)
    if not category or not key or not text:
        return jsonify({'success': False, 'message': 'Parametres manquants'}), 400
    result = audio_svc.generate_single(category, key, text, force=force)
    return jsonify(result)


@app.route('/api/audio/job/<job_id>')
def api_audio_job_status(job_id):
    status = audio_svc.get_job_status(job_id)
    if not status:
        return jsonify({'success': False, 'message': 'Job introuvable'}), 404
    return jsonify(status)


@app.route('/api/audio/job/<job_id>/cancel', methods=['POST'])
@require_auth
def api_audio_cancel_job(job_id):
    if audio_svc.cancel_job(job_id):
        return jsonify({'success': True})
    return jsonify({'success': False, 'message': 'Job introuvable'}), 404


@app.route('/api/audio/files')
def api_audio_files():
    return jsonify(audio_svc.list_audio_files())


@app.route('/api/audio/files/<category>', methods=['DELETE'])
@require_auth
def api_audio_delete_category(category):
    result = audio_svc.delete_category(category)
    return jsonify(result)


@app.route('/api/audio/preview/<path:filepath>')
def api_audio_preview(filepath):
    full = audio_svc.get_audio_file_path(filepath)
    if not full:
        return jsonify({'success': False, 'message': 'Fichier introuvable'}), 404
    return send_from_directory(os.path.dirname(full), os.path.basename(full))


@app.route('/api/questionnaires/<int:qn_id>/audio/status')
def api_qn_audio_status(qn_id):
    qn_obj = qm.get_questionnaire(qn_id)
    if not qn_obj:
        return jsonify({'success': False, 'message': 'Questionnaire introuvable'}), 404
    questions = [qm._serialize_question(q) for q in qn_obj.questions]
    status = qn_audio_svc.get_status(qn_id, questions)
    jobs = qn_audio_svc.get_all_jobs()
    active_jobs = {k: v for k, v in jobs.items()
                   if v.get('questionnaire_id') == qn_id and v.get('status') == 'running'}
    status['jobs'] = active_jobs
    return jsonify(status)


@app.route('/api/questionnaires/<int:qn_id>/audio/generate', methods=['POST'])
@require_auth
def api_qn_audio_generate(qn_id):
    qn_obj = qm.get_questionnaire(qn_id)
    if not qn_obj:
        return jsonify({'success': False, 'message': 'Questionnaire introuvable'}), 404
    data = request.get_json() or {}
    mode = data.get('mode', 'missing')
    if mode not in ('missing', 'all'):
        return jsonify({'success': False, 'message': 'Mode invalide (missing ou all)'}), 400
    questions = [qm._serialize_question(q) for q in qn_obj.questions]
    if not questions:
        return jsonify({'success': False, 'message': 'Aucune question dans ce questionnaire'}), 400
    job_id = qn_audio_svc.start_generation_job(qn_id, questions, mode=mode)
    return jsonify({'success': True, 'job_id': job_id})


@app.route('/api/questionnaires/<int:qn_id>/audio/job/<job_id>')
def api_qn_audio_job_status(qn_id, job_id):
    status = qn_audio_svc.get_job_status(job_id)
    if not status:
        return jsonify({'success': False, 'message': 'Job introuvable'}), 404
    return jsonify(status)


@app.route('/api/questionnaires/<int:qn_id>/audio/job/<job_id>/cancel', methods=['POST'])
@require_auth
def api_qn_audio_cancel_job(qn_id, job_id):
    if qn_audio_svc.cancel_job(job_id):
        return jsonify({'success': True})
    return jsonify({'success': False, 'message': 'Job introuvable'}), 404


@app.route('/api/questionnaires/<int:qn_id>/audio/delete', methods=['POST'])
@require_auth
def api_qn_audio_delete(qn_id):
    result = qn_audio_svc.delete_audio(qn_id)
    return jsonify(result)


@app.route('/api/questionnaires/<int:qn_id>/audio/preview/<path:filepath>')
def api_qn_audio_preview(qn_id, filepath):
    full = qn_audio_svc.get_audio_file_path(qn_id, filepath)
    if not full:
        return jsonify({'success': False, 'message': 'Fichier introuvable'}), 404
    return send_from_directory(os.path.dirname(full), os.path.basename(full))


@app.route('/api/ai/generate', methods=['POST'])
@require_auth
def api_ai_generate():
    data = request.get_json() or {}
    theme = data.get('theme', '').strip()
    if not theme:
        return jsonify({'success': False, 'message': 'Le theme est requis'}), 400
    count = int(data.get('count', 10))
    if not (1 <= count <= 30):
        return jsonify({'success': False, 'message': 'Le nombre de questions doit etre entre 1 et 30'}), 400
    difficulty = int(data.get('difficulty', 2))
    if difficulty not in (1, 2, 3):
        return jsonify({'success': False, 'message': 'La difficulte doit etre 1, 2 ou 3'}), 400
    config = GenerationConfig(
        theme=theme,
        category=data.get('category', theme),
        subcategory=data.get('subcategory', ''),
        difficulty=difficulty,
        count=count,
        language=data.get('language', 'fr'),
        target_audience=data.get('target_audience', 'general'),
        style=data.get('style', 'standard'),
    )
    try:
        job_id = qn_generator.start_job(config)
        return jsonify({'success': True, 'job_id': job_id})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/ai/job/<job_id>')
@require_auth
def api_ai_job_status(job_id):
    job = qn_generator.get_job(job_id)
    if not job:
        return jsonify({'success': False, 'message': 'Job introuvable'}), 404
    return jsonify({'success': True, **qn_generator.serialize_job(job)})


@app.route('/api/ai/job/<job_id>/cancel', methods=['POST'])
@require_auth
def api_ai_cancel_job(job_id):
    if qn_generator.cancel_job(job_id):
        return jsonify({'success': True})
    return jsonify({'success': False, 'message': 'Job introuvable ou deja termine'}), 404


@app.route('/api/ai/job/<job_id>/preview')
@require_auth
def api_ai_job_preview(job_id):
    job = qn_generator.get_job(job_id)
    if not job:
        return jsonify({'success': False, 'message': 'Job introuvable'}), 404
    if job.status != 'done':
        return jsonify({'success': False, 'message': f'Job non termine (statut: {job.status})'}), 400
    return jsonify({
        'success': True,
        'candidates': job.candidates,
        'stats': job.stats,
        'config': {
            'theme': job.config.theme,
            'category': job.config.category,
            'difficulty': job.config.difficulty,
            'count': job.config.count,
            'language': job.config.language,
        }
    })


@app.route('/api/ai/job/<job_id>/confirm', methods=['POST'])
@require_auth
def api_ai_confirm_job(job_id):
    data = request.get_json() or {}
    selected_indices = data.get('selected_indices', [])
    target_qn_id = data.get('target_questionnaire_id')
    new_qn_name = data.get('new_questionnaire_name', '')
    if not selected_indices:
        return jsonify({'success': False, 'message': 'Aucune question selectionnee'}), 400
    try:
        result = qn_generator.confirm_job(
            job_id=job_id,
            selected_indices=selected_indices,
            target_qn_id=target_qn_id,
            new_qn_name=new_qn_name
        )
        return jsonify({'success': True, **result})
    except (ValueError, RuntimeError) as e:
        return jsonify({'success': False, 'message': str(e)}), 400
    except Exception as e:
        return jsonify({'success': False, 'message': f'Erreur: {str(e)}'}), 500


MUSIC_DIR_ABS = os.path.join(PROJECT_ROOT, 'data', 'music')


@app.route('/api/music/config', methods=['GET'])
@require_auth
def api_music_config():
    return jsonify(music_svc.get_playback_config())


@app.route('/api/music/config', methods=['PUT'])
@require_auth
def api_music_config_update():
    data = request.get_json() or {}
    result = music_svc.update_config(data)
    _push_music_config()
    return jsonify({'success': True, 'config': result})


@app.route('/api/music/tracks', methods=['GET'])
@require_auth
def api_music_tracks():
    return jsonify({'tracks': music_svc.list_tracks()})


@app.route('/api/music/tracks', methods=['POST'])
@require_auth
def api_music_upload():
    if 'file' not in request.files:
        return jsonify({'success': False, 'message': 'Aucun fichier'}), 400
    f = request.files['file']
    if not f.filename:
        return jsonify({'success': False, 'message': 'Nom de fichier vide'}), 400
    allowed_ext = {'.mp3', '.ogg', '.wav', '.m4a', '.flac'}
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in allowed_ext:
        return jsonify({'success': False, 'message': 'Format non supporte'}), 400
    result = music_svc.save_upload(f.filename, f.read())
    return jsonify(result)


@app.route('/api/music/tracks/<path:filename>', methods=['DELETE'])
@require_auth
def api_music_delete_track(filename):
    if music_svc.delete_track(filename):
        return jsonify({'success': True})
    return jsonify({'success': False, 'message': 'Fichier introuvable'}), 404


@app.route('/api/music/tracks/<path:filename>/activate', methods=['POST'])
@require_auth
def api_music_activate_track(filename):
    if music_svc.set_active_track(filename):
        _push_music_config()
        return jsonify({'success': True})
    return jsonify({'success': False, 'message': 'Fichier introuvable'}), 404


@app.route('/api/music/tracks/deactivate', methods=['POST'])
@require_auth
def api_music_deactivate_track():
    music_svc.set_active_track(None)
    _push_music_config()
    return jsonify({'success': True})


@app.route('/api/music/preview/<path:filename>')
@require_auth
def api_music_preview(filename):
    path = music_svc.get_track_path(filename)
    if not path:
        return jsonify({'success': False, 'message': 'Fichier introuvable'}), 404
    return send_from_directory(os.path.dirname(path), os.path.basename(path))


@app.route('/api/music/command', methods=['POST'])
@require_auth
def api_music_command():
    data = request.get_json() or {}
    command = data.get('command', '')
    if command not in ('play', 'pause', 'stop', 'resume', 'next', 'prev'):
        return jsonify({'success': False, 'message': 'Commande invalide'}), 400
    _send_ws_music_command(command, data)
    return jsonify({'success': True})


def _push_music_config():
    cfg = music_svc.get_playback_config()
    _send_ws_music_command('config_update', cfg)


def _send_ws_music_command(command: str, data: dict = None):
    ws = game_runtime.ws_server
    loop = game_runtime._ws_loop
    if ws and loop and not loop.is_closed():
        import asyncio
        asyncio.run_coroutine_threadsafe(
            ws.send_music_command(command, data or {}),
            loop
        )


def create_app():
    game_runtime.start_ws_server()
    return app


if __name__ == '__main__':
    print("=" * 50)
    print("  TikTok Quiz - Admin Panel")
    print("  http://localhost:5000")
    print("=" * 50)
    game_runtime.start_ws_server()
    app.run(host='0.0.0.0', port=5000, debug=False)
