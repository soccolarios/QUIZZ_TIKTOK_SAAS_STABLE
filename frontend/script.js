const UIState = {
    WAITING: 'waiting',
    STARTING: 'starting',
    QUESTION: 'question',
    RESULT: 'result',
    LEADERBOARD: 'leaderboard',
    COUNTDOWN: 'countdown',
    TRANSITION: 'transition',
    END: 'end',
    DOUBLE_OPEN: 'double_open',
    DOUBLE_SHOW: 'double_show',
    DOUBLE_RESULT: 'double_result'
};

class QuizOverlay {
    constructor() {
        const overlayCfg = GameConfig.getSection('overlay');
        const wsCfg = GameConfig.getSection('websocket');

        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = overlayCfg.max_reconnect_attempts || 10;
        this.reconnectDelay = overlayCfg.reconnect_delay_ms || 2000;
        this._reconnectTimer = null;
        this._connecting = false;
        this.currentScreen = UIState.WAITING;
        this.totalTime = 20;
        this.sessionLeaderboard = [];
        this.isPaused = false;
        this.currentTemplate = 'standard';

        this.uiState = UIState.WAITING;
        this.minResultDuration = overlayCfg.min_result_duration_ms || 5000;
        this.minLeaderboardDuration = overlayCfg.min_leaderboard_duration_ms || 4000;
        this.resultShownAt = null;
        this.leaderboardShownAt = null;

        this.wsHost = wsCfg.host || null;
        this.wsPort = wsCfg.port || null;

        this._saasMode = !!(window.__SAAS_MODE);
        this._saasToken = window.__SAAS_OVERLAY_TOKEN || null;
        this._saasConfigLoaded = false;
        this._saasWsUrl = null;

        this.animBaseDelay = overlayCfg.winner_pill_animation_base_delay || 0.6;
        this.animStep = overlayCfg.winner_pill_animation_step || 0.08;
        this.lbAnimStep = overlayCfg.leaderboard_item_animation_step || 0.1;

        this.audio = new AudioManager();
        this.audio.preload();

        this.music = new MusicPlayer();
        const musicBase = window.__SAAS_MODE
            ? '/overlay-assets'
            : (window.location.pathname.startsWith('/overlay') ? '/overlay' : '');
        this.music.setBasePath(musicBase);
        window._musicPlayer = this.music;
        this._loadMusicConfig();

        this.loadTemplate();

        this.screens = {
            waiting: document.getElementById('screen-waiting'),
            starting: document.getElementById('screen-starting'),
            question: document.getElementById('screen-question'),
            result: document.getElementById('screen-result'),
            leaderboard: document.getElementById('screen-leaderboard'),
            countdown: document.getElementById('screen-countdown'),
            transition: document.getElementById('screen-transition'),
            end: document.getElementById('screen-end'),
            paused: document.getElementById('screen-paused'),
            double_open: document.getElementById('screen-double-open'),
            double_show: document.getElementById('screen-double-show'),
            double_result: document.getElementById('screen-double-result')
        };

        this.elements = {
            questionNumber: document.querySelector('.question-number'),
            questionTotal: document.querySelector('.question-total'),
            timerValue: document.querySelector('.timer-value'),
            timerProgress: document.querySelector('.timer-progress'),
            questionText: document.querySelector('.question-text'),
            answerCount: document.querySelector('.count-value'),
            showcaseLetter: document.querySelector('.showcase-letter'),
            showcaseText: document.querySelector('.showcase-text'),
            fastestPlayerName: document.querySelector('.fastest-player-name'),
            fastestTime: document.querySelector('.fastest-time'),
            winnersCountBadge: document.querySelector('.winners-count-badge'),
            winnersGrid: document.querySelector('.winners-grid'),
            countdownValue: document.querySelector('.countdown-value'),
            championName: document.querySelector('.champion-name'),
            championScore: document.querySelector('.champion-score'),
            doubleBadge: document.querySelector('.double-badge'),
            transitionFinishedName: document.querySelector('.transition-finished-name'),
            transitionNextName: document.querySelector('.transition-next-name')
        };

        this._ready = false;
        this._gameStarted = false;
        this._startingRetryTimer = null;
    }

    async init() {
        if (this._saasMode && this._saasToken) {
            await this._loadSaasConfig();
        }
        await this._fetchAndApplySnapshot();
        this._ready = true;
        this.connect();
        if (!this._saasMode) {
            this.connectSSE();
        }
    }

    async _loadSaasConfig() {
        try {
            const res = await fetch(`/api/overlay/${this._saasToken}/config`);
            if (!res.ok) {
                this.log('SaaS', `Config fetch failed: HTTP ${res.status}`);
                return;
            }
            const cfg = await res.json();
            if (!cfg.ok) {
                this.log('SaaS', `Config error: ${cfg.error}`);
                return;
            }
            if (cfg.overlay_template && cfg.overlay_template !== 'default') {
                this.applyTemplate(cfg.overlay_template);
            }
            if (cfg.ws_url) {
                try {
                    new URL(cfg.ws_url);
                    this._saasWsUrl = cfg.ws_url;
                    this.log('SaaS', `Config loaded — ws_url=${cfg.ws_url} status=${cfg.session_status} template=${cfg.overlay_template || 'default'}`);
                    this._saasConfigLoaded = true;
                } catch (e) {
                    this.log('SaaS', `Invalid ws_url: ${cfg.ws_url}`);
                }
            }
        } catch (e) {
            this.log('SaaS', `Config fetch exception: ${e}`);
        }
    }

    log(category, message, data = null) {
        const timestamp = new Date().toISOString().substr(11, 12);
        const dataStr = data ? ` ${JSON.stringify(data)}` : '';
        console.log(`[${timestamp}] [${category}] ${message}${dataStr}`);
    }

