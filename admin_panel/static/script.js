let pollingInterval = null;
let _pollInFlight = false;
let _pollErrorCount = 0;
let _status503Logged = false;
let _logs503Logged = false;
let _pollBackoffActive = false;
let logCursor = 0;
const LOG_DOM_MAX = 150;
let _lastLogLine = '';
let isRunning = false;
let isPaused = false;
let currentQnId = null;
let currentQnData = null;
let allQuestions = [];
let questionnairesCache = [];

const _origFetch = window.fetch.bind(window);
window.fetch = function(url, opts = {}) {
    return _origFetch(url, opts).then(resp => {
        if (resp.status === 401 && typeof url === 'string' && url.startsWith('/api/')) {
            window.location.href = '/login';
        }
        return resp;
    });
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

async function adminLogout() {
    try {
        await fetch('/logout', { method: 'POST' });
    } catch (e) {}
    window.location.href = '/login';
}

function switchTab(tabName) {
    console.log('[DIAG] switchTab:', tabName);
    $$('.tab').forEach(t => t.classList.remove('active'));
    $$('.tab-content').forEach(c => c.classList.remove('active'));
    $(`.tab[data-tab="${tabName}"]`).classList.add('active');
    $(`#tab-${tabName}`).classList.add('active');
    if (tabName === 'questionnaires') loadQuestionnaires();
    if (tabName === 'audio') loadAudioConfig();
    if (tabName === 'music') loadMusicConfig();
    if (tabName === 'ia') iaTabInit();
}

function onSimulateModeChange() {
    const simulate = $('#simulateMode').checked;
    const usernameInput = $('#username');
    usernameInput.disabled = simulate;
    if (simulate) {
        usernameInput.style.opacity = '0.4';
        usernameInput.style.cursor = 'not-allowed';
    } else {
        usernameInput.style.opacity = '';
        usernameInput.style.cursor = '';
    }
}

function getFormData() {
    const mode = $('#playMode').value;
    const simulate = $('#simulateMode').checked;
    const data = {
        username: simulate ? '' : $('#username').value.trim(),
        simulate: simulate,
        delay: parseInt($('#delay').value) || 3,
        questions: parseInt($('#questions').value) || 0,
        question_time: parseInt($('#questionTime').value) || 20,
        no_tts: $('#noTts').checked,
        play_mode: mode,
        x2_enabled: $('#x2Enabled').checked,
        x2_frequency: $('#x2Frequency').value
    };
    if (mode === 'single' || mode === 'infinite_single') {
        const sel = $('#qnSelector');
        if (sel.value) data.questionnaire_id = parseInt(sel.value);
    } else if (mode === 'sequential' || mode === 'infinite_all') {
        data.questionnaire_ids = questionnairesCache.filter(q => q.active).map(q => q.id);
    }
    return data;
}

function onX2EnabledChange() {
    const enabled = $('#x2Enabled').checked;
    $('#x2FrequencyGroup').style.display = enabled ? '' : 'none';
}

let currentServerState = 'stopped';

function updateUI(running, paused) {
    isRunning = running;
    if (paused !== undefined) isPaused = paused;

    const state = currentServerState;
    const isActive = state === 'running' || state === 'paused';
    const isTransitioning = state === 'starting' || state === 'stopping';

    $('#btnStart').disabled = isActive || isTransitioning;
    $('#btnStop').disabled = !isActive && state !== 'starting';
    $('#btnRestart').disabled = !isActive;
    $('#btnPause').disabled = state !== 'running' && state !== 'paused';

    const pauseLabel = $('#pauseLabel');
    const pauseIcon = $('#pauseIcon');
    if (state === 'paused') {
        pauseLabel.textContent = 'Reprendre';
        pauseIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
    } else {
        pauseLabel.textContent = 'Pause';
        pauseIcon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
    }

    const badge = $('#statusBadge');
    const statusText = badge.querySelector('.status-text');

    const stateLabels = {
        stopped: { text: 'Hors ligne', color: '#71717a', online: false },
        starting: { text: 'Demarrage...', color: '#3b82f6', online: true },
        running: { text: 'En ligne', color: '#22c55e', online: true },
        paused: { text: 'En pause', color: '#f59e0b', online: true },
        stopping: { text: 'Arret...', color: '#f59e0b', online: true },
        error: { text: 'Erreur', color: '#ef4444', online: false },
    };

    const info = stateLabels[state] || stateLabels.stopped;
    if (info.online) {
        badge.classList.add('online');
    } else {
        badge.classList.remove('online');
    }
    statusText.textContent = info.text;
    $('#infoStatus').textContent = info.text;
    $('#infoStatus').style.color = info.color;

    if (!isActive && !isTransitioning) {
        $('#infoUptime').textContent = '-';
        isPaused = false;
    }
}

function formatUptime(seconds) {
    if (!seconds && seconds !== 0) return '-';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function toast(message, type) {
    const container = $('#toastContainer');
    const el = document.createElement('div');
    el.className = `toast ${type}`;

    const icons = {
        success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>',
        error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
        info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    };

    el.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span class="toast-msg">${escapeHtml(message)}</span>`;
    container.appendChild(el);

    requestAnimationFrame(() => el.classList.add('show'));

    setTimeout(() => {
        el.classList.remove('show');
        el.classList.add('removing');
        setTimeout(() => el.remove(), 250);
    }, 3500);
}

function classifyLog(text) {
    if (text.includes('[Admin]')) return 'log-admin';
    if (text.includes('[Game]')) return 'log-game';
    if (text.includes('[ANSWER]')) return 'log-answer';
    if (text.includes('[PARSER]')) return 'log-parser';
    if (text.includes('[TIKTOK]')) return 'log-tiktok';
    if (text.includes('[Main]')) return 'log-main';
    if (text.includes('[ERREUR]') || text.includes('Error') || text.includes('Traceback')) return 'log-error';
    return '';
}

function appendLogs(lines) {
    const container = $('#logsContainer');
    const empty = $('#logsEmpty');

    if (lines.length === 0) return;
    if (empty) empty.style.display = 'none';

    const deduped = [];
    for (const line of lines) {
        if (line === _lastLogLine) continue;
        _lastLogLine = line;
        deduped.push(line);
    }
    if (deduped.length === 0) return;

    const fragment = document.createDocumentFragment();
    for (const line of deduped) {
        const div = document.createElement('div');
        div.className = `log-line ${classifyLog(line)}`;
        div.textContent = line;
        fragment.appendChild(div);
    }
    container.appendChild(fragment);

    const logLines = container.querySelectorAll('.log-line');
    const overflow = logLines.length - LOG_DOM_MAX;
    if (overflow > 0) {
        for (let i = 0; i < overflow; i++) {
            logLines[i].remove();
        }
    }

    if ($('#autoScroll').checked) {
        container.scrollTop = container.scrollHeight;
    }
}

async function fetchStatus() {
    try {
        const res = await fetch('/api/status');
        if (res.status === 503 || res.status === 504 || res.status === 429) {
            _pollErrorCount++;
            if (!_status503Logged) {
                console.warn(`[poll] /api/status ${res.status} — suppressing further errors until recovery`);
                _status503Logged = true;
            }
            if (!_pollBackoffActive && _pollErrorCount >= 2) {
                _pollBackoffActive = true;
                if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
                setTimeout(() => {
                    _pollBackoffActive = false;
                    _pollErrorCount = 0;
                    startPolling();
                }, 15000);
            }
            return;
        }
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) return;
        const data = await res.json();
        if (_status503Logged) {
            console.log('[poll] /api/status recovered');
            _status503Logged = false;
        }
        _pollErrorCount = 0;
        currentServerState = data.state || 'stopped';
        updateUI(data.running, data.paused);
        if (data.running || data.state === 'starting') {
            $('#infoUptime').textContent = formatUptime(data.uptime);
        }
        const engineEl = $('#infoEngineState');
        if (engineEl) {
            engineEl.textContent = data.engine_state || '-';
        }
        if (data.error) {
            const errEl = $('#infoStatus');
            if (errEl) errEl.title = data.error;
        }
    } catch (e) {}
}

async function fetchLogs() {
    try {
        const res = await fetch(`/api/logs?cursor=${logCursor}`);
        if (res.status === 503 || res.status === 504 || res.status === 429) {
            if (!_logs503Logged) {
                console.warn(`[poll] /api/logs ${res.status} — suppressing further errors until recovery`);
                _logs503Logged = true;
            }
            return;
        }
        if (_logs503Logged) {
            console.log('[poll] /api/logs recovered');
            _logs503Logged = false;
        }
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) return;
        const data = await res.json();
        if (data.logs && data.logs.length > 0) {
            appendLogs(data.logs);
        }
        if (data.cursor !== undefined) {
            logCursor = data.cursor;
        }
    } catch (e) {}
}

async function poll() {
    if (_pollInFlight) return;
    _pollInFlight = true;
    try {
        await Promise.all([fetchStatus(), fetchLogs()]);
    } finally {
        _pollInFlight = false;
    }
}

function startPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    poll();
    pollingInterval = setInterval(poll, 5000);
}

async function startGame() {
    const data = getFormData();
    if (!data.simulate && !data.username) {
        toast('Le pseudo TikTok est requis', 'error');
        $('#username').focus();
        return;
    }
    $('#btnStart').disabled = true;
    try {
        const res = await fetch('/api/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await res.json();
        if (result.success) {
            toast(result.message, 'success');
            currentServerState = 'starting';
            updateUI(false, false);
            fetchStatus();
        } else {
            toast(result.message, 'error');
            fetchStatus();
        }
    } catch (e) {
        toast('Erreur de connexion au serveur', 'error');
        fetchStatus();
    }
}

async function stopGame() {
    $('#btnStop').disabled = true;
    try {
        const res = await fetch('/api/stop', { method: 'POST' });
        const result = await res.json();
        if (result.success) {
            toast(result.message, 'success');
            currentServerState = 'stopping';
            updateUI(false, false);
        } else {
            toast(result.message, 'error');
        }
        fetchStatus();
    } catch (e) {
        toast('Erreur de connexion au serveur', 'error');
        fetchStatus();
    }
}

async function restartGame() {
    const data = getFormData();
    if (!data.simulate && !data.username) {
        toast('Le pseudo TikTok est requis', 'error');
        $('#username').focus();
        return;
    }
    $('#btnRestart').disabled = true;
    toast('Redemarrage en cours...', 'info');
    try {
        const res = await fetch('/api/restart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await res.json();
        if (result.success) {
            toast(result.message, 'success');
            currentServerState = 'starting';
            updateUI(false, false);
        } else {
            toast(result.message, 'error');
        }
        fetchStatus();
    } catch (e) {
        toast('Erreur de connexion au serveur', 'error');
        fetchStatus();
    }
}

async function togglePause() {
    const endpoint = currentServerState === 'paused' ? '/api/resume' : '/api/pause';
    $('#btnPause').disabled = true;
    try {
        const res = await fetch(endpoint, { method: 'POST' });
        let result;
        try {
            result = await res.json();
        } catch (jsonErr) {
            toast('Erreur serveur (reponse invalide, code ' + res.status + ')', 'error');
            fetchStatus();
            return;
        }
        if (result.success) {
            toast(result.message, 'success');
        } else {
            toast(result.message || 'Operation impossible', 'error');
        }
        fetchStatus();
    } catch (e) {
        toast('Le serveur admin ne repond pas.', 'error');
        fetchStatus();
    }
}

async function clearLogs() {
    try {
        const res = await fetch('/api/logs/clear', { method: 'POST' });
        const data = await res.json();
        if (data.cursor !== undefined) logCursor = data.cursor;
        _lastLogLine = '';
        const container = $('#logsContainer');
        container.innerHTML = '<div class="logs-empty" id="logsEmpty">Aucun log pour le moment</div>';
    } catch (e) {
        toast('Erreur lors de l\'effacement des logs', 'error');
    }
}

function initOverlayUrl() {
    const url = window.location.origin + '/overlay';
    const el = $('#overlayUrl');
    if (el) el.textContent = url;
}

async function copyOverlayUrl() {
    const url = window.location.origin + '/overlay';
    try {
        await navigator.clipboard.writeText(url);
        toast('Lien overlay copie !', 'success');
    } catch (e) {
        const el = $('#overlayUrl');
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('copy');
        sel.removeAllRanges();
        toast('Lien overlay copie !', 'success');
    }
}

function openModal(title, bodyHTML) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = bodyHTML;
    const overlay = $('#modalOverlay');
    overlay.classList.add('active');
    const firstInput = overlay.querySelector('input[type="text"], textarea');
    if (firstInput) setTimeout(() => firstInput.focus(), 100);
}

function closeModal(e) {
    if (e && e.target && e.target.id !== 'modalOverlay') return;
    const overlay = $('#modalOverlay');
    overlay.classList.remove('active');
    setTimeout(() => { $('#modalBody').innerHTML = ''; }, 200);
}

async function loadQuestionnaires() {
    try {
        const res = await fetch('/api/questionnaires');
        const data = await res.json();
        questionnairesCache = data;
        renderQnList(data);
        populateQnSelector(data);
    } catch (e) {
        toast('Erreur de chargement des questionnaires', 'error');
    }
}

function populateQnSelector(list) {
    const sel = $('#qnSelector');
    const prev = sel.value;
    sel.innerHTML = '';
    const active = list.filter(q => q.active !== false);
    if (active.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'Aucun questionnaire actif';
        sel.appendChild(opt);
    } else {
        active.forEach(q => {
            const opt = document.createElement('option');
            opt.value = q.id;
            opt.textContent = q.name + (q.question_count !== undefined ? ` (${q.question_count}q)` : '');
            sel.appendChild(opt);
        });
    }
    if (prev && sel.querySelector(`option[value="${prev}"]`)) {
        sel.value = prev;
    }
    updateLaunchSummary();
}

function renderQnList(list) {
    const container = $('#qnList');
    if (!list || list.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></div><h3>Aucun questionnaire</h3><p>Cliquez sur "+ Nouveau" pour creer votre premier questionnaire</p></div>';
        return;
    }
    container.innerHTML = '';
    list.forEach(q => {
        const card = document.createElement('div');
        card.className = 'qn-card';
        card.setAttribute('data-id', q.id);

        const activeBadge = q.active !== false
            ? '<span class="badge badge-active"><span class="badge-dot active"></span>Actif</span>'
            : '<span class="badge badge-inactive"><span class="badge-dot"></span>Inactif</span>';

        const count = q.question_count !== undefined ? q.question_count : '?';
        const activeCount = q.active_question_count !== undefined ? q.active_question_count : count;

        card.innerHTML =
            '<div class="qn-card-top" onclick="openQuestionnaire(' + q.id + ')">' +
                '<div class="qn-card-info">' +
                    '<h3 class="qn-card-name">' + escapeHtml(q.name) + '</h3>' +
                    (q.description ? '<p class="qn-card-desc">' + escapeHtml(q.description) + '</p>' : '') +
                '</div>' +
                '<div class="qn-card-badges">' +
                    activeBadge +
                    '<span class="badge badge-count"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' + activeCount + '/' + count + '</span>' +
                    (q.category ? '<span class="badge badge-cat">' + escapeHtml(q.category) + '</span>' : '') +
                '</div>' +
            '</div>' +
            '<div class="qn-card-actions">' +
                '<button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();openQuestionnaire(' + q.id + ')" title="Ouvrir"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg> Ouvrir</button>' +
                '<button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();editQuestionnaireModal(' + q.id + ')" title="Modifier"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Modifier</button>' +
                '<button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();duplicateQuestionnaire(' + q.id + ')" title="Dupliquer"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Dupliquer</button>' +
                '<button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();toggleQnActive(' + q.id + ', ' + (q.active !== false) + ')" title="' + (q.active !== false ? 'Desactiver' : 'Activer') + '">' + (q.active !== false ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> Desactiver' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg> Activer') + '</button>' +
                '<button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();exportQuestionnaire(' + q.id + ')" title="Exporter"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Exporter</button>' +
                '<button class="btn btn-ghost btn-xs btn-danger" onclick="event.stopPropagation();deleteQuestionnaire(' + q.id + ')" title="Supprimer"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg> Supprimer</button>' +
            '</div>';
        container.appendChild(card);
    });
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function escapeAttr(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function createQuestionnaire() {
    const html =
        '<form onsubmit="submitCreateQn(event)">' +
            '<div class="form-group">' +
                '<label>Nom</label>' +
                '<input type="text" id="mqnName" class="modal-input" placeholder="Ex: Culture Generale" required>' +
            '</div>' +
            '<div class="form-group">' +
                '<label>Description</label>' +
                '<textarea id="mqnDesc" class="modal-input" rows="2" placeholder="Description optionnelle..."></textarea>' +
            '</div>' +
            '<div class="form-group">' +
                '<label>Categorie</label>' +
                '<input type="text" id="mqnCat" class="modal-input" placeholder="Ex: general, sport, science...">' +
            '</div>' +
            '<div class="modal-actions">' +
                '<button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button>' +
                '<button type="submit" class="btn btn-primary">Creer</button>' +
            '</div>' +
        '</form>';
    openModal('Nouveau questionnaire', html);
}

async function submitCreateQn(e) {
    e.preventDefault();
    const body = {
        name: $('#mqnName').value.trim(),
        description: $('#mqnDesc').value.trim(),
        category: $('#mqnCat').value.trim()
    };
    if (!body.name) {
        toast('Le nom est requis', 'error');
        return;
    }
    try {
        const res = await fetch('/api/questionnaires', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const result = await res.json();
        if (res.ok && result.success) {
            toast('Questionnaire cree', 'success');
            closeModal();
            loadQuestionnaires();
        } else {
            toast(result.message || 'Erreur', 'error');
        }
    } catch (e) {
        toast('Erreur de connexion', 'error');
    }
}

async function editQuestionnaireModal(id) {
    try {
        const res = await fetch('/api/questionnaires/' + id);
        const q = await res.json();
        const html =
            '<form onsubmit="submitEditQn(event, ' + id + ')">' +
                '<div class="form-group">' +
                    '<label>Nom</label>' +
                    '<input type="text" id="mqnName" class="modal-input" value="' + escapeAttr(q.name) + '" required>' +
                '</div>' +
                '<div class="form-group">' +
                    '<label>Description</label>' +
                    '<textarea id="mqnDesc" class="modal-input" rows="2">' + escapeHtml(q.description || '') + '</textarea>' +
                '</div>' +
                '<div class="form-group">' +
                    '<label>Categorie</label>' +
                    '<input type="text" id="mqnCat" class="modal-input" value="' + escapeAttr(q.category || '') + '">' +
                '</div>' +
                '<div class="modal-actions">' +
                    '<button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button>' +
                    '<button type="submit" class="btn btn-primary">Enregistrer</button>' +
                '</div>' +
            '</form>';
        openModal('Modifier questionnaire', html);
    } catch (e) {
        toast('Erreur de chargement', 'error');
    }
}

async function submitEditQn(e, id) {
    e.preventDefault();
    const body = {
        name: $('#mqnName').value.trim(),
        description: $('#mqnDesc').value.trim(),
        category: $('#mqnCat').value.trim()
    };
    if (!body.name) {
        toast('Le nom est requis', 'error');
        return;
    }
    try {
        const res = await fetch('/api/questionnaires/' + id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const result = await res.json();
        if (res.ok && result.success) {
            toast('Questionnaire mis a jour', 'success');
            closeModal();
            loadQuestionnaires();
            if (currentQnId === id) {
                openQuestionnaire(id);
            }
        } else {
            toast(result.message || 'Erreur', 'error');
        }
    } catch (e) {
        toast('Erreur de connexion', 'error');
    }
}

async function deleteQuestionnaire(id) {
    if (!confirm('Supprimer ce questionnaire et toutes ses questions ?')) return;
    try {
        const res = await fetch('/api/questionnaires/' + id, { method: 'DELETE' });
        if (res.ok) {
            toast('Questionnaire supprime', 'success');
            if (currentQnId === id) backToList();
            loadQuestionnaires();
        } else {
            toast('Erreur de suppression', 'error');
        }
    } catch (e) {
        toast('Erreur de connexion', 'error');
    }
}

async function duplicateQuestionnaire(id) {
    try {
        const res = await fetch('/api/questionnaires/' + id + '/duplicate', { method: 'POST' });
        const result = await res.json();
        if (res.ok && result.success) {
            toast('Questionnaire duplique (nouveau fichier cree)', 'success');
            loadQuestionnaires();
        } else {
            toast(result.message || 'Erreur de duplication', 'error');
        }
    } catch (e) {
        toast('Erreur de connexion', 'error');
    }
}

async function toggleQnActive(id, currentlyActive) {
    try {
        const res = await fetch('/api/questionnaires/' + id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ active: !currentlyActive })
        });
        if (res.ok) {
            toast(currentlyActive ? 'Questionnaire desactive' : 'Questionnaire active', 'success');
            loadQuestionnaires();
        } else {
            toast('Erreur', 'error');
        }
    } catch (e) {
        toast('Erreur de connexion', 'error');
    }
}

async function exportQuestionnaire(id) {
    try {
        const res = await fetch('/api/questionnaires/' + id + '/export');
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (data.name || 'questionnaire') + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast('Export telecharge', 'success');
    } catch (e) {
        toast('Erreur d\'export', 'error');
    }
}

function exportCurrentQn() {
    if (currentQnId) exportQuestionnaire(currentQnId);
}

function editQuestionnaireInfo() {
    if (currentQnId) editQuestionnaireModal(currentQnId);
}

function importQuestionnairePrompt() {
    const html =
        '<form onsubmit="submitImportQn(event)">' +
            '<div class="form-group">' +
                '<label>Fichier JSON</label>' +
                '<div class="file-upload-zone" id="fileDropZone">' +
                    '<input type="file" id="mqnFile" accept=".json" class="file-input-hidden" required>' +
                    '<div class="file-upload-content">' +
                        '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>' +
                        '<span class="file-upload-text">Glissez un fichier ou cliquez pour parcourir</span>' +
                        '<span class="file-upload-name" id="importFileName"></span>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="form-group">' +
                '<label>Mode</label>' +
                '<select id="mqnImportMode" class="modal-input select-input">' +
                    '<option value="create">Creer un nouveau questionnaire</option>' +
                    '<option value="merge">Fusionner dans un existant</option>' +
                '</select>' +
            '</div>' +
            '<div class="form-group" id="mqnMergeTarget" style="display:none;">' +
                '<label>Questionnaire cible</label>' +
                '<select id="mqnMergeId" class="modal-input select-input"></select>' +
            '</div>' +
            '<div class="modal-actions">' +
                '<button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button>' +
                '<button type="submit" class="btn btn-primary">Importer</button>' +
            '</div>' +
        '</form>';
    openModal('Importer un questionnaire', html);

    const fileInput = $('#mqnFile');
    const dropZone = $('#fileDropZone');
    const fileName = $('#importFileName');

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            fileInput.files = e.dataTransfer.files;
            fileName.textContent = e.dataTransfer.files[0].name;
            dropZone.classList.add('has-file');
        }
    });
    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
            fileName.textContent = fileInput.files[0].name;
            dropZone.classList.add('has-file');
        }
    });

    const modeSelect = $('#mqnImportMode');
    const mergeTarget = $('#mqnMergeTarget');
    const mergeId = $('#mqnMergeId');

    modeSelect.addEventListener('change', function() {
        if (this.value === 'merge') {
            mergeTarget.style.display = '';
            mergeId.innerHTML = '';
            questionnairesCache.forEach(q => {
                const opt = document.createElement('option');
                opt.value = q.id;
                opt.textContent = q.name;
                mergeId.appendChild(opt);
            });
        } else {
            mergeTarget.style.display = 'none';
        }
    });
}

async function submitImportQn(e) {
    e.preventDefault();
    const file = $('#mqnFile').files[0];
    if (!file) {
        toast('Selectionnez un fichier JSON', 'error');
        return;
    }
    try {
        const text = await file.text();
        const data = JSON.parse(text);
        const mode = $('#mqnImportMode').value;
        const body = { data: data };
        if (mode === 'merge') {
            body.merge_into_id = parseInt($('#mqnMergeId').value);
            body.mode = 'merge';
        }
        const res = await fetch('/api/questionnaires/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const result = await res.json();
        if (res.ok && result.success) {
            const r = result.report || {};
            toast(`Import reussi: ${r.imported || 0} question(s) importee(s)`, 'success');
            closeModal();
            loadQuestionnaires();
        } else {
            toast(result.message || 'Erreur d\'import', 'error');
        }
    } catch (e) {
        toast('Fichier JSON invalide', 'error');
    }
}

async function openQuestionnaire(id) {
    currentQnId = id;
    try {
        const res = await fetch('/api/questionnaires/' + id);
        currentQnData = await res.json();

        $('#qnDetailName').textContent = currentQnData.name;
        const meta = [];
        if (currentQnData.category) meta.push(currentQnData.category);
        if (currentQnData.questions) meta.push(currentQnData.questions.length + ' questions');
        if (currentQnData.description) meta.push(currentQnData.description);
        $('#qnDetailMeta').textContent = meta.join(' -- ');

        allQuestions = currentQnData.questions || [];
        renderQuestions(allQuestions);

        $('#qnListView').style.display = 'none';
        $('#qnDetailView').style.display = '';
        $('#qSearch').value = '';
        loadQnAudioStatus();
    } catch (e) {
        toast('Erreur de chargement', 'error');
    }
}

function backToList() {
    currentQnId = null;
    currentQnData = null;
    allQuestions = [];
    $('#qnListView').style.display = '';
    $('#qnDetailView').style.display = 'none';
    loadQuestionnaires();
}

function renderQuestions(questions) {
    const container = $('#questionsList');
    if (!questions || questions.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div><h3>Aucune question</h3><p>Cliquez sur "+ Question" pour ajouter votre premiere question</p></div>';
        return;
    }
    container.innerHTML = '';
    questions.forEach((q, idx) => {
        const card = document.createElement('div');
        card.className = 'q-card';

        const typeBadge = q.type === 'double'
            ? '<span class="badge badge-double">Double</span>'
            : '<span class="badge badge-standard">Standard</span>';

        const diffLabels = { 1: 'Facile', 2: 'Moyen', 3: 'Difficile', 'easy': 'Facile', 'medium': 'Moyen', 'hard': 'Difficile' };
        const diffClass = { 1: 'easy', 2: 'medium', 3: 'hard', 'easy': 'easy', 'medium': 'medium', 'hard': 'hard' };
        const diffBadge = q.difficulty
            ? '<span class="badge badge-diff badge-diff-' + (diffClass[q.difficulty] || 'easy') + '">' + (diffLabels[q.difficulty] || q.difficulty) + '</span>'
            : '';

        const activeBadge = q.active === false
            ? '<span class="badge badge-inactive"><span class="badge-dot"></span>Inactif</span>'
            : '';

        let correctDisplay = '';
        if (q.type === 'double' && q.correct_answers) {
            correctDisplay = q.correct_answers.join(', ');
        } else {
            correctDisplay = q.correct_answer || '';
        }

        const choicesHtml = q.choices
            ? Object.entries(q.choices).map(([k, v]) => {
                const isCorrect = q.type === 'double'
                    ? (q.correct_answers && q.correct_answers.includes(k))
                    : k === q.correct_answer;
                return '<span class="q-choice' + (isCorrect ? ' q-choice-correct' : '') + '"><strong>' + k + '</strong> ' + escapeHtml(v) + '</span>';
            }).join('')
            : '';

        card.innerHTML =
            '<div class="q-card-top">' +
                '<span class="q-number">' + (idx + 1) + '</span>' +
                '<div class="q-card-text">' + escapeHtml(q.text) + '</div>' +
                '<div class="q-badges">' + typeBadge + diffBadge + activeBadge + '</div>' +
            '</div>' +
            '<div class="q-choices">' + choicesHtml + '</div>' +
            '<div class="q-card-bottom">' +
                '<div class="q-card-actions">' +
                    '<button class="btn btn-ghost btn-xs" onclick="editQuestion(' + currentQnId + ', ' + q.id + ')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Modifier</button>' +
                    '<button class="btn btn-ghost btn-xs" onclick="duplicateQuestion(' + currentQnId + ', ' + q.id + ')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Dupliquer</button>' +
                    '<button class="btn btn-ghost btn-xs" onclick="moveQuestionPrompt(' + currentQnId + ', ' + q.id + ')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg> Deplacer</button>' +
                    '<button class="btn btn-ghost btn-xs btn-danger" onclick="deleteQuestion(' + currentQnId + ', ' + q.id + ')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg> Supprimer</button>' +
                '</div>' +
            '</div>';
        container.appendChild(card);
    });
}

function buildQuestionFormHtml(q) {
    const text = q ? escapeAttr(q.text) : '';
    const cA = q && q.choices ? escapeAttr(q.choices.A || '') : '';
    const cB = q && q.choices ? escapeAttr(q.choices.B || '') : '';
    const cC = q && q.choices ? escapeAttr(q.choices.C || '') : '';
    const cD = q && q.choices ? escapeAttr(q.choices.D || '') : '';
    const cat = q ? escapeAttr(q.category || '') : '';
    const diff = q ? (q.difficulty || '') : '';
    const type = q ? (q.type || 'standard') : 'standard';
    const correct = q ? (q.correct_answer || 'A') : 'A';
    const correctAnswers = q && q.correct_answers ? q.correct_answers : [];

    return '<div class="form-group">' +
            '<label>Texte de la question</label>' +
            '<textarea id="mqText" class="modal-input" rows="3" placeholder="Saisissez la question..." required>' + (q ? escapeHtml(q.text) : '') + '</textarea>' +
        '</div>' +
        '<div class="form-row">' +
            '<div class="form-group"><label>Choix A</label><input type="text" id="mqA" class="modal-input" value="' + cA + '" placeholder="Reponse A" required></div>' +
            '<div class="form-group"><label>Choix B</label><input type="text" id="mqB" class="modal-input" value="' + cB + '" placeholder="Reponse B" required></div>' +
        '</div>' +
        '<div class="form-row">' +
            '<div class="form-group"><label>Choix C</label><input type="text" id="mqC" class="modal-input" value="' + cC + '" placeholder="Reponse C" required></div>' +
            '<div class="form-group"><label>Choix D</label><input type="text" id="mqD" class="modal-input" value="' + cD + '" placeholder="Reponse D" required></div>' +
        '</div>' +
        '<div class="form-row">' +
            '<div class="form-group">' +
                '<label>Type</label>' +
                '<select id="mqType" class="modal-input select-input" onchange="onQuestionTypeChange()">' +
                    '<option value="standard"' + (type === 'standard' ? ' selected' : '') + '>Standard</option>' +
                    '<option value="double"' + (type === 'double' ? ' selected' : '') + '>Double</option>' +
                '</select>' +
            '</div>' +
            '<div class="form-group" id="mqCorrectGroup">' +
                '<label>Reponse correcte</label>' +
                '<select id="mqCorrect" class="modal-input select-input">' +
                    '<option value="A"' + (correct === 'A' ? ' selected' : '') + '>A</option>' +
                    '<option value="B"' + (correct === 'B' ? ' selected' : '') + '>B</option>' +
                    '<option value="C"' + (correct === 'C' ? ' selected' : '') + '>C</option>' +
                    '<option value="D"' + (correct === 'D' ? ' selected' : '') + '>D</option>' +
                '</select>' +
            '</div>' +
        '</div>' +
        '<div class="form-group" id="mqCorrectAnswersGroup" style="' + (type === 'double' ? '' : 'display:none;') + '">' +
            '<label>Reponses correctes (double)</label>' +
            '<div class="checkbox-row">' +
                '<label class="checkbox-label"><input type="checkbox" id="mqCA_A" ' + (correctAnswers.includes('A') ? 'checked' : '') + '><span class="checkbox-custom"></span>A</label>' +
                '<label class="checkbox-label"><input type="checkbox" id="mqCA_B" ' + (correctAnswers.includes('B') ? 'checked' : '') + '><span class="checkbox-custom"></span>B</label>' +
                '<label class="checkbox-label"><input type="checkbox" id="mqCA_C" ' + (correctAnswers.includes('C') ? 'checked' : '') + '><span class="checkbox-custom"></span>C</label>' +
                '<label class="checkbox-label"><input type="checkbox" id="mqCA_D" ' + (correctAnswers.includes('D') ? 'checked' : '') + '><span class="checkbox-custom"></span>D</label>' +
            '</div>' +
        '</div>' +
        '<div class="form-row">' +
            '<div class="form-group">' +
                '<label>Categorie</label>' +
                '<input type="text" id="mqCat" class="modal-input" value="' + cat + '" placeholder="Ex: geographie">' +
            '</div>' +
            '<div class="form-group">' +
                '<label>Difficulte</label>' +
                '<select id="mqDiff" class="modal-input select-input">' +
                    '<option value=""' + (diff === '' ? ' selected' : '') + '>Non defini</option>' +
                    '<option value="easy"' + (diff === 'easy' || diff === 1 ? ' selected' : '') + '>Facile</option>' +
                    '<option value="medium"' + (diff === 'medium' || diff === 2 ? ' selected' : '') + '>Moyen</option>' +
                    '<option value="hard"' + (diff === 'hard' || diff === 3 ? ' selected' : '') + '>Difficile</option>' +
                '</select>' +
            '</div>' +
        '</div>';
}

function onQuestionTypeChange() {
    const type = $('#mqType').value;
    const correctGroup = $('#mqCorrectGroup');
    const correctAnswersGroup = $('#mqCorrectAnswersGroup');
    if (type === 'double') {
        correctGroup.style.display = 'none';
        correctAnswersGroup.style.display = '';
    } else {
        correctGroup.style.display = '';
        correctAnswersGroup.style.display = 'none';
    }
}

function getQuestionFormData() {
    const type = $('#mqType').value;
    const data = {
        text: $('#mqText').value.trim(),
        choices: {
            A: $('#mqA').value.trim(),
            B: $('#mqB').value.trim(),
            C: $('#mqC').value.trim(),
            D: $('#mqD').value.trim()
        },
        category: $('#mqCat').value.trim(),
        difficulty: $('#mqDiff').value,
        type: type
    };
    if (type === 'double') {
        const answers = [];
        if ($('#mqCA_A').checked) answers.push('A');
        if ($('#mqCA_B').checked) answers.push('B');
        if ($('#mqCA_C').checked) answers.push('C');
        if ($('#mqCA_D').checked) answers.push('D');
        data.correct_answers = answers;
        data.correct_answer = answers[0] || 'A';
    } else {
        data.correct_answer = $('#mqCorrect').value;
    }
    return data;
}

function addQuestion() {
    const formHtml = buildQuestionFormHtml(null);
    const html =
        '<form onsubmit="submitAddQuestion(event)">' +
            formHtml +
            '<div class="modal-actions">' +
                '<button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button>' +
                '<button type="submit" class="btn btn-primary">Ajouter</button>' +
            '</div>' +
        '</form>';
    openModal('Nouvelle question', html);
}

async function submitAddQuestion(e) {
    e.preventDefault();
    const data = getQuestionFormData();
    if (!data.text) {
        toast('Le texte est requis', 'error');
        return;
    }
    if (!data.choices.A || !data.choices.B) {
        toast('Les choix A et B sont requis au minimum', 'error');
        return;
    }
    try {
        const res = await fetch('/api/questionnaires/' + currentQnId + '/questions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await res.json();
        if (res.ok && result.success) {
            toast('Question ajoutee', 'success');
            closeModal();
            openQuestionnaire(currentQnId);
        } else {
            toast(result.message || 'Erreur', 'error');
        }
    } catch (e) {
        toast('Erreur de connexion', 'error');
    }
}

async function editQuestion(qnId, qId) {
    let q = allQuestions.find(x => x.id === qId);
    if (!q) {
        try {
            const res = await fetch('/api/questionnaires/' + qnId + '/questions');
            const questions = await res.json();
            q = questions.find(x => x.id === qId);
        } catch (e) {
            toast('Erreur de chargement', 'error');
            return;
        }
    }
    if (!q) {
        toast('Question introuvable', 'error');
        return;
    }
    const formHtml = buildQuestionFormHtml(q);
    const html =
        '<form onsubmit="submitEditQuestion(event, ' + qnId + ', ' + qId + ')">' +
            formHtml +
            '<div class="modal-actions">' +
                '<button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button>' +
                '<button type="submit" class="btn btn-primary">Enregistrer</button>' +
            '</div>' +
        '</form>';
    openModal('Modifier la question', html);
    onQuestionTypeChange();
}

async function submitEditQuestion(e, qnId, qId) {
    e.preventDefault();
    const data = getQuestionFormData();
    if (!data.text) {
        toast('Le texte est requis', 'error');
        return;
    }
    try {
        const res = await fetch('/api/questionnaires/' + qnId + '/questions/' + qId, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await res.json();
        if (res.ok && result.success) {
            toast('Question mise a jour', 'success');
            closeModal();
            openQuestionnaire(qnId);
        } else {
            toast(result.message || 'Erreur', 'error');
        }
    } catch (e) {
        toast('Erreur de connexion', 'error');
    }
}

async function deleteQuestion(qnId, qId) {
    if (!confirm('Supprimer cette question ?')) return;
    try {
        const res = await fetch('/api/questionnaires/' + qnId + '/questions/' + qId, { method: 'DELETE' });
        if (res.ok) {
            toast('Question supprimee', 'success');
            openQuestionnaire(qnId);
        } else {
            toast('Erreur de suppression', 'error');
        }
    } catch (e) {
        toast('Erreur de connexion', 'error');
    }
}

async function duplicateQuestion(qnId, qId) {
    try {
        const res = await fetch('/api/questionnaires/' + qnId + '/questions/' + qId + '/duplicate', { method: 'POST' });
        if (res.ok) {
            toast('Question dupliquee', 'success');
            openQuestionnaire(qnId);
        } else {
            toast('Erreur de duplication', 'error');
        }
    } catch (e) {
        toast('Erreur de connexion', 'error');
    }
}

function moveQuestionPrompt(qnId, qId) {
    const others = questionnairesCache.filter(q => q.id !== qnId);
    if (others.length === 0) {
        toast('Aucun autre questionnaire disponible', 'error');
        return;
    }
    let opts = '';
    others.forEach(q => {
        opts += '<option value="' + q.id + '">' + escapeHtml(q.name) + '</option>';
    });
    const html =
        '<form onsubmit="submitMoveQuestion(event, ' + qnId + ', ' + qId + ')">' +
            '<div class="form-group">' +
                '<label>Deplacer vers</label>' +
                '<select id="mqMoveTo" class="modal-input select-input">' + opts + '</select>' +
            '</div>' +
            '<div class="modal-actions">' +
                '<button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button>' +
                '<button type="submit" class="btn btn-primary">Deplacer</button>' +
            '</div>' +
        '</form>';
    openModal('Deplacer la question', html);
}

async function submitMoveQuestion(e, qnId, qId) {
    e.preventDefault();
    const toId = parseInt($('#mqMoveTo').value);
    try {
        const res = await fetch('/api/questionnaires/' + qnId + '/questions/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question_id: qId, to_questionnaire_id: toId })
        });
        const result = await res.json();
        if (res.ok && result.success) {
            toast('Question deplacee', 'success');
            closeModal();
            openQuestionnaire(qnId);
        } else {
            toast(result.message || 'Erreur', 'error');
        }
    } catch (e) {
        toast('Erreur de connexion', 'error');
    }
}

function searchQuestions() {
    const query = $('#qSearch').value.trim().toLowerCase();
    if (!query) {
        renderQuestions(allQuestions);
        return;
    }
    const filtered = allQuestions.filter(q => {
        if (q.text && q.text.toLowerCase().includes(query)) return true;
        if (q.category && q.category.toLowerCase().includes(query)) return true;
        if (q.choices) {
            for (const v of Object.values(q.choices)) {
                if (v && v.toLowerCase().includes(query)) return true;
            }
        }
        return false;
    });
    renderQuestions(filtered);
}

function importQuestionsPrompt() {
    const html =
        '<form onsubmit="submitImportQuestions(event)">' +
            '<div class="form-group">' +
                '<label>Fichier JSON (tableau de questions ou questionnaire complet)</label>' +
                '<div class="file-upload-zone" id="fileDropZone2">' +
                    '<input type="file" id="mqFile" accept=".json" class="file-input-hidden" required>' +
                    '<div class="file-upload-content">' +
                        '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>' +
                        '<span class="file-upload-text">Glissez un fichier ou cliquez pour parcourir</span>' +
                        '<span class="file-upload-name" id="importFileName2"></span>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="form-group">' +
                '<label>Mode</label>' +
                '<select id="mqImportMode" class="modal-input select-input">' +
                    '<option value="add">Ajouter aux existantes</option>' +
                    '<option value="replace">Remplacer les existantes</option>' +
                '</select>' +
            '</div>' +
            '<div class="modal-actions">' +
                '<button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button>' +
                '<button type="submit" class="btn btn-primary">Importer</button>' +
            '</div>' +
        '</form>';
    openModal('Importer des questions', html);

    const fileInput = $('#mqFile');
    const dropZone = $('#fileDropZone2');
    const fileName = $('#importFileName2');

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            fileInput.files = e.dataTransfer.files;
            fileName.textContent = e.dataTransfer.files[0].name;
            dropZone.classList.add('has-file');
        }
    });
    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
            fileName.textContent = fileInput.files[0].name;
            dropZone.classList.add('has-file');
        }
    });
}

async function submitImportQuestions(e) {
    e.preventDefault();
    const file = $('#mqFile').files[0];
    if (!file) {
        toast('Selectionnez un fichier JSON', 'error');
        return;
    }
    try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const mode = $('#mqImportMode').value;
        let questions;
        if (Array.isArray(parsed)) {
            questions = parsed;
        } else if (parsed.questions && Array.isArray(parsed.questions)) {
            questions = parsed.questions;
        } else {
            toast('Format invalide: attendu un tableau de questions ou un objet avec "questions"', 'error');
            return;
        }
        const body = { questions: questions, mode: mode };
        const res = await fetch('/api/questionnaires/' + currentQnId + '/questions/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const result = await res.json();
        if (res.ok && result.success) {
            const r = result.report || {};
            toast(`Import: ${r.imported || 0} ajoutee(s), ${r.duplicates || 0} doublon(s)`, 'success');
            closeModal();
            openQuestionnaire(currentQnId);
        } else {
            toast(result.message || 'Erreur d\'import', 'error');
        }
    } catch (e) {
        toast('Fichier JSON invalide', 'error');
    }
}

function onPlayModeChange() {
    const mode = $('#playMode').value;
    const group = $('#qnSelectorGroup');
    if (mode === 'single' || mode === 'infinite_single') {
        group.style.display = '';
    } else {
        group.style.display = 'none';
    }
    updateLaunchSummary();
}

function updateLaunchSummary() {
    const mode = $('#playMode').value;
    const el = $('#launchSummary');
    const sel = $('#qnSelector');

    const labels = {
        single: 'Questionnaire unique',
        sequential: 'Sequentiel (tous, une fois)',
        infinite_all: 'Boucle infinie (tous)',
        infinite_single: 'Boucle infinie (un seul)'
    };

    let text = labels[mode] || mode;

    if (mode === 'single' || mode === 'infinite_single') {
        const opt = sel.options[sel.selectedIndex];
        if (opt && opt.value) {
            text += ' : ' + opt.textContent;
        } else {
            text += ' : aucun questionnaire selectionne';
        }
    } else {
        const activeCount = questionnairesCache.filter(q => q.active !== false).length;
        text += ' : ' + activeCount + ' questionnaire(s) actif(s)';
    }

    el.textContent = text;
}

async function onTemplateChange() {
    const template = $('#overlayTemplate').value;
    try {
        const res = await fetch('/api/template', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ template })
        });
        const result = await res.json();
        if (result.success) {
            toast('Template overlay: ' + template, 'success');
        } else {
            toast(result.message || 'Erreur', 'error');
        }
    } catch (e) {
        toast('Erreur de connexion', 'error');
    }
}

async function loadCurrentTemplate() {
    try {
        const res = await fetch('/api/template');
        const data = await res.json();
        if (data.template) {
            $('#overlayTemplate').value = data.template;
        }
    } catch (e) {}
}

let audioConfig = null;
let audioJobPollers = {};
let audioPreviewAudio = null;

async function loadAudioConfig() {
    console.log('[DIAG] loadAudioConfig called');
    try {
        const res = await fetch('/api/audio/config');
        console.log('[DIAG] loadAudioConfig: /api/audio/config status=' + res.status);
        if (!res.ok) {
            toast('Erreur serveur audio (HTTP ' + res.status + ')', 'error');
            return;
        }
        audioConfig = await res.json();
        console.log('[DIAG] loadAudioConfig: config loaded, provider=' + audioConfig.provider);
        await renderAudioConfig(audioConfig);
        console.log('[DIAG] loadAudioConfig: renderAudioConfig done');
        await loadAudioStatus();
        console.log('[DIAG] loadAudioConfig: loadAudioStatus done');
        await loadAudioFiles();
        console.log('[DIAG] loadAudioConfig: loadAudioFiles done');
    } catch (e) {
        console.error('[DIAG] loadAudioConfig CATCH error:', e);
        toast('Erreur de chargement config audio - verifiez que Flask tourne sur le port 5000', 'error');
    }
}

async function renderAudioConfig(cfg) {
    const provider = cfg.provider || 'openai';
    $('#audioProvider').value = provider;

    const openaiCfg = cfg.providers?.openai || {};
    const elCfg = cfg.providers?.elevenlabs || {};
    const azCfg = cfg.providers?.azure || {};

    $('#keyOpenai').value = '';
    $('#keyOpenai').placeholder = openaiCfg.api_key || 'sk-...';
    $('#keyElevenlabs').value = '';
    $('#keyElevenlabs').placeholder = elCfg.api_key || 'xi-...';
    $('#keyAzure').value = '';
    $('#keyAzure').placeholder = azCfg.api_key || '...';
    $('#azureRegion').value = azCfg.region || 'westeurope';

    $('#audioSpeed').value = openaiCfg.speed || 1.0;

    const elStab = $('#elStability');
    const elSim = $('#elSimilarity');
    if (elStab) elStab.value = elCfg.stability ?? 0.5;
    if (elSim) elSim.value = elCfg.similarity_boost ?? 0.75;

    try {
        await Promise.all([
            loadAudioLanguages(cfg.language || 'fr-FR'),
            loadAudioModels(provider, cfg),
            loadAudioVoices(provider)
        ]);
    } catch (e) {
        console.error('renderAudioConfig: error loading selects:', e);
    }

    renderAudioWords(cfg.texts?.words || {});
    renderAudioPhrases(cfg.texts?.phrases || {});

    showProviderSections(provider);
    updateAudioConfigSummary();
}

async function loadAudioLanguages(selectedLang) {
    try {
        const res = await fetch('/api/audio/languages');
        if (!res.ok) return;
        const data = await res.json();
        const sel = $('#audioLanguage');
        if (!sel) return;
        sel.innerHTML = '';
        (data.languages || []).forEach(l => {
            const opt = document.createElement('option');
            opt.value = l.id;
            opt.textContent = l.name;
            sel.appendChild(opt);
        });
        if (selectedLang && sel.querySelector(`option[value="${selectedLang}"]`)) {
            sel.value = selectedLang;
        }
    } catch (e) { console.error('loadAudioLanguages error:', e); }
}

async function loadAudioModels(provider, cfg) {
    try {
        const res = await fetch('/api/audio/models?provider=' + (provider || ''));
        if (!res.ok) return;
        const data = await res.json();
        const sel = $('#audioModel');
        if (!sel) return;
        sel.innerHTML = '';
        (data.models || []).forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.name;
            sel.appendChild(opt);
        });

        if (cfg || audioConfig) {
            const c = cfg || audioConfig;
            const pcfg = c.providers?.[provider] || {};
            const savedModel = pcfg.model || pcfg.model_id || '';
            if (savedModel && sel.querySelector(`option[value="${savedModel}"]`)) {
                sel.value = savedModel;
            }
        }
    } catch (e) { console.error('loadAudioModels error:', e); }
}

async function onAudioLanguageChange() {
    const provider = $('#audioProvider').value;
    if (provider === 'azure') {
        await loadAudioVoices(provider);
    }
    updateAudioConfigSummary();
}

function updateAudioConfigSummary() {
    const el = $('#audioCurrentConfig');
    if (!el) return;
    const provider = $('#audioProvider').value;
    const model = $('#audioModel').value;
    const voice = $('#audioVoice');
    const voiceText = voice.options[voice.selectedIndex]?.textContent || voice.value || '-';
    const lang = $('#audioLanguage');
    const langText = lang.options[lang.selectedIndex]?.textContent || lang.value || '-';
    const speed = $('#audioSpeed').value;

    let parts = [
        '<span class="cfg-chip">Provider: <strong>' + escapeHtml(provider) + '</strong></span>',
        '<span class="cfg-chip">Langue: <strong>' + escapeHtml(langText) + '</strong></span>',
    ];
    if (provider !== 'azure') {
        parts.push('<span class="cfg-chip">Modele: <strong>' + escapeHtml(model) + '</strong></span>');
    }
    parts.push('<span class="cfg-chip">Voix: <strong>' + escapeHtml(voiceText) + '</strong></span>');
    if (provider === 'openai') {
        parts.push('<span class="cfg-chip">Vitesse: <strong>' + escapeHtml(speed) + '</strong></span>');
    }
    el.innerHTML = '<div class="audio-config-chips">' + parts.join('') + '</div>';
}

async function loadAudioVoices(provider) {
    try {
        const res = await fetch('/api/audio/voices?provider=' + (provider || ''));
        if (!res.ok) return;
        const data = await res.json();
        const sel = $('#audioVoice');
        if (!sel) return;
        sel.innerHTML = '';
        (data.voices || []).forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.id;
            opt.textContent = v.name;
            sel.appendChild(opt);
        });

        if (audioConfig) {
            const pcfg = audioConfig.providers?.[provider] || {};
            const voiceKey = provider === 'openai' ? 'voice' :
                             provider === 'elevenlabs' ? 'voice_id' :
                             provider === 'azure' ? 'voice_name' : '';
            const savedVoice = pcfg[voiceKey];
            if (savedVoice && sel.querySelector(`option[value="${savedVoice}"]`)) {
                sel.value = savedVoice;
            }
        }
    } catch (e) { console.error('loadAudioVoices error:', e); }
}

function showProviderSections(provider) {
    $$('.audio-provider-section').forEach(s => {
        s.style.display = s.dataset.provider === provider ? 'block' : 'none';
    });
    $$('.audio-provider-option').forEach(el => {
        const providers = (el.dataset.providers || '').split(' ');
        el.style.display = providers.includes(provider) ? '' : 'none';
    });
}

async function onAudioProviderChange() {
    const provider = $('#audioProvider').value;
    showProviderSections(provider);
    try {
        await Promise.all([
            loadAudioModels(provider, audioConfig),
            loadAudioVoices(provider)
        ]);
    } catch (e) {
        console.error('onAudioProviderChange error:', e);
    }
    updateAudioConfigSummary();
}

function toggleKeyVisibility(inputId, btn) {
    const input = $('#' + inputId);
    if (!input) return;
    if (input.type === 'password') {
        input.type = 'text';
        btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
    } else {
        input.type = 'password';
        btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    }
}

function testCurrentProvider() {
    console.log('[DIAG] testCurrentProvider called');
    const provider = $('#audioProvider').value;
    console.log('[DIAG] testCurrentProvider provider=' + provider);
    testAudioProvider(provider);
}

async function saveAudioApiKey(provider) {
    const inputMap = { openai: '#keyOpenai', elevenlabs: '#keyElevenlabs', azure: '#keyAzure' };
    const input = $(inputMap[provider]);
    const key = input ? input.value.trim() : '';
    if (!key) {
        toast('Saisissez une cle API', 'error');
        return;
    }
    try {
        const res = await fetch('/api/audio/config/api-key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider, api_key: key })
        });
        const result = await res.json();
        if (result.success) {
            toast('Cle API sauvegardee', 'success');
            input.value = '';
            input.placeholder = key.substring(0, 4) + '...' + key.substring(key.length - 4);
        } else {
            toast(result.message || 'Erreur', 'error');
        }
    } catch (e) {
        toast('Erreur de connexion', 'error');
    }
}

async function testAudioProvider(provider) {
    const statusEl = $(`#status${provider.charAt(0).toUpperCase() + provider.slice(1)}`);
    if (statusEl) {
        statusEl.textContent = 'Test en cours...';
        statusEl.className = 'audio-key-status testing';
    }
    try {
        const res = await fetch('/api/audio/test-provider', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider })
        });
        const result = await res.json();
        if (statusEl) {
            statusEl.textContent = result.message || (result.success ? 'OK' : 'Erreur');
            statusEl.className = 'audio-key-status ' + (result.success ? 'success' : 'error');
        }
        toast(result.message, result.success ? 'success' : 'error');
    } catch (e) {
        if (statusEl) {
            statusEl.textContent = 'Erreur de connexion';
            statusEl.className = 'audio-key-status error';
        }
        toast('Erreur de connexion', 'error');
    }
}

