import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  RefreshCw,
  Square,
  Pause,
  Play,
  Trophy,
  AlertTriangle,
  Info,
  Database,
  Users,
  CheckCircle,
  TrendingUp,
  RotateCcw,
} from 'lucide-react';
import { sessionsApi } from '../api/sessions';
import type { Session, LogEntry, SessionScores, SessionSnapshot } from '../api/types';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card, CardHeader } from '../components/ui/Card';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Spinner } from '../components/ui/Spinner';
import { toast } from '../components/layout/DashboardLayout';
import { ApiError } from '../api/client';
import { statusBadgeVariant, statusLabel, isActiveStatus, isTerminalStatus, statusDescription } from '../utils/sessionStatus';
import { ActivityLog } from '../components/sessions/ActivityLog';
import { StartSessionModal, type SessionPrefill } from '../components/sessions/StartSessionModal';
import type { PlayMode } from '../api/sessions';
import { useAuth } from '../context/AuthContext';

interface SessionDetailPageProps {
  sessionId: string;
  onBack: () => void;
}

export function SessionDetailPage({ sessionId, onBack }: SessionDetailPageProps) {
  const { isAdmin } = useAuth();
  const [session, setSession] = useState<Session | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [scores, setScores] = useState<SessionScores | null>(null);
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsOpened, setLogsOpened] = useState(false);
  const [scoresLoading, setScoresLoading] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [relaunchOpen, setRelaunchOpen] = useState(false);
  const [relaunchPrefill, setRelaunchPrefill] = useState<SessionPrefill | undefined>();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadSession = useCallback(async () => {
    try {
      const data = await sessionsApi.get(sessionId);
      setSession(data);
      return data;
    } catch {
      toast('Failed to load session', 'error');
      return null;
    }
  }, [sessionId]);

  const loadLogs = useCallback(async (silent = false) => {
    if (!silent) setLogsLoading(true);
    try {
      const data = await sessionsApi.logs(sessionId);
      setLogs(data.logs);
    } catch {
      // silently fail
    } finally {
      setLogsLoading(false);
    }
  }, [sessionId]);

  const loadScores = useCallback(async () => {
    setScoresLoading(true);
    try {
      const data = await sessionsApi.scores(sessionId);
      setScores(data);
    } catch {
      setScores(null);
    } finally {
      setScoresLoading(false);
    }
  }, [sessionId]);

  const loadSnapshot = useCallback(async () => {
    try {
      const data = await sessionsApi.snapshot(sessionId);
      setSnapshot(data);
    } catch {
      setSnapshot(null);
    }
  }, [sessionId]);

  useEffect(() => {
    Promise.all([loadSession(), loadScores(), loadSnapshot()])
      .finally(() => setLoading(false));
  }, [loadSession, loadScores, loadSnapshot]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => {
        loadSession();
        loadLogs(true);
        loadScores();
      }, 3000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, loadSession, loadLogs, loadScores]);

  const handleStop = async () => {
    setActionLoading(true);
    try {
      const updated = await sessionsApi.stop(sessionId);
      setSession(updated);
      toast('Session stopped', 'success');
      loadScores();
      loadSnapshot();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to stop', 'error');
    } finally {
      setActionLoading(false);
      setStopOpen(false);
    }
  };

  const handlePause = async () => {
    setActionLoading(true);
    try {
      const updated = await sessionsApi.pause(sessionId);
      setSession(updated);
      toast('Session paused', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to pause', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleResume = async () => {
    setActionLoading(true);
    try {
      const updated = await sessionsApi.resume(sessionId);
      setSession(updated);
      toast('Session resumed', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to resume', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const copyUrl = () => {
    if (!session) return;
    navigator.clipboard.writeText(session.overlay_url);
    toast('Overlay URL copied', 'success');
  };

  const formatDate = (s: string | null) => {
    if (!s) return '—';
    return new Date(s).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Button variant="ghost" icon={<ArrowLeft className="w-4 h-4" />} onClick={onBack} size="sm">
          Back
        </Button>
        <div className="flex justify-center py-16"><Spinner /></div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex flex-col gap-4">
        <Button variant="ghost" icon={<ArrowLeft className="w-4 h-4" />} onClick={onBack} size="sm">
          Back
        </Button>
        <p className="text-gray-500 text-sm">Session not found.</p>
      </div>
    );
  }

  const active = isActiveStatus(session.status);
  const terminal = isTerminalStatus(session.status);
  const isOrphaned = session.status === 'orphaned';
  const desc = statusDescription(session.status);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" icon={<ArrowLeft className="w-4 h-4" />} onClick={onBack} size="sm">
          Sessions
        </Button>
        <span className="text-gray-300">/</span>
        <span className="text-sm text-gray-600 font-mono truncate">{session.id}</span>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-gray-900">Session detail</h1>
          <Badge variant={statusBadgeVariant(session.status)}>
            {statusLabel(session.status)}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {session.status === 'running' && (
            <Button variant="secondary" size="sm" icon={<Pause className="w-3.5 h-3.5" />} onClick={handlePause} loading={actionLoading}>
              Pause
            </Button>
          )}
          {session.status === 'paused' && (
            <Button variant="secondary" size="sm" icon={<Play className="w-3.5 h-3.5" />} onClick={handleResume} loading={actionLoading}>
              Resume
            </Button>
          )}
          {active && (
            <Button variant="danger" size="sm" icon={<Square className="w-3.5 h-3.5" />} onClick={() => setStopOpen(true)} loading={actionLoading}>
              Stop
            </Button>
          )}
          {terminal && (
            <Button
              variant="secondary"
              size="sm"
              icon={<RotateCcw className="w-3.5 h-3.5" />}
              onClick={() => {
                const opts = (session.launch_options || {}) as Record<string, unknown>;
                setRelaunchPrefill({
                  projectId:      session.project_id,
                  quizId:         session.quiz_id,
                  simulationMode: session.simulation_mode,
                  playMode:       (opts.play_mode as PlayMode) || 'single',
                  questionTime:   typeof opts.question_time === 'number' ? opts.question_time : undefined,
                  countdownTime:  typeof opts.countdown_time === 'number' ? opts.countdown_time : undefined,
                  x2Enabled:      Boolean(opts.x2_enabled),
                  ttsEnabled:     !Boolean(opts.no_tts),
                  tiktokUsername: session.tiktok_username ?? undefined,
                  overlayToken:   session.overlay_token,
                  shortCode:      session.short_code ?? undefined,
                });
                setRelaunchOpen(true);
              }}
            >
              Relaunch
            </Button>
          )}
        </div>
      </div>

      {isOrphaned && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Session interrupted by server restart</p>
            <p className="text-xs text-amber-600 mt-0.5">
              The backend process restarted while this session was active. The in-memory runtime is gone.
              Scores and the last snapshot are preserved below. Start a new session to continue.
            </p>
          </div>
        </div>
      )}

      {desc && !isOrphaned && terminal && (
        <div className="flex items-start gap-2.5 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
          <Info className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-gray-500">{desc}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {isAdmin && (
          <Card>
            <CardHeader>
              <p className="text-sm font-semibold text-gray-900">Runtime info</p>
              <Button variant="ghost" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={() => loadSession()}>
                Refresh
              </Button>
            </CardHeader>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-gray-400">Status</dt>
                <dd className="font-medium text-gray-800 mt-0.5">{statusLabel(session.status)}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">Uptime</dt>
                <dd className="font-medium text-gray-800 mt-0.5">
                  {session.runtime.uptime != null ? `${session.runtime.uptime}s` : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">Engine state</dt>
                <dd className="font-medium text-gray-800 mt-0.5">{session.runtime.engine_state || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">WS clients</dt>
                <dd className="font-medium text-gray-800 mt-0.5">{session.runtime.ws_connected}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">Started</dt>
                <dd className="font-medium text-gray-800 mt-0.5">{formatDate(session.started_at)}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">Ended</dt>
                <dd className="font-medium text-gray-800 mt-0.5">{formatDate(session.ended_at)}</dd>
              </div>
              {session.runtime.error && (
                <div className="col-span-2">
                  <dt className="text-xs text-gray-400">Error</dt>
                  <dd className="text-xs text-red-600 mt-0.5 font-mono break-all">{session.runtime.error}</dd>
                </div>
              )}
            </dl>
          </Card>
        )}

        <Card className={!isAdmin ? 'md:col-span-2' : ''}>
          <CardHeader>
            <p className="text-sm font-semibold text-gray-900">Overlay</p>
          </CardHeader>
          <div className="flex flex-col gap-3">
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
              <p className="text-xs font-mono text-gray-700 break-all">{session.overlay_url}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" icon={<Copy className="w-3.5 h-3.5" />} onClick={copyUrl} className="flex-1">
                Copy URL
              </Button>
              <a href={session.overlay_url} target="_blank" rel="noopener noreferrer" className="flex-1">
                <Button variant="secondary" size="sm" icon={<ExternalLink className="w-3.5 h-3.5" />} className="w-full">
                  Open overlay
                </Button>
              </a>
            </div>
            <div className="text-xs text-gray-400">
              <p>Mode: {session.simulation_mode ? 'Simulation' : 'Live TikTok'}</p>
              {session.tiktok_username && <p>Account: @{session.tiktok_username}</p>}
            </div>
          </div>
        </Card>
      </div>

      {snapshot && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-gray-400" />
              <p className="text-sm font-semibold text-gray-900">
                Last snapshot
                {snapshot.source === 'stored' && (
                  <span className="ml-2 text-xs font-normal text-gray-400">
                    {snapshot.updated_at ? `saved ${formatDate(snapshot.updated_at)}` : ''}
                  </span>
                )}
                {snapshot.source === 'live' && (
                  <span className="ml-2 text-xs font-normal text-emerald-500">live</span>
                )}
              </p>
            </div>
          </CardHeader>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-4">
            {snapshot.snapshot.phase && (
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-400">Phase</p>
                <p className="font-medium text-gray-800 mt-0.5 capitalize">{snapshot.snapshot.phase}</p>
              </div>
            )}
            {snapshot.snapshot.question_index != null && snapshot.snapshot.question_total != null && (
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-400">Question</p>
                <p className="font-medium text-gray-800 mt-0.5">
                  {snapshot.snapshot.question_index} / {snapshot.snapshot.question_total}
                </p>
              </div>
            )}
            {snapshot.snapshot.participant_count != null && (
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-400">Participants</p>
                <p className="font-medium text-gray-800 mt-0.5">{snapshot.snapshot.participant_count}</p>
              </div>
            )}
            {snapshot.snapshot.engine_state && (
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-400">Engine</p>
                <p className="font-medium text-gray-800 mt-0.5 capitalize">{snapshot.snapshot.engine_state}</p>
              </div>
            )}
          </div>
          {snapshot.snapshot.question_text && (
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
              <p className="text-xs text-gray-400 mb-1">Last question shown</p>
              <p className="text-sm text-gray-700">{snapshot.snapshot.question_text}</p>
            </div>
          )}
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-gray-400" />
            <p className="text-sm font-semibold text-gray-900">
              Leaderboard
              {scores && (
                <span className="ml-2 text-xs font-normal text-gray-400">
                  {scores.source === 'live' ? 'live' : 'from saved scores'}
                </span>
              )}
            </p>
          </div>
          <Button variant="ghost" size="sm" icon={<RefreshCw className={`w-3.5 h-3.5 ${scoresLoading ? 'animate-spin' : ''}`} />} onClick={loadScores}>
            Refresh
          </Button>
        </CardHeader>

        {scores && (
          <div className="flex items-center gap-4 mb-4 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <Users className="w-3.5 h-3.5" />
              <span>{scores.total_players} players</span>
            </div>
            {scores.total_answers != null && (
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <TrendingUp className="w-3.5 h-3.5" />
                <span>{scores.total_answers} answers</span>
              </div>
            )}
            {scores.accuracy_pct != null && (
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <CheckCircle className="w-3.5 h-3.5" />
                <span>{scores.accuracy_pct}% correct</span>
              </div>
            )}
          </div>
        )}

        {scoresLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : !scores || scores.leaderboard.length === 0 ? (
          <p className="text-sm text-gray-400 py-6 text-center">No scores available yet</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {scores.leaderboard.map((entry) => (
              <div key={entry.username} className="flex items-center justify-between py-2.5 px-1">
                <div className="flex items-center gap-3">
                  <span className={`w-6 text-center text-xs font-bold ${
                    entry.rank === 1 ? 'text-amber-500' :
                    entry.rank === 2 ? 'text-gray-400' :
                    entry.rank === 3 ? 'text-amber-700' : 'text-gray-300'
                  }`}>
                    #{entry.rank}
                  </span>
                  <span className="text-sm font-medium text-gray-800">{entry.username}</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-right">
                  {entry.correct_answers != null && entry.total_answers != null && (
                    <span className="text-gray-400">
                      {entry.correct_answers}/{entry.total_answers}
                    </span>
                  )}
                  <span className="font-bold text-gray-900 w-16">{entry.total_score.toLocaleString()} pts</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {isAdmin && (
        <details
          className="group rounded-xl border border-gray-200 overflow-hidden"
          onToggle={(e) => {
            const open = (e.currentTarget as HTMLDetailsElement).open;
            if (open && !logsOpened) {
              setLogsOpened(true);
              loadLogs();
            }
          }}
        >
          <summary className="flex items-center justify-between px-4 py-3 bg-gray-50 cursor-pointer select-none hover:bg-gray-100 transition-colors list-none">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-500">
              <Database className="w-3.5 h-3.5" />
              <span>Developer logs</span>
              {logs.length > 0 && (
                <span className="text-[11px] text-gray-400 tabular-nums">({logs.length})</span>
              )}
            </div>
            <span className="text-xs text-gray-400 group-open:hidden">Show</span>
            <span className="text-xs text-gray-400 hidden group-open:inline">Hide</span>
          </summary>
          <div className="p-3 bg-white">
            <ActivityLog
              logs={logs}
              variant="light"
              live={autoRefresh}
              autoScroll={false}
              height={320}
              title="Session logs"
              headerRight={
                <div className="flex items-center gap-1.5">
                  <label className="flex items-center gap-1 text-[11px] text-gray-400 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={autoRefresh}
                      onChange={e => setAutoRefresh(e.target.checked)}
                      className="rounded w-3 h-3"
                    />
                    Auto
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<RefreshCw className={`w-3 h-3 ${logsLoading ? 'animate-spin' : ''}`} />}
                    onClick={() => loadLogs()}
                  />
                </div>
              }
            />
          </div>
        </details>
      )}

      <ConfirmDialog
        open={stopOpen}
        onClose={() => setStopOpen(false)}
        onConfirm={handleStop}
        title="Stop session"
        message="Stop this session? The game will end immediately."
        confirmLabel="Stop"
        loading={actionLoading}
      />

      <StartSessionModal
        open={relaunchOpen}
        onClose={() => { setRelaunchOpen(false); setRelaunchPrefill(undefined); }}
        onStarted={() => { setRelaunchOpen(false); onBack(); }}
        prefill={relaunchPrefill}
      />
    </div>
  );
}
