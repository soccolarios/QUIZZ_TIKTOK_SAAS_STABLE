import { useState, useEffect, useCallback } from 'react';
import { User, Mail, CreditCard, ArrowRight, ExternalLink, CheckCircle, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { billingApi, type Subscription } from '../api/billing';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import { toast } from '../components/layout/DashboardLayout';
import { ApiError } from '../api/client';
import type { NavPage } from '../components/layout/Sidebar';

interface AccountPageProps {
  onNavigate: (page: NavPage) => void;
}

const planColors: Record<string, string> = {
  free: 'bg-gray-100 text-gray-700',
  pro: 'bg-blue-600 text-white',
  premium: 'bg-amber-500 text-white',
};

const statusVariant = (s: string): 'success' | 'warning' | 'error' | 'default' => {
  if (s === 'active' || s === 'trialing') return 'success';
  if (s === 'past_due') return 'error';
  if (s === 'canceled') return 'default';
  return 'default';
};

export function AccountPage({ onNavigate }: AccountPageProps) {
  const { user } = useAuth();
  const [sub, setSub] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [portalLoading, setPortalLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await billingApi.getSubscription();
      setSub(data);
    } catch {
      toast('Failed to load account info', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handlePortal = async () => {
    setPortalLoading(true);
    try {
      const { portal_url } = await billingApi.createPortal();
      window.open(portal_url, '_blank');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to open billing portal', 'error');
    } finally {
      setPortalLoading(false);
    }
  };

  const planCode = sub?.plan_code || 'free';
  const planLabel = sub?.display_name || 'Free';

  const formatDate = (s: string | null) => {
    if (!s) return null;
    return new Date(s).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Account</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage your profile and subscription</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
          <User className="w-4 h-4 text-gray-500" />
          <p className="text-sm font-semibold text-gray-700">Profile</p>
        </div>
        <div className="px-5 py-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
            <span className="text-lg font-bold text-blue-600">
              {user?.email?.[0]?.toUpperCase() ?? '?'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <Mail className="w-3.5 h-3.5 text-gray-400" />
              <p className="text-sm text-gray-700 font-medium truncate">{user?.email}</p>
            </div>
            <p className="text-xs text-gray-400">
              Member since {user?.created_at ? formatDate(user.created_at) : '—'}
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-gray-500" />
            <p className="text-sm font-semibold text-gray-700">Subscription</p>
          </div>
          <div className="px-5 py-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide ${planColors[planCode]}`}>
                  {planLabel}
                </span>
                {sub && <Badge variant={statusVariant(sub.status)}>{sub.status}</Badge>}
              </div>
              {sub?.current_period_end && (
                <p className="text-xs text-gray-400">
                  {sub.cancel_at_period_end
                    ? `Cancels ${formatDate(sub.current_period_end)}`
                    : `Renews ${formatDate(sub.current_period_end)}`}
                </p>
              )}
            </div>

            {sub && (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-2 text-gray-600">
                  {sub.limits.x2_enabled
                    ? <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                    : <AlertCircle className="w-3.5 h-3.5 text-gray-300" />}
                  X2 mechanic
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  {sub.limits.tts_enabled
                    ? <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                    : <AlertCircle className="w-3.5 h-3.5 text-gray-300" />}
                  TTS audio
                </div>
                <div className="text-gray-500">
                  <span className="font-semibold text-gray-800">{sub.limits.max_active_sessions}</span> active sessions
                </div>
                <div className="text-gray-500">
                  <span className="font-semibold text-gray-800">{sub.limits.max_projects}</span> projects
                </div>
              </div>
            )}

            {sub?.cancel_at_period_end && (
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-100 rounded-lg">
                <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700">
                  Your subscription is set to cancel on {formatDate(sub.current_period_end)}.
                  Reactivate in the billing portal to keep access.
                </p>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              {planCode === 'free' ? (
                <Button
                  onClick={() => onNavigate('billing')}
                  icon={<ArrowRight className="w-3.5 h-3.5" />}
                >
                  Upgrade plan
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  onClick={handlePortal}
                  loading={portalLoading}
                  icon={<ExternalLink className="w-3.5 h-3.5" />}
                >
                  Manage billing
                </Button>
              )}
              <button
                onClick={() => onNavigate('billing')}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors"
              >
                View all plans
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
