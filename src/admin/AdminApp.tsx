import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { AdminLayout, type AdminPage } from './AdminLayout';
import { ApiKeysPage } from './ApiKeysPage';
import { MusicBankPage } from './MusicBankPage';
import { SoundBankPage } from './SoundBankPage';
import { BrandAssetsPage } from './BrandAssetsPage';
import { ShieldAlert, LogIn, Key, Music, Volume2, Image } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { PageSpinner } from '../components/ui/Spinner';

function AdminLoginGate() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 bg-gradient-to-br from-rose-500 to-orange-500 rounded-2xl flex items-center justify-center mb-4">
            <ShieldAlert className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-lg font-bold text-white">Admin Panel</h1>
          <p className="text-xs text-gray-500 mt-1">Super Admin access only</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-gray-900 rounded-2xl border border-gray-800 p-6 space-y-4">
          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">{error}</div>
          )}
          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <Button type="submit" loading={loading} className="w-full" icon={<LogIn className="w-4 h-4" />}>Sign in</Button>
        </form>
      </div>
    </div>
  );
}

function AdminAccessDenied() {
  const { logout } = useAuth();
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="text-center max-w-sm">
        <div className="w-14 h-14 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-5">
          <ShieldAlert className="w-7 h-7 text-red-400" />
        </div>
        <h1 className="text-lg font-bold text-white mb-2">Access Denied</h1>
        <p className="text-sm text-gray-400 mb-6">Your account does not have Super Admin privileges.</p>
        <Button variant="secondary" onClick={logout}>Sign out</Button>
      </div>
    </div>
  );
}

function AdminDashboardPage({ onNavigate }: { onNavigate: (p: AdminPage) => void }) {
  const cards = [
    { page: 'api-keys' as AdminPage, icon: <Key className="w-5 h-5" />, label: 'API Keys', desc: 'Manage third-party API keys' },
    { page: 'music-bank' as AdminPage, icon: <Music className="w-5 h-5" />, label: 'Music Bank', desc: 'Background music tracks' },
    { page: 'sound-bank' as AdminPage, icon: <Volume2 className="w-5 h-5" />, label: 'Sound Bank', desc: 'Quiz sound effects' },
    { page: 'brand-assets' as AdminPage, icon: <Image className="w-5 h-5" />, label: 'Brand Assets', desc: 'Logo, favicon, images' },
  ];

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-bold text-white mb-1">Super Admin Dashboard</h1>
      <p className="text-sm text-gray-400 mb-8">Platform configuration and media management.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <button key={c.page} onClick={() => onNavigate(c.page)}
            className="flex items-start gap-4 p-5 rounded-2xl bg-gray-900 border border-gray-800 hover:border-gray-700 transition-colors text-left">
            <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center flex-shrink-0 text-gray-300">
              {c.icon}
            </div>
            <div>
              <p className="text-sm font-semibold text-white">{c.label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{c.desc}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function AdminDashboard() {
  const { user, logout } = useAuth();
  const [page, setPage] = useState<AdminPage>('dashboard');

  const renderPage = () => {
    switch (page) {
      case 'dashboard': return <AdminDashboardPage onNavigate={setPage} />;
      case 'api-keys': return <ApiKeysPage />;
      case 'music-bank': return <MusicBankPage />;
      case 'sound-bank': return <SoundBankPage />;
      case 'brand-assets': return <BrandAssetsPage />;
      default: return <AdminDashboardPage onNavigate={setPage} />;
    }
  };

  return (
    <AdminLayout currentPage={page} onNavigate={setPage} onLogout={logout} userEmail={user?.email ?? ''}>
      {renderPage()}
    </AdminLayout>
  );
}

export function AdminApp() {
  const { user, loading, isAdmin } = useAuth();

  if (loading) return <PageSpinner />;
  if (!user) return <AdminLoginGate />;
  if (!isAdmin) return <AdminAccessDenied />;
  return <AdminDashboard />;
}