    async loadTemplate() {
        if (this._saasMode) return;
        try {
            const baseUrl = window.location.origin;
            const res = await fetch(`${baseUrl}/api/template`);
            if (res.ok) {
                const data = await res.json();
                if (data.template) {
                    this.applyTemplate(data.template);
                }
            }
        } catch (e) {
            this.log('Template', 'Could not load template, using standard');
        }
    }

    applyTemplate(templateName) {
        console.log('[TEMPLATE]', templateName);
        const app = document.getElementById('app');
        if (templateName === 'standard' || !templateName) {
            app.removeAttribute('data-template');
            this.removeTemplateCSS();
            this.updateTimerGradient('#00f5d4', '#7b2ff7', '#f72585');
        } else {
            app.setAttribute('data-template', templateName);
            this.loadTemplateCSS(templateName);
            if (templateName === 'football') {
                this.updateTimerGradient('#00e676', '#b2ff59', '#00bfa5');
            }
        }
        this.currentTemplate = templateName;
        this.log('Template', `Applied template: ${templateName}`);
    }

    updateTimerGradient(c1, c2, c3) {
        const stops = document.querySelectorAll('#timerGradient stop');
        if (stops.length >= 3) {
            stops[0].setAttribute('stop-color', c1);
            stops[1].setAttribute('stop-color', c2);
            stops[2].setAttribute('stop-color', c3);
        }
    }

    loadTemplateCSS(templateName) {
        this.removeTemplateCSS();
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.id = 'template-css';
        const basePath = window.__SAAS_MODE
            ? '/overlay-assets/'
            : (window.location.pathname.startsWith('/overlay') ? '/overlay/' : '');
        link.href = `${basePath}template-${templateName}.css?v=${Date.now()}`;
        document.head.appendChild(link);
    }

    removeTemplateCSS() {
        const existing = document.getElementById('template-css');
        if (existing) existing.remove();
    }

    async _fetchAndApplySnapshot() {
        try {
            let url;
            if (this._saasMode && this._saasToken) {
                url = `/api/overlay/${this._saasToken}/state`;
            } else {
                url = `${window.location.origin}/api/overlay-state`;
            }
            const res = await fetch(url);
            if (!res.ok) {
                this.showScreen(UIState.WAITING);
                return;
            }
            const snap = await res.json();
            this.log('Snapshot', 'Received', { phase: snap.phase, runtime: snap.runtime_state });
            this._applySnapshot(snap);
        } catch (e) {
            this.log('Snapshot', 'Fetch failed, showing waiting screen');
            this.showScreen(UIState.WAITING);
        }
    }

    _applySnapshot(snap) {
        const phase = snap.phase || 'waiting';
        if (this._gameStarted && phase === 'waiting') {
            this.log('Snapshot', 'Ignoring stale "waiting" snapshot — game is active');
            return;
        }

        if (snap.template) {
            this.applyTemplate(snap.template);
        }

        if (phase === 'waiting' || phase === 'starting') {
            this.showScreen(phase === 'starting' ? UIState.STARTING : UIState.WAITING);
            if (phase === 'starting' && !this._startingRetryTimer) {
                this._startingRetryTimer = setTimeout(() => {
                    this._startingRetryTimer = null;
                    this._fetchAndApplySnapshot();
                }, 1500);
            }
            return;
        }

        if (snap.leaderboard && snap.leaderboard.length > 0) {
            this.sessionLeaderboard = snap.leaderboard.map((p, i) => ({
                username: p.username,
                score: p.score,
                rank: i + 1,
            }));
        }

        if ((phase === 'question' || phase === 'result') && snap.question) {
            const q = snap.question;
            this.elements.questionNumber.textContent = q.question_number;
            this.elements.questionTotal.textContent = q.total_questions;
            this.elements.questionText.textContent = q.text;
            this.totalTime = q.time_limit || 20;

            const isDouble = q.is_double || false;
            if (this.elements.doubleBadge) {
                this.elements.doubleBadge.style.display = isDouble ? 'flex' : 'none';
            }
            const questionCard = document.querySelector('.question-card');
            if (questionCard) {
                questionCard.classList.toggle('double-question-card', isDouble);
            }

            const choices = document.querySelectorAll('#screen-question .choice');
            choices.forEach(choice => {
                const letter = choice.dataset.choice;
                const textEl = choice.querySelector('.choice-text');
                const barFill = choice.querySelector('.choice-bar-fill');
                const percentEl = choice.querySelector('.choice-percent');
                textEl.textContent = q.choices[letter] || '';
                barFill.style.width = '0%';
                percentEl.textContent = '0%';
                choice.classList.remove('correct', 'incorrect', 'correct-double');
            });

            this.elements.answerCount.textContent = '0';
            this.updateMiniLeaderboard();

            if (snap.timer) {
                const remaining = snap.timer.remaining;
                this.elements.timerValue.textContent = remaining;
                const circumference = 2 * Math.PI * 85;
                const progress = (remaining / this.totalTime) * circumference;
                this.elements.timerProgress.style.strokeDashoffset = circumference - progress;
                this.elements.timerProgress.classList.remove('warning', 'danger');
                if (remaining <= 5) {
                    this.elements.timerProgress.classList.add('danger');
                } else if (remaining <= 10) {
                    this.elements.timerProgress.classList.add('warning');
                }
            } else {
                this.resetTimer();
            }

            if (snap.answer_update) {
                this.onAnswerUpdate(snap.answer_update);
            }

            if (phase === 'result' && snap.result) {
                this.showScreen(UIState.QUESTION);
                this.onResult(snap.result);
            } else {
                this.showScreen(UIState.QUESTION);
            }
        } else if (phase === 'leaderboard') {
            if (snap.leaderboard && snap.leaderboard.length > 0) {
                this._restoreLeaderboard(snap.leaderboard);
            }
            this.showScreen(UIState.LEADERBOARD);
        } else if (phase === 'countdown' && snap.countdown) {
            this.elements.countdownValue.textContent = snap.countdown.seconds;
            this.showScreen(UIState.COUNTDOWN);
        } else if (phase === 'transition') {
            this.showScreen(UIState.TRANSITION);
        } else if (phase === 'double_open' && snap.x2) {
            this.onDoubleOpen({ duration: snap.x2.duration });
            this.onX2Registered({ count: snap.x2.count, participants: snap.x2.participants });
        } else if (phase === 'double_show' && snap.x2) {
            this.onDoubleShow({ count: snap.x2.count, participants: snap.x2.participants });
        } else if (phase === 'double_result' && snap.double_result) {
            this.onDoubleResult(snap.double_result);
        } else if (phase === 'end' && snap.game_end) {
            this.onGameEnd(snap.game_end);
        } else {
            this.showScreen(UIState.WAITING);
        }

        if (snap.paused) {
            this.isPaused = true;
            this.showPauseOverlay();
        }
    }