async function saveAudioConfig(silent) {
    console.log('[DIAG] saveAudioConfig called, silent=' + silent);
    const provider = $('#audioProvider').value;
    const voice = $('#audioVoice').value;
    const model = $('#audioModel').value;
    const language = $('#audioLanguage').value;
    const speed = parseFloat($('#audioSpeed').value) || 1.0;
    const region = $('#azureRegion').value.trim();

    console.log('[DIAG] saveAudioConfig values:', { provider, voice, model, language, speed, region });

    if (!language) {
        if (!silent) toast('Configuration non chargee, impossible de sauvegarder', 'error');
        console.log('[DIAG] saveAudioConfig: language empty, returning false');
        return false;
    }

    const data = {
        provider,
        language,
        providers: {}
    };

    if (provider === 'openai') {
        const providerData = {};
        if (voice) providerData.voice = voice;
        if (model) providerData.model = model;
        providerData.speed = speed;
        data.providers.openai = providerData;
    } else if (provider === 'elevenlabs') {
        const providerData = {
            stability: parseFloat($('#elStability').value) || 0.5,
            similarity_boost: parseFloat($('#elSimilarity').value) || 0.75
        };
        if (voice) providerData.voice_id = voice;
        if (model) providerData.model_id = model;
        data.providers.elevenlabs = providerData;
    } else if (provider === 'azure') {
        const providerData = {};
        if (voice) providerData.voice_name = voice;
        if (region) providerData.region = region;
        data.providers.azure = providerData;
    }

    console.log('[DIAG] saveAudioConfig sending PUT:', JSON.stringify(data));
    try {
        const res = await fetch('/api/audio/config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        console.log('[DIAG] saveAudioConfig response status:', res.status);
        const result = await res.json();
        console.log('[DIAG] saveAudioConfig result:', JSON.stringify(result).substring(0, 200));
        if (result.success) {
            if (!silent) toast('Configuration audio sauvegardee', 'success');
            audioConfig = result.config;
            updateAudioConfigSummary();
            console.log('[DIAG] saveAudioConfig returning true');
            return true;
        } else {
            if (!silent) toast('Erreur de sauvegarde', 'error');
            console.log('[DIAG] saveAudioConfig returning false (success=false)');
            return false;
        }
    } catch (e) {
        console.error('[DIAG] saveAudioConfig CATCH error:', e);
        if (!silent) toast('Erreur de connexion', 'error');
        return false;
    }
}

async function loadAudioStatus() {
    console.log('[DIAG] loadAudioStatus called');
    try {
        const res = await fetch('/api/audio/status');
        console.log('[DIAG] loadAudioStatus: status=' + res.status);
        const data = await res.json();
        console.log('[DIAG] loadAudioStatus: data keys=' + Object.keys(data).join(','));
        renderAudioGenStatus(data);
        console.log('[DIAG] loadAudioStatus: renderAudioGenStatus done');
    } catch (e) { console.error('[DIAG] loadAudioStatus error:', e); }
}

function renderAudioGenStatus(data) {
    const container = $('#audioGenStatus');
    const gen = data.generation || {};
    const jobs = data.jobs || {};
    const modified = data.modified || {};

    let html = '';
    const categories = [
        { key: 'numbers', label: 'Nombres', icon: '#' },
        { key: 'words', label: 'Mots', icon: 'Aa' },
        { key: 'phrases', label: 'Phrases', icon: '"' }
    ];

    categories.forEach(cat => {
        const s = gen[cat.key] || {};
        const total = s.total || 0;
        const existing = s.existing || 0;
        const lastGen = s.last_generated || '-';
        const modCount = (modified[cat.key] || []).length;

        let runningJob = null;
        for (const [jid, jdata] of Object.entries(jobs)) {
            if (jdata.category === cat.key) { runningJob = { id: jid, ...jdata }; break; }
        }

        let displayTotal, displayExisting, pct;
        if (runningJob) {
            displayTotal = runningJob.total || total;
            displayExisting = (runningJob.generated || 0) + (runningJob.cached || 0);
            pct = runningJob.progress || 0;
        } else {
            displayTotal = total;
            displayExisting = existing;
            pct = total > 0 ? Math.round((existing / total) * 100) : 0;
        }

        const complete = !runningJob && existing === total && total > 0;
        const statusClass = runningJob ? 'gen-running' : (complete ? 'gen-complete' : (existing > 0 ? 'gen-partial' : 'gen-empty'));
        const statusLabel = runningJob ? 'En cours' : (complete ? 'Complet' : (existing > 0 ? 'Partiel' : 'Non genere'));

        html += '<div class="audio-gen-section">' +
            '<div class="gen-section-header">' +
                '<div class="gen-section-title">' +
                    '<span class="gen-icon">' + cat.icon + '</span>' +
                    '<span>' + cat.label + '</span>' +
                    '<span class="gen-badge ' + statusClass + '">' + statusLabel + '</span>' +
                    (modCount > 0 ? '<span class="gen-badge gen-modified">' + modCount + ' modifie(s)</span>' : '') +
                '</div>' +
                '<div class="gen-section-stats">' + displayExisting + '/' + displayTotal + '</div>' +
            '</div>' +
            '<div class="gen-progress-bar"><div class="gen-progress-fill" style="width:' + pct + '%"></div></div>';

        if (runningJob) {
            const jobErrors = runningJob.errors || 0;
            let statusText = 'Generation en cours: ' + pct + '% (' + displayExisting + ' genere(s)';
            if (jobErrors > 0) {
                statusText += ', ' + jobErrors + ' erreur(s)';
            }
            statusText += ')';
            html += '<div class="gen-job-status">' +
                '<span class="gen-job-running">' + statusText + '</span>' +
                '<button class="btn btn-xs btn-ghost btn-danger" onclick="cancelAudioJob(\'' + runningJob.id + '\')">Annuler</button>' +
            '</div>';
        } else {
            html += '<div class="gen-section-actions">' +
                '<button class="btn btn-xs" onclick="generateAudioCategory(\'' + cat.key + '\', false)">Generer manquants</button>' +
                '<button class="btn btn-xs" onclick="generateAudioCategory(\'' + cat.key + '\', true)">Tout regenerer</button>' +
                (cat.key !== 'numbers' ? '<button class="btn btn-xs btn-ghost btn-danger" onclick="deleteAudioCategory(\'' + cat.key + '\')">Supprimer</button>' : '') +
            '</div>';
        }

        if (lastGen !== '-') {
            html += '<div class="gen-section-meta">Derniere generation: ' + lastGen + '</div>';
        }

        html += '</div>';
    });

    container.innerHTML = html;
}

async function generateAudioCategory(category, force) {
    console.log('[DIAG] generateAudioCategory called:', category, 'force=' + force);
    try {
        const language = $('#audioLanguage').value;
        console.log('[DIAG] generateAudioCategory language=' + JSON.stringify(language));

        if (language) {
            console.log('[DIAG] generateAudioCategory: calling saveAudioConfig(true)...');
            try {
                const saved = await saveAudioConfig(true);
                console.log('[DIAG] generateAudioCategory: saveAudioConfig returned', saved);
                if (!saved) {
                    console.log('[DIAG] generateAudioCategory: save failed, continuing with server config');
                }
            } catch (saveErr) {
                console.error('[DIAG] generateAudioCategory: saveAudioConfig threw:', saveErr);
            }
        } else {
            console.log('[DIAG] generateAudioCategory: skipping save (no language)');
        }

        console.log('[DIAG] generateAudioCategory: sending POST /api/audio/generate/' + category);
        const res = await fetch('/api/audio/generate/' + category, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ force: !!force })
        });
        console.log('[DIAG] generateAudioCategory: response status=' + res.status);
        const result = await res.json();
        console.log('[DIAG] generateAudioCategory: result=', JSON.stringify(result).substring(0, 200));
        if (result.success && result.job_id) {
            const provider = $('#audioProvider')?.value || '?';
            toast('Generation ' + category + ' lancee (provider: ' + provider + ')', 'success');
            pollAudioJob(result.job_id);
        } else {
            toast(result.message || 'Erreur', 'error');
        }
    } catch (e) {
        console.error('[DIAG] generateAudioCategory CATCH error:', e);
        toast('Erreur de connexion', 'error');
    }
}

