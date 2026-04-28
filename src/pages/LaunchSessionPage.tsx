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
  Rocket,
  ArrowRight,
} from 'lucide-react';
import { projectsApi } from '../api/projects';
import { quizzesApi } from '../api/quizzes';
import { sessionsApi, type StartSessionParams, type PlayMode, type OverlayTemplate } from '../api/sessions';
import { billingApi, type PlanLimits } from '../api/billing';
import { musicApi, type MusicTrack } from '../api/music';
import { useSessionDefaults } from '../context/PublicConfigContext';
import type { Project, Quiz, Session } from '../api/types';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Spinner } from '../components/ui/Spinner';
import { OverlayPreview, type OverlayPreviewState } from '../components/OverlayPreview';
import { toast } from '../components/layout/DashboardLayout';
import { ApiError } from '../api/client';

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
// Sub-components (local — keep these in-file, no shared-component overhead)
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2.5">
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
      <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
        disabled ? 'bg-gray-100 text-gray-400' : checked ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'
      }`}>
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
      <div className="flex-shrink-0 relative rounded-full" style={{ height: '22px', width: '40px' }}>
        <div className={`absolute inset-0 rounded-full transition-colors ${
          disabled ? 'bg-gray-200' : checked ? 'bg-blue-600' : 'bg-gray-300'
        }`} />
        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`} />
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
                num === preset ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
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
// Static icon map for play modes
// ---------------------------------------------------------------------------

