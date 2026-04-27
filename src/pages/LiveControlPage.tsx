import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  Square,
  Pause,
  Play,
  RotateCcw,
  Radio,
  Bot,
  Trophy,
  Users,
  Activity,
  AlertTriangle,
  Wifi,
  WifiOff,
  RefreshCw,
  Volume2,
  VolumeX,
  Music,
  Music2,
  Zap,
  ZapOff,
  Clock,
  Loader2,
  Mic,
  MicOff,
  SlidersHorizontal,
  Monitor,
  Link,
} from 'lucide-react';
import { sessionsApi } from '../api/sessions';
import type { Session, SessionScores, SessionSnapshot, AudioState } from '../api/types';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { toast } from '../components/layout/DashboardLayout';
import { ApiError } from '../api/client';
import { statusLabel, isActiveStatus } from '../utils/sessionStatus';
import { SessionTimeline } from '../components/sessions/SessionTimeline';
import { OverlayPreview } from '../components/OverlayPreview';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLL_MS = 5000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtUptime(s: number | null): string {
  if (s == null) return '—';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${s}s`;
}

function fmtTime(s: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleTimeString('en-US', { hour12: false });
}

// ---------------------------------------------------------------------------
// Status colour tokens
// ---------------------------------------------------------------------------

function statusColors(status: string) {
  switch (status) {
    case 'running':  return { bg: 'bg-emerald-950', border: 'border-emerald-800', dot: 'bg-emerald-400', ping: 'bg-emerald-400', label: 'text-emerald-300', pulse: true  };
    case 'paused':   return { bg: 'bg-amber-950',   border: 'border-amber-800',   dot: 'bg-amber-400',   ping: '',              label: 'text-amber-300',   pulse: false };
    case 'starting': return { bg: 'bg-blue-950',    border: 'border-blue-800',    dot: 'bg-blue-400',    ping: 'bg-blue-400',   label: 'text-blue-300',    pulse: true  };
    default:         return { bg: 'bg-gray-900',    border: 'border-gray-700',    dot: 'bg-gray-600',    ping: '',              label: 'text-gray-400',    pulse: false };
  }
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

interface LiveControlPageProps {
  sessionId: string;
  onBack: () => void;
  onViewDetail: () => void;
}

export function LiveControlPage({ sessionId, onBack, onViewDetail }: LiveControlPageProps) {
  const [session,  setSession]  = useState<Session | null>(null);
  const [scores,   setScores]   = useState<SessionScores | null>(null);
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [audio,    setAudio]    = useState<AudioState | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [busy,     setBusy]     = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const [polling,    setPolling]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [previewMuted, setPreviewMuted] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Pending volume — tracks slider position before committing
  const [pendingVolume, setPendingVolume] = useState<number | null>(null);
  const volumeCommitRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Fetchers ───────────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    const [s, sc, sn] = await Promise.allSettled([
      sessionsApi.get(sessionId),
      sessionsApi.scores(sessionId, 10),
      sessionsApi.snapshot(sessionId),
    ]);
    if (s.status  === 'fulfilled') setSession(s.value);
    if (sc.status === 'fulfilled') setScores(sc.value);
    if (sn.status === 'fulfilled') setSnapshot(sn.value);
  }, [sessionId]);

  // ── Boot ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    const boot = async () => {
      const [s, sc, sn, au] = await Promise.allSettled([
        sessionsApi.get(sessionId),
        sessionsApi.scores(sessionId, 10),
        sessionsApi.snapshot(sessionId),
        sessionsApi.audioState(sessionId),
      ]);
      if (s.status  === 'fulfilled') setSession(s.value);
      if (sc.status === 'fulfilled') setScores(sc.value);
      if (sn.status === 'fulfilled') setSnapshot(sn.value);
      if (au.status === 'fulfilled') {
        setAudio(au.value);
        setPendingVolume(null);
      }
    };
    boot().finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Poll ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (polling) {
      intervalRef.current = setInterval(fetchAll, POLL_MS);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [polling, fetchAll]);

  useEffect(() => {
    if (session && !isActiveStatus(session.status)) setPolling(false);
  }, [session]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const withAction = useCallback(async (fn: () => Promise<Session>, label: string) => {
    setBusy(true);
    try {
      const updated = await fn();
      setSession(updated);
      toast(label, 'success');
      return updated;
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Action failed', 'error');
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const handlePause  = () => withAction(() => sessionsApi.pause(sessionId),  'Session paused');
  const handleResume = () => withAction(() => sessionsApi.resume(sessionId), 'Session resumed');
  const handleReplay = () => withAction(() => sessionsApi.replay(sessionId), 'Question replayed');
  const handleStop   = async () => {
    const updated = await withAction(() => sessionsApi.stop(sessionId), 'Session stopped — scores saved');
    if (updated) { setPolling(false); fetchAll(); }
    setStopOpen(false);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  };

  // ── Audio actions ──────────────────────────────────────────────────────────

  const withAudio = useCallback(async (fn: () => Promise<AudioState>) => {
    setAudioBusy(true);
    try {
      const updated = await fn();
      setAudio(updated);
      if (!volumeCommitRef.current) setPendingVolume(null);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Audio control failed', 'error');
    } finally {
      setAudioBusy(false);
    }
  }, []);

  const handleToggleTts = () =>
    withAudio(() => sessionsApi.setTts(sessionId, !audio?.tts_enabled));

  const handleToggleMusic = () =>
    withAudio(() => sessionsApi.setMusic(sessionId, !audio?.music_enabled));

  const handleVolumeChange = (v: number) => {
    setPendingVolume(v);
    if (volumeCommitRef.current) clearTimeout(volumeCommitRef.current);
    volumeCommitRef.current = setTimeout(() => {
      volumeCommitRef.current = null;
      withAudio(() => sessionsApi.setVolume(sessionId, v));
    }, 400);
  };

  // ── Loading skeleton ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <BackLink onClick={onBack} />
        <div className="h-[72px] rounded-2xl bg-gray-100 animate-pulse" />
        <div className="grid grid-cols-4 gap-3">
          {[0,1,2,3].map(i => <div key={i} className="h-16 rounded-xl bg-gray-100 animate-pulse" />)}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="h-48 rounded-xl bg-gray-100 animate-pulse" />
          <div className="h-48 rounded-xl bg-gray-100 animate-pulse" />
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex flex-col gap-3">
        <BackLink onClick={onBack} />
        <p className="text-sm text-gray-500">Session not found.</p>
      </div>
    );
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const active    = isActiveStatus(session.status);
  const isRunning = session.status === 'running';
  const isPaused  = session.status === 'paused';
  const colors    = statusColors(session.status);

  const snap    = snapshot?.snapshot;
  const opts              = (session.launch_options || {}) as Record<string, unknown>;
  const noTts             = Boolean(opts.no_tts);
  const x2On              = Boolean(opts.x2_enabled);
  const qTime             = opts.question_time as number | undefined;
  const overlayTemplate   = (opts.overlay_template as string | undefined) || 'default';
  const musicTrackSlug    = (opts.music_track_slug as string | undefined) || 'none';

  const qIdx      = snap?.question_index;
  const qTotal    = snap?.question_total;
  const qProgress = qIdx != null && qTotal ? qIdx / qTotal : 0;
  const currentQ  = snap?.question_text;
  const phase     = snap?.phase;

  return (
    <div className="flex flex-col gap-3">

      {/* ── Top bar ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BackLink onClick={onBack} />
          <span className="text-gray-300 select-none">/</span>
          <span className="text-sm text-gray-500 font-medium">Live Control</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setPolling(v => !v)}
            title={polling ? 'Pause auto-refresh' : 'Resume auto-refresh'}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 transition-colors"
          >
            {polling
              ? <><Wifi className="w-3 h-3 text-emerald-500" /><span>Live</span></>
              : <><WifiOff className="w-3 h-3" /><span>Paused</span></>
            }
          </button>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh now"
            className="p-1.5 rounded-lg border border-gray-200 bg-white text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onViewDetail}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 transition-colors"
          >
            Full detail
          </button>
        </div>
      </div>

      {/* ── Hero: status + controls (fixed height) ── */}
      <div className={`rounded-2xl border ${colors.bg} ${colors.border} px-5 py-3.5`}>
        <div className="flex items-center justify-between gap-4">

          {/* Status + context */}
          <div className="flex items-center gap-3 min-w-0">
            {/* Pulse dot */}
            <div className="relative flex-shrink-0 w-3 h-3">
              {colors.pulse && (
                <span className={`absolute inset-0 rounded-full ${colors.ping} opacity-40 animate-ping`} />
              )}
              <span className={`relative block w-3 h-3 rounded-full ${colors.dot}`} />
            </div>

            <div className="min-w-0">
              {/* Status row */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-base font-bold leading-none ${colors.label}`}>
                  {statusLabel(session.status)}
                </span>
                {session.simulation_mode ? (
                  <span className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-white/10 text-gray-300 font-medium leading-none">
                    <Bot className="w-2.5 h-2.5" /> Sim
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-medium leading-none">
                    <Radio className="w-2.5 h-2.5" /> Live
                  </span>
                )}
                {/* TikTok connection status badge — live mode only */}
                {!session.simulation_mode && active && (
                  session.runtime.tiktok?.connected ? (
                    <span className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-medium leading-none">
                      <Wifi className="w-2.5 h-2.5" /> TikTok connected
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-medium leading-none">
                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                      {session.runtime.tiktok?.connecting ? 'TikTok connecting…' : 'TikTok disconnected'}
                      {(session.runtime.tiktok?.retry_count ?? 0) > 0 && (
                        <span className="opacity-60">(#{session.runtime.tiktok!.retry_count})</span>
                      )}
                    </span>
                  )
                )}
              </div>

              {/* Sub-line: progress bar OR context text — always present to hold height */}
              <div className="mt-1.5 h-4 flex items-center gap-2">
                {active && qTotal && qTotal > 0 ? (
                  <>
                    <div className="w-32 h-1 rounded-full bg-white/10 overflow-hidden flex-shrink-0">
                      <div
                        className="h-full rounded-full bg-white/50 transition-[width] duration-700"
                        style={{ width: `${Math.round(qProgress * 100)}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-white/40 tabular-nums leading-none flex-shrink-0">
                      {qIdx}/{qTotal}
                      {phase ? ` · ${phase}` : ''}
                    </span>
                    {currentQ && (
                      <span className="text-[11px] text-white/30 truncate hidden sm:block">{currentQ}</span>
                    )}
                  </>
                ) : (
                  <span className="text-[11px] text-white/30 leading-none">
                    {session.tiktok_username ? `@${session.tiktok_username}` : session.simulation_mode ? 'Bot players active' : ''}
                    {!active && session.ended_at ? ` Ended ${fmtTime(session.ended_at)}` : ''}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Pause / Resume */}
            <ActionBtn
              onClick={isRunning ? handlePause : handleResume}
              disabled={busy || !active || session.status === 'starting'}
              loading={busy && (isRunning || isPaused)}
              variant={isPaused ? 'resume' : 'pause'}
              hidden={!active}
            >
              {isPaused
                ? <><Play className="w-3.5 h-3.5" /> Resume</>
                : <><Pause className="w-3.5 h-3.5" /> Pause</>
              }
            </ActionBtn>

            {/* Replay — restarts the game inside the current session */}
            <ActionBtn
              onClick={handleReplay}
              disabled={busy}
              loading={busy}
              variant="replay"
              hidden={false}
            >
              <RotateCcw className="w-3.5 h-3.5" /> Replay
            </ActionBtn>

            {/* Stop */}
            <ActionBtn
              onClick={() => setStopOpen(true)}
              disabled={busy || !active}
              loading={false}
              variant="stop"
              hidden={!active}
            >
              <Square className="w-3.5 h-3.5" /> Stop
            </ActionBtn>
          </div>
        </div>

        {/* Orphaned / failed inline note */}
        {(session.status === 'orphaned' || session.status === 'failed') && (
          <div className="mt-3 pt-3 border-t border-white/10 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-px" />
            <p className="text-xs text-amber-200/80">
              {session.status === 'orphaned'
                ? 'Server restarted mid-session. Runtime gone. Scores up to that point are preserved.'
                : 'Session failed. Scores may be partial.'}
            </p>
          </div>
        )}
      </div>

      {/* ── Metric strip ── */}
      <div className="grid grid-cols-4 gap-3">
        <MetricTile icon={<Users    className="w-3.5 h-3.5" />} label="Players"
          value={snap?.participant_count ?? scores?.total_players ?? null}
          accent="text-blue-600" />
        <MetricTile icon={<Activity className="w-3.5 h-3.5" />} label="Answers"
          value={scores?.total_answers ?? null} />
        <MetricTile icon={<Activity className="w-3.5 h-3.5" />} label="Accuracy"
          value={scores?.accuracy_pct != null ? `${scores.accuracy_pct}%` : null}
          accent="text-emerald-600" />
        <MetricTile icon={<Clock    className="w-3.5 h-3.5" />} label="Uptime"
          value={fmtUptime(session.runtime.uptime)} />
      </div>

      {/* ── Audio controls ── */}
      {active && (
        <AudioPanel
          audio={audio}
          busy={audioBusy}
          onToggleTts={handleToggleTts}
          onToggleMusic={handleToggleMusic}
          onVolumeChange={handleVolumeChange}
          pendingVolume={pendingVolume}
          previewMuted={previewMuted}
          onTogglePreviewMute={() => setPreviewMuted(v => !v)}
        />
      )}

      {/* ── Main body: left controls + right overlay preview ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] xl:grid-cols-[1fr_320px] gap-3 items-start">

        {/* ── Left column: leaderboard + timeline + info strip ── */}
        <div className="flex flex-col gap-3 min-w-0">

          {/* Leaderboard */}
          <div className="bg-white rounded-xl border border-gray-200 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 flex-shrink-0">
              <div className="flex items-center gap-2">
                <Trophy className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-sm font-semibold text-gray-900">Top players</span>
                {scores && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    scores.source === 'live' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {scores.source === 'live' ? 'LIVE' : 'SAVED'}
                  </span>
                )}
              </div>
              <span className="text-xs text-gray-400 tabular-nums">{scores?.total_players ?? 0}</span>
            </div>

            <div className="overflow-y-auto" style={{ minHeight: 120, maxHeight: 280 }}>
              {!scores || scores.leaderboard.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center py-8 text-center">
                  <Trophy className="w-6 h-6 text-gray-200 mb-1.5" />
                  <p className="text-xs font-medium text-gray-400">No scores yet</p>
                  {active && (
                    <p className="text-xs text-gray-300 mt-0.5">Appears after the first question</p>
                  )}
                </div>
              ) : (
                scores.leaderboard.slice(0, 10).map((entry, i) => (
                  <div
                    key={entry.username}
                    className={`flex items-center gap-3 px-4 py-2 border-b border-gray-50 last:border-0 ${i < 3 ? 'bg-amber-50/40' : ''}`}
                  >
                    <span className="w-5 text-center text-sm flex-shrink-0 leading-none">
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (
                        <span className="text-xs text-gray-300 font-bold">#{entry.rank}</span>
                      )}
                    </span>
                    <span className="flex-1 text-sm font-medium text-gray-800 truncate">{entry.username}</span>
                    <span className="text-sm font-bold text-gray-900 tabular-nums flex-shrink-0">
                      {entry.total_score.toLocaleString()}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Session timeline */}
          <SessionTimeline
            snapshot={snap ?? null}
            sessionStatus={session.status}
            scores={scores}
            live={polling}
            tiktokConnected={session.runtime.tiktok?.connected}
            height={104}
          />

          {/* Info strip */}
          <div className="flex flex-wrap items-center rounded-xl border border-gray-200 bg-white divide-x divide-gray-100 text-xs overflow-hidden">
            <OverlayLinkChip shortUrl={session.short_overlay_url ?? null} longUrl={session.overlay_url} />

            {session.tiktok_username && (
              <InfoChip icon={<Radio className="w-3 h-3" />} label="TikTok">
                <span className="text-gray-700">@{session.tiktok_username}</span>
              </InfoChip>
            )}

            <InfoChip icon={noTts ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />} label="TTS">
              <span className={noTts ? 'text-gray-400' : 'text-emerald-600 font-semibold'}>{noTts ? 'Off' : 'On'}</span>
            </InfoChip>

            <InfoChip icon={x2On ? <Zap className="w-3 h-3" /> : <ZapOff className="w-3 h-3" />} label="X2">
              <span className={x2On ? 'text-emerald-600 font-semibold' : 'text-gray-400'}>{x2On ? 'On' : 'Off'}</span>
            </InfoChip>

            {qTime != null && (
              <InfoChip icon={<Clock className="w-3 h-3" />} label="Q time">
                <span className="text-gray-700">{qTime}s</span>
              </InfoChip>
            )}

            <InfoChip icon={<Monitor className="w-3 h-3" />} label="Template">
              <span className="text-gray-700 capitalize">{overlayTemplate}</span>
            </InfoChip>

            {musicTrackSlug !== 'none' && (
              <InfoChip icon={<Music className="w-3 h-3" />} label="Music">
                <span className="text-gray-700 truncate max-w-24">{musicTrackSlug.replace(/_/g, ' ')}</span>
              </InfoChip>
            )}

            <InfoChip icon={<Clock className="w-3 h-3" />} label="Started">
              <span className="text-gray-700">{fmtTime(session.started_at)}</span>
            </InfoChip>
          </div>
        </div>

        {/* ── Right column: overlay preview (shared component) ── */}
        <LiveOverlayPanel session={session} active={active} previewMuted={previewMuted} />
      </div>

      <ConfirmDialog
        open={stopOpen}
        onClose={() => setStopOpen(false)}
        onConfirm={handleStop}
        title="Stop session"
        message="End this session now? Scores recorded so far will be saved."
        confirmLabel="Stop session"
        loading={busy}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
    >
      <ArrowLeft className="w-3.5 h-3.5" /> Sessions
    </button>
  );
}

// Action button with a fixed width so the button row never shifts
interface ActionBtnProps {
  onClick: () => void;
  disabled: boolean;
  loading: boolean;
  variant: 'pause' | 'resume' | 'stop' | 'replay';
  hidden: boolean;
  children: React.ReactNode;
  title?: string;
}

function ActionBtn({ onClick, disabled, loading, variant, hidden, children, title }: ActionBtnProps) {
  const base = 'inline-flex items-center justify-center gap-1.5 w-24 px-3 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  const colors: Record<ActionBtnProps['variant'], string> = {
    pause:  'bg-amber-500 hover:bg-amber-400 text-white',
    resume: 'bg-emerald-500 hover:bg-emerald-400 text-white',
    replay: 'bg-blue-600 hover:bg-blue-500 text-white',
    stop:   'bg-red-600 hover:bg-red-500 text-white',
  };

  if (hidden) {
    return <div className="w-24 h-9" />;
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${base} ${colors[variant]}`}
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : children}
    </button>
  );
}

interface MetricTileProps {
  icon: React.ReactNode;
  label: string;
  value: string | number | null;
  accent?: string;
}

function MetricTile({ icon, label, value, accent = 'text-gray-900' }: MetricTileProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
      <div className="flex items-center gap-1.5 text-gray-400 mb-1">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className={`text-xl font-bold tabular-nums leading-none ${value == null ? 'text-gray-300' : accent}`}>
        {value == null ? '—' : String(value)}
      </p>
    </div>
  );
}