async function generateAllAudio(force) {
    console.log('[DIAG] generateAllAudio called, force=' + force);
    const categories = ['numbers', 'words', 'phrases'];
    for (const cat of categories) {
        console.log('[DIAG] generateAllAudio: processing category', cat);
        await generateAudioCategory(cat, force);
    }
    console.log('[DIAG] generateAllAudio: done');
}

function pollAudioJob(jobId) {
    if (audioJobPollers[jobId]) return;
    let _errCount = 0;
    audioJobPollers[jobId] = setInterval(async () => {
        try {
            const res = await fetch('/api/audio/job/' + jobId);
            if (res.status === 503 || res.status === 504 || res.status === 429) {
                _errCount++;
                if (_errCount >= 3) { clearInterval(audioJobPollers[jobId]); delete audioJobPollers[jobId]; }
                return;
            }
            const ct = res.headers.get('content-type') || '';
            if (!ct.includes('application/json')) return;
            _errCount = 0;
            const data = await res.json();
            if (data.status !== 'running') {
                clearInterval(audioJobPollers[jobId]);
                delete audioJobPollers[jobId];
                const gen = (data.generated || 0) + (data.cached || 0);
                const errs = data.errors || 0;
                if (data.status === 'completed') {
                    toast('Generation terminee: ' + gen + ' fichier(s) genere(s)' + (errs > 0 ? ', ' + errs + ' erreur(s)' : ''), 'success');
                } else if (data.status === 'error') {
                    toast('Erreur de generation: ' + (data.message || 'inconnue') + (gen > 0 ? ' (' + gen + ' fichier(s) OK)' : ''), 'error');
                }
                loadAudioStatus();
                loadAudioFiles();
            } else {
                loadAudioStatus();
            }
        } catch (e) {
            clearInterval(audioJobPollers[jobId]);
            delete audioJobPollers[jobId];
        }
    }, 3000);
}

