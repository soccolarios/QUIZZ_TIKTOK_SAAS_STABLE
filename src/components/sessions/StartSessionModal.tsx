import { useState, useEffect } from 'react';
import {
  ChevronDown,
  PlayCircle,
  Bot,
  Radio,
  Clock,
  Timer,
  Volume2,
  Zap,
  Lock,
  BookOpen,
  AlertCircle,
  Check,
  Info,
  ListOrdered,
  Repeat,
  Repeat1,
  SkipForward,
  Monitor,
  Music,
  VolumeX,
} from 'lucide-react';
import { projectsApi } from '../../api/projects';
import { quizzesApi } from '../../api/quizzes';
import { sessionsApi, type StartSessionParams, type PlayMode, type OverlayTemplate } from '../../api/sessions';
import { billingApi, type PlanLimits } from '../../api/billing';
import { musicApi, type MusicTrack } from '../../api/music';
import { useSessionDefaults } from '../../context/PublicConfigContext';
import type { Project, Quiz } from '../../api/types';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Spinner } from '../ui/Spinner';
import { toast } from '../layout/DashboardLayout';
import { ApiError } from '../../api/client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractQuestionCount(data_json: Record<string, unknown>): number {
  if (Array.isArray(data_json['questionnaires'])) {
    const qnrs = data_json['questionnaires'] as Record<string, unknown>[];
    if (qnrs[0] && Array.isArray(qnrs[0]['questions'])) {
      return (qnrs[0]['questions'] as unknown[]).length;
    }
    return 0;
  }
  return Array.isArray(data_json['questions'])
    ? (data_json['questions'] as unknown[]).length
    : 0;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">
      {children}
    </p>
  );
}

interface ToggleRowProps {
  icon: React.ReactNode;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  lockedHint?: string;
}

function ToggleRow({ icon, label, hint, checked, onChange, disabled, lockedHint }: ToggleRowProps) {
  return (
    <div
      className={`flex items-center gap-3 px-3 py-3 rounded-xl border transition-all ${
        disabled
          ? 'border-gray-100 bg-gray-50 opacity-70 cursor-not-allowed'
          : checked
          ? 'border-blue-200 bg-blue-50/60 cursor-pointer'
          : 'border-gray-200 bg-white hover:border-gray-300 cursor-pointer'
      }`}
      onClick={() => !disabled && onChange(!checked)}
    >
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
          disabled
            ? 'bg-gray-100 text-gray-400'
            : checked
            ? 'bg-blue-100 text-blue-600'
            : 'bg-gray-100 text-gray-500'
        }`}
      >
        {disabled ? <Lock className="w-3.5 h-3.5" /> : icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium leading-none mb-0.5 ${disabled ? 'text-gray-400' : 'text-gray-800'}`}>
          {label}
        </p>
        <p className="text-xs text-gray-400 leading-snug">
          {disabled && lockedHint ? lockedHint : hint}
        </p>
      </div>
      <div
        className={`flex-shrink-0 relative rounded-full transition-colors`}
        style={{ height: '22px', width: '40px' }}
      >
        <div
          className={`absolute inset-0 rounded-full transition-colors ${
            disabled ? 'bg-gray-200' : checked ? 'bg-blue-600' : 'bg-gray-300'
          }`}
        />
        <div
          className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </div>
    </div>
  );
}

interface TimeInputProps {
  label: string;
  icon: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  min: number;
  max: number;
  unit: string;
  hint: string;
  presets: number[];
}