    _restoreLeaderboard(players) {
        this.sessionLeaderboard = players;

        const podium1 = document.querySelector('.podium-1');
        const podium2 = document.querySelector('.podium-2');
        const podium3 = document.querySelector('.podium-3');

        if (players[0]) {
            const n0 = this.safeDisplayName(players[0].username);
            const avatarSlot0 = podium1.querySelector('.podium-avatar-slot');
            if (avatarSlot0) avatarSlot0.innerHTML = this.renderAvatar(players[0].profile_picture_url || '', 'avatar-podium', n0);
            podium1.querySelector('.podium-name').textContent = n0;
            podium1.querySelector('.podium-score').textContent = players[0].score;
        }
        if (players[1]) {
            const n1 = this.safeDisplayName(players[1].username);
            const avatarSlot1 = podium2.querySelector('.podium-avatar-slot');
            if (avatarSlot1) avatarSlot1.innerHTML = this.renderAvatar(players[1].profile_picture_url || '', 'avatar-podium-side', n1);
            podium2.querySelector('.podium-name').textContent = n1;
            podium2.querySelector('.podium-score').textContent = players[1].score;
        }
        if (players[2]) {
            const n2 = this.safeDisplayName(players[2].username);
            const avatarSlot2 = podium3.querySelector('.podium-avatar-slot');
            if (avatarSlot2) avatarSlot2.innerHTML = this.renderAvatar(players[2].profile_picture_url || '', 'avatar-podium-side', n2);
            podium3.querySelector('.podium-name').textContent = n2;
            podium3.querySelector('.podium-score').textContent = players[2].score;
        }

        const listEl = document.querySelector('#screen-leaderboard .leaderboard-list');
        listEl.innerHTML = '';
        players.slice(3, 5).forEach((player, index) => {
            const lbName = this.safeDisplayName(player.username);
            const item = document.createElement('div');
            item.className = 'leaderboard-item';
            item.dataset.rank = index + 4;
            item.innerHTML = `
                <div class="lb-rank">${player.rank}</div>
                ${this.renderAvatar(player.profile_picture_url || '', 'avatar-lb', lbName)}
                <div class="lb-name">${this.escapeHtml(lbName)}</div>
                <div class="lb-score">${player.score}</div>
            `;
            listEl.appendChild(item);
        });

        this.updateMiniLeaderboard();
    }