async function cancelAudioJob(jobId) {
    try {
        await fetch('/api/audio/job/' + jobId + '/cancel', { method: 'POST' });
        toast('Generation annulee', 'info');
        loadAudioStatus();
    } catch (e) {
        toast('Erreur', 'error');
    }
}

async function deleteAudioCategory(category) {
    if (!confirm('Supprimer tous les fichiers audio de la categorie "' + category + '" ?')) return;
    try {
        const res = await fetch('/api/audio/files/' + category, { method: 'DELETE' });
        const result = await res.json();
        if (result.success) {
            toast(result.deleted + ' fichier(s) supprime(s)', 'success');
            loadAudioStatus();
            loadAudioFiles();
        } else {
            toast(result.message || 'Erreur', 'error');
        }
    } catch (e) {
        toast('Erreur de connexion', 'error');
    }
}

function renderAudioWords(words) {
    const container = $('#audioWordsEditor');
    let html = '<div class="audio-text-list">';
    for (const [key, text] of Object.entries(words)) {
        html += '<div class="audio-text-row">' +
            '<label class="audio-text-key">' + escapeHtml(key) + '</label>' +
            '<input type="text" class="form-input audio-text-input" data-cat="words" data-key="' + escapeAttr(key) + '" value="' + escapeAttr(text) + '">' +
            '<button class="btn btn-xs btn-ghost" onclick="previewAudioText(\'' + escapeAttr(key) + '\', \'words\')" title="Ecouter">' +
                '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>' +
            '</button>' +
        '</div>';
    }
    html += '</div>';
    container.innerHTML = html;
}