function TimeInput({ label, icon, value, onChange, min, max, unit, hint, presets }: TimeInputProps) {
  const num = parseInt(value) || 0;
  const valid = num >= min && num <= max;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-gray-400">{icon}</span>
        <label className="text-sm font-medium text-gray-700">{label}</label>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          min={min}
          max={max}
          className={`w-20 px-3 py-2 text-sm border rounded-lg bg-white text-gray-900 text-center focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
            !valid ? 'border-red-300' : 'border-gray-300'
          }`}
        />
        <span className="text-sm text-gray-500">{unit}</span>
        <div className="flex gap-1 ml-auto">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => onChange(String(preset))}
              className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                num === preset
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {preset}
            </button>
          ))}
        </div>
      </div>
      {!valid ? (
        <p className="text-xs text-red-500">{label} must be {min}–{max}.</p>
      ) : (
        <p className="text-xs text-gray-400">{hint}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Play mode icon map
// ---------------------------------------------------------------------------

const PLAY_MODE_ICONS: Record<string, React.ReactNode> = {
  single:      <SkipForward className="w-3.5 h-3.5" />,
  loop_single: <Repeat1     className="w-3.5 h-3.5" />,
  sequential:  <ListOrdered className="w-3.5 h-3.5" />,
  loop_all:    <Repeat      className="w-3.5 h-3.5" />,
};

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

export interface SessionPrefill {
  projectId?: string;
  quizId?: string;
  simulationMode?: boolean;
  playMode?: PlayMode;
  questionTime?: number;
  countdownTime?: number;
  x2Enabled?: boolean;
  ttsEnabled?: boolean;
  tiktokUsername?: string;
  overlayTemplate?: OverlayTemplate;
  musicTrackSlug?: string;
  /** Relaunch only — reuse overlay identity from the source session */
  overlayToken?: string;
  shortCode?: string;
}

interface StartSessionModalProps {
  open: boolean;
  onClose: () => void;
  onStarted: () => void;
  prefill?: SessionPrefill;
}

export function StartSessionModal({ open, onClose, onStarted, prefill }: StartSessionModalProps) {
  const sessionCfg = useSessionDefaults();
  const PLAY_MODES = sessionCfg.playModes.map((m) => ({
    value: m.value as PlayMode,
    label: m.label,
    hint: m.hint,
    icon: PLAY_MODE_ICONS[m.value] ?? <SkipForward className="w-3.5 h-3.5" />,
  }));
  const OVERLAY_TEMPLATES = sessionCfg.overlayTemplates.map((t) => ({
    value: t.value as OverlayTemplate,
    label: t.label,
    hint: t.hint,
  }));

  const [projects, setProjects] = useState<Project[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [limits, setLimits] = useState<PlanLimits | null>(null);

  const [projectId, setProjectId] = useState('');
  const [quizId, setQuizId] = useState('');
  const [tiktokUsername, setTiktokUsername] = useState('');
  const [simulationMode, setSimulationMode] = useState(true);
  const [x2Enabled, setX2Enabled] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [playMode, setPlayMode] = useState<PlayMode>('single');
  const [overlayTemplate, setOverlayTemplate] = useState<OverlayTemplate>('default');
  const [musicTrackSlug, setMusicTrackSlug] = useState('none');
  const [musicTracks, setMusicTracks] = useState<MusicTrack[]>([]);
  const [questionTime, setQuestionTime] = useState(String(sessionCfg.questionTimerDefault));
  const [countdownTime, setCountdownTime] = useState(String(sessionCfg.countdownDefault));

  const [loadingData, setLoadingData] = useState(true);
  const [loadingQuizzes, setLoadingQuizzes] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [usernameError, setUsernameError] = useState('');

  useEffect(() => {
    if (!open) return;
    // Apply prefill values when modal opens
    if (prefill) {
      if (prefill.projectId)     setProjectId(prefill.projectId);
      if (prefill.simulationMode !== undefined) setSimulationMode(prefill.simulationMode);
      if (prefill.playMode)      setPlayMode(prefill.playMode);
      if (prefill.questionTime)  setQuestionTime(String(prefill.questionTime));
      if (prefill.countdownTime) setCountdownTime(String(prefill.countdownTime));
      if (prefill.x2Enabled !== undefined)  setX2Enabled(prefill.x2Enabled);
      if (prefill.ttsEnabled !== undefined) setTtsEnabled(prefill.ttsEnabled);
      if (prefill.tiktokUsername)  setTiktokUsername(prefill.tiktokUsername);
      if (prefill.overlayTemplate) setOverlayTemplate(prefill.overlayTemplate);
      if (prefill.musicTrackSlug)  setMusicTrackSlug(prefill.musicTrackSlug);
    }
    setLoadingData(true);
    Promise.all([projectsApi.list(), billingApi.getSubscription(), musicApi.list()])
      .then(([projs, sub, tracks]) => {
        setProjects(projs);
        setLimits(sub.limits);
        setMusicTracks(tracks);
        if (projs.length > 0 && !projectId && !prefill?.projectId) setProjectId(projs[0].id);
        if (!sub.limits.tts_enabled) setTtsEnabled(false);
        if (!sub.limits.x2_enabled) setX2Enabled(false);
      })
      .catch(() => toast('Failed to load session data', 'error'))
      .finally(() => setLoadingData(false));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!projectId) { setQuizzes([]); setQuizId(''); return; }
    setLoadingQuizzes(true);
    quizzesApi.list(projectId)
      .then((data) => {
        setQuizzes(data);
        // Use prefill quiz if it exists in this project, otherwise default to first
        const prefillMatch = prefill?.quizId ? data.find(q => q.id === prefill.quizId) : null;
        setQuizId(prefillMatch?.id || data[0]?.id || '');
      })
      .finally(() => setLoadingQuizzes(false));
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedQuiz = quizzes.find((q) => q.id === quizId);
  const questionCount = selectedQuiz ? extractQuestionCount(selectedQuiz.data_json) : 0;

  const qTimeNum = parseInt(questionTime) || 0;
  const cdTimeNum = parseInt(countdownTime) || 0;
  const qTimeValid = qTimeNum >= 5 && qTimeNum <= 120;
  const cdTimeValid = cdTimeNum >= 3 && cdTimeNum <= 30;
  const canLaunch = !!projectId && !!quizId && questionCount > 0 && qTimeValid && cdTimeValid && !launching;

  const handleLaunch = async () => {
    if (!canLaunch) return;
    if (!simulationMode && !tiktokUsername.trim()) {
      setUsernameError('TikTok username is required for live mode.');
      return;
    }
    setUsernameError('');

    const params: StartSessionParams = {
      project_id: projectId,
      quiz_id: quizId,
      simulation_mode: simulationMode,
      x2_enabled: x2Enabled,
      no_tts: !ttsEnabled,
      question_time: qTimeNum,
      countdown_time: cdTimeNum,
      play_mode: playMode,
      overlay_template: overlayTemplate,
      music_track_slug: musicTrackSlug,
    };
    if (!simulationMode && tiktokUsername.trim()) {
      params.tiktok_username = tiktokUsername.trim();
    }
    if (prefill?.overlayToken) params.overlay_token = prefill.overlayToken;
    if (prefill?.shortCode)    params.short_code    = prefill.shortCode;

    setLaunching(true);
    try {
      await sessionsApi.start(params);
      toast('Session launched', 'success');
      onStarted();
      onClose();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to launch session', 'error');
    } finally {
      setLaunching(false);
    }
  };

  const estimatedMinutes =
    questionCount > 0 && qTimeValid
      ? Math.round((questionCount * (qTimeNum + cdTimeNum)) / 60)
      : null;

  return (
    <Modal open={open} onClose={onClose} title="Launch session" size="xl">
      {loadingData ? (
        <div className="flex items-center justify-center py-12">
          <Spinner />
        </div>
      ) : (
        <div className="flex flex-col gap-5">

          {/* ── Quiz selection ── */}
          <div>
            <SectionLabel>Quiz</SectionLabel>
            <div className="flex flex-col gap-2">
              <div className="relative">
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white text-gray-900 appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select a project…</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>

              {projectId && (
                loadingQuizzes ? (
                  <div className="py-3 flex items-center gap-2 text-sm text-gray-400">
                    <Spinner /><span>Loading quizzes…</span>
                  </div>
                ) : quizzes.length === 0 ? (
                  <div className="flex items-center gap-2 px-3 py-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-700">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    No quizzes in this project. Create one in the Quizzes tab first.
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                    {quizzes.map((q) => {
                      const cnt = extractQuestionCount(q.data_json);
                      const isSelected = q.id === quizId;
                      const isEmpty = cnt === 0;
                      return (
                        <button
                          key={q.id}
                          type="button"
                          onClick={() => !isEmpty && setQuizId(q.id)}
                          disabled={isEmpty}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all ${
                            isSelected
                              ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300'
                              : isEmpty
                              ? 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed'
                              : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${isSelected ? 'bg-blue-100' : 'bg-gray-100'}`}>
                            <BookOpen className={`w-3.5 h-3.5 ${isSelected ? 'text-blue-600' : 'text-gray-400'}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium truncate ${isSelected ? 'text-blue-700' : 'text-gray-800'}`}>
                              {q.title}
                            </p>
                            <p className={`text-xs mt-0.5 ${isEmpty ? 'text-amber-500' : 'text-gray-400'}`}>
                              {isEmpty ? 'No questions — add some first' : `${cnt} question${cnt !== 1 ? 's' : ''}`}
                            </p>
                          </div>
                          {isSelected && <Check className="w-4 h-4 text-blue-600 flex-shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                )
              )}
            </div>
          </div>

          <div className="border-t border-gray-100" />

          {/* ── Game mode ── */}
          <div>
            <SectionLabel>Game mode</SectionLabel>
            <div className="grid grid-cols-2 gap-2">
              {PLAY_MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setPlayMode(m.value)}
                  className={`flex items-start gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-all ${
                    playMode === m.value
                      ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    playMode === m.value ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'
                  }`}>
                    {m.icon}
                  </div>
                  <div className="min-w-0">
                    <p className={`text-sm font-medium leading-tight ${playMode === m.value ? 'text-blue-700' : 'text-gray-800'}`}>
                      {m.label}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5 leading-snug">{m.hint}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-gray-100" />

          {/* ── Mode ── */}
          <div>
            <SectionLabel>Mode</SectionLabel>
            <div className="grid grid-cols-2 gap-2">
              {/* Simulation */}
              <button
                type="button"
                onClick={() => setSimulationMode(true)}
                className={`flex flex-col items-start gap-2 px-4 py-3 rounded-xl border transition-all text-left ${
                  simulationMode
                    ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${simulationMode ? 'bg-blue-100' : 'bg-gray-100'}`}>
                  <Bot className={`w-4 h-4 ${simulationMode ? 'text-blue-600' : 'text-gray-400'}`} />
                </div>
                <div>
                  <p className={`text-sm font-semibold ${simulationMode ? 'text-blue-700' : 'text-gray-700'}`}>
                    Simulation
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5 leading-snug">
                    Bot players. Perfect for testing without going live.
                  </p>
                </div>
                {simulationMode && (
                  <span className="text-[10px] font-bold bg-blue-200 text-blue-700 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                    Active
                  </span>
                )}
              </button>

              {/* Live */}
              <button
                type="button"
                onClick={() => setSimulationMode(false)}
                className={`flex flex-col items-start gap-2 px-4 py-3 rounded-xl border transition-all text-left ${
                  !simulationMode
                    ? 'border-emerald-400 bg-emerald-50 ring-1 ring-emerald-300'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${!simulationMode ? 'bg-emerald-100' : 'bg-gray-100'}`}>
                  <Radio className={`w-4 h-4 ${!simulationMode ? 'text-emerald-600' : 'text-gray-400'}`} />
                </div>
                <div>
                  <p className={`text-sm font-semibold ${!simulationMode ? 'text-emerald-700' : 'text-gray-700'}`}>
                    Live
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5 leading-snug">
                    Real TikTok viewers participate live.
                  </p>
                </div>
                {!simulationMode && (
                  <span className="text-[10px] font-bold bg-emerald-200 text-emerald-700 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                    Active
                  </span>
                )}
              </button>
            </div>

            {!simulationMode && (
              <div className="mt-2">
                <Input
                  label="TikTok username"
                  value={tiktokUsername}
                  onChange={(e) => { setTiktokUsername(e.target.value); setUsernameError(''); }}
                  placeholder="@your_username"
                  error={usernameError}
                  hint="The TikTok account that will be streaming live."
                />
              </div>
            )}
          </div>

          <div className="border-t border-gray-100" />

          {/* ── Timings ── */}
          <div>
            <SectionLabel>Timings</SectionLabel>
            <div className="grid grid-cols-2 gap-5">
              <TimeInput
                label="Question time"
                icon={<Clock className="w-3.5 h-3.5" />}
                value={questionTime}
                onChange={setQuestionTime}
                min={5}
                max={120}
                unit="sec"
                hint="How long viewers have to answer."
                presets={[15, 30, 60]}
              />
              <TimeInput
                label="Countdown"
                icon={<Timer className="w-3.5 h-3.5" />}
                value={countdownTime}
                onChange={setCountdownTime}
                min={3}
                max={30}
                unit="sec"
                hint="Pause between questions."
                presets={[3, 5, 10]}
              />
            </div>
            {estimatedMinutes !== null && questionCount > 0 && (
              <div className="flex items-center gap-1.5 mt-2 text-xs text-gray-400">
                <Info className="w-3.5 h-3.5 flex-shrink-0" />
                Estimated session length: ~{estimatedMinutes} min
                ({questionCount} questions × {qTimeNum + cdTimeNum}s)
              </div>
            )}
          </div>

          <div className="border-t border-gray-100" />

          {/* ── Features ── */}
          <div>
            <SectionLabel>Features</SectionLabel>
            <div className="flex flex-col gap-2">
              <ToggleRow
                icon={<Volume2 className="w-4 h-4" />}
                label="Text-to-speech"
                hint="Questions and answers are read aloud during the session."
                checked={ttsEnabled}
                onChange={setTtsEnabled}
                disabled={!limits?.tts_enabled}
                lockedHint="Available on Pro and Premium plans."
              />
              <ToggleRow
                icon={<Zap className="w-4 h-4" />}
                label="X2 double-or-nothing"
                hint="Players can risk their score for a chance to double it."
                checked={x2Enabled}
                onChange={setX2Enabled}
                disabled={!limits?.x2_enabled}
                lockedHint="Available on Pro and Premium plans."
              />
            </div>

            {limits && (!limits.tts_enabled || !limits.x2_enabled) && (
              <div className="flex items-start gap-2.5 mt-3 px-3.5 py-3 rounded-xl bg-gradient-to-r from-blue-50 to-cyan-50 border border-blue-100">
                <Zap className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm">
                  <span className="font-semibold text-blue-700">Want TTS and X2? </span>
                  <span className="text-blue-600">Upgrade to Pro for $19/mo.</span>
                </p>
              </div>
            )}
          </div>

          <div className="border-t border-gray-100" />

          {/* ── Overlay template ── */}
          <div>
            <SectionLabel>Overlay style</SectionLabel>
            <div className="grid grid-cols-2 gap-2">
              {OVERLAY_TEMPLATES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setOverlayTemplate(t.value)}
                  className={`flex items-start gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-all ${
                    overlayTemplate === t.value
                      ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    overlayTemplate === t.value ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'
                  }`}>
                    <Monitor className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0">
                    <p className={`text-sm font-medium leading-tight ${overlayTemplate === t.value ? 'text-blue-700' : 'text-gray-800'}`}>
                      {t.label}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5 leading-snug">{t.hint}</p>
                  </div>
                  {overlayTemplate === t.value && (
                    <Check className="w-3.5 h-3.5 text-blue-500 flex-shrink-0 mt-1" />
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-gray-100" />

          {/* ── Background music ── */}
          <div>
            <SectionLabel>Background music</SectionLabel>
            {musicTracks.length === 0 ? (
              <p className="text-xs text-gray-400">No music tracks available.</p>
            ) : (
              <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto">
                {musicTracks.map((track) => {
                  const isSelected = musicTrackSlug === track.slug;
                  const isNone = track.slug === 'none';
                  return (
                    <button
                      key={track.slug}
                      type="button"
                      onClick={() => setMusicTrackSlug(track.slug)}
                      className={`flex items-center gap-3 px-3 py-2 rounded-xl border text-left transition-all ${
                        isSelected
                          ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300'
                          : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        isSelected ? 'bg-blue-100' : 'bg-gray-100'
                      }`}>
                        {isNone
                          ? <VolumeX className={`w-3.5 h-3.5 ${isSelected ? 'text-blue-500' : 'text-gray-400'}`} />
                          : <Music   className={`w-3.5 h-3.5 ${isSelected ? 'text-blue-500' : 'text-gray-400'}`} />
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium truncate ${isSelected ? 'text-blue-700' : 'text-gray-800'}`}>
                          {track.name}
                        </p>
                        {!isNone && (
                          <p className="text-xs text-gray-400 mt-px">
                            {track.genre}{track.duration_sec ? ` · ${Math.round(track.duration_sec / 60)}m` : ''}
                          </p>
                        )}
                      </div>
                      {isSelected && <Check className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Footer ── */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              {simulationMode ? (
                <><Bot className="w-3.5 h-3.5" /> Simulation — safe for testing</>
              ) : (
                <>
                  <Radio className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-emerald-600 font-medium">Live mode</span>
                  <span>— TikTok viewers can participate</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={onClose} disabled={launching}>
                Cancel
              </Button>
              <Button
                onClick={handleLaunch}
                loading={launching}
                disabled={!canLaunch}
                icon={<PlayCircle className="w-4 h-4" />}
              >
                Launch
              </Button>
            </div>
          </div>

        </div>
      )}
    </Modal>
  );
}
