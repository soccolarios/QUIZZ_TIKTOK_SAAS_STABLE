import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { AdminLayout } from './AdminLayout';
import { AdminDashboardPage } from './AdminDashboardPage';
import { AdminPlaceholderPage } from './AdminPlaceholderPage';
import { SiteConfigPage } from './SiteConfigPage';
import { PricingPlansPage } from './PricingPlansPage';
import { FeatureFlagsPage } from './FeatureFlagsPage';
import { AdminBillingPage } from './AdminBillingPage';
import { MailjetConfigPage } from './MailjetConfigPage';
import type { AdminPage } from './AdminSidebar';
import { ShieldAlert, LogIn } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { ApiError } from '../api/client';
import { useBrand } from '../context/PublicConfigContext';
import { PageSpinner } from '../components/ui/Spinner';

function AdminLoginGate() {
  const { login } = useAuth();
  const brand = useBrand();
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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to reach the server. Check your connection.');
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
          <h1 className="text-lg font-bold text-white">{brand.name} Admin</h1>
          <p className="text-xs text-gray-500 mt-1">Super Admin access only</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-gray-900 rounded-2xl border border-gray-800 p-6 space-y-4">
          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
              {error}
            </div>
          )}
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Button type="submit" loading={loading} className="w-full" icon={<LogIn className="w-4 h-4" />}>
            Sign in
          </Button>
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
        <p className="text-sm text-gray-400 mb-6">
          Your account does not have Super Admin privileges. Contact the platform administrator if you believe this is an error.
        </p>
        <Button variant="secondary" onClick={logout}>
          Sign out
        </Button>
      </div>
    </div>
  );
}

function AdminDashboard() {
  const { user, logout } = useAuth();
  const [page, setPage] = useState<AdminPage>('dashboard');

  const renderPage = () => {
    if (page === 'dashboard') return <AdminDashboardPage onNavigate={setPage} />;
    if (page === 'site-config') return <SiteConfigPage />;
    if (page === 'pricing-plans') return <PricingPlansPage />;
    if (page === 'feature-flags') return <FeatureFlagsPage />;
    if (page === 'subscriptions') return <AdminBillingPage />;
    if (page === 'mailjet') return <MailjetConfigPage />;
    return <AdminPlaceholderPage moduleId={page} />;
  };

  return (
    <AdminLayout
      currentPage={page}
      onNavigate={setPage}
      onLogout={logout}
      userEmail={user?.email ?? ''}
    >
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