function renderAudioPhrases(phrases) {
    const container = $('#audioPhrasesEditor');
    let html = '<div class="audio-text-list">';
    for (const [key, text] of Object.entries(phrases)) {
        html += '<div class="audio-text-row">' +
            '<label class="audio-text-key">' + escapeHtml(key) + '</label>' +
            '<input type="text" class="form-input audio-text-input" data-cat="phrases" data-key="' + escapeAttr(key) + '" value="' + escapeAttr(text) + '">' +
            '<button class="btn btn-xs btn-ghost" onclick="previewAudioText(\'' + escapeAttr(key) + '\', \'phrases\')" title="Ecouter">' +
                '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>' +
            '</button>' +
        '</div>';
    }
    html += '</div>';
    container.innerHTML = html;
}

async function saveAudioTexts() {
    const words = {};
    const phrases = {};

    $$('.audio-text-input[data-cat="words"]').forEach(input => {
        words[input.dataset.key] = input.value;
    });
    $$('.audio-text-input[data-cat="phrases"]').forEach(input => {
        phrases[input.dataset.key] = input.value;
    });

    try {
        const res = await fetch('/api/audio/config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texts: { words, phrases } })
        });
        const result = await res.json();
        if (result.success) {
            toast('Textes audio sauvegardes', 'success');
            audioConfig = result.config;
            loadAudioStatus();
        } else {
            toast('Erreur de sauvegarde', 'error');
        }
    } catch (e) {
        toast('Erreur de connexion', 'error');
    }
}

