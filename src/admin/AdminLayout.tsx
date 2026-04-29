import { useState } from 'react';
import { LogOut, LayoutDashboard, Key, Music, Volume2, Image, Zap } from 'lucide-react';

export type AdminPage = 'dashboard' | 'api-keys' | 'music-bank' | 'sound-bank' | 'brand-assets';

interface NavItem {
  id: AdminPage;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
  { id: 'api-keys', label: 'API Keys', icon: <Key className="w-4 h-4" /> },
  { id: 'music-bank', label: 'Music Bank', icon: <Music className="w-4 h-4" /> },
  { id: 'sound-bank', label: 'Sound Bank', icon: <Volume2 className="w-4 h-4" /> },
  { id: 'brand-assets', label: 'Brand Assets', icon: <Image className="w-4 h-4" /> },
];

let _toastFn: ((msg: string, type: 'success' | 'error') => void) | null = null;

export function adminToast(msg: string, type: 'success' | 'error' = 'success') {
  _toastFn?.(msg, type);
}

interface Props {
  currentPage: AdminPage;
  onNavigate: (page: AdminPage) => void;
  onLogout: () => void;
  userEmail: string;
  children: React.ReactNode;
}

export function AdminLayout({ currentPage, onNavigate, onLogout, userEmail, children }: Props) {
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);

  _toastFn = (msg, type) => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  return (
    <div className="flex min-h-screen bg-gray-950">
      {/* Sidebar */}
      <aside className="w-60 bg-gray-950 flex flex-col min-h-screen border-r border-gray-800/50">
        <div className="px-4 py-4 border-b border-gray-800/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-gradient-to-br from-rose-500 to-orange-500 rounded-lg flex items-center justify-center flex-shrink-0">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate">LiveGine</p>
              <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">Super Admin</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors text-left ${
                currentPage === item.id
                  ? 'bg-white/10 text-white'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
              }`}
            >
              <span className="flex-shrink-0 opacity-75">{item.icon}</span>
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="px-3 py-3 border-t border-gray-800/50 space-y-1">
          <div className="flex items-center gap-2 px-3 py-1.5">
            <div className="w-6 h-6 rounded-full bg-rose-500/20 flex items-center justify-center flex-shrink-0">
              <span className="text-[10px] font-bold text-rose-400">
                {userEmail.charAt(0).toUpperCase()}
              </span>
            </div>
            <span className="text-[11px] text-gray-500 truncate">{userEmail}</span>
          </div>
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-8">
        {children}
      </main>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium z-50 transition-all ${
          toast.type === 'success'
            ? 'bg-emerald-900/90 text-emerald-200 border border-emerald-700/50'
            : 'bg-red-900/90 text-red-200 border border-red-700/50'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