const PLAY_MODE_ICONS: Record<string, React.ReactNode> = {
  single:      <SkipForward className="w-3.5 h-3.5" />,
  loop_single: <Repeat1     className="w-3.5 h-3.5" />,
  sequential:  <ListOrdered className="w-3.5 h-3.5" />,
  loop_all:    <Repeat      className="w-3.5 h-3.5" />,
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export interface LaunchPrefill {
  projectId?:      string;
  quizId?:         string;
  simulationMode?: boolean;
  playMode?:       PlayMode;
  overlayTemplate?: OverlayTemplate;
  musicTrackSlug?: string;
  questionTime?:   number;
  countdownTime?:  number;
  x2Enabled?:     boolean;
  ttsEnabled?:    boolean;
  tiktokUsername?: string;
  /** Relaunch only — preserve overlay identity from the source session */
  overlayToken?:   string;
  shortCode?:      string;
  overlayUrl?:     string;
  shortOverlayUrl?: string | null;
}

export interface LaunchSessionPageProps {
  onLaunched: (session: Session) => void;
  prefill?:   LaunchPrefill;
}

export function LaunchSessionPage({ onLaunched, prefill }: LaunchSessionPageProps) {
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

  // Data
  const [projects,     setProjects]     = useState<Project[]>([]);
  const [quizzes,      setQuizzes]      = useState<Quiz[]>([]);
  const [limits,       setLimits]       = useState<PlanLimits | null>(null);
  const [musicTracks,  setMusicTracks]  = useState<MusicTrack[]>([]);
  const [loadingData,  setLoadingData]  = useState(true);
  const [loadingQuizzes, setLoadingQuizzes] = useState(false);

  // Form state
  const [projectId,       setProjectId]       = useState(prefill?.projectId      ?? '');
  const [quizId,          setQuizId]          = useState(prefill?.quizId         ?? '');
  const [playMode,        setPlayMode]        = useState<PlayMode>(prefill?.playMode ?? 'single');
  const [overlayTemplate, setOverlayTemplate] = useState<OverlayTemplate>(prefill?.overlayTemplate ?? 'default');
  const [musicTrackSlug,  setMusicTrackSlug]  = useState(prefill?.musicTrackSlug  ?? 'none');
  const [simulationMode,  setSimulationMode]  = useState(prefill?.simulationMode  ?? true);
  const [tiktokUsername,  setTiktokUsername]  = useState(prefill?.tiktokUsername  ?? '');
  const [usernameError,   setUsernameError]   = useState('');
  const [x2Enabled,       setX2Enabled]       = useState(prefill?.x2Enabled       ?? false);
  const [ttsEnabled,      setTtsEnabled]      = useState(prefill?.ttsEnabled      ?? false);
  const [questionTime,    setQuestionTime]    = useState(String(prefill?.questionTime  ?? sessionCfg.questionTimerDefault));
  const [countdownTime,   setCountdownTime]   = useState(String(prefill?.countdownTime ?? sessionCfg.countdownDefault));

  // Prepared session
  const [preparedSession, setPreparedSession] = useState<Session | null>(null);
  const [preparing,       setPreparing]       = useState(false);
  const [launching,       setLaunching]       = useState(false);

  // Load projects + plan limits + music on mount
  useEffect(() => {
    Promise.all([
      projectsApi.list(),
      billingApi.getSubscription(),
      musicApi.list().catch(() => [] as MusicTrack[]),
    ])
      .then(([projs, sub, tracks]) => {
        setProjects(projs);
        setLimits(sub.limits);
        setMusicTracks(tracks);
        if (projs.length > 0 && !prefill?.projectId) setProjectId(projs[0].id);
        if (!sub.limits.tts_enabled) setTtsEnabled(false);
        if (!sub.limits.x2_enabled)  setX2Enabled(false);
      })
      .catch(() => toast('Failed to load launch data', 'error'))
      .finally(() => setLoadingData(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load quizzes when project changes
  useEffect(() => {
    if (!projectId) { setQuizzes([]); setQuizId(''); return; }
    setLoadingQuizzes(true);
    quizzesApi.list(projectId)
      .then((data) => {
        setQuizzes(data);
        // Honour prefill quiz if it's in this project, else default to first
        const match = prefill?.quizId ? data.find(q => q.id === prefill.quizId) : null;
        setQuizId(match?.id ?? data[0]?.id ?? '');
      })
      .finally(() => setLoadingQuizzes(false));
    // Invalidate prepared session when project changes
    setPreparedSession(null);
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Invalidate prepared session when quiz or template changes
  useEffect(() => {
    setPreparedSession(null);
  }, [quizId, overlayTemplate]);

  const selectedQuiz   = quizzes.find((q) => q.id === quizId);
  const questionCount  = selectedQuiz ? extractQuestionCount(selectedQuiz.data_json) : 0;
  const qTimeNum       = parseInt(questionTime) || 0;
  const cdTimeNum      = parseInt(countdownTime) || 0;
  const qTimeValid     = qTimeNum >= 5  && qTimeNum  <= 120;
  const cdTimeValid    = cdTimeNum >= 3 && cdTimeNum <= 30;
  const liveUsernameOk = simulationMode || !!tiktokUsername.trim();
  const canPrepare     = !!projectId && !!quizId && questionCount > 0 && !preparing && !launching;
  const canLaunch      = canPrepare && qTimeValid && cdTimeValid && !!preparedSession && liveUsernameOk && !launching;

  const previewState: OverlayPreviewState = !preparedSession
    ? 'unprepared'
    : simulationMode
    ? 'prepared-simulation'
    : tiktokUsername.trim()
    ? 'prepared-live'
    : 'prepared-live-no-username';

  const estimatedMinutes =
    questionCount > 0 && qTimeValid
      ? Math.round((questionCount * (qTimeNum + cdTimeNum)) / 60)
      : null;

  const handleReset = async () => {
    if (!preparedSession) return;
    const id = preparedSession.id;
    setPreparedSession(null);
    try {
      await sessionsApi.delete(id);
    } catch {
      // Silently ignore — session may already be gone or never persisted
    }
  };

  const handlePrepare = async () => {
    if (!canPrepare) return;
    setPreparing(true);
    try {
      const session = await sessionsApi.prepare({
        project_id:      projectId,
        quiz_id:         quizId,
        overlay_template: overlayTemplate,
        overlay_token:   prefill?.overlayToken,
        short_code:      prefill?.shortCode,
      });
      setPreparedSession(session);
      toast('Session prepared — overlay URL is ready', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to prepare session', 'error');
    } finally {
      setPreparing(false);
    }
  };

  const handleLaunch = async () => {
    if (!canLaunch || !preparedSession) return;
    if (!simulationMode && !tiktokUsername.trim()) {
      setUsernameError('TikTok username is required for live mode.');
      return;
    }
    setUsernameError('');

    const params: StartSessionParams = {
      session_id:       preparedSession.id,
      project_id:       projectId,
      quiz_id:          quizId,
      simulation_mode:  simulationMode,
      x2_enabled:       x2Enabled,
      no_tts:           !ttsEnabled,
      question_time:    qTimeNum,
      countdown_time:   cdTimeNum,
      play_mode:        playMode,
      overlay_template: overlayTemplate,
      music_track_slug: musicTrackSlug,
    };
    if (!simulationMode && tiktokUsername.trim()) {
      params.tiktok_username = tiktokUsername.trim();
    }

    setLaunching(true);
    try {
      const started = await sessionsApi.start(params);
      toast('Session launched!', 'success');
      onLaunched(started);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to launch session', 'error');
    } finally {
      setLaunching(false);
    }
  };

  if (loadingData) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader />
        <div className="flex justify-center py-20"><Spinner /></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6 items-start">

        {/* ── Left column: configuration ── */}
        <div className="flex flex-col gap-5">

          {/* Quiz selection */}
          <Section>
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
                  <div className="flex flex-col gap-1.5">
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
          </Section>

          {/* Play mode */}
          <Section>
            <SectionLabel>Play mode</SectionLabel>
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
          </Section>

          {/* Overlay style */}
          <Section>
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
          </Section>

          {/* Background music */}
          <Section>
            <SectionLabel>Background music</SectionLabel>
            {musicTracks.length === 0 ? (
              <p className="text-xs text-gray-400">No music tracks available.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
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
          </Section>

          {/* Timings */}
          <Section>
            <SectionLabel>Timings</SectionLabel>
            <div className="grid grid-cols-2 gap-5">
              <TimeInput
                label="Question time"
                icon={<Clock className="w-3.5 h-3.5" />}
                value={questionTime}
                onChange={setQuestionTime}
                min={5} max={120}
                unit="sec"
                hint="How long viewers have to answer."
                presets={[15, 30, 60]}
              />
              <TimeInput
                label="Countdown"
                icon={<Timer className="w-3.5 h-3.5" />}
                value={countdownTime}
                onChange={setCountdownTime}
                min={3} max={30}
                unit="sec"
                hint="Pause between questions."
                presets={[3, 5, 10]}
              />
            </div>
            {estimatedMinutes !== null && questionCount > 0 && (
              <div className="flex items-center gap-1.5 mt-2 text-xs text-gray-400">
                <Info className="w-3.5 h-3.5 flex-shrink-0" />
                ~{estimatedMinutes} min ({questionCount} q × {qTimeNum + cdTimeNum}s)
              </div>
            )}
          </Section>

          {/* Mode & features */}
          <Section>
            <SectionLabel>Mode</SectionLabel>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <ModeCard
                icon={<Bot className="w-4 h-4" />}
                label="Simulation"
                hint="Bot players. Safe for testing."
                active={simulationMode}
                activeColor="blue"
                onClick={() => setSimulationMode(true)}
              />
              <ModeCard
                icon={<Radio className="w-4 h-4" />}
                label="Live"
                hint="Real TikTok viewers participate."
                active={!simulationMode}
                activeColor="emerald"
                onClick={() => setSimulationMode(false)}
              />
            </div>

            {!simulationMode && (
              <Input
                label="TikTok username"
                value={tiktokUsername}
                onChange={(e) => { setTiktokUsername(e.target.value); setUsernameError(''); }}
                placeholder="@your_username"
                error={usernameError}
                hint="The TikTok account streaming live."
              />
            )}

            <div className="mt-3 flex flex-col gap-2">
              <ToggleRow
                icon={<Volume2 className="w-4 h-4" />}
                label="Text-to-speech"
                hint="Questions read aloud during the session."
                checked={ttsEnabled}
                onChange={setTtsEnabled}
                disabled={!limits?.tts_enabled}
                lockedHint="Available on Pro and Premium plans."
              />
              <ToggleRow
                icon={<Zap className="w-4 h-4" />}
                label="X2 double-or-nothing"
                hint="Players risk their score to double it."
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
          </Section>
        </div>

        {/* ── Right column: preview + actions ── */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-8">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 flex flex-col gap-5">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 mb-0.5">Overlay preview</h2>
              <p className="text-xs text-gray-400">Add this URL as a Browser Source in OBS before going live.</p>
            </div>

            <OverlayPreview
              overlayUrl={preparedSession?.overlay_url ?? null}
              shortUrl={preparedSession?.short_overlay_url ?? null}
              previewState={previewState}
            />

            <div className="border-t border-gray-100 pt-4 flex flex-col gap-3">
              {/* Prepare button */}
              {!preparedSession ? (
                <Button
                  onClick={handlePrepare}
                  loading={preparing}
                  disabled={!canPrepare}
                  variant="secondary"
                  icon={<Rocket className="w-4 h-4" />}
                  className="w-full justify-center"
                >
                  Prepare Session
                </Button>
              ) : (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200">
                  <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-emerald-700">Session prepared</p>
                    <p className="text-xs text-emerald-600 mt-px">Overlay URL is live. Configure settings and launch.</p>
                  </div>
                  <button
                    onClick={handleReset}
                    className="text-xs text-emerald-500 hover:text-emerald-700 font-medium flex-shrink-0"
                  >
                    Reset
                  </button>
                </div>
              )}

              {/* Launch button */}
              <Button
                onClick={handleLaunch}
                loading={launching}
                disabled={!canLaunch}
                icon={<ArrowRight className="w-4 h-4" />}
                className="w-full justify-center"
              >
                Launch Game
              </Button>

              {!preparedSession && (
                <p className="text-xs text-gray-400 text-center">
                  Prepare a session first to get your overlay URL, then launch when ready.
                </p>
              )}
              {preparedSession && !liveUsernameOk && (
                <p className="text-xs text-amber-500 text-center">
                  Enter a TikTok username to enable launch in live mode.
                </p>
              )}
            </div>
          </div>

          {/* Quick checklist */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4 flex flex-col gap-2.5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Go-live checklist</p>
            <ChecklistItem done={!!quizId && questionCount > 0} label="Quiz selected with questions" />
            <ChecklistItem done={!!preparedSession} label="Session prepared (overlay URL ready)" />
            <ChecklistItem done={qTimeValid && cdTimeValid} label="Timings are valid" />
            <ChecklistItem done={simulationMode || !!tiktokUsername.trim()} label="Mode configured" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function PageHeader() {
  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900">Launch session</h1>
      <p className="text-sm text-gray-500 mt-0.5">
        Configure your quiz game, prepare the overlay URL, then go live.
      </p>
    </div>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
      {children}
    </div>
  );
}

function ModeCard({
  icon, label, hint, active, activeColor, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  active: boolean;
  activeColor: 'blue' | 'emerald';
  onClick: () => void;
}) {
  const ring = activeColor === 'blue' ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300' : 'border-emerald-400 bg-emerald-50 ring-1 ring-emerald-300';
  const iconBg = activeColor === 'blue' ? 'bg-blue-100' : 'bg-emerald-100';
  const iconColor = activeColor === 'blue' ? 'text-blue-600' : 'text-emerald-600';
  const labelColor = activeColor === 'blue' ? 'text-blue-700' : 'text-emerald-700';
  const badgeBg = activeColor === 'blue' ? 'bg-blue-200 text-blue-700' : 'bg-emerald-200 text-emerald-700';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start gap-2 px-4 py-3 rounded-xl border transition-all text-left ${
        active ? ring : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${active ? iconBg : 'bg-gray-100'}`}>
        <span className={active ? iconColor : 'text-gray-400'}>{icon}</span>
      </div>
      <div>
        <p className={`text-sm font-semibold ${active ? labelColor : 'text-gray-700'}`}>{label}</p>
        <p className="text-xs text-gray-400 mt-0.5 leading-snug">{hint}</p>
      </div>
      {active && (
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide ${badgeBg}`}>
          Active
        </span>
      )}
    </button>
  );
}

function ChecklistItem({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
        done ? 'bg-emerald-500' : 'bg-gray-200'
      }`}>
        {done && <Check className="w-2.5 h-2.5 text-white" />}
      </div>
      <span className={`text-xs ${done ? 'text-gray-700' : 'text-gray-400'}`}>{label}</span>
    </div>
  );
}