function previewAudioText(key, category) {
    const subdir = category === 'numbers' ? 'system/numbers' : (category === 'words' ? 'system/words' : 'system/phrases');
    const url = '/api/audio/preview/' + subdir + '/' + key + '.mp3';

    if (audioPreviewAudio) {
        audioPreviewAudio.pause();
        audioPreviewAudio = null;
    }
    audioPreviewAudio = new Audio(url);
    audioPreviewAudio.play().catch(() => {
        toast('Fichier audio non disponible', 'info');
    });
}

async function loadAudioFiles() {
    try {
        const res = await fetch('/api/audio/files');
        const data = await res.json();
        renderAudioFiles(data);
    } catch (e) { console.error('loadAudioFiles error:', e); }
}

function renderAudioFiles(data) {
    const container = $('#audioFilesBrowser');
    let html = '';

    const categories = [
        { key: 'numbers', label: 'Nombres' },
        { key: 'words', label: 'Mots' },
        { key: 'phrases', label: 'Phrases' }
    ];

    categories.forEach(cat => {
        const files = data[cat.key] || [];
        html += '<div class="audio-files-section">' +
            '<div class="audio-files-header">' +
                '<span class="audio-files-title">' + cat.label + '</span>' +
                '<span class="audio-files-count">' + files.length + ' fichier(s)</span>' +
            '</div>';

        if (files.length > 0) {
            html += '<div class="audio-files-grid">';
            const shown = files.slice(0, 50);
            shown.forEach(f => {
                const name = f.replace('.mp3', '');
                html += '<div class="audio-file-chip" onclick="previewAudioText(\'' + escapeAttr(name) + '\', \'' + cat.key + '\')">' +
                    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>' +
                    '<span>' + escapeHtml(name) + '</span>' +
                '</div>';
            });
            if (files.length > 50) {
                html += '<div class="audio-file-chip more">+' + (files.length - 50) + ' autres</div>';
            }
            html += '</div>';
        } else {
            html += '<div class="audio-files-empty">Aucun fichier</div>';
        }

        html += '</div>';
    });

    container.innerHTML = html;
}

let qnAudioJobPollers = {};

async function loadQnAudioStatus() {
    if (!currentQnId) return;
    try {
        const res = await fetch('/api/questionnaires/' + currentQnId + '/audio/status');
        if (!res.ok) return;
        const data = await res.json();
        renderQnAudioStatus(data);
    } catch (e) {
        console.error('loadQnAudioStatus error:', e);
    }
}

function renderQnAudioStatus(data) {
    const container = $('#qnAudioStatus');
    const badge = $('#qnAudioBadge');
    if (!container) return;

    const total = data.total_expected || 0;
    const existing = data.existing || 0;
    const missing = data.missing || 0;
    const obsolete = data.obsolete || 0;
    const jobs = data.jobs || {};

    let runningJob = null;
    for (const [jid, jdata] of Object.entries(jobs)) {
        if (jdata.status === 'running') { runningJob = { id: jid, ...jdata }; break; }
    }

    const pct = total > 0 ? Math.round((existing / total) * 100) : 0;
    const isComplete = existing === total && total > 0 && obsolete === 0;

    if (badge) {
        if (runningJob) {
            badge.className = 'qn-audio-badge running';
            badge.textContent = 'En cours...';
        } else if (isComplete) {
            badge.className = 'qn-audio-badge complete';
            badge.textContent = 'Complet';
        } else if (existing > 0) {
            badge.className = 'qn-audio-badge partial';
            badge.textContent = 'Partiel';
        } else {
            badge.className = 'qn-audio-badge empty';
            badge.textContent = 'Non genere';
        }
    }

    let html = '<div class="qn-audio-stats">' +
        '<div class="qn-audio-stat"><span class="qn-audio-stat-value">' + total + '</span><span class="qn-audio-stat-label">Total attendu</span></div>' +
        '<div class="qn-audio-stat"><span class="qn-audio-stat-value qn-audio-ok">' + existing + '</span><span class="qn-audio-stat-label">Genere</span></div>' +
        '<div class="qn-audio-stat"><span class="qn-audio-stat-value qn-audio-missing">' + missing + '</span><span class="qn-audio-stat-label">Manquant</span></div>' +
        '<div class="qn-audio-stat"><span class="qn-audio-stat-value qn-audio-obsolete">' + obsolete + '</span><span class="qn-audio-stat-label">Obsolete</span></div>' +
    '</div>';

    html += '<div class="gen-progress-bar"><div class="gen-progress-fill" style="width:' + pct + '%"></div></div>';

    if (runningJob) {
        const jp = runningJob.progress || 0;
        const je = runningJob.errors || 0;
        let statusText = 'Generation: ' + jp + '%';
        if (je > 0) statusText += ' (' + je + ' erreur(s))';
        html += '<div class="gen-job-status">' +
            '<span class="gen-job-running">' + statusText + '</span>' +
            '<button class="btn btn-xs btn-ghost btn-danger" onclick="cancelQnAudioJob(\'' + runningJob.id + '\')">Annuler</button>' +
        '</div>';
    } else {
        html += '<div class="qn-audio-actions">' +
            '<button class="btn btn-sm btn-success" onclick="generateQnAudio(\'missing\')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Generer les manquants</button>' +
            '<button class="btn btn-sm" onclick="generateQnAudio(\'all\')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg> Tout regenerer</button>' +
            (existing > 0 ? '<button class="btn btn-sm btn-ghost btn-danger" onclick="deleteQnAudio()"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg> Supprimer audios</button>' : '') +
        '</div>';
    }

    container.innerHTML = html;
}

async function generateQnAudio(mode) {
    if (!currentQnId) return;
    try {
        const language = $('#audioLanguage') ? $('#audioLanguage').value : '';
        if (language) {
            await saveAudioConfig(true);
        }

        const res = await fetch('/api/questionnaires/' + currentQnId + '/audio/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: mode })
        });
        const result = await res.json();
        if (result.success && result.job_id) {
            toast('Generation audio lancee', 'success');
            pollQnAudioJob(result.job_id);
        } else {
            toast(result.message || 'Erreur', 'error');
        }
    } catch (e) {
        toast('Erreur de connexion', 'error');
    }
}