    _buildWsUrl() {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const INTERNAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '::']);

        if (this._saasMode) {
            return this._saasWsUrl || null;
        }

        if (this.wsHost && this.wsPort && !INTERNAL_HOSTS.has(this.wsHost)) {
            return `${proto}//${this.wsHost}:${this.wsPort}`;
        }
        return `${proto}//${window.location.host}/ws`;
    }

    connect() {
        if (this._connecting) {
            this.log('WS', 'Connection already in progress, skipping');
            return;
        }

        if (this.ws &&
            (this.ws.readyState === WebSocket.CONNECTING ||
             this.ws.readyState === WebSocket.OPEN)) {
            this.log('WS', 'Already connected or connecting, skipping');
            return;
        }

        const wsUrl = this._buildWsUrl();
        if (!wsUrl) {
            this.log('WS', 'ws_url not available yet — will retry');
            this._scheduleReconnect();
            return;
        }

        this._connecting = true;
        this.log('WS', `Connecting to ${wsUrl}...`);

        try {
            this.ws = new WebSocket(wsUrl);
            this.ws.onopen  = () => this._onOpen();
            this.ws.onclose = (ev) => this._onClose(ev);
            this.ws.onerror = (err) => this._onError(err);
            this.ws.onmessage = (event) => this.onMessage(event);
        } catch (error) {
            this.log('WS', 'Construction error', { message: error.message });
            this._connecting = false;
            this._scheduleReconnect();
        }
    }

    _onOpen() {
        this._connecting = false;
        const wasReconnect = this.reconnectAttempts > 0;
        this.log('WS', `Connected${wasReconnect ? ` (reconnected after ${this.reconnectAttempts} attempt(s))` : ''}`);
        this.reconnectAttempts = 0;
        if (wasReconnect) {
            this.log('WS', 'Restoring session state via snapshot...');
            this._fetchAndApplySnapshot();
        }
    }

    _onClose(ev) {
        this._connecting = false;
        this.log('WS', `Disconnected (code=${ev.code} reason=${ev.reason || 'none'})`);
        this._scheduleReconnect();
    }

    _onError(err) {
        this.log('WS', 'Socket error', { type: err.type });
    }

    _scheduleReconnect() {
        if (this._reconnectTimer !== null) {
            return;
        }

        this.reconnectAttempts++;
        const base = 1000;
        const delay = Math.min(base * Math.pow(2, this.reconnectAttempts - 1), 30000);
        this.log('WS', `Reconnect attempt ${this.reconnectAttempts} scheduled in ${delay}ms`);

        this._reconnectTimer = setTimeout(async () => {
            this._reconnectTimer = null;
            if (this._saasMode && this._saasToken) {
                await this._loadSaasConfig();
            }
            this.connect();
        }, delay);
    }

    onOpen() {}
    onClose() {}
    onError() {}

    onMessage(event) {
        try {
            const message = JSON.parse(event.data);
            this.handleMessage(message.type, message.data);
        } catch (error) {
            this.log('WS', 'Parse error', error);
        }
    }

    handleMessage(type, data) {
        this.log('MSG', `Received: ${type}`);
        if (type === 'result' && data.winners) {
            data.winners.forEach(w => {
                this.log('DEBUG', `winner raw_name=${JSON.stringify(w.display_name || w.username)} displayed=${JSON.stringify(this.safeDisplayName(w.display_name || w.username))}`);
            });
        }
        if (type === 'leaderboard' && data.players) {
            data.players.forEach(p => {
                this.log('DEBUG', `lb raw_name=${JSON.stringify(p.username)} displayed=${JSON.stringify(this.safeDisplayName(p.username))}`);
            });
        }

        switch (type) {
            case 'connected':
                this.log('Game', 'Connected to server');
                break;
            case 'game_start':
                this.onGameStart(data);
                break;
            case 'question':
                this.onQuestion(data);
                break;
            case 'timer':
                this.onTimer(data);
                break;
            case 'answer_update':
                this.onAnswerUpdate(data);
                break;
            case 'result':
                this.onResult(data);
                break;
            case 'leaderboard':
                this.onLeaderboard(data);
                break;
            case 'countdown':
                this.onCountdown(data);
                break;
            case 'next_question':
                break;
            case 'questionnaire_transition':
                this.onQuestionnaireTransition(data);
                break;
            case 'double_open':
                this.onDoubleOpen(data);
                break;
            case 'double_show':
                this.onDoubleShow(data);
                break;
            case 'x2_registered':
                this.onX2Registered(data);
                break;
            case 'double_result':
                this.onDoubleResult(data);
                break;
            case 'game_end':
                this.onGameEnd(data);
                break;
            case 'audio_play':
                this.onAudioPlay(data);
                break;
            case 'state_sync':
                this._applySnapshot(data);
                break;
            case 'music_command':
                this.music.handleCommand(data.command, data);
                break;
            case 'music_ducking':
                if (data.duck) this.music.duck();
                else this.music.unduck();
                break;
            case 'music_config':
                this.music.applyConfig(data);
                if (data.enabled === false) {
                    this.music.pause();
                } else if (data.enabled === true && !this.music._isPlaying) {
                    this.music.resume();
                }
                break;
        }
    }

    async _loadMusicConfig() {
        if (this._saasMode) {
            // In SaaS mode, music config comes from the overlay config endpoint
            // which is already fetched during WebSocket setup. We apply it here
            // once we know the overlay token is available.
            try {
                const token = window.__SAAS_OVERLAY_TOKEN;
                if (!token) return;
                const res = await fetch(`/api/overlay/${token}/config`);
                if (!res.ok) return;
                const cfg = await res.json();
                if (!cfg.music_enabled || !cfg.music_file_name) return;
                const volume = typeof cfg.music_volume === 'number'
                    ? Math.max(0, Math.min(100, cfg.music_volume)) / 100
                    : 0.4;
                this.music.applyConfig({
                    enabled: true,
                    volume: volume,
                    loop: true,
                    auto_start: true,
                    auto_stop: true,
                    tracks: [{ filename: cfg.music_file_name }],
                    active_track: cfg.music_file_name,
                });
            } catch (e) {}
            return;
        }
        try {
            const base = window.location.pathname.startsWith('/overlay') ? '/overlay' : '';
            const res = await fetch(`${base}/api/music/config`);
            if (!res.ok) return;
            const cfg = await res.json();
            this.music.applyConfig(cfg);
        } catch (e) {}
    }

    onAudioPlay(data) {
        const files = data.files || [];
        const token = data.token || null;
        const sequenceId = data.sequence_id || null;
        if (files.length > 0) {
            this.log('AUDIO', `Playing sequence: ${files.length} file(s), token=${token}, sequence_id=${sequenceId}`);
            this.audio._sequenceId++;
            const mySeqId = this.audio._sequenceId;
            this.audio._playSequenceWithId(files, mySeqId).then((completed) => {
                if (!completed) {
                    this.log('AUDIO', `audio_ended suppressed (sequence interrupted, sequence_id=${sequenceId})`);
                    return;
                }
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ type: 'audio_ended', data: { token, sequence_id: sequenceId } }));
                    this.log('AUDIO', `audio_ended sent to server (token=${token}, sequence_id=${sequenceId})`);
                }
            });
        }
    }

    showScreen(screenName, options = {}) {
        const { playSound = null, preserveAudio = false } = options;

        this.log('UI', `Transition: ${this.uiState} -> ${screenName}`);

        if (this.uiState !== screenName && !preserveAudio) {
            this.audio.stopAll();
        }

        Object.entries(this.screens).forEach(([name, screen]) => {
            if (screen) {
                screen.classList.remove('active');
            }
        });

        if (this.screens[screenName]) {
            this.screens[screenName].classList.add('active');
            this.uiState = screenName;
            this.currentScreen = screenName;
        }

        if (playSound) {
            this.audio.play(playSound);
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    _clearStartingRetry() {
        if (this._startingRetryTimer) {
            clearTimeout(this._startingRetryTimer);
            this._startingRetryTimer = null;
        }
    }

    onGameStart(data) {
        this.log('Game', 'Starting!', data);
        this._clearStartingRetry();
        this._gameStarted = true;
        this.elements.questionTotal.textContent = data.total_questions;
        this.sessionLeaderboard = [];
        this.music.onGameStart();
        this.showScreen(UIState.STARTING);
    }

    onQuestion(data) {
        this._clearStartingRetry();
        this.log('UI', 'show_question');

        this.elements.questionNumber.textContent = data.question_number;
        this.elements.questionTotal.textContent = data.total_questions;
        this.elements.questionText.textContent = data.text;
        this.totalTime = data.time_limit || 20;

        const isDouble = data.is_double || false;
        if (this.elements.doubleBadge) {
            this.elements.doubleBadge.style.display = isDouble ? 'flex' : 'none';
        }

        const questionCard = document.querySelector('.question-card');
        if (questionCard) {
            questionCard.classList.toggle('double-question-card', isDouble);
        }

        const choices = document.querySelectorAll('#screen-question .choice');
        choices.forEach(choice => {
            const letter = choice.dataset.choice;
            const textEl = choice.querySelector('.choice-text');
            const barFill = choice.querySelector('.choice-bar-fill');
            const percentEl = choice.querySelector('.choice-percent');

            textEl.textContent = data.choices[letter] || '';
            barFill.style.width = '0%';
            percentEl.textContent = '0%';
            choice.classList.remove('correct', 'incorrect', 'correct-double');
        });

        this.elements.answerCount.textContent = '0';
        this.resetTimer();
        this.updateMiniLeaderboard();

        this.showScreen(UIState.QUESTION, { playSound: 'question_show' });
    }

    onTimer(data) {
        const remaining = data.remaining;
        this.elements.timerValue.textContent = remaining;

        const circumference = 2 * Math.PI * 85;
        const progress = (remaining / this.totalTime) * circumference;
        this.elements.timerProgress.style.strokeDashoffset = circumference - progress;

        this.elements.timerProgress.classList.remove('warning', 'danger');
        if (remaining <= 5) {
            this.elements.timerProgress.classList.add('danger');
            if (remaining === 5 && !this.audio.currentlyPlaying['_sequence']) {
                this.audio.play('countdown_warning');
                this.log('AUDIO', 'Playing: countdown_warning');
            }
        } else if (remaining <= 10) {
            this.elements.timerProgress.classList.add('warning');
        }
    }

    resetTimer() {
        this.elements.timerValue.textContent = this.totalTime;
        this.elements.timerProgress.style.strokeDashoffset = 0;
        this.elements.timerProgress.classList.remove('warning', 'danger');
    }

    onAnswerUpdate(data) {
        const percentages = data.percentages;
        const total = data.total_answers;

        this.elements.answerCount.textContent = total;

        const choices = document.querySelectorAll('#screen-question .choice');
        choices.forEach(choice => {
            const letter = choice.dataset.choice;
            const barFill = choice.querySelector('.choice-bar-fill');
            const percentEl = choice.querySelector('.choice-percent');

            const percent = percentages[letter] || 0;
            barFill.style.width = `${percent}%`;
            percentEl.textContent = `${Math.round(percent)}%`;
        });
    }

    onResult(data) {
        this._clearStartingRetry();
        this.log('UI', 'onResult received', data);
        this.resultShownAt = Date.now();

        const isDouble = data.is_double || false;
        const correctLetter = data.correct_letter || data.correct_answer;
        const correctText = data.correct_text || data.answer_text;

        const showcaseContainer = document.querySelector('.result-answer-showcase');
        if (isDouble && data.correct_answers && data.correct_texts) {
            const letters = data.correct_answers;
            this.elements.showcaseLetter.textContent = letters.join(' & ');
            const texts = letters.map(l => data.correct_texts[l] || '').join(' & ');
            this.elements.showcaseText.textContent = texts;

            const showcaseLabel = document.querySelector('.showcase-label');
            if (showcaseLabel) {
                showcaseLabel.textContent = 'Les bonnes reponses etaient';
            }

            if (showcaseContainer) {
                showcaseContainer.classList.add('showcase-double');
            }
        } else {
            this.elements.showcaseLetter.textContent = correctLetter;
            this.elements.showcaseText.textContent = correctText;

            const showcaseLabel = document.querySelector('.showcase-label');
            if (showcaseLabel) {
                showcaseLabel.textContent = 'La bonne reponse etait';
            }

            if (showcaseContainer) {
                showcaseContainer.classList.remove('showcase-double');
            }
        }

        const correctAnswers = isDouble && data.correct_answers ? data.correct_answers : [correctLetter];

        const choices = document.querySelectorAll('#screen-question .choice');
        choices.forEach(choice => {
            const letter = choice.dataset.choice;
            if (correctAnswers.includes(letter)) {
                choice.classList.add('correct');
                if (isDouble) {
                    choice.classList.add('correct-double');
                }
            } else {
                choice.classList.add('incorrect');
            }
        });

        const winners = data.winners || [];
        const winnerCount = data.winner_count || winners.length;
        const fastestWinner = data.fastest_winner;
        const totalAnswers = data.total_answers || 0;

        this.elements.winnersCountBadge.textContent = winnerCount;

        const fastestSection = document.querySelector('.result-fastest-section');
        if (winners.length > 0 && fastestWinner) {
            fastestSection.style.display = 'block';
            const fastestName = fastestWinner && typeof fastestWinner === 'object'
                ? fastestWinner.display_name
                : fastestWinner;
            const fastestPic = fastestWinner && typeof fastestWinner === 'object'
                ? fastestWinner.profile_picture_url || ''
                : '';
            const fastestDisplayed = this.safeDisplayName(fastestName);

            const fastestAvatarSlot = document.querySelector('.fastest-avatar-slot');
            if (fastestAvatarSlot) {
                fastestAvatarSlot.innerHTML = this.renderAvatar(fastestPic, 'avatar-fastest', fastestDisplayed);
            }
            this.elements.fastestPlayerName.textContent = fastestDisplayed;

            const fastestWinnerData = winners.find(w => (w.display_name || w.username) === fastestName);
            if (fastestWinnerData && fastestWinnerData.time_ms) {
                this.elements.fastestTime.textContent = `${(fastestWinnerData.time_ms / 1000).toFixed(2)}s`;
            } else {
                this.elements.fastestTime.textContent = '';
            }
        } else {
            fastestSection.style.display = 'none';
        }

        const winnersGrid = this.elements.winnersGrid;
        winnersGrid.innerHTML = '';

        const winnersBanner = document.querySelector('.winners-banner');
        const winnersBannerTitle = winnersBanner.querySelector('.winners-banner-title');

        if (winnerCount === 0) {
            winnersBannerTitle.textContent = 'AUCUN GAGNANT';
            winnersGrid.innerHTML = `
                <div class="no-winners-result">
                    <div class="no-winners-icon">&#128546;</div>
                    <p class="no-winners-text">Personne n'a trouve la bonne reponse</p>
                    <p class="no-winners-subtext">${totalAnswers} reponse${totalAnswers > 1 ? 's' : ''} recue${totalAnswers > 1 ? 's' : ''}</p>
                </div>
            `;
        } else {
            winnersBannerTitle.textContent = winnerCount === 1 ? 'FELICITATIONS AU GAGNANT !' : 'FELICITATIONS AUX GAGNANTS !';

            winners.forEach((winner, index) => {
                const displayName = this.safeDisplayName(winner.display_name || winner.username);
                const fastestName = fastestWinner && typeof fastestWinner === 'object'
                    ? fastestWinner.display_name
                    : fastestWinner;
                const isFastest = fastestName && displayName === this.safeDisplayName(fastestName);
                const picUrl = winner.profile_picture_url || '';

                const pill = document.createElement('div');
                pill.className = `winner-pill${isFastest ? ' fastest-pill' : ''}`;
                pill.style.animationDelay = `${this.animBaseDelay + (index * this.animStep)}s`;

                pill.innerHTML = `
                    <div class="winner-pill-rank">${index + 1}</div>
                    ${this.renderAvatar(picUrl, 'avatar-winner-pill', displayName)}
                    <span class="winner-pill-name">${this.escapeHtml(displayName)}</span>
                    <span class="winner-pill-points">+${winner.points}${winner.x2 ? '<span class="x2-star">X2</span>' : ''}</span>
                `;
                winnersGrid.appendChild(pill);
            });
        }

        this.updateMiniLeaderboard();

        this.showScreen(UIState.RESULT, { playSound: 'correct_answer' });
    }

    onLeaderboard(data) {
        this._clearStartingRetry();
        this.log('UI', 'onLeaderboard received, current state:', this.uiState);

        this.sessionLeaderboard = data.players;

        const players = data.players;

        const podium1 = document.querySelector('.podium-1');
        const podium2 = document.querySelector('.podium-2');
        const podium3 = document.querySelector('.podium-3');

        if (players[0]) {
            const n0 = this.safeDisplayName(players[0].username);
            const avatarSlot0 = podium1.querySelector('.podium-avatar-slot');
            if (avatarSlot0) avatarSlot0.innerHTML = this.renderAvatar(players[0].profile_picture_url || '', 'avatar-podium', n0);
            podium1.querySelector('.podium-name').textContent = n0;
            podium1.querySelector('.podium-score').textContent = players[0].score;
        }
        if (players[1]) {
            const n1 = this.safeDisplayName(players[1].username);
            const avatarSlot1 = podium2.querySelector('.podium-avatar-slot');
            if (avatarSlot1) avatarSlot1.innerHTML = this.renderAvatar(players[1].profile_picture_url || '', 'avatar-podium-side', n1);
            podium2.querySelector('.podium-name').textContent = n1;
            podium2.querySelector('.podium-score').textContent = players[1].score;
        }
        if (players[2]) {
            const n2 = this.safeDisplayName(players[2].username);
            const avatarSlot2 = podium3.querySelector('.podium-avatar-slot');
            if (avatarSlot2) avatarSlot2.innerHTML = this.renderAvatar(players[2].profile_picture_url || '', 'avatar-podium-side', n2);
            podium3.querySelector('.podium-name').textContent = n2;
            podium3.querySelector('.podium-score').textContent = players[2].score;
        }

        const listEl = document.querySelector('#screen-leaderboard .leaderboard-list');
        listEl.innerHTML = '';

        players.slice(3, 5).forEach((player, index) => {
            const lbName = this.safeDisplayName(player.username);
            const item = document.createElement('div');
            item.className = 'leaderboard-item';
            item.dataset.rank = index + 4;
            item.style.animationDelay = `${(index + 3) * this.lbAnimStep}s`;
            item.innerHTML = `
                <div class="lb-rank">${player.rank}</div>
                ${this.renderAvatar(player.profile_picture_url || '', 'avatar-lb', lbName)}
                <div class="lb-name">${this.escapeHtml(lbName)}</div>
                <div class="lb-score">${player.score}</div>
            `;
            listEl.appendChild(item);
        });

        this.updateMiniLeaderboard();

        if (this.uiState === UIState.RESULT ||
            this.uiState === UIState.QUESTION ||
            this.uiState === UIState.COUNTDOWN ||
            this.uiState === UIState.TRANSITION ||
            this.uiState === UIState.STARTING ||
            this.uiState === UIState.DOUBLE_OPEN ||
            this.uiState === UIState.DOUBLE_SHOW ||
            this.uiState === UIState.DOUBLE_RESULT) {
            this.log('UI', 'Leaderboard data updated but NOT switching screen (protected state)');
            return;
        }

        this.leaderboardShownAt = Date.now();
        this.showScreen(UIState.LEADERBOARD, { playSound: 'leaderboard_show' });
    }

    updateMiniLeaderboard() {
        const miniLists = document.querySelectorAll('.mini-lb-list');

        miniLists.forEach(miniList => {
            const items = miniList.querySelectorAll('.mini-lb-item');
            items.forEach((item, index) => {
                const nameEl = item.querySelector('.mini-name');
                const scoreEl = item.querySelector('.mini-score');

                if (this.sessionLeaderboard[index]) {
                    nameEl.textContent = this.safeDisplayName(this.sessionLeaderboard[index].username);
                    scoreEl.textContent = this.sessionLeaderboard[index].score;
                } else {
                    nameEl.textContent = '---';
                    scoreEl.textContent = '0';
                }
            });
        });
    }

    onCountdown(data) {
        this.log('UI', 'show_countdown', { seconds: data.seconds });

        this.elements.countdownValue.textContent = data.seconds;

        if (this.uiState !== UIState.COUNTDOWN) {
            this.showScreen(UIState.COUNTDOWN, { playSound: 'next_question' });
        }
    }

    onQuestionnaireTransition(data) {
        this.log('UI', 'show_questionnaire_transition', data);

        if (this.elements.transitionFinishedName) {
            this.elements.transitionFinishedName.textContent = data.finished_questionnaire || '';
        }
        if (this.elements.transitionNextName) {
            this.elements.transitionNextName.textContent = data.next_questionnaire || '';
        }

        this.showScreen(UIState.TRANSITION, { playSound: 'leaderboard_show' });
    }

    onGameEnd(data) {
        this.log('UI', 'show_end');
        this._gameStarted = false;

        const leaderboard = data.leaderboard;

        if (leaderboard.length > 0) {
            const chName = this.safeDisplayName(leaderboard[0].username);
            const championAvatarSlot = document.querySelector('.champion-avatar-slot');
            if (championAvatarSlot) {
                championAvatarSlot.innerHTML = this.renderAvatar(leaderboard[0].profile_picture_url || '', 'avatar-champion', chName);
            }
            this.elements.championName.textContent = chName;
            this.elements.championScore.textContent = `${leaderboard[0].score} points`;
        }

        if (leaderboard.length > 1) {
            const ru2Name = this.safeDisplayName(leaderboard[1].username);
            const ru2El = document.querySelector('.runner-up[data-rank="2"]');
            if (ru2El) {
                const avatarSlot = ru2El.querySelector('.ru-avatar-slot');
                if (avatarSlot) avatarSlot.innerHTML = this.renderAvatar(leaderboard[1].profile_picture_url || '', 'avatar-runner-up', ru2Name);
                ru2El.querySelector('.ru-name').textContent = ru2Name;
            }
        }

        if (leaderboard.length > 2) {
            const ru3Name = this.safeDisplayName(leaderboard[2].username);
            const ru3El = document.querySelector('.runner-up[data-rank="3"]');
            if (ru3El) {
                const avatarSlot = ru3El.querySelector('.ru-avatar-slot');
                if (avatarSlot) avatarSlot.innerHTML = this.renderAvatar(leaderboard[2].profile_picture_url || '', 'avatar-runner-up', ru3Name);
                ru3El.querySelector('.ru-name').textContent = ru3Name;
            }
        }

        this.music.onGameEnd();
        this.showScreen(UIState.END, { playSound: 'leaderboard_show' });
    }

    _renderX2Participants(participants, containerId) {
        const el = document.getElementById(containerId);
        if (!el) return;
        el.innerHTML = '';
        participants.forEach(p => {
            const chip = document.createElement('div');
            chip.className = containerId.includes('open') ? 'x2-participant-chip' : 'x2-show-chip';
            chip.textContent = this.safeDisplayName(p.display_name || p.username);
            el.appendChild(chip);
        });
    }

    onDoubleOpen(data) {
        this._clearStartingRetry();
        this.log('X2', 'double_open', data);
        const duration = data.duration || 10;

        const countEl = document.getElementById('x2-registered-count');
        if (countEl) countEl.textContent = '0';

        const listEl = document.getElementById('x2-open-participants');
        if (listEl) listEl.innerHTML = '';

        const bar = document.getElementById('x2-timer-bar');
        if (bar) {
            bar.style.transition = 'none';
            bar.style.width = '100%';
            requestAnimationFrame(() => {
                bar.style.transition = `width ${duration}s linear`;
                bar.style.width = '0%';
            });
        }

        this.showScreen(UIState.DOUBLE_OPEN, { preserveAudio: true });
    }

    onDoubleShow(data) {
        this.log('X2', 'double_show', data);
        const count = data.count || 0;
        const participants = data.participants || [];

        const countEl = document.getElementById('x2-show-count');
        if (countEl) countEl.textContent = count;

        this._renderX2Participants(participants, 'x2-show-list');

        this.showScreen(UIState.DOUBLE_SHOW, { preserveAudio: true });
    }

    onX2Registered(data) {
        this.log('X2', 'x2_registered', data);
        const count = data.count || 0;
        const participants = data.participants || [];

        const countEl = document.getElementById('x2-registered-count');
        if (countEl) countEl.textContent = count;

        this._renderX2Participants(participants, 'x2-open-participants');
    }

    onDoubleResult(data) {
        this.log('X2', 'double_result', data);
        const successful = data.successful || [];
        const failed = data.failed || [];

        const successCount = document.getElementById('x2-success-count');
        const failCount = document.getElementById('x2-fail-count');
        if (successCount) successCount.textContent = successful.length;
        if (failCount) failCount.textContent = failed.length;

        const successList = document.getElementById('x2-success-list');
        const failList = document.getElementById('x2-fail-list');

        if (successList) {
            successList.innerHTML = '';
            successful.forEach(p => {
                const chip = document.createElement('div');
                chip.className = 'x2-result-chip x2-result-chip-success';
                chip.textContent = this.safeDisplayName(p.display_name || p.username);
                successList.appendChild(chip);
            });
        }

        if (failList) {
            failList.innerHTML = '';
            failed.forEach(p => {
                const chip = document.createElement('div');
                chip.className = 'x2-result-chip x2-result-chip-fail';
                chip.textContent = this.safeDisplayName(p.display_name || p.username);
                failList.appendChild(chip);
            });
        }

        const successSection = document.getElementById('x2-result-success-section');
        const failSection = document.getElementById('x2-result-fail-section');
        if (successSection) successSection.style.display = successful.length > 0 ? 'block' : 'none';
        if (failSection) failSection.style.display = failed.length > 0 ? 'block' : 'none';

        this.showScreen(UIState.DOUBLE_RESULT, { preserveAudio: true });
    }

    connectSSE() {
        const baseUrl = window.location.origin;
        const evtUrl = `${baseUrl}/api/events`;
        this.log('SSE', `Connecting to ${evtUrl}`);

        this.sse = new EventSource(evtUrl);

        this.sse.addEventListener('game_start', (e) => {
            this.log('SSE', 'game_start');
            this.isPaused = false;
            this.hidePauseOverlay();
            this.sessionLeaderboard = [];
            this.showScreen(UIState.STARTING);
        });

        this.sse.addEventListener('game_stop', (e) => {
            this.log('SSE', 'game_stop');
            this.isPaused = false;
            this.hidePauseOverlay();
            this.showScreen(UIState.WAITING);
            const subtitle = document.querySelector('.waiting-subtitle');
            if (subtitle) subtitle.textContent = 'Jeu arrete -- En attente du redemarrage';
        });

        this.sse.addEventListener('game_restart', (e) => {
            this.log('SSE', 'game_restart');
            this.isPaused = false;
            this.hidePauseOverlay();
            this.sessionLeaderboard = [];
            this.showScreen(UIState.STARTING);
        });

        this.sse.addEventListener('game_pause', (e) => {
            this.log('SSE', 'game_pause');
            this.isPaused = true;
            this.music.onGamePause();
            this.showPauseOverlay();
        });

        this.sse.addEventListener('game_resume', (e) => {
            this.log('SSE', 'game_resume');
            this.isPaused = false;
            this.music.onGameResume();
            this.hidePauseOverlay();
            this._fetchAndApplySnapshot();
        });

        this.sse.addEventListener('template_change', (e) => {
            try {
                const data = JSON.parse(e.data);
                this.log('SSE', 'template_change', data);
                this.applyTemplate(data.template);
            } catch (err) {
                this.log('SSE', 'template_change parse error');
            }
        });

        this.sse.addEventListener('connected', (e) => {
            this.log('SSE', 'Connected to admin event stream');
            this._fetchAndApplySnapshot();
        });

        this.sse.onerror = () => {
            this.log('SSE', 'Connection error, will auto-reconnect');
        };
    }

    showPauseOverlay() {
        let overlay = document.getElementById('pause-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'pause-overlay';
            overlay.innerHTML = `
                <div class="pause-backdrop"></div>
                <div class="pause-content">
                    <div class="pause-icon-ring">
                        <svg viewBox="0 0 24 24" fill="currentColor" width="64" height="64">
                            <rect x="6" y="4" width="4" height="16" rx="1"/>
                            <rect x="14" y="4" width="4" height="16" rx="1"/>
                        </svg>
                    </div>
                    <h1 class="pause-title">PAUSE</h1>
                    <p class="pause-subtitle">Le quiz reprendra bientot</p>
                    <div class="pause-pulse-bar"><div class="pause-pulse-fill"></div></div>
                </div>
            `;
            document.getElementById('app').appendChild(overlay);
        }
        overlay.classList.add('active');
    }

    hidePauseOverlay() {
        const overlay = document.getElementById('pause-overlay');
        if (overlay) {
            overlay.classList.remove('active');
        }
    }

    renderAvatar(url, cssClass, displayName) {
        const initials = this._getInitials(displayName);
        if (url && typeof url === 'string' && url.trim()) {
            return `<img src="${this.escapeHtml(url)}" class="${cssClass} avatar-img" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="${cssClass} avatar-fallback" style="display:none">${this.escapeHtml(initials)}</span>`;
        }
        return `<span class="${cssClass} avatar-fallback">${this.escapeHtml(initials)}</span>`;
    }

    _getInitials(name) {
        if (!name || typeof name !== 'string') return '?';
        const clean = name.trim().replace(/[\u{1F000}-\u{1FFFF}]/gu, '').replace(/[^\p{L}\p{N}\s]/gu, '').trim();
        if (!clean) return name.trim().charAt(0).toUpperCase() || '?';
        const parts = clean.split(/\s+/);
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        return clean[0].toUpperCase();
    }

    sanitizeName(name) {
        if (!name || typeof name !== 'string' || !name.trim()) return 'Joueur';
        return name.trim();
    }

    safeDisplayName(name, max = 20) {
        if (!name || typeof name !== 'string') return 'Joueur';
        const trimmed = name.trim();
        if (!trimmed) return 'Joueur';
        if (typeof Intl !== 'undefined' && Intl.Segmenter) {
            const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
            const graphemes = [...segmenter.segment(trimmed)].map(s => s.segment);
            if (graphemes.length <= max) return trimmed;
            return graphemes.slice(0, max).join('') + '\u2026';
        }
        if ([...trimmed].length <= max) return trimmed;
        return [...trimmed].slice(0, max).join('') + '\u2026';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    await GameConfig.loadConfig();
    const quiz = new QuizOverlay();
    window.quiz = quiz;
    await quiz.init();
});

window.addEventListener('message', (event) => {
    if (!event.data || event.data.type !== 'preview_mute') return;
    const muted = !!event.data.muted;
    if (window.quiz) {
        if (window.quiz.audio) window.quiz.audio.setMasterMute(muted);
        if (window.quiz.music) window.quiz.music.setMasterMute(muted);
    }
});
