import { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  PlayCircle,
  RefreshCw,
  Radio,
  Bot,
  Trophy,
  Users,
  Clock,
  ChevronRight,
  MonitorPlay,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  Activity,
  Calendar,
  RotateCcw,
  Trash2,
  Copy,
  Check,
  Link,
  Rocket,
} from 'lucide-react';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { sessionsApi } from '../api/sessions';
import type { Session } from '../api/types';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import { toast } from '../components/layout/DashboardLayout';
import {
  statusBadgeVariant,
  statusLabel,
  isActiveStatus,
  isTerminalStatus,
  isPreparedStatus,
} from '../utils/sessionStatus';
import type { PlayMode, OverlayTemplate } from '../api/sessions';
import type { LaunchPrefill } from './LaunchSessionPage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(s: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function fmtDuration(start: string | null, end: string | null): string {
  if (!start) return '—';
  const a = new Date(start).getTime();
  const b = end ? new Date(end).getTime() : Date.now();
  const secs = Math.round((b - a) / 1000);
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

function buildRelaunchPrefill(s: Session): LaunchPrefill {
  const opts = (s.launch_options || {}) as Record<string, unknown>;
  return {
    projectId:       s.project_id,
    quizId:          s.quiz_id,
    simulationMode:  s.simulation_mode,
    playMode:        (opts.play_mode as PlayMode) || 'single',
    overlayTemplate: (opts.overlay_template as OverlayTemplate) || 'default',
    musicTrackSlug:  typeof opts.music_track_slug === 'string' ? opts.music_track_slug : 'none',
    questionTime:    typeof opts.question_time === 'number' ? opts.question_time : undefined,
    countdownTime:   typeof opts.countdown_time === 'number' ? opts.countdown_time : undefined,
    x2Enabled:       Boolean(opts.x2_enabled),
    ttsEnabled:      !Boolean(opts.no_tts),
    tiktokUsername:  s.tiktok_username ?? undefined,
    overlayToken:    s.overlay_token,
    shortCode:       s.short_code ?? undefined,
    overlayUrl:      s.overlay_url,
    shortOverlayUrl: s.short_overlay_url,
  };
}

type Filter = 'all' | 'active' | 'prepared' | 'completed' | 'failed';

