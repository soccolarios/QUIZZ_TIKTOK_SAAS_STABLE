import { useState, useRef, useEffect } from 'react';
import {
  Terminal,
  AlertTriangle,
  AlertCircle,
  Info,
  MessageSquare,
  Filter,
} from 'lucide-react';
import type { LogEntry } from '../../api/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LogFilter = 'all' | 'important' | 'errors';
type Variant = 'dark' | 'light';

// ---------------------------------------------------------------------------
// Level helpers
// ---------------------------------------------------------------------------

type NormLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

function normaliseLevel(level: string): NormLevel {
  const u = (level || '').toUpperCase().trim();
  if (u === 'ERROR')                return 'ERROR';
  if (u === 'WARNING' || u === 'WARN') return 'WARN';
  if (u === 'INFO')                 return 'INFO';
  return 'DEBUG';
}

// Words that make a DEBUG line "important"
const IMPORTANT_TOKENS = [
  'started', 'stopped', 'paused', 'resumed', 'running',
  'question', 'leaderboard', 'session', 'finished', 'score',
  'correct', 'winner', 'error', 'failed',
];

function isImportant(log: LogEntry): boolean {
  const lvl = normaliseLevel(log.level);
  if (lvl === 'ERROR' || lvl === 'WARN') return true;
  const msg = (log.message || '').toLowerCase();
  return IMPORTANT_TOKENS.some(t => msg.includes(t));
}

function matchesFilter(log: LogEntry, filter: LogFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'errors') return normaliseLevel(log.level) === 'ERROR';
  return isImportant(log);
}

// ---------------------------------------------------------------------------
// Timestamp
// ---------------------------------------------------------------------------

function fmtTs(ts: string | null | undefined): string {
  if (!ts) return '--:--:--';
  try {
    return new Date(ts).toLocaleTimeString('en-US', { hour12: false });
  } catch {
    return '--:--:--';
  }
}

// ---------------------------------------------------------------------------
// Level badge
// ---------------------------------------------------------------------------

interface LevelBadgeProps {
  level: string;
  variant: Variant;
}

