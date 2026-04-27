import { useEffect, useRef, useState } from 'react';
import {
  PlayCircle,
  HelpCircle,
  CheckCircle2,
  Trophy,
  Users,
  PauseCircle,
  StopCircle,
  Zap,
  Clock,
  Loader,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { SnapshotData, SessionScores } from '../../api/types';

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type TimelineEventKind =
  | 'session_started'
  | 'session_paused'
  | 'session_resumed'
  | 'session_stopped'
  | 'question_started'
  | 'question_answered'
  | 'leaderboard_updated'
  | 'player_joined'
  | 'phase_changed'
  | 'tiktok_connected'
  | 'tiktok_connecting';

export interface TimelineEvent {
  id: string;
  kind: TimelineEventKind;
  ts: string; // ISO timestamp string
  message: string;
  detail?: string;
  icon?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Icon + color mapping
// ---------------------------------------------------------------------------

interface EventStyle {
  iconEl: React.ReactNode;
  dotColor: string;
  textColor: string;
  bgColor: string;
  borderColor: string;
  label: string;
}

function eventStyle(kind: TimelineEventKind, message: string): EventStyle {
  switch (kind) {
    case 'session_started':
      return { iconEl: <PlayCircle className="w-4 h-4" />, dotColor: 'bg-emerald-500', textColor: 'text-emerald-700', bgColor: 'bg-emerald-50', borderColor: 'border-emerald-200', label: 'Session started' };
    case 'session_paused':
      return { iconEl: <PauseCircle className="w-4 h-4" />, dotColor: 'bg-amber-400', textColor: 'text-amber-700', bgColor: 'bg-amber-50', borderColor: 'border-amber-200', label: 'Session paused' };
    case 'session_resumed':
      return { iconEl: <PlayCircle className="w-4 h-4" />, dotColor: 'bg-emerald-500', textColor: 'text-emerald-700', bgColor: 'bg-emerald-50', borderColor: 'border-emerald-200', label: 'Session started' };
    case 'session_stopped':
      return { iconEl: <StopCircle className="w-4 h-4" />, dotColor: 'bg-gray-500', textColor: 'text-gray-600', bgColor: 'bg-gray-100', borderColor: 'border-gray-300', label: 'Session ended' };
    case 'question_started':
      return { iconEl: <HelpCircle className="w-4 h-4" />, dotColor: 'bg-blue-500', textColor: 'text-blue-700', bgColor: 'bg-blue-50', borderColor: 'border-blue-200', label: 'Question shown' };
    case 'question_answered':
      return { iconEl: <CheckCircle2 className="w-4 h-4" />, dotColor: 'bg-sky-500', textColor: 'text-sky-700', bgColor: 'bg-sky-50', borderColor: 'border-sky-200', label: 'Answers received' };
    case 'leaderboard_updated':
      return { iconEl: <Trophy className="w-4 h-4" />, dotColor: 'bg-amber-500', textColor: 'text-amber-700', bgColor: 'bg-amber-50', borderColor: 'border-amber-200', label: 'Leaderboard shown' };
    case 'player_joined':
      return { iconEl: <Users className="w-4 h-4" />, dotColor: 'bg-teal-500', textColor: 'text-teal-700', bgColor: 'bg-teal-50', borderColor: 'border-teal-200', label: 'Players joined' };
    case 'phase_changed': {
      // Map phase messages to clean user labels
      const msg = message.toLowerCase();
      if (msg.includes('result') || msg.includes('countdown'))
        return { iconEl: <CheckCircle2 className="w-4 h-4" />, dotColor: 'bg-sky-500', textColor: 'text-sky-700', bgColor: 'bg-sky-50', borderColor: 'border-sky-200', label: 'Result revealed' };
      if (msg.includes('leaderboard'))
        return { iconEl: <Trophy className="w-4 h-4" />, dotColor: 'bg-amber-500', textColor: 'text-amber-700', bgColor: 'bg-amber-50', borderColor: 'border-amber-200', label: 'Leaderboard shown' };
      if (msg.includes('finish') || msg.includes('end'))
        return { iconEl: <StopCircle className="w-4 h-4" />, dotColor: 'bg-gray-500', textColor: 'text-gray-600', bgColor: 'bg-gray-100', borderColor: 'border-gray-300', label: 'Session ended' };
      return { iconEl: <Zap className="w-4 h-4" />, dotColor: 'bg-gray-400', textColor: 'text-gray-500', bgColor: 'bg-gray-50', borderColor: 'border-gray-200', label: message };
    }
    case 'tiktok_connected':
      return { iconEl: <Wifi    className="w-4 h-4" />, dotColor: 'bg-cyan-500',  textColor: 'text-cyan-700',  bgColor: 'bg-cyan-50',  borderColor: 'border-cyan-200',  label: 'TikTok connected'  };
    case 'tiktok_connecting':
      return { iconEl: <WifiOff className="w-4 h-4" />, dotColor: 'bg-amber-400', textColor: 'text-amber-600', bgColor: 'bg-amber-50', borderColor: 'border-amber-200', label: 'TikTok connecting' };
    default:
      return { iconEl: <Clock className="w-4 h-4" />, dotColor: 'bg-gray-300', textColor: 'text-gray-500', bgColor: 'bg-gray-50', borderColor: 'border-gray-200', label: message };
  }
}

// ---------------------------------------------------------------------------
// Derive events from snapshot deltas
// ---------------------------------------------------------------------------

let _eventSeq = 0;
function nextId() { return `evt-${++_eventSeq}`; }

function nowTs(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

export function deriveEvents(
  prev: SnapshotData | null,
  next: SnapshotData | null,
  prevSessionStatus: string,
  nextSessionStatus: string,
  scores: SessionScores | null,
  prevTikTokConnected?: boolean,
  nextTikTokConnected?: boolean,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  if (!next) return events;

  // TikTok connection transitions (live mode only)
  if (prevTikTokConnected !== undefined && nextTikTokConnected !== undefined) {
    if (!prevTikTokConnected && nextTikTokConnected) {
      events.push({ id: nextId(), kind: 'tiktok_connected',  ts: nowTs(), message: 'TikTok connected' });
    } else if (prevTikTokConnected && !nextTikTokConnected) {
      events.push({ id: nextId(), kind: 'tiktok_connecting', ts: nowTs(), message: 'TikTok connecting', detail: 'Waiting for reconnection' });
    }
  }

  // Session lifecycle transitions
  if (prevSessionStatus !== nextSessionStatus) {
    if (nextSessionStatus === 'running' && prevSessionStatus !== 'running') {
      if (prevSessionStatus === 'paused') {
        events.push({ id: nextId(), kind: 'session_resumed', ts: nowTs(), message: 'Session resumed' });
      } else {
        events.push({ id: nextId(), kind: 'session_started', ts: nowTs(), message: 'Session started' });
      }
    } else if (nextSessionStatus === 'paused') {
      events.push({ id: nextId(), kind: 'session_paused', ts: nowTs(), message: 'Session paused' });
    } else if (nextSessionStatus === 'stopped') {
      const leader = scores?.leaderboard[0];
      events.push({
        id: nextId(), kind: 'session_stopped', ts: nowTs(),
        message: 'Session ended',
        detail: leader ? `Winner: ${leader.username} (${leader.total_score.toLocaleString()} pts)` : undefined,
      });
    }
  }

  // Phase change
  const prevPhase = prev?.phase;
  const nextPhase = next.phase;
  if (nextPhase && nextPhase !== prevPhase) {
    const phaseLabel: Record<string, string> = {
      question:    'Question phase',
      countdown:   'Countdown',
      leaderboard: 'Leaderboard shown',
      waiting:     'Waiting for players',
      starting:    'Game starting',
      finished:    'Game finished',
    };
    const label = phaseLabel[nextPhase] ?? `Phase: ${nextPhase}`;
    // Don't duplicate with question_started events
    if (nextPhase !== 'question') {
      events.push({ id: nextId(), kind: 'phase_changed', ts: nowTs(), message: label });
    }
  }

  // New question
  const prevQIdx = prev?.question_index;
  const nextQIdx = next.question_index;
  if (nextQIdx != null && nextQIdx !== prevQIdx && next.phase === 'question') {
    const total = next.question_total;
    events.push({
      id: nextId(),
      kind: 'question_started',
      ts: nowTs(),
      message: total
        ? `Question ${nextQIdx} of ${total}`
        : `Question ${nextQIdx}`,
      detail: next.question_text ?? undefined,
    });
  }

  // Player count increase
  const prevCount = prev?.participant_count ?? 0;
  const nextCount = next.participant_count ?? 0;
  if (nextCount > prevCount) {
    const joined = nextCount - prevCount;
    events.push({
      id: nextId(),
      kind: 'player_joined',
      ts: nowTs(),
      message: nextCount === 1
        ? '1 player in the session'
        : `${nextCount} players (+${joined})`,
    });
  }

  // Leaderboard leader change
  const prevLeader = prev && Array.isArray((prev as Record<string, unknown>)['leaderboard_top20'])
    ? ((prev as Record<string, unknown>)['leaderboard_top20'] as Array<{ username: string; score: number }>)[0]?.username
    : null;
  const nextTop20 = next && Array.isArray((next as Record<string, unknown>)['leaderboard_top20'])
    ? (next as Record<string, unknown>)['leaderboard_top20'] as Array<{ username: string; score: number }>
    : null;
  const nextLeader = nextTop20?.[0];
  if (nextLeader && nextLeader.username !== prevLeader) {
    events.push({
      id: nextId(),
      kind: 'leaderboard_updated',
      ts: nowTs(),
      message: `${nextLeader.username} leads`,
      detail: `${nextLeader.score.toLocaleString()} pts`,
    });
  }

  return events;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface SessionTimelineProps {
  snapshot: SnapshotData | null;
  sessionStatus: string;
  scores: SessionScores | null;
  live: boolean;
  tiktokConnected?: boolean;
  /** Max events to display */
  maxEvents?: number;
  height?: number;
}

export function SessionTimeline({
  snapshot,
  sessionStatus,
  scores,
  live,
  tiktokConnected,
  maxEvents = 40,
  height = 104,
}: SessionTimelineProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const prevSnapshotRef       = useRef<SnapshotData | null>(null);
  const prevStatusRef         = useRef<string>('');
  const prevTikTokConnectedRef = useRef<boolean | undefined>(undefined);
  const scrollRef             = useRef<HTMLDivElement>(null);

  // Seed a "session started" event on mount when already running
  useEffect(() => {
    if (sessionStatus === 'running' || sessionStatus === 'paused') {
      setEvents([{
        id: nextId(),
        kind: 'session_started',
        ts: nowTs(),
        message: 'Session started',
      }]);
      prevStatusRef.current = sessionStatus;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Derive new events when snapshot/status/tiktokConnected change
  useEffect(() => {
    const newEvents = deriveEvents(
      prevSnapshotRef.current,
      snapshot,
      prevStatusRef.current,
      sessionStatus,
      scores,
      prevTikTokConnectedRef.current,
      tiktokConnected,
    );
    if (newEvents.length > 0) {
      setEvents(prev => {
        const updated = [...prev, ...newEvents];
        return updated.slice(-maxEvents);
      });
      setTimeout(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
        }
      }, 30);
    }
    prevSnapshotRef.current        = snapshot;
    prevStatusRef.current          = sessionStatus;
    prevTikTokConnectedRef.current = tiktokConnected;
  }, [snapshot, sessionStatus, scores, tiktokConnected, maxEvents]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 bg-gray-50 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-gray-400" />
          <span className="text-xs font-semibold text-gray-700">Timeline</span>
          {live && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </span>
          )}
        </div>
        <span className="text-[11px] text-gray-400 tabular-nums">{events.length} events</span>
      </div>

      {/* Horizontal scroll body */}
      <div
        ref={scrollRef}
        className="overflow-x-auto overflow-y-hidden"
        style={{ height: height ?? 88 }}
      >
        {events.length === 0 ? (
          <div className="flex items-center justify-center h-full gap-2 px-6">
            {live
              ? <><Loader className="w-4 h-4 text-gray-200 animate-spin flex-shrink-0" /><p className="text-xs text-gray-300">Waiting for events…</p></>
              : <><Clock className="w-4 h-4 text-gray-200 flex-shrink-0" /><p className="text-xs text-gray-300">No events recorded</p></>
            }
          </div>
        ) : (
          /* Track line + nodes */
          <div className="relative flex items-center h-full px-4 gap-0 min-w-max">
            {/* Horizontal connector line through all nodes */}
            <div className="absolute top-1/2 left-4 right-4 h-px bg-gray-100 -translate-y-1/2 pointer-events-none" />

            {events.map((evt, i) => {
              const { iconEl, dotColor, textColor, bgColor, borderColor, label } = eventStyle(evt.kind, evt.message);
              const isLast = i === events.length - 1;
              return (
                <div key={evt.id} className="relative flex flex-col items-center flex-shrink-0" style={{ width: 96 }}>
                  {/* Node */}
                  <div
                    className={`relative z-10 flex items-center justify-center w-8 h-8 rounded-full border-2 ${bgColor} ${borderColor} ${isLast ? 'ring-2 ring-offset-1 ring-gray-300' : ''}`}
                    title={evt.detail ?? label}
                  >
                    <span className={textColor}>{iconEl}</span>
                  </div>

                  {/* Label + time below node */}
                  <div className="mt-1.5 flex flex-col items-center gap-0.5 px-1 w-full">
                    <span className={`text-[11px] font-semibold leading-tight text-center truncate w-full ${textColor}`}>
                      {label}
                    </span>
                    {evt.detail && (
                      <span className="text-[10px] text-gray-400 leading-tight text-center truncate w-full">
                        {evt.detail}
                      </span>
                    )}
                    <span className="text-[10px] text-gray-300 tabular-nums">{evt.ts}</span>
                  </div>

                  {/* Connector segment to the right (except last) */}
                  {!isLast && (
                    <div className="absolute top-4 left-1/2 w-full h-px bg-gray-150 pointer-events-none" />
                  )}
                </div>
              );
            })}

            {/* Animated "now" pulse on the right when live */}
            {live && events.length > 0 && (
              <div className="relative flex items-center justify-center flex-shrink-0 w-8 mx-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
