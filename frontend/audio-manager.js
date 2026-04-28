class AudioManager {
    constructor() {
        const audioCfg = (window.GameConfig && GameConfig.getSection('audio')) || {};
        this.sounds = {};
        this.isLoaded = false;
        this.volume = audioCfg.default_volume !== undefined ? audioCfg.default_volume : 0.5;
        this.currentlyPlaying = {};
        this.cooldowns = {};
        this.cooldownTime = audioCfg.cooldown_ms !== undefined ? audioCfg.cooldown_ms : 100;
        this._sequenceId = 0;
        this._masterMuted = false;
    }

    setMasterMute(muted) {
        this._masterMuted = !!muted;
        const vol = muted ? 0 : this.volume;
        Object.values(this.currentlyPlaying).forEach(s => { if (s) s.volume = vol; });
        console.log(`[AUDIO] Master mute: ${this._masterMuted}`);
    }

    async preload() {
        const basePath = window.__SAAS_MODE
            ? '/overlay-assets/'
            : (window.location.pathname.startsWith('/overlay') ? '/overlay/' : '');
        const soundFiles = {
            question_show: basePath + 'assets/sounds/question_show.mp3',
            countdown_warning: basePath + 'assets/sounds/countdown_warning.mp3',
            correct_answer: basePath + 'assets/sounds/correct_answer.mp3',
            leaderboard_show: basePath + 'assets/sounds/leaderboard_show.mp3',
            next_question: basePath + 'assets/sounds/next_question.mp3',
            tick: basePath + 'assets/sounds/tick.mp3'
        };

        const loadPromises = Object.entries(soundFiles).map(([name, path]) => {
            return this._loadSound(name, path);
        });

        try {
            await Promise.all(loadPromises);
            this.isLoaded = true;
            console.log('[AUDIO] All sounds preloaded');
        } catch (error) {
            console.warn('[AUDIO] Some sounds failed to load:', error);
            this.isLoaded = true;
        }
    }

    async _loadSound(name, path) {
        return new Promise((resolve) => {
            const audio = new Audio(path);
            audio.volume = this.volume;
            audio.preload = 'auto';

            audio.addEventListener('canplaythrough', () => {
                this.sounds[name] = audio;
                console.log(`[AUDIO] Loaded: ${name}`);
                resolve();
            }, { once: true });

            audio.addEventListener('error', (e) => {
                console.warn(`[AUDIO] Failed to load ${name}: ${path}`);
                this.sounds[name] = null;
                resolve();
            }, { once: true });

            audio.load();
        });
    }

    play(soundName) {
        if (!this.isLoaded) {
            console.warn('[AUDIO] Sounds not loaded yet');
            return;
        }
        if (this._masterMuted) return;

        const now = Date.now();
        if (this.cooldowns[soundName] && now - this.cooldowns[soundName] < this.cooldownTime) {
            console.log(`[AUDIO] Skipping ${soundName} (cooldown)`);
            return;
        }

        const sound = this.sounds[soundName];
        if (!sound) {
            console.warn(`[AUDIO] Sound not found: ${soundName}`);
            return;
        }

        this.cooldowns[soundName] = now;

        const playInstance = sound.cloneNode();
        playInstance.volume = this.volume;

        this.currentlyPlaying[soundName] = playInstance;

        playInstance.play().then(() => {
            console.log(`[AUDIO] Playing: ${soundName}`);
        }).catch(error => {
            console.warn(`[AUDIO] Play failed for ${soundName}:`, error.message);
        });

        playInstance.addEventListener('ended', () => {
            if (this.currentlyPlaying[soundName] === playInstance) {
                delete this.currentlyPlaying[soundName];
            }
        }, { once: true });
    }

    stop(soundName) {
        const playInstance = this.currentlyPlaying[soundName];
        if (playInstance) {
            playInstance.pause();
            playInstance.currentTime = 0;
            delete this.currentlyPlaying[soundName];
            console.log(`[AUDIO] Stopped: ${soundName}`);
        }
    }

    stopAll() {
        Object.keys(this.currentlyPlaying).forEach(name => {
            if (name !== '_sequence') this.stop(name);
        });
        console.log('[AUDIO] Stopped UI sounds (TTS sequence preserved)');
    }

    stopSequence() {
        this._sequenceId++;
        const seq = this.currentlyPlaying['_sequence'];
        if (seq) {
            seq.pause();
            seq.currentTime = 0;
            delete this.currentlyPlaying['_sequence'];
        }
        console.log('[AUDIO] Stopped TTS sequence');
    }

    async playSequence(files) {
        this._sequenceId++;
        const myId = this._sequenceId;
        await this._playSequenceWithId(files, myId);
    }

    async _playSequenceWithId(files, myId) {
        if (this._masterMuted) return false;

        const basePath = window.__SAAS_MODE
            ? '/overlay-assets/audio/'
            : (window.location.pathname.startsWith('/overlay') ? '/overlay/audio/' : '/audio/');

        const seq = this.currentlyPlaying['_sequence'];
        if (seq) {
            seq.pause();
            seq.currentTime = 0;
            delete this.currentlyPlaying['_sequence'];
        }

        const preloaded = files.map(file => {
            const audio = new Audio(basePath + file);
            audio.volume = this.volume;
            audio.preload = 'auto';
            audio.load();
            return { audio, file };
        });

        let playedCount = 0;
        for (const { audio, file } of preloaded) {
            if (this._sequenceId !== myId) return false;
            try {
                await this._playPreloaded(audio, myId);
                playedCount++;
            } catch (e) {
                console.warn(`[AUDIO] Sequence skip: ${file}`, e);
            }
        }

        return this._sequenceId === myId && playedCount > 0;
    }

    _playPreloaded(audio, seqId) {
        return new Promise((resolve, reject) => {
            if (this._sequenceId !== seqId) { resolve(); return; }
            audio.volume = this.volume;
            this.currentlyPlaying['_sequence'] = audio;

            audio.addEventListener('ended', () => {
                if (this.currentlyPlaying['_sequence'] === audio) {
                    delete this.currentlyPlaying['_sequence'];
                }
                resolve();
            }, { once: true });
            audio.addEventListener('error', (e) => {
                if (this.currentlyPlaying['_sequence'] === audio) {
                    delete this.currentlyPlaying['_sequence'];
                }
                reject(e);
            }, { once: true });

            audio.play().catch(reject);
        });
    }

    preloadSequence(files) {
        const basePath = window.__SAAS_MODE
            ? '/overlay-assets/audio/'
            : (window.location.pathname.startsWith('/overlay') ? '/overlay/audio/' : '/audio/');
        if (!this._preloaded) this._preloaded = {};
        files.forEach(file => {
            const url = basePath + file;
            if (!this._preloaded[url]) {
                const audio = new Audio(url);
                audio.preload = 'auto';
                audio.load();
                this._preloaded[url] = true;
            }
        });
    }

    setVolume(vol) {
        this.volume = Math.max(0, Math.min(1, vol));
        Object.values(this.sounds).forEach(sound => {
            if (sound) {
                sound.volume = this.volume;
            }
        });
        Object.values(this.currentlyPlaying).forEach(sound => {
            if (sound) {
                sound.volume = this.volume;
            }
        });
        console.log(`[AUDIO] Volume set to: ${this.volume}`);
    }
}