function matchesFilter(s: Session, f: Filter): boolean {
  if (f === 'all')       return true;
  if (f === 'active')    return isActiveStatus(s.status);
  if (f === 'prepared')  return isPreparedStatus(s.status);
  if (f === 'completed') return s.status === 'stopped';
  if (f === 'failed')    return s.status === 'failed' || s.status === 'orphaned';
  return true;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface SessionsPageProps {
  onViewDetail:       (session: Session) => void;
  onRelaunch:         (prefill: LaunchPrefill) => void;
  onNavigateToLaunch: () => void;
}

export function SessionsPage({ onViewDetail, onRelaunch, onNavigateToLaunch }: SessionsPageProps) {
  const [sessions,      setSessions]     = useState<Session[]>([]);
  const [loading,       setLoading]      = useState(true);
  const [refreshing,    setRefreshing]   = useState(false);
  const [filter,        setFilter]       = useState<Filter>('all');
  const [actionBusy,    setActionBusy]   = useState<string | null>(null);
  const [deleteTarget,  setDeleteTarget] = useState<Session | null>(null);
  const [deleting,      setDeleting]     = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      setSessions(await sessionsApi.list());
    } catch {
      toast('Failed to load sessions', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await sessionsApi.delete(deleteTarget.id);
      setSessions(prev => prev.filter(x => x.id !== deleteTarget.id));
      toast('Session deleted', 'success');
    } catch {
      toast('Failed to delete session', 'error');
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const handleStop = async (s: Session) => {
    setActionBusy(s.id);
    try {
      const updated = await sessionsApi.stop(s.id);
      setSessions(prev => prev.map(x => x.id === updated.id ? updated : x));
      toast('Session stopped', 'success');
    } catch {
      toast('Failed to stop session', 'error');
    } finally {
      setActionBusy(null);
    }
  };

  const filtered = sessions.filter(s => matchesFilter(s, filter));
  const counts: Record<Filter, number> = {
    all:       sessions.length,
    active:    sessions.filter(s => isActiveStatus(s.status)).length,
    prepared:  sessions.filter(s => isPreparedStatus(s.status)).length,
    completed: sessions.filter(s => s.status === 'stopped').length,
    failed:    sessions.filter(s => s.status === 'failed' || s.status === 'orphaned').length,
  };

  const tabs: { id: Filter; label: string; icon?: React.ReactNode }[] = [
    { id: 'all',       label: 'All' },
    { id: 'active',    label: 'Active',   icon: <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> },
    { id: 'prepared',  label: 'Ready',    icon: <Rocket className="w-3 h-3 text-blue-400" /> },
    { id: 'completed', label: 'Completed',icon: <CheckCircle2 className="w-3 h-3" /> },
    { id: 'failed',    label: 'Failed',   icon: <XCircle className="w-3 h-3" /> },
  ];

  return (
    <div className="flex flex-col gap-5">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Sessions</h1>
          <p className="text-sm text-gray-500 mt-0.5">Launch and review live quiz sessions</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-500 hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <Button icon={<Plus className="w-4 h-4" />} onClick={onNavigateToLaunch}>
            Launch session
          </Button>
        </div>
      </div>

      {/* Filter tabs */}
      {sessions.length > 0 && (
        <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1 w-fit flex-wrap">
          {tabs.map(tab => {
            const hidden = tab.id !== 'all' && counts[tab.id] === 0;
            if (hidden) return null;
            return (
              <button
                key={tab.id}
                onClick={() => setFilter(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  filter === tab.id
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.icon}
                {tab.label}
                {counts[tab.id] > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                    filter === tab.id ? 'bg-gray-100 text-gray-600' : 'bg-gray-200 text-gray-500'
                  }`}>
                    {counts[tab.id]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : sessions.length === 0 ? (
        <EmptyState onLaunch={onNavigateToLaunch} />
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-14 bg-white rounded-xl border border-gray-200 text-center">
          <Activity className="w-8 h-8 text-gray-200 mb-3" />
          <p className="text-sm font-medium text-gray-500">No {filter} sessions</p>
          {filter === 'active' && (
            <Button size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={onNavigateToLaunch} className="mt-4">
              Launch one now
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map(s => (
            <SessionCard
              key={s.id}
              session={s}
              busy={actionBusy === s.id}
              onDetail={() => onViewDetail(s)}
              onLiveControl={() => onViewDetail(s)}
              onStop={() => handleStop(s)}
              onRelaunch={() => onRelaunch(buildRelaunchPrefill(s))}
              onDelete={() => setDeleteTarget(s)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete session"
        message="Permanently delete this session and its scores data? This cannot be undone."
        confirmLabel="Delete"
        loading={deleting}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ onLaunch }: { onLaunch: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 bg-white rounded-xl border border-gray-200 text-center px-6">
      <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center mb-4">
        <PlayCircle className="w-7 h-7 text-blue-500" />
      </div>
      <p className="text-base font-semibold text-gray-800">No sessions yet</p>
      <p className="text-sm text-gray-400 mt-1 mb-5 max-w-xs">
        Launch a session, copy the overlay URL into OBS, and go live on TikTok or in simulation mode.
      </p>
      <Button icon={<Plus className="w-4 h-4" />} onClick={onLaunch}>
        Launch your first session
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session card
// ---------------------------------------------------------------------------

interface SessionCardProps {
  session: Session;
  busy: boolean;
  onDetail: () => void;
  onLiveControl: () => void;
  onStop: () => void;
  onRelaunch: () => void;
  onDelete: () => void;
}

function SessionCard({ session: s, busy, onDetail, onLiveControl, onStop, onRelaunch, onDelete }: SessionCardProps) {
  const active     = isActiveStatus(s.status);
  const isPrepared = isPreparedStatus(s.status);
  const isOrphaned = s.status === 'orphaned';
  const isFailed   = s.status === 'failed';
  const canDelete  = isTerminalStatus(s.status) || isPrepared;

  const borderClass = active
    ? 'border-emerald-200 bg-emerald-50/20'
    : isPrepared
    ? 'border-blue-200 bg-blue-50/20'
    : isOrphaned
    ? 'border-amber-200 bg-amber-50/20'
    : isFailed
    ? 'border-red-100 bg-red-50/10'
    : 'border-gray-200 bg-white';

  const overlayUrl = s.short_overlay_url ?? s.overlay_url;

  return (
    <div className={`rounded-xl border transition-colors ${borderClass}`}>
      <div className="flex items-start gap-3 p-4">

        {/* Icon */}
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
          active    ? 'bg-emerald-100'
          : isPrepared ? 'bg-blue-100'
          : isOrphaned  ? 'bg-amber-100'
          : isFailed    ? 'bg-red-100'
          : 'bg-gray-100'
        }`}>
          {isOrphaned || isFailed
            ? <AlertTriangle className={`w-4 h-4 ${isOrphaned ? 'text-amber-500' : 'text-red-400'}`} />
            : isPrepared
            ? <Rocket className="w-4 h-4 text-blue-500" />
            : <PlayCircle className={`w-4 h-4 ${active ? 'text-emerald-600' : 'text-gray-400'}`} />
          }
        </div>

        {/* Main body */}
        <div className="flex-1 min-w-0">

          {/* Title row */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900 truncate">
              {s.quiz_title || 'Untitled quiz'}
            </span>
            {s.project_name && (
              <span className="text-xs text-gray-400 truncate">· {s.project_name}</span>
            )}
            <Badge variant={statusBadgeVariant(s.status)}>
              {statusLabel(s.status)}
            </Badge>
            {s.simulation_mode
              ? <ModeChip icon={<Bot   className="w-2.5 h-2.5" />} label="Sim" />
              : <ModeChip icon={<Radio className="w-2.5 h-2.5" />} label="Live" color="text-emerald-600 bg-emerald-50" />
            }
          </div>

          {/* Meta row */}
          <div className="mt-1.5 flex items-center gap-3 flex-wrap text-xs text-gray-400">
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {fmtDate(s.started_at ?? s.created_at)}
            </span>
            {s.started_at && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {fmtDuration(s.started_at, s.ended_at)}
              </span>
            )}
            {s.tiktok_username && (
              <span className="text-gray-400">@{s.tiktok_username}</span>
            )}
          </div>

          {/* Overlay link row — shown for prepared + active sessions */}
          {(active || isPrepared) && overlayUrl && (
            <OverlayLinkRow url={overlayUrl} />
          )}

          {/* Summary row */}
          {s.summary && (s.summary.participant_count != null || s.summary.top_player) && (
            <div className="mt-2 flex items-center gap-3 flex-wrap">
              {s.summary.participant_count != null && (
                <SummaryChip icon={<Users  className="w-3 h-3" />} label={`${s.summary.participant_count} players`} />
              )}
              {s.summary.top_player && (
                <SummaryChip
                  icon={<Trophy className="w-3 h-3 text-amber-400" />}
                  label={`${s.summary.top_player}${s.summary.top_score != null ? ` · ${s.summary.top_score.toLocaleString()} pts` : ''}`}
                />
              )}
            </div>
          )}

          {/* Warning notes */}
          {isOrphaned && (
            <p className="mt-1.5 text-xs text-amber-600 font-medium">
              Process restarted mid-session — scores preserved up to interruption
            </p>
          )}
          {isFailed && (
            <p className="mt-1.5 text-xs text-red-500 font-medium">
              Session failed — scores may be partial
            </p>
          )}
          {isPrepared && (
            <p className="mt-1.5 text-xs text-blue-500 font-medium">
              Overlay URL is ready — go to Launch to start the game
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0 self-start mt-0.5">
          {active && (
            <button
              onClick={onLiveControl}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
            >
              <MonitorPlay className="w-3.5 h-3.5" />
              Live control
            </button>
          )}
          {active && (
            <button
              onClick={onStop}
              disabled={busy}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-red-600 hover:bg-red-50 border border-red-200 transition-colors disabled:opacity-40"
            >
              {busy ? <Spinner /> : <span>Stop</span>}
            </button>
          )}
          {(isTerminalStatus(s.status) || isPrepared) && (
            <button
              onClick={onRelaunch}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-blue-600 hover:bg-blue-50 border border-blue-200 transition-colors"
              title="Relaunch with same settings"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Relaunch
            </button>
          )}
          {canDelete && (
            <button
              onClick={onDelete}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
              title="Delete session"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          {!isPrepared && (
            <button
              onClick={onDetail}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:bg-gray-100 transition-colors"
            >
              Detail
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overlay link row
// ---------------------------------------------------------------------------

function OverlayLinkRow({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  let display = url;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    if (path.startsWith('/o/')) {
      display = parsed.host + path;
    } else {
      const parts = path.split('/').filter(Boolean);
      const token = parts[parts.length - 1] ?? '';
      display = token.length > 12 ? `…${token.slice(-10)}` : path;
    }
  } catch {
    display = url.length > 40 ? `${url.slice(0, 40)}…` : url;
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      toast('Overlay URL copied', 'success');
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="mt-2 flex items-center gap-1.5 max-w-xs">
      <Link className="w-3 h-3 text-gray-300 flex-shrink-0" />
      <span className="font-mono text-[11px] text-gray-500 truncate">{display}</span>
      <button
        onClick={handleCopy}
        className="flex-shrink-0 p-0.5 rounded text-gray-300 hover:text-blue-500 transition-colors"
        title="Copy overlay URL"
      >
        {copied
          ? <Check className="w-3 h-3 text-emerald-500" />
          : <Copy  className="w-3 h-3" />
        }
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tiny reusable chips
// ---------------------------------------------------------------------------

function ModeChip({ icon, label, color = 'text-gray-500 bg-gray-100' }: { icon: React.ReactNode; label: string; color?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-full ${color}`}>
      {icon}{label}
    </span>
  );
}

function SummaryChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-gray-500 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded-full">
      {icon}{label}
    </span>
  );
}