function LevelBadge({ level, variant }: LevelBadgeProps) {
  const norm = normaliseLevel(level);

  const darkMap: Record<NormLevel, string> = {
    ERROR: 'bg-red-900/60 text-red-300 ring-1 ring-red-700/50',
    WARN:  'bg-amber-900/50 text-amber-300 ring-1 ring-amber-700/40',
    INFO:  'bg-sky-900/40 text-sky-300',
    DEBUG: 'bg-gray-800 text-gray-500',
  };
  const lightMap: Record<NormLevel, string> = {
    ERROR: 'bg-red-50 text-red-600 ring-1 ring-red-200',
    WARN:  'bg-amber-50 text-amber-600 ring-1 ring-amber-200',
    INFO:  'bg-sky-50 text-sky-600',
    DEBUG: 'bg-gray-100 text-gray-400',
  };

  const cls = variant === 'dark' ? darkMap[norm] : lightMap[norm];
  const labels: Record<NormLevel, string> = { ERROR: 'ERR', WARN: 'WRN', INFO: 'INF', DEBUG: 'DBG' };

  return (
    <span className={`inline-flex items-center rounded px-1 py-px text-[10px] font-bold uppercase tracking-wide flex-shrink-0 ${cls}`}>
      {labels[norm]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Icon for empty state
// ---------------------------------------------------------------------------

function LevelIcon({ norm, variant }: { norm: NormLevel; variant: Variant }) {
  const cls = variant === 'dark' ? {
    ERROR: 'text-red-400', WARN: 'text-amber-400', INFO: 'text-sky-400', DEBUG: 'text-gray-600',
  } : {
    ERROR: 'text-red-400', WARN: 'text-amber-400', INFO: 'text-sky-500', DEBUG: 'text-gray-400',
  };
  const c = cls[norm];
  if (norm === 'ERROR') return <AlertCircle   className={`w-3 h-3 ${c} flex-shrink-0 mt-px`} />;
  if (norm === 'WARN')  return <AlertTriangle className={`w-3 h-3 ${c} flex-shrink-0 mt-px`} />;
  if (norm === 'INFO')  return <Info          className={`w-3 h-3 ${c} flex-shrink-0 mt-px`} />;
  return                       <MessageSquare className={`w-3 h-3 ${c} flex-shrink-0 mt-px`} />;
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface LogRowProps {
  log: LogEntry;
  variant: Variant;
  showIcon: boolean;
}

function LogRow({ log, variant, showIcon }: LogRowProps) {
  const norm = normaliseLevel(log.level);
  const dark = variant === 'dark';

  const rowHighlight: Partial<Record<NormLevel, string>> = dark
    ? { ERROR: 'bg-red-950/30', WARN: 'bg-amber-950/20' }
    : { ERROR: 'bg-red-50/60', WARN: 'bg-amber-50/40' };

  const msgClass = dark
    ? { ERROR: 'text-red-200', WARN: 'text-amber-100', INFO: 'text-gray-200', DEBUG: 'text-gray-400' }
    : { ERROR: 'text-red-700', WARN: 'text-amber-700', INFO: 'text-gray-700', DEBUG: 'text-gray-500' };

  const tsClass = dark ? 'text-gray-600' : 'text-gray-400';

  return (
    <div className={`flex items-start gap-2 px-3 py-1 rounded ${rowHighlight[norm] ?? ''}`}>
      <span className={`font-mono text-[11px] tabular-nums flex-shrink-0 pt-px ${tsClass}`}>
        {fmtTs(log.timestamp)}
      </span>
      <LevelBadge level={log.level} variant={variant} />
      {showIcon && <LevelIcon norm={norm} variant={variant} />}
      <span className={`font-mono text-[12px] leading-5 break-all ${msgClass[norm]}`}>
        {log.message}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter tabs
// ---------------------------------------------------------------------------

interface FilterTabsProps {
  active: LogFilter;
  counts: Record<LogFilter, number>;
  onChange: (f: LogFilter) => void;
  variant: Variant;
}

function FilterTabs({ active, counts, onChange, variant }: FilterTabsProps) {
  const dark = variant === 'dark';
  const tabs: { key: LogFilter; label: string }[] = [
    { key: 'all',       label: 'All'       },
    { key: 'important', label: 'Important' },
    { key: 'errors',    label: 'Errors'    },
  ];

  return (
    <div className="flex items-center gap-0.5">
      {tabs.map(({ key, label }) => {
        const isActive = active === key;
        const count = counts[key];
        const activeClass = dark
          ? 'bg-gray-700 text-gray-100'
          : 'bg-white text-gray-800 shadow-sm';
        const inactiveClass = dark
          ? 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
          : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100';
        const hasError = key === 'errors' && count > 0;

        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${isActive ? activeClass : inactiveClass}`}
          >
            {label}
            {count > 0 && (
              <span className={`text-[10px] px-1 rounded-full font-bold ${
                hasError
                  ? (isActive ? 'bg-red-500 text-white' : 'bg-red-100 text-red-500')
                  : (dark
                    ? (isActive ? 'bg-gray-600 text-gray-200' : 'bg-gray-700 text-gray-400')
                    : (isActive ? 'bg-gray-100 text-gray-500' : 'bg-gray-100 text-gray-400'))
              }`}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface ActivityLogProps {
  logs: LogEntry[];
  variant?: Variant;
  /** If true, auto-scroll to bottom when logs update */
  autoScroll?: boolean;
  /** If true, renders a "streaming" indicator in the header */
  live?: boolean;
  /** Override panel height (CSS value) */
  height?: string | number;
  /** Called when user changes the filter — optional, for external control */
  onFilterChange?: (f: LogFilter) => void;
  /** Label shown in the panel header */
  title?: string;
  /** Slot for extra header content (e.g. a Refresh button) */
  headerRight?: React.ReactNode;
}

export function ActivityLog({
  logs,
  variant = 'dark',
  autoScroll = true,
  live = false,
  height = 220,
  title = 'Activity',
  headerRight,
}: ActivityLogProps) {
  const [filter, setFilter] = useState<LogFilter>('all');
  const scrollRef = useRef<HTMLDivElement>(null);
  const dark = variant === 'dark';

  // Scroll to bottom when logs change (and filter is 'all' or the new item matches)
  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (!el) return;
    // Only auto-scroll if user is near the bottom (within 80px)
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom || logs.length <= 5) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs, autoScroll]);

  // Compute counts
  const counts: Record<LogFilter, number> = {
    all:       logs.length,
    important: logs.filter(l => isImportant(l)).length,
    errors:    logs.filter(l => normaliseLevel(l.level) === 'ERROR').length,
  };

  const visible = logs.filter(l => matchesFilter(l, filter));

  // Show level icon on 'important' and 'errors' views to make them easier to scan
  const showIcon = filter !== 'all';

  // Styling
  const containerClass = dark
    ? 'bg-gray-950 border-gray-800'
    : 'bg-white border-gray-200';
  const headerClass = dark
    ? 'bg-gray-900 border-gray-800'
    : 'bg-gray-50 border-gray-200';
  const titleClass = dark ? 'text-gray-300' : 'text-gray-700';
  const iconClass  = dark ? 'text-gray-500' : 'text-gray-400';
  const liveClass  = live
    ? (dark ? 'text-emerald-400' : 'text-emerald-600')
    : (dark ? 'text-gray-600'   : 'text-gray-400');

  return (
    <div className={`rounded-xl border flex flex-col overflow-hidden ${containerClass}`}>
      {/* Header */}
      <div className={`flex items-center justify-between px-3 py-2 border-b flex-shrink-0 ${headerClass}`}>
        <div className="flex items-center gap-2">
          <Terminal className={`w-3.5 h-3.5 ${iconClass}`} />
          <span className={`text-xs font-semibold ${titleClass}`}>{title}</span>
          {live && (
            <span className={`flex items-center gap-1 text-[11px] font-medium ${liveClass}`}>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </span>
          )}
          {counts.errors > 0 && (
            <span className="flex items-center gap-0.5 text-[11px] font-semibold text-red-500">
              <AlertCircle className="w-3 h-3" />
              {counts.errors}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {logs.length > 0 && (
            <div className="flex items-center gap-1">
              <Filter className={`w-3 h-3 ${iconClass}`} />
              <FilterTabs active={filter} counts={counts} onChange={setFilter} variant={variant} />
            </div>
          )}
          {headerRight}
        </div>
      </div>

      {/* Log body */}
      <div
        ref={scrollRef}
        className="overflow-y-auto flex-1 py-1.5"
        style={{ height, minHeight: typeof height === 'number' ? height : undefined }}
      >
        {visible.length === 0 ? (
          <EmptyState filter={filter} active={live} variant={variant} totalLogs={logs.length} />
        ) : (
          <div className="flex flex-col gap-px">
            {visible.map((log, i) => (
              <LogRow key={i} log={log} variant={variant} showIcon={showIcon} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

interface EmptyStateProps {
  filter: LogFilter;
  active: boolean;
  variant: Variant;
  totalLogs: number;
}

function EmptyState({ filter, active, variant, totalLogs }: EmptyStateProps) {
  const dark = variant === 'dark';
  const iconClass  = dark ? 'text-gray-700'  : 'text-gray-300';
  const titleClass = dark ? 'text-gray-500'  : 'text-gray-400';
  const subClass   = dark ? 'text-gray-600'  : 'text-gray-300';

  if (filter !== 'all' && totalLogs > 0) {
    const label = filter === 'errors' ? 'No errors' : 'Nothing notable';
    const sub   = filter === 'errors'
      ? 'No error-level log entries in this session'
      : 'All events look routine — switch to All to see everything';
    return (
      <div className="flex flex-col items-center justify-center h-full py-8 gap-1.5 text-center px-4">
        <AlertCircle className={`w-5 h-5 ${filter === 'errors' ? 'text-emerald-500 opacity-50' : iconClass}`} />
        <p className={`text-xs font-medium ${titleClass}`}>{label}</p>
        <p className={`text-[11px] ${subClass}`}>{sub}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full py-8 gap-1.5 text-center px-4">
      <Terminal className={`w-5 h-5 ${iconClass}`} />
      <p className={`text-xs font-medium ${titleClass}`}>
        {active ? 'Waiting for activity' : 'No logs recorded'}
      </p>
      {active && (
        <p className={`text-[11px] ${subClass}`}>Events will appear here in real time</p>
      )}
    </div>
  );
}