function pollQnAudioJob(jobId) {
    if (qnAudioJobPollers[jobId]) return;
    let _errCount = 0;
    qnAudioJobPollers[jobId] = setInterval(async () => {
        try {
            const res = await fetch('/api/questionnaires/' + currentQnId + '/audio/job/' + jobId);
            if (res.status === 503 || res.status === 504 || res.status === 429) {
                _errCount++;
                if (_errCount >= 3) { clearInterval(qnAudioJobPollers[jobId]); delete qnAudioJobPollers[jobId]; }
                return;
            }
            const ct = res.headers.get('content-type') || '';
            if (!ct.includes('application/json')) return;
            _errCount = 0;
            const data = await res.json();
            if (data.status !== 'running') {
                clearInterval(qnAudioJobPollers[jobId]);
                delete qnAudioJobPollers[jobId];
                const gen = (data.generated || 0);
                const cached = (data.cached || 0);
                const errs = data.errors || 0;
                if (data.status === 'completed') {
                    toast('Generation terminee: ' + gen + ' genere(s), ' + cached + ' en cache' + (errs > 0 ? ', ' + errs + ' erreur(s)' : ''), 'success');
                } else if (data.status === 'partial') {
                    toast('Generation partielle: ' + gen + ' genere(s), ' + errs + ' erreur(s)', 'info');
                } else {
                    toast('Erreur de generation: ' + (data.message || 'inconnue'), 'error');
                }
                loadQnAudioStatus();
            } else {
                loadQnAudioStatus();
            }
        } catch (e) {
            clearInterval(qnAudioJobPollers[jobId]);
            delete qnAudioJobPollers[jobId];
        }
    }, 3000);
}

async function cancelQnAudioJob(jobId) {
    if (!currentQnId) return;
    try {
        await fetch('/api/questionnaires/' + currentQnId + '/audio/job/' + jobId + '/cancel', { method: 'POST' });
        toast('Generation annulee', 'info');
        loadQnAudioStatus();
    } catch (e) {
        toast('Erreur', 'error');
    }
}

async function deleteQnAudio() {
    if (!currentQnId) return;
    if (!confirm('Supprimer tous les fichiers audio de ce questionnaire ?')) return;
    try {
        const res = await fetch('/api/questionnaires/' + currentQnId + '/audio/delete', { method: 'POST' });
        const result = await res.json();
        if (result.success) {
            toast(result.deleted + ' fichier(s) supprime(s)', 'success');
            loadQnAudioStatus();
        } else {
            toast(result.message || 'Erreur', 'error');
        }
    } catch (e) {
        toast('Erreur de connexion', 'error');
    }
}

let _iaJobId = null;
let _iaPolling = null;

function iaTabInit() {
    const sel = $('#iaQnSelector');
    if (sel) {
        sel.innerHTML = '';
        questionnairesCache.forEach(q => {
            const opt = document.createElement('option');
            opt.value = q.id;
            opt.textContent = q.name + (q.question_count !== undefined ? ` (${q.question_count}q)` : '');
            sel.appendChild(opt);
        });
    }
}

function iaToggleOpt(btn) {
    const active = btn.getAttribute('aria-checked') === 'true';
    btn.setAttribute('aria-checked', active ? 'false' : 'true');
    btn.classList.toggle('ia-toggle--active', !active);
}

function iaToggleExpert() {
    const btn = $('#iaExpertToggle');
    const active = btn.getAttribute('aria-checked') === 'true';
    btn.setAttribute('aria-checked', active ? 'false' : 'true');
    btn.classList.toggle('ia-toggle--active', !active);
    $$('.ia-expert-field').forEach(el => {
        el.style.display = !active ? '' : 'none';
    });
}

const _iaPresets = {
    culture:  { theme: 'Culture generale', style: 'standard', difficulty: '2', audience: 'general' },
    sport:    { theme: 'Sport et champions', style: 'chiffres', difficulty: '2', audience: 'general' },
    cinema:   { theme: 'Cinema et series', style: 'personnalites', difficulty: '1', audience: 'general' },
    science:  { theme: 'Sciences et decouvertes', style: 'anecdote', difficulty: '3', audience: 'experts' },
    histoire: { theme: 'Histoire du monde', style: 'chiffres', difficulty: '2', audience: 'general' },
    tiktok:   { theme: 'Quiz viral TikTok', style: 'anecdote', difficulty: '1', audience: 'general', tiktok: true },
};

function iaApplyPreset(key) {
    const p = _iaPresets[key];
    if (!p) return;
    if (p.theme) $('#iaTheme').value = p.theme;
    if (p.style) {
        const r = document.querySelector(`input[name="iaStyle"][value="${p.style}"]`);
        if (r) r.checked = true;
    }
    if (p.difficulty) {
        const r = document.querySelector(`input[name="iaDifficulty"][value="${p.difficulty}"]`);
        if (r) r.checked = true;
    }
    if (p.audience) {
        const r = document.querySelector(`input[name="iaAudience"][value="${p.audience}"]`);
        if (r) r.checked = true;
    }
    if (p.tiktok) {
        const btnT = $('#optTiktokLive');
        if (btnT) { btnT.setAttribute('aria-checked','true'); btnT.classList.add('ia-toggle--active'); }
        const btnS = $('#optShortQuestions');
        if (btnS) { btnS.setAttribute('aria-checked','true'); btnS.classList.add('ia-toggle--active'); }
    }
    $$('.ia-preset').forEach(b => b.classList.remove('ia-preset--active'));
    document.querySelector(`.ia-preset[data-preset="${key}"]`)?.classList.add('ia-preset--active');
    toast('Preset applique', 'success');
}

function _iaGetOpts() {
    return {
        no_duplicates:   $('#optNoDuplicates')?.getAttribute('aria-checked') === 'true',
        no_rephrase:     $('#optNoRephrase')?.getAttribute('aria-checked') === 'true',
        vary_angles:     $('#optVaryAngles')?.getAttribute('aria-checked') === 'true',
        balance_answers: $('#optBalanceAnswers')?.getAttribute('aria-checked') === 'true',
        tiktok_live:     $('#optTiktokLive')?.getAttribute('aria-checked') === 'true',
        short_questions: $('#optShortQuestions')?.getAttribute('aria-checked') === 'true',
        auto_mode:       $('#optAutoMode')?.getAttribute('aria-checked') === 'true',
        multi_theme:     $('#optMultiTheme')?.getAttribute('aria-checked') === 'true',
    };
}

function onIaDestChange() {
    const val = document.querySelector('input[name="iaDestType"]:checked').value;
    $('#iaNewQnName').style.display = val === 'new' ? '' : 'none';
    $('#iaExistingQn').style.display = val === 'existing' ? '' : 'none';
}

async function iaGenerate() {
    const theme = $('#iaTheme').value.trim();
    if (!theme) {
        toast('Le theme est requis', 'error');
        $('#iaTheme').focus();
        return;
    }
    const count = parseInt($('#iaCount').value) || 10;
    if (count < 1 || count > 30) {
        toast('Le nombre de questions doit etre entre 1 et 30', 'error');
        return;
    }
    const difficulty = parseInt(document.querySelector('input[name="iaDifficulty"]:checked')?.value || '2');
    const audience   = document.querySelector('input[name="iaAudience"]:checked')?.value || 'general';
    const style      = document.querySelector('input[name="iaStyle"]:checked')?.value || 'standard';
    const opts       = _iaGetOpts();

    const body = {
        theme,
        category: $('#iaCategory').value.trim() || theme,
        subcategory: $('#iaSubcategory').value.trim(),
        difficulty,
        count,
        language: $('#iaLanguage').value,
        target_audience: audience,
        style,
        options: opts,
        max_question_length: parseInt($('#iaMaxQlen')?.value || '80'),
        max_answer_length: parseInt($('#iaMaxAlen')?.value || '40'),
    };
    $('#iaBtnGenerate').disabled = true;
    $('#iaBtnCancel').style.display = '';
    $('#iaProgressCard').style.display = '';
    $('#iaResultCard').style.display = 'none';
    $('#iaProgressBar').style.width = '10%';
    $('#iaProgressText').textContent = 'Appel a OpenAI en cours...';
    try {
        const res = await fetch('/api/ai/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!data.success) {
            toast(data.message || 'Erreur lors du lancement', 'error');
            iaReset();
            return;
        }
        _iaJobId = data.job_id;
        pollIaJob();
    } catch (e) {
        toast('Erreur de connexion', 'error');
        iaReset();
    }
}

function pollIaJob() {
    if (_iaPolling) clearInterval(_iaPolling);
    let _iaErrCount = 0;
    _iaPolling = setInterval(async () => {
        if (!_iaJobId) { clearInterval(_iaPolling); return; }
        try {
            const res = await fetch('/api/ai/job/' + _iaJobId);
            if (res.status === 503 || res.status === 504 || res.status === 429) {
                _iaErrCount++;
                if (_iaErrCount >= 3) { clearInterval(_iaPolling); iaReset(); }
                return;
            }
            const ct = res.headers.get('content-type') || '';
            if (!ct.includes('application/json')) return;
            _iaErrCount = 0;
            const data = await res.json();
            if (!data.success) { clearInterval(_iaPolling); iaReset(); return; }

            const pct = data.total > 0 ? Math.round((data.progress / data.total) * 80) + 10 : 30;
            $('#iaProgressBar').style.width = Math.min(pct, 90) + '%';

            if (data.status === 'running') {
                $('#iaProgressText').textContent = 'Traitement des questions...';
            } else if (data.status === 'done') {
                clearInterval(_iaPolling);
                $('#iaProgressBar').style.width = '100%';
                $('#iaProgressText').textContent = 'Termine !';
                setTimeout(() => {
                    $('#iaProgressCard').style.display = 'none';
                    loadIaPreview();
                }, 500);
            } else if (data.status === 'error') {
                clearInterval(_iaPolling);
                toast('Erreur: ' + (data.error || 'Inconnue'), 'error');
                iaReset();
            } else if (data.status === 'cancelled') {
                clearInterval(_iaPolling);
                iaReset();
            }
        } catch (e) {
            clearInterval(_iaPolling);
        }
    }, 3000);
}

async function loadIaPreview() {
    try {
        const res = await fetch('/api/ai/job/' + _iaJobId + '/preview');
        const data = await res.json();
        if (!data.success) {
            toast(data.message || 'Erreur de preview', 'error');
            iaReset();
            return;
        }
        $('#iaBtnCancel').style.display = 'none';
        $('#iaBtnGenerate').disabled = false;
        const stats = data.stats || {};
        const badge = `${stats.accepted || 0} acceptees / ${stats.total_generated || 0} generees`;
        $('#iaStatsBadge').textContent = badge;
        renderIaCandidates(data.candidates || []);
        $('#iaResultCard').style.display = '';
    } catch (e) {
        toast('Erreur de chargement du preview', 'error');
        iaReset();
    }
}

function renderIaCandidates(candidates) {
    const container = $('#iaCandidatesList');
    if (!candidates || candidates.length === 0) {
        container.innerHTML = '<div class="ia-empty">Aucune question generee. Toutes ont ete rejetees comme doublons ou invalides.</div>';
        updateIaSelectedCount();
        return;
    }
    container.innerHTML = '';
    const diffLabels = { 1: 'Facile', 2: 'Moyen', 3: 'Difficile' };
    candidates.forEach((q, idx) => {
        const card = document.createElement('div');
        card.className = 'ia-candidate' + (q.selected ? ' selected' : '');
        card.setAttribute('data-idx', idx);

        const choicesHtml = Object.entries(q.choices || {}).map(([k, v]) => {
            const isCorrect = k === q.correct_answer;
            return `<span class="ia-choice${isCorrect ? ' ia-choice-correct' : ''}"><strong>${k}.</strong> ${escapeHtml(String(v))}</span>`;
        }).join('');

        card.innerHTML =
            '<div class="ia-candidate-header">' +
                '<label class="ia-checkbox-label">' +
                    '<input type="checkbox" class="ia-checkbox" data-idx="' + idx + '" ' + (q.selected ? 'checked' : '') + ' onchange="iaToggleCandidate(' + idx + ', this.checked)">' +
                    '<span class="ia-q-text">' + escapeHtml(q.text) + '</span>' +
                '</label>' +
                '<div class="ia-q-meta">' +
                    '<span class="ia-diff-badge diff-' + q.difficulty + '">' + (diffLabels[q.difficulty] || 'Moyen') + '</span>' +
                    (q.category ? '<span class="ia-cat-badge">' + escapeHtml(q.category) + '</span>' : '') +
                '</div>' +
            '</div>' +
            '<div class="ia-choices-grid">' + choicesHtml + '</div>';
        container.appendChild(card);
    });
    updateIaSelectedCount();
}