interface InfoChipProps {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}

function InfoChip({ icon, label, children }: InfoChipProps) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-2">
      <span className="text-gray-400">{icon}</span>
      <span className="text-gray-400">{label}</span>
      <div className="flex items-center gap-1 ml-0.5">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live overlay right-column panel (wraps the shared OverlayPreview)
// ---------------------------------------------------------------------------

interface LiveOverlayPanelProps {
  session: Session;
  active: boolean;
  previewMuted: boolean;
}

function LiveOverlayPanel({ session, active, previewMuted }: LiveOverlayPanelProps) {
  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
          <Monitor className="w-3.5 h-3.5" />
          <span>Overlay preview</span>
        </div>
        {active && (
          <span className="flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
            LIVE
          </span>
        )}
      </div>
      <OverlayPreview
        overlayUrl={session.overlay_url}
        shortUrl={session.short_overlay_url ?? null}
        muted={previewMuted}
      />
    </div>
  );
}

// Short URL chip shown in the info strip.
function OverlayLinkChip({ shortUrl, longUrl }: { shortUrl: string | null; longUrl: string }) {
  const displayUrl = shortUrl ?? longUrl;
  let displayLabel = displayUrl;
  try {
    const parsed = new URL(displayUrl);
    const path = parsed.pathname;
    if (path.startsWith('/o/')) {
      displayLabel = path;
    } else {
      const parts = path.split('/').filter(Boolean);
      const token = parts[parts.length - 1] || '';
      displayLabel = token.length > 10 ? `overlay/${token.slice(0, 8)}…` : path;
    }
  } catch {
    displayLabel = displayUrl.length > 32 ? `${displayUrl.slice(0, 32)}…` : displayUrl;
  }

  return (
    <div className="flex items-center gap-1.5 px-3 py-2">
      <span className="text-gray-400"><Link className="w-3 h-3" /></span>
      <span className="text-gray-400 text-xs">{shortUrl ? 'Short link' : 'Overlay'}</span>
      <span className="font-mono text-xs text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100 ml-0.5 select-all cursor-text">
        {displayLabel}
      </span>
      <button
        onClick={() => { navigator.clipboard.writeText(displayUrl); toast('Overlay URL copied', 'success'); }}
        title="Copy URL"
        className="text-gray-400 hover:text-gray-700 transition-colors ml-0.5"
      >
        <Copy className="w-3 h-3" />
      </button>
      <a
        href={longUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="Open overlay"
        className="text-gray-400 hover:text-blue-600 transition-colors"
      >
        <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audio panel
// ---------------------------------------------------------------------------

interface AudioPanelProps {
  audio: AudioState | null;
  busy: boolean;
  pendingVolume: number | null;
  onToggleTts: () => void;
  onToggleMusic: () => void;
  onVolumeChange: (v: number) => void;
  previewMuted: boolean;
  onTogglePreviewMute: () => void;
}

function AudioPanel({ audio, busy, pendingVolume, onToggleTts, onToggleMusic, onVolumeChange, previewMuted, onTogglePreviewMute }: AudioPanelProps) {
  const ttsOn    = audio?.tts_enabled   ?? true;
  const musicOn  = audio?.music_enabled ?? true;
  const displayVolume = pendingVolume ?? audio?.music_volume ?? 40;
  const unavailable  = audio === null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center gap-5 flex-wrap">
      {/* Header */}
      <div className="flex items-center gap-1.5 text-gray-400 flex-shrink-0 w-28">
        <SlidersHorizontal className="w-3.5 h-3.5" />
        <span className="text-xs font-medium">Audio</span>
        {busy && <Loader2 className="w-3 h-3 animate-spin ml-1" />}
      </div>

      {/* Divider */}
      <div className="w-px h-7 bg-gray-100 flex-shrink-0 hidden sm:block" />

      {/* TTS toggle */}
      <div className="flex items-center gap-2.5 flex-shrink-0">
        <span className="text-xs text-gray-500 w-6">TTS</span>
        <ToggleSwitch
          on={ttsOn}
          disabled={busy || unavailable}
          onIcon={<Mic    className="w-3 h-3" />}
          offIcon={<MicOff className="w-3 h-3" />}
          onColor="bg-emerald-500"
          onClick={onToggleTts}
        />
        <span className={`text-xs font-medium w-6 ${ttsOn ? 'text-emerald-600' : 'text-gray-400'}`}>
          {ttsOn ? 'On' : 'Off'}
        </span>
      </div>

      {/* Divider */}
      <div className="w-px h-7 bg-gray-100 flex-shrink-0 hidden sm:block" />

      {/* Music toggle */}
      <div className="flex items-center gap-2.5 flex-shrink-0">
        <span className="text-xs text-gray-500 w-10">Music</span>
        <ToggleSwitch
          on={musicOn}
          disabled={busy || unavailable}
          onIcon={<Music  className="w-3 h-3" />}
          offIcon={<Music2 className="w-3 h-3" />}
          onColor="bg-emerald-500"
          onClick={onToggleMusic}
        />
        <span className={`text-xs font-medium w-6 ${musicOn ? 'text-emerald-600' : 'text-gray-400'}`}>
          {musicOn ? 'On' : 'Off'}
        </span>
      </div>

      {/* Divider */}
      <div className="w-px h-7 bg-gray-100 flex-shrink-0 hidden sm:block" />

      {/* Volume slider */}
      <div className="flex items-center gap-3 flex-1 min-w-48">
        <VolumeX className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={displayVolume}
          disabled={busy || unavailable || !musicOn}
          onChange={e => onVolumeChange(Number(e.target.value))}
          className="flex-1 h-1.5 rounded-full appearance-none bg-gray-200 accent-emerald-500 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
        />
        <Volume2 className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
        <span className="text-xs tabular-nums text-gray-500 w-8 text-right flex-shrink-0">
          {displayVolume}%
        </span>
      </div>

      {/* Divider */}
      <div className="w-px h-7 bg-gray-100 flex-shrink-0 hidden sm:block" />

      {/* Preview mute — local only, no effect on OBS/TikTok */}
      <button
        onClick={onTogglePreviewMute}
        title={previewMuted ? 'Unmute preview' : 'Mute preview (local only)'}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors flex-shrink-0 ${
          previewMuted
            ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
            : 'border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100'
        }`}
      >
        {previewMuted
          ? <><VolumeX className="w-3 h-3" /> Preview muted</>
          : <><Volume2 className="w-3 h-3" /> Preview</>
        }
      </button>
    </div>
  );
}

interface ToggleSwitchProps {
  on: boolean;
  disabled: boolean;
  onIcon: React.ReactNode;
  offIcon: React.ReactNode;
  onColor: string;
  onClick: () => void;
}

function ToggleSwitch({ on, disabled, onIcon, offIcon, onColor, onClick }: ToggleSwitchProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative inline-flex items-center w-9 h-5 rounded-full transition-colors flex-shrink-0 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed ${on ? onColor : 'bg-gray-200'}`}
    >
      <span
        className={`inline-flex items-center justify-center w-4 h-4 rounded-full bg-white shadow-sm transform transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`}
      >
        <span className={on ? 'text-emerald-600' : 'text-gray-400'}>
          {on ? onIcon : offIcon}
        </span>
      </span>
    </button>
  );
}
