import { useState, useEffect, useCallback } from 'react';
import {
  FolderOpen, BookOpen, PlayCircle, CheckCircle2, Circle,
  ArrowRight, Activity, TrendingUp, Clock, Zap,
} from 'lucide-react';
import { analyticsApi, type DashboardStats } from '../api/analytics';
import { billingApi, type Subscription } from '../api/billing';
import { useAuth } from '../context/AuthContext';
import type { NavPage } from '../components/layout/Sidebar';

interface OverviewPageProps {
  onNavigate: (page: NavPage) => void;
}

function StatCard({ label, value, icon, sub }: { label: string; value: number | string; icon: React.ReactNode; sub?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 flex items-start gap-4 shadow-sm">
      <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900 leading-none mb-0.5">{value}</p>
        <p className="text-xs font-medium text-gray-500">{label}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

const PLAN_COLORS: Record<string, string> = {
  free: 'text-gray-500 bg-gray-100',
  pro: 'text-blue-700 bg-blue-50',
  premium: 'text-amber-700 bg-amber-50',
};

function OnboardingChecklist({ stats, onNavigate }: { stats: DashboardStats | null; onNavigate: (p: NavPage) => void }) {
  const steps = [
    {
      done: (stats?.total_projects ?? 0) > 0,
      label: 'Create your first project',
      description: 'A project groups your quizzes together.',
      action: () => onNavigate('projects'),
      actionLabel: 'Create project',
      icon: <FolderOpen className="w-4 h-4" />,
    },
    {
      done: (stats?.total_quizzes ?? 0) > 0,
      label: 'Add a quiz',
      description: 'Create questions and answers for your session.',
      action: () => onNavigate('quizzes'),
      actionLabel: 'Create quiz',
      icon: <BookOpen className="w-4 h-4" />,
    },
    {
      done: (stats?.total_sessions ?? 0) > 0,
      label: 'Launch a session',
      description: 'Start a session and grab your OBS overlay URL.',
      action: () => onNavigate('sessions'),
      actionLabel: 'Launch session',
      icon: <PlayCircle className="w-4 h-4" />,
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;

  if (allDone) return null;

  return (
    <div className="bg-white border border-blue-100 rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 bg-blue-50/50 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900">Get started</p>
          <p className="text-xs text-gray-500 mt-0.5">{doneCount} of {steps.length} steps completed</p>
        </div>
        <div className="flex gap-1">
          {steps.map((s, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-colors ${s.done ? 'bg-blue-600' : 'bg-gray-200'}`}
            />
          ))}
        </div>
      </div>
      <div className="divide-y divide-gray-100">
        {steps.map((s) => (
          <div key={s.label} className={`flex items-center gap-4 px-5 py-4 ${s.done ? 'opacity-60' : ''}`}>
            {s.done
              ? <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
              : <Circle className="w-5 h-5 text-gray-300 flex-shrink-0" />
            }
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${s.done ? 'line-through text-gray-400' : 'text-gray-800'}`}>{s.label}</p>
              {!s.done && <p className="text-xs text-gray-500 mt-0.5">{s.description}</p>}
            </div>
            {!s.done && (
              <button
                onClick={s.action}
                className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 transition-colors flex-shrink-0"
              >
                {s.actionLabel}
                <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function OverviewPage({ onNavigate }: OverviewPageProps) {
  const { user } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, billing] = await Promise.all([
        analyticsApi.getStats().catch(() => null),
        billingApi.getSubscription().catch(() => null),
      ]);
      setStats(s);
      setSub(billing);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = user?.email?.split('@')[0] ?? 'there';

  const planCode = sub?.plan_code || 'free';
  const planLabel = sub?.display_name || 'Free';

  const formatRelative = (iso: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    const now = new Date();
    const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return d.toLocaleDateString();
  };

  return (
    <div className="flex flex-col gap-7">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{greeting}, {firstName}</h1>
          <p className="text-sm text-gray-500 mt-0.5">Here's your dashboard overview</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide ${PLAN_COLORS[planCode]}`}>
            {planLabel}
          </span>
          {planCode === 'free' && (
            <button
              onClick={() => onNavigate('billing')}
              className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 transition-colors"
            >
              Upgrade
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <OnboardingChecklist stats={stats} onNavigate={onNavigate} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Projects"
          value={loading ? '—' : stats?.total_projects ?? 0}
          icon={<FolderOpen className="w-5 h-5 text-blue-600" />}
        />
        <StatCard
          label="Quizzes"
          value={loading ? '—' : stats?.total_quizzes ?? 0}
          icon={<BookOpen className="w-5 h-5 text-blue-600" />}
        />
        <StatCard
          label="Sessions"
          value={loading ? '—' : stats?.total_sessions ?? 0}
          icon={<TrendingUp className="w-5 h-5 text-blue-600" />}
          sub={stats?.last_session_at ? `Last: ${formatRelative(stats.last_session_at)}` : undefined}
        />
        <StatCard
          label="Active now"
          value={loading ? '—' : stats?.active_sessions ?? 0}
          icon={<Activity className={`w-5 h-5 ${(stats?.active_sessions ?? 0) > 0 ? 'text-green-500' : 'text-blue-600'}`} />}
          sub={(stats?.active_sessions ?? 0) > 0 ? 'Sessions running' : 'No sessions running'}
        />
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <QuickActionCard
          icon={<FolderOpen className="w-5 h-5 text-blue-600" />}
          title="Projects"
          description="Organise your quizzes by project"
          action="Manage projects"
          onClick={() => onNavigate('projects')}
        />
        <QuickActionCard
          icon={<BookOpen className="w-5 h-5 text-blue-600" />}
          title="Quizzes"
          description="Create and manage your questions"
          action="Manage quizzes"
          onClick={() => onNavigate('quizzes')}
        />
        <QuickActionCard
          icon={<Zap className="w-5 h-5 text-blue-600" />}
          title="Sessions"
          description="Launch a live quiz session"
          action="Go to sessions"
          onClick={() => onNavigate('sessions')}
        />
      </div>

      {sub && planCode === 'free' && (
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl p-5 flex items-center justify-between gap-4 text-white">
          <div>
            <p className="font-semibold text-sm">Unlock more with Pro</p>
            <p className="text-xs text-blue-100 mt-0.5">5 sessions, X2 mechanic, TTS audio, and full analytics.</p>
          </div>
          <button
            onClick={() => onNavigate('billing')}
            className="flex items-center gap-1.5 bg-white text-blue-700 font-semibold text-xs px-4 py-2 rounded-lg hover:bg-blue-50 transition-colors flex-shrink-0"
          >
            See plans
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}

function QuickActionCard({ icon, title, description, action, onClick }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="bg-white border border-gray-200 rounded-xl p-5 text-left hover:border-blue-300 hover:shadow-sm transition-all group"
    >
      <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center mb-3">
        {icon}
      </div>
      <p className="text-sm font-semibold text-gray-900 mb-0.5">{title}</p>
      <p className="text-xs text-gray-500">{description}</p>
      <div className="flex items-center gap-1 mt-3 text-xs font-semibold text-blue-600 group-hover:gap-2 transition-all">
        {action}
        <ArrowRight className="w-3 h-3" />
      </div>
    </button>
  );
}