window.AudioManager = AudioManager;

class MusicPlayer {
    constructor() {
        this._audio = null;
        this._tracks = [];
        this._currentIndex = 0;
        this._config = {
            enabled: true,
            volume: 0.4,
            loop: true,
            shuffle: false,
            queue_mode: false,
            resume_position: true,
            ducking: {
                enabled: true,
                volume_during_speech: 0.08,
                fade_down_ms: 300,
                fade_up_ms: 600
            }
        };
        this._savedPosition = 0;
        this._isDucked = false;
        this._duckFadeInterval = null;
        this._isPlaying = false;
        this._shuffleOrder = [];
        this._basePath = '';
        this._masterMuted = false;
    }

    setMasterMute(muted) {
        this._masterMuted = !!muted;
        if (this._audio) {
            this._audio.volume = muted ? 0 : (this._isDucked
                ? this._config.ducking.volume_during_speech
                : this._config.volume);
        }
        console.log(`[Music] Master mute: ${this._masterMuted}`);
    }

    setBasePath(path) { this._basePath = path; }

    applyConfig(cfg) {
        if (!cfg) return;
        const prev = { ...this._config };
        Object.assign(this._config, cfg);
        if (cfg.ducking) this._config.ducking = { ...prev.ducking, ...cfg.ducking };

        if (cfg.tracks !== undefined) {
            this._tracks = (cfg.tracks || []).map(t => t.filename);
            this._buildShuffleOrder();
            const activeTrack = cfg.active_track;
            if (activeTrack) {
                const idx = this._tracks.indexOf(activeTrack);
                if (idx >= 0) this._currentIndex = idx;
            }
        }
        if (this._audio) {
            this._targetVolume = this._isDucked
                ? this._config.ducking.volume_during_speech
                : this._config.volume;
            this._audio.volume = this._masterMuted ? 0 : this._targetVolume;
        }
    }

