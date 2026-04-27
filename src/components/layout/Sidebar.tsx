import { FolderOpen, BookOpen, PlayCircle, LogOut, Zap, User, CreditCard, LayoutDashboard, Sparkles, Rocket } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export type NavPage = 'overview' | 'projects' | 'quizzes' | 'ai-generator' | 'sessions' | 'launch' | 'billing' | 'account';

interface SidebarProps {
  current: NavPage;
  onChange: (page: NavPage) => void;
}

const navItems: { id: NavPage; label: string; icon: React.ReactNode; highlight?: boolean }[] = [
  { id: 'overview',      label: 'Overview',     icon: <LayoutDashboard className="w-4 h-4" /> },
  { id: 'projects',      label: 'Projects',     icon: <FolderOpen      className="w-4 h-4" /> },
  { id: 'quizzes',       label: 'Quizzes',      icon: <BookOpen        className="w-4 h-4" /> },
  { id: 'ai-generator',  label: 'AI Generator', icon: <Sparkles        className="w-4 h-4" />, highlight: true },
  { id: 'launch',        label: 'Launch',       icon: <Rocket          className="w-4 h-4" /> },
  { id: 'sessions',      label: 'Sessions',     icon: <PlayCircle      className="w-4 h-4" /> },
];

const planColors: Record<string, string> = {
  free: 'bg-gray-600 text-gray-200',
  pro: 'bg-blue-600 text-white',
  premium: 'bg-amber-500 text-white',
};

const planLabels: Record<string, string> = {
  free: 'Free',
  pro: 'Pro',
  premium: 'Premium',
};

export function Sidebar({ current, onChange }: SidebarProps) {
  const { user, logout } = useAuth();

  const planCode = user?.plan_code || 'free';
  const planLabel = planLabels[planCode] || planCode;

  return (
    <aside className="w-56 bg-gray-900 flex flex-col min-h-screen">
      <div className="px-4 py-5 border-b border-gray-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center flex-shrink-0">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm font-semibold text-white">TikTok Quiz</span>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
        {navItems.map((item) => {
          const isActive = current === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
                isActive
                  ? item.highlight
                    ? 'bg-gradient-to-r from-blue-600 to-cyan-500 text-white'
                    : 'bg-blue-600 text-white'
                  : item.highlight
                  ? 'text-cyan-400 hover:text-white hover:bg-gray-800'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              {item.icon}
              {item.label}
              {item.highlight && !isActive && (
                <span className="ml-auto text-[9px] font-bold bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                  IA
                </span>
              )}
            </button>
          );
        })}

        <div className="mt-2 pt-2 border-t border-gray-800 flex flex-col gap-1">
          <button
            onClick={() => onChange('billing')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
              current === 'billing'
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            <CreditCard className="w-4 h-4" />
            Billing
          </button>
          <button
            onClick={() => onChange('account')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
              current === 'account'
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            <User className="w-4 h-4" />
            Account
          </button>
        </div>
      </nav>

      <div className="px-3 py-4 border-t border-gray-800">
        <button
          onClick={() => onChange('billing')}
          className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg mb-2 hover:bg-gray-800 transition-colors"
        >
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide ${planColors[planCode] || planColors.free}`}>
            {planLabel}
          </span>
          {planCode === 'free' && (
            <span className="text-xs text-blue-400 ml-auto">Upgrade</span>
          )}
        </button>

        <div className="flex items-center gap-2 px-3 py-2 mb-1">
          <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0">
            <User className="w-3.5 h-3.5 text-gray-400" />
          </div>
          <span className="text-xs text-gray-400 truncate">{user?.email}</span>
        </div>
        <button
          onClick={logout}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