function iaToggleCandidate(idx, checked) {
    const card = document.querySelector('.ia-candidate[data-idx="' + idx + '"]');
    if (card) card.classList.toggle('selected', checked);
    updateIaSelectedCount();
}

function iaSelectAll(select) {
    document.querySelectorAll('.ia-checkbox').forEach(cb => {
        cb.checked = select;
        const idx = parseInt(cb.getAttribute('data-idx'));
        const card = document.querySelector('.ia-candidate[data-idx="' + idx + '"]');
        if (card) card.classList.toggle('selected', select);
    });
    updateIaSelectedCount();
}

function updateIaSelectedCount() {
    const total = document.querySelectorAll('.ia-checkbox').length;
    const selected = document.querySelectorAll('.ia-checkbox:checked').length;
    const el = $('#iaSelectedCount');
    if (el) el.textContent = selected + ' / ' + total + ' selectionnee(s)';
    const btnConfirm = $('#iaBtnConfirm');
    if (btnConfirm) btnConfirm.disabled = selected === 0;
}

async function iaConfirm() {
    const checked = Array.from(document.querySelectorAll('.ia-checkbox:checked'));
    const selectedIndices = checked.map(cb => parseInt(cb.getAttribute('data-idx')));
    if (selectedIndices.length === 0) {
        toast('Selectionnez au moins une question', 'error');
        return;
    }
    const destType = document.querySelector('input[name="iaDestType"]:checked').value;
    const body = { selected_indices: selectedIndices };
    if (destType === 'existing') {
        const sel = $('#iaQnSelector');
        if (sel && sel.value) body.target_questionnaire_id = parseInt(sel.value);
    } else {
        const name = $('#iaQnName').value.trim();
        if (name) body.new_questionnaire_name = name;
    }
    $('#iaBtnConfirm').disabled = true;
    try {
        const res = await fetch('/api/ai/job/' + _iaJobId + '/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (data.success) {
            toast(`${data.imported} question(s) enregistree(s) dans "${data.questionnaire_name}"`, 'success');
            loadQuestionnaires();
            iaReset();
        } else {
            toast(data.message || 'Erreur', 'error');
            $('#iaBtnConfirm').disabled = false;
        }
    } catch (e) {
        toast('Erreur de connexion', 'error');
        $('#iaBtnConfirm').disabled = false;
    }
}

async function iaCancelJob() {
    if (!_iaJobId) { iaReset(); return; }
    try {
        await fetch('/api/ai/job/' + _iaJobId + '/cancel', { method: 'POST' });
    } catch (e) {}
    iaReset();
}

function iaReset() {
    if (_iaPolling) { clearInterval(_iaPolling); _iaPolling = null; }
    _iaJobId = null;
    $('#iaBtnGenerate').disabled = false;
    $('#iaBtnCancel').style.display = 'none';
    $('#iaProgressCard').style.display = 'none';
    $('#iaResultCard').style.display = 'none';
    $('#iaProgressBar').style.width = '0%';
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
    } else {
        startPolling();
    }
});

// ─── MUSIC MANAGEMENT ─────────────────────────────────────────────────────────

let _musicConfig = null;
let _musicPreviewAudio = null;

async function loadMusicConfig() {
    try {
        const res = await fetch('/api/music/config');
        if (!res.ok) return;
        _musicConfig = await res.json();
        applyMusicConfig(_musicConfig);
        renderMusicTracks(_musicConfig.tracks || []);
    } catch (e) {}
}

function applyMusicConfig(cfg) {
    if (!cfg) return;
    const vol = cfg.volume !== undefined ? cfg.volume : 0.4;
    const volEl = $('#musicVolume');
    if (volEl) {
        volEl.value = vol;
        $('#musicVolumeVal').textContent = Math.round(vol * 100) + '%';
    }
    const toggleMap = {
        enabled: 'musicEnabled',
        loop: 'musicLoop',
        shuffle: 'musicShuffle',
        queue_mode: 'musicQueueMode',
        resume_position: 'musicResumePosition',
        auto_start: 'musicAutoStart',
        auto_stop: 'musicAutoStop',
    };
    for (const [key, id] of Object.entries(toggleMap)) {
        const el = $('#' + id);
        if (!el) continue;
        const val = cfg[key] !== undefined ? cfg[key] : false;
        if (val) {
            el.classList.add('ia-toggle--active');
            el.setAttribute('aria-checked', 'true');
        } else {
            el.classList.remove('ia-toggle--active');
            el.setAttribute('aria-checked', 'false');
        }
    }
    const ducking = cfg.ducking || {};
    const dEl = $('#duckingEnabled');
    if (dEl) {
        const dv = ducking.enabled !== false;
        if (dv) { dEl.classList.add('ia-toggle--active'); dEl.setAttribute('aria-checked', 'true'); }
        else { dEl.classList.remove('ia-toggle--active'); dEl.setAttribute('aria-checked', 'false'); }
        const opts = $('#duckingOptions');
        if (opts) opts.style.opacity = dv ? '1' : '0.4';
    }
    if (ducking.volume_during_speech !== undefined) {
        const dv = $('#duckingVolume');
        if (dv) {
            dv.value = ducking.volume_during_speech;
            $('#duckingVolumeVal').textContent = Math.round(ducking.volume_during_speech * 100) + '%';
        }
    }
    if (ducking.fade_down_ms !== undefined && $('#duckingFadeDown'))
        $('#duckingFadeDown').value = ducking.fade_down_ms;
    if (ducking.fade_up_ms !== undefined && $('#duckingFadeUp'))
        $('#duckingFadeUp').value = ducking.fade_up_ms;
}

function renderMusicTracks(tracks) {
    const el = $('#musicTrackList');
    if (!el) return;
    if (!tracks.length) {
        el.innerHTML = '<div class="music-empty">Aucune piste. Uploadez des fichiers audio ci-dessus.</div>';
        return;
    }
    el.innerHTML = tracks.map(t => {
        const active = t.active;
        const sizeMb = (t.size / (1024 * 1024)).toFixed(2);
        return `<div class="music-track ${active ? 'music-track--active' : ''}" data-filename="${escHtml(t.filename)}">
            <div class="music-track-info">
                <div class="music-track-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                </div>
                <div>
                    <div class="music-track-name">${escHtml(t.filename)}</div>
                    <div class="music-track-meta">${sizeMb} MB${active ? ' &bull; <span style="color:var(--success)">Piste active</span>' : ''}</div>
                </div>
            </div>
            <div class="music-track-actions">
                <button class="btn btn-xs" onclick="musicPreviewTrack('${escHtml(t.filename)}')" title="Ecouter">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                </button>
                ${active
                    ? `<button class="btn btn-xs" onclick="musicDeactivateTrack()" title="Desactiver">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16"/></svg>
                       </button>`
                    : `<button class="btn btn-xs btn-primary" onclick="musicActivateTrack('${escHtml(t.filename)}')" title="Activer">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                       </button>`
                }
                <button class="btn btn-xs btn-danger" onclick="musicDeleteTrack('${escHtml(t.filename)}')" title="Supprimer">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                </button>
            </div>
        </div>`;
    }).join('');
}

function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function musicUploadFiles(files) {
    if (!files || !files.length) return;
    for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', file);
        try {
            const res = await fetch('/api/music/tracks', { method: 'POST', body: fd });
            const data = await res.json();
            if (data.success) toast(`"${data.filename}" uploadé`, 'success');
            else toast(data.message || 'Erreur upload', 'error');
        } catch (e) { toast('Erreur upload', 'error'); }
    }
    loadMusicConfig();
}

function setupMusicUploadZone() {
    const zone = $('#musicUploadZone');
    if (!zone) return;
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('music-upload-zone--drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('music-upload-zone--drag'));
    zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('music-upload-zone--drag');
        musicUploadFiles(e.dataTransfer.files);
    });
}

async function musicActivateTrack(filename) {
    const res = await fetch(`/api/music/tracks/${encodeURIComponent(filename)}/activate`, { method: 'POST' });
    const data = await res.json();
    if (data.success) { toast('Piste activée', 'success'); loadMusicConfig(); }
    else toast(data.message || 'Erreur', 'error');
}

async function musicDeactivateTrack() {
    const res = await fetch('/api/music/tracks/deactivate', { method: 'POST' });
    const data = await res.json();
    if (data.success) { toast('Piste désactivée', 'success'); loadMusicConfig(); }
}

async function musicDeleteTrack(filename) {
    if (!confirm(`Supprimer "${filename}" ?`)) return;
    if (_musicPreviewAudio) { _musicPreviewAudio.pause(); _musicPreviewAudio = null; }
    const res = await fetch(`/api/music/tracks/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) { toast('Piste supprimée', 'success'); loadMusicConfig(); }
    else toast(data.message || 'Erreur', 'error');
}

function musicPreviewTrack(filename) {
    if (_musicPreviewAudio) { _musicPreviewAudio.pause(); _musicPreviewAudio = null; }
    _musicPreviewAudio = new Audio(`/api/music/preview/${encodeURIComponent(filename)}`);
    _musicPreviewAudio.volume = 0.5;
    _musicPreviewAudio.play().catch(() => toast('Impossible de lire la piste', 'error'));
}

function musicToggleOpt(btn, key) {
    const checked = btn.getAttribute('aria-checked') === 'true';
    const newVal = !checked;
    btn.setAttribute('aria-checked', String(newVal));
    if (newVal) btn.classList.add('ia-toggle--active');
    else btn.classList.remove('ia-toggle--active');
}

function musicDuckingToggle(btn) {
    musicToggleOpt(btn, 'ducking_enabled');
    const enabled = btn.getAttribute('aria-checked') === 'true';
    const opts = $('#duckingOptions');
    if (opts) opts.style.opacity = enabled ? '1' : '0.4';
}

async function saveMusicConfig() {
    const vol = parseFloat($('#musicVolume').value);
    const getToggle = id => $('#' + id)?.getAttribute('aria-checked') === 'true';
    const cfg = {
        volume: vol,
        enabled: getToggle('musicEnabled'),
        loop: getToggle('musicLoop'),
        shuffle: getToggle('musicShuffle'),
        queue_mode: getToggle('musicQueueMode'),
        resume_position: getToggle('musicResumePosition'),
        auto_start: getToggle('musicAutoStart'),
        auto_stop: getToggle('musicAutoStop'),
        ducking: {
            enabled: getToggle('duckingEnabled'),
            volume_during_speech: parseFloat($('#duckingVolume').value),
            fade_down_ms: parseInt($('#duckingFadeDown').value),
            fade_up_ms: parseInt($('#duckingFadeUp').value),
        }
    };
    try {
        const res = await fetch('/api/music/config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cfg)
        });
        const data = await res.json();
        if (data.success) toast('Configuration musique sauvegardée', 'success');
        else toast('Erreur sauvegarde', 'error');
    } catch (e) { toast('Erreur serveur', 'error'); }
}

async function musicCommand(command) {
    try {
        await fetch('/api/music/command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command })
        });
    } catch (e) {}
}

// ─── END MUSIC ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    initOverlayUrl();
    startPolling();

    $('#username').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !isRunning) startGame();
    });

    loadQuestionnaires();
    loadCurrentTemplate();
    onPlayModeChange();
    setupMusicUploadZone();

    $('#qnSelector').addEventListener('change', updateLaunchSummary);
    $('#playMode').addEventListener('change', updateLaunchSummary);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const overlay = $('#modalOverlay');
            if (overlay.classList.contains('active')) {
                overlay.classList.remove('active');
                setTimeout(() => { $('#modalBody').innerHTML = ''; }, 200);
            }
        }
    });
});