    _buildShuffleOrder() {
        this._shuffleOrder = this._tracks.map((_, i) => i);
        for (let i = this._shuffleOrder.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this._shuffleOrder[i], this._shuffleOrder[j]] = [this._shuffleOrder[j], this._shuffleOrder[i]];
        }
    }

    _getTrackUrl(filename) {
        return `${this._basePath}/music/${encodeURIComponent(filename)}`;
    }

    play(trackIndex) {
        if (!this._config.enabled || !this._tracks.length) return;
        const idx = trackIndex !== undefined ? trackIndex : this._currentIndex;
        if (idx < 0 || idx >= this._tracks.length) return;
        this._currentIndex = idx;

        const filename = this._tracks[this._config.shuffle
            ? this._shuffleOrder[idx % this._shuffleOrder.length]
            : idx];
        if (!filename) return;

        if (this._audio) {
            this._audio.pause();
            this._audio.onended = null;
            this._audio.onerror = null;
        }

        this._audio = new Audio(this._getTrackUrl(filename));
        this._audio.volume = this._masterMuted ? 0 : (this._isDucked
            ? this._config.ducking.volume_during_speech
            : this._config.volume);
        this._audio.loop = this._config.loop && !this._config.queue_mode;

        this._audio.onended = () => {
            this._isPlaying = false;
            if (this._config.queue_mode && this._tracks.length > 1) {
                this._nextTrack();
            } else if (!this._config.loop) {
                this._isPlaying = false;
            }
        };
        this._audio.onerror = (e) => {
            console.warn('[Music] Playback error:', e);
            this._isPlaying = false;
        };

        if (this._config.resume_position && this._savedPosition > 0) {
            this._audio.currentTime = this._savedPosition;
            this._savedPosition = 0;
        }

        this._audio.play().then(() => {
            this._isPlaying = true;
            console.log(`[Music] Playing: ${filename}`);
        }).catch(e => {
            console.warn('[Music] Play failed:', e.message);
        });
    }

    pause() {
        if (!this._audio || !this._isPlaying) return;
        if (this._config.resume_position) {
            this._savedPosition = this._audio.currentTime;
        }
        this._audio.pause();
        this._isPlaying = false;
        console.log('[Music] Paused');
    }

    resume() {
        if (!this._audio) {
            this.play();
            return;
        }
        if (this._isPlaying) return;
        this._audio.play().then(() => {
            this._isPlaying = true;
            console.log('[Music] Resumed');
        }).catch(e => {
            console.warn('[Music] Resume failed:', e.message);
            this.play();
        });
    }

    stop() {
        if (this._audio) {
            this._audio.pause();
            this._audio.currentTime = 0;
            this._audio.onended = null;
            this._audio = null;
        }
        this._isPlaying = false;
        this._savedPosition = 0;
        console.log('[Music] Stopped');
    }

    resetSession() {
        if (this._audio) {
            this._audio.pause();
            this._audio.onended = null;
            this._audio.onerror = null;
            this._audio = null;
        }
        if (this._duckFadeInterval) {
            clearInterval(this._duckFadeInterval);
            this._duckFadeInterval = null;
        }
        this._isPlaying = false;
        this._savedPosition = 0;
        this._isDucked = false;
        this._tracks = [];
        this._currentIndex = 0;
        this._shuffleOrder = [];
        console.log('[Music] Session reset');
    }

    _nextTrack() {
        if (!this._tracks.length) return;
        this._currentIndex = (this._currentIndex + 1) % this._tracks.length;
        this.play(this._currentIndex);
    }

    _prevTrack() {
        if (!this._tracks.length) return;
        this._currentIndex = (this._currentIndex - 1 + this._tracks.length) % this._tracks.length;
        this.play(this._currentIndex);
    }

    duck() {
        if (!this._config.ducking.enabled || !this._audio || this._isDucked) return;
        this._isDucked = true;
        if (!this._masterMuted) {
            this._fadeTo(this._config.ducking.volume_during_speech, this._config.ducking.fade_down_ms);
        }
    }

    unduck() {
        if (!this._config.ducking.enabled || !this._audio || !this._isDucked) return;
        this._isDucked = false;
        if (!this._masterMuted) {
            this._fadeTo(this._config.volume, this._config.ducking.fade_up_ms);
        }
    }

    _fadeTo(targetVol, durationMs) {
        if (this._duckFadeInterval) {
            clearInterval(this._duckFadeInterval);
            this._duckFadeInterval = null;
        }
        if (!this._audio) return;
        if (durationMs <= 0) {
            this._audio.volume = Math.max(0, Math.min(1, targetVol));
            return;
        }
        const steps = Math.max(1, Math.floor(durationMs / 20));
        const startVol = this._audio.volume;
        const delta = (targetVol - startVol) / steps;
        let step = 0;
        this._duckFadeInterval = setInterval(() => {
            step++;
            if (!this._audio) { clearInterval(this._duckFadeInterval); return; }
            this._audio.volume = Math.max(0, Math.min(1, startVol + delta * step));
            if (step >= steps) {
                clearInterval(this._duckFadeInterval);
                this._duckFadeInterval = null;
                if (this._audio) this._audio.volume = Math.max(0, Math.min(1, targetVol));
            }
        }, 20);
    }

    handleCommand(command, data) {
        switch (command) {
            case 'config_update':
                this.applyConfig(data);
                break;
            case 'play':
                if (this._isPlaying) this.stop();
                this.play();
                break;
            case 'pause':
                this.pause();
                break;
            case 'resume':
                this.resume();
                break;
            case 'stop':
                this.stop();
                break;
            case 'next':
                this._nextTrack();
                break;
            case 'prev':
                this._prevTrack();
                break;
        }
    }

    onGameStart() {
        if (!this._config.enabled || !this._config.auto_start) return;
        if (this._isPlaying) return;
        if (this._tracks.length) this.play();
    }

    onGameEnd() {
        if (!this._config.auto_stop) return;
        this.stop();
    }

    onGamePause() {
        this.pause();
    }

    onGameResume() {
        this.resume();
    }
}

window.MusicPlayer = MusicPlayer;
