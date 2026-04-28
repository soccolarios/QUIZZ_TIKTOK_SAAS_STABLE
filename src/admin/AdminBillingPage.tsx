import { useState, useEffect, useCallback } from 'react';
import {
  CreditCard,
  Search,
  Shield,
  ShieldOff,
  Crown,
  Star,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  AlertCircle,
  Check,
  RefreshCw,
} from 'lucide-react';
import { adminBillingApi, type AdminSubscription } from '../api/admin';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Spinner } from '../components/ui/Spinner';
import { toast } from '../components/layout/DashboardLayout';
import { ApiError } from '../api/client';

const PLAN_BADGE: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
  free:    { bg: 'bg-gray-100', text: 'text-gray-600', icon: <Zap className="w-3 h-3" /> },
  pro:     { bg: 'bg-blue-50',  text: 'text-blue-700', icon: <Star className="w-3 h-3" /> },
  premium: { bg: 'bg-amber-50', text: 'text-amber-700', icon: <Crown className="w-3 h-3" /> },
};

function PlanBadge({ code }: { code: string }) {
  const style = PLAN_BADGE[code] || PLAN_BADGE.free;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${style.bg} ${style.text}`}>
      {style.icon}
      {code}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
    active: 'success',
    trialing: 'success',
    past_due: 'error',
    canceled: 'default',
    suspended: 'error',
  };
  return <Badge variant={map[status] || 'default'}>{status}</Badge>;
}

function fmtDate(s: string | null): string {
  if (!s) return '--';
  return new Date(s).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Override modal
// ---------------------------------------------------------------------------

interface OverrideModalProps {
  open: boolean;
  sub: AdminSubscription | null;
  onClose: () => void;
  onSaved: (updated: AdminSubscription) => void;
}

function OverrideModal({ open, sub, onClose, onSaved }: OverrideModalProps) {
  const [planCode, setPlanCode] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && sub) {
      setPlanCode(sub.admin_override_plan_code);
      setReason('');
    }
  }, [open, sub]);

  const handleSave = async () => {
    if (!sub) return;
    if (!reason.trim()) { toast('Reason is required', 'error'); return; }
    setSaving(true);
    try {
      const updated = await adminBillingApi.setOverride(sub.user_id, planCode, reason.trim());
      onSaved(updated);
      onClose();
      toast(planCode ? `Plan override set to ${planCode}` : 'Override cleared', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to set override', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Plan Override" size="md">
      <div className="flex flex-col gap-4">
        {sub && (
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span className="font-medium">{sub.email}</span>
            <span className="text-gray-300">|</span>
            <span>Stripe plan: <PlanBadge code={sub.plan_code} /></span>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Override Plan</label>
          <div className="grid grid-cols-4 gap-2">
            {[
              { value: null, label: 'None (Stripe)', hint: 'Use Stripe subscription' },
              { value: 'free', label: 'Free', hint: 'Force free tier' },
              { value: 'pro', label: 'Pro', hint: 'Comp Pro access' },
              { value: 'premium', label: 'Premium', hint: 'Comp Premium access' },
            ].map((opt) => (
              <button
                key={String(opt.value)}
                onClick={() => setPlanCode(opt.value)}
                className={`flex flex-col items-center gap-1 px-3 py-2.5 rounded-xl border text-center transition-all ${
                  planCode === opt.value
                    ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <span className={`text-xs font-semibold ${planCode === opt.value ? 'text-blue-700' : 'text-gray-700'}`}>
                  {opt.label}
                </span>
                <span className="text-[10px] text-gray-400 leading-tight">{opt.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <Input
          label="Reason (required)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Partner comp, contest winner, support escalation..."
          autoFocus
        />

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} loading={saving}>
            {planCode === null ? 'Clear Override' : 'Apply Override'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Suspend modal
// ---------------------------------------------------------------------------

interface SuspendModalProps {
  open: boolean;
  sub: AdminSubscription | null;
  onClose: () => void;
  onSaved: (updated: AdminSubscription) => void;
}

function SuspendModal({ open, sub, onClose, onSaved }: SuspendModalProps) {
  const isSuspended = !!sub?.suspended_at;
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  const handleSave = async () => {
    if (!sub) return;
    const newSuspended = !isSuspended;
    if (newSuspended && !reason.trim()) { toast('Reason is required', 'error'); return; }
    setSaving(true);
    try {
      const updated = await adminBillingApi.setSuspended(sub.user_id, newSuspended, reason.trim());
      onSaved(updated);
      onClose();
      toast(newSuspended ? 'Account suspended' : 'Account unsuspended', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to update suspension', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={isSuspended ? 'Unsuspend Account' : 'Suspend Account'} size="md">
      <div className="flex flex-col gap-4">
        {sub && (
          <div className="text-sm text-gray-600">
            <span className="font-medium">{sub.email}</span>
          </div>
        )}

        {isSuspended ? (
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
            <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-emerald-800">This account is currently suspended</p>
              <p className="text-xs text-emerald-700 mt-0.5">Reason: {sub?.suspension_reason || 'No reason given'}</p>
              <p className="text-xs text-emerald-600 mt-0.5">Since: {fmtDate(sub?.suspended_at ?? null)}</p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-red-50 border border-red-200">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">
              Suspending will immediately restrict this user to free-tier access.
              All paid features will be disabled until the suspension is lifted.
            </p>
          </div>
        )}

        {!isSuspended && (
          <Input
            label="Reason (required)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. TOS violation, payment fraud..."
            autoFocus
          />
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          {isSuspended ? (
            <Button onClick={handleSave} loading={saving}>Unsuspend</Button>
          ) : (
            <Button onClick={handleSave} loading={saving} className="bg-red-600 hover:bg-red-500 text-white">
              Suspend Account
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function AdminBillingPage() {
  const [subs, setSubs] = useState<AdminSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [overrideTarget, setOverrideTarget] = useState<AdminSubscription | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<AdminSubscription | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSubs(await adminBillingApi.listSubscriptions());
    } catch {
      toast('Failed to load subscriptions', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleUpdated = (updated: AdminSubscription) => {
    setSubs((prev) => prev.map((s) => (s.user_id === updated.user_id ? { ...s, ...updated } : s)));
  };

  const filtered = search.trim()
    ? subs.filter((s) =>
        s.email.toLowerCase().includes(search.toLowerCase()) ||
        s.effective_plan.includes(search.toLowerCase()) ||
        s.status.includes(search.toLowerCase())
      )
    : subs;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">Subscription Management</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Manage user plans, overrides, and suspensions. Changes take effect immediately.
          </p>
        </div>
        <Button variant="secondary" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={load}>
          Refresh
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by email, plan, or status..."
          className="w-full pl-9 pr-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-500 text-sm">
          {search ? 'No subscriptions match your search.' : 'No subscriptions found.'}
        </div>
      ) : (
        <div className="rounded-xl border border-gray-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-800/50 text-gray-400 text-xs uppercase tracking-wide">
                  <th className="px-4 py-3 text-left font-semibold">User</th>
                  <th className="px-3 py-3 text-left font-semibold">Stripe Plan</th>
                  <th className="px-3 py-3 text-left font-semibold">Effective</th>
                  <th className="px-3 py-3 text-left font-semibold">Status</th>
                  <th className="px-3 py-3 text-left font-semibold">Override</th>
                  <th className="px-3 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {filtered.map((sub) => {
                  const isSuspended = !!sub.suspended_at;
                  const hasOverride = !!sub.admin_override_plan_code;
                  return (
                    <tr
                      key={sub.user_id}
                      className={`transition-colors ${
                        isSuspended ? 'bg-red-950/20' : 'hover:bg-gray-800/30'
                      }`}
                    >
                      <td className="px-4 py-3">
                        <p className="text-gray-200 font-medium truncate max-w-[200px]">{sub.email}</p>
                        <p className="text-[11px] text-gray-500 mt-0.5 font-mono truncate max-w-[200px]">
                          {sub.user_id.slice(0, 8)}...
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <PlanBadge code={sub.plan_code} />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1.5">
                          <PlanBadge code={sub.effective_plan} />
                          {sub.effective_plan !== sub.plan_code && (
                            hasOverride
                              ? <ArrowUpRight className="w-3 h-3 text-amber-400" />
                              : <ArrowDownRight className="w-3 h-3 text-red-400" />
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge status={isSuspended ? 'suspended' : sub.status} />
                      </td>
                      <td className="px-3 py-3">
                        {hasOverride ? (
                          <div>
                            <span className="text-xs text-amber-400 font-medium">{sub.admin_override_plan_code}</span>
                            {sub.admin_override_reason && (
                              <p className="text-[10px] text-gray-500 mt-0.5 truncate max-w-[150px]">
                                {sub.admin_override_reason}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-600">--</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setOverrideTarget(sub)}
                            className="px-2 py-1 rounded-md text-xs font-medium text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
                            title="Set plan override"
                          >
                            <CreditCard className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setSuspendTarget(sub)}
                            className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                              isSuspended
                                ? 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-900/30'
                                : 'text-gray-400 hover:text-red-400 hover:bg-red-900/30'
                            }`}
                            title={isSuspended ? 'Unsuspend' : 'Suspend'}
                          >
                            {isSuspended
                              ? <Shield className="w-3.5 h-3.5" />
                              : <ShieldOff className="w-3.5 h-3.5" />
                            }
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <OverrideModal
        open={!!overrideTarget}
        sub={overrideTarget}
        onClose={() => setOverrideTarget(null)}
        onSaved={handleUpdated}
      />

      <SuspendModal
        open={!!suspendTarget}
        sub={suspendTarget}
        onClose={() => setSuspendTarget(null)}
        onSaved={handleUpdated}
      />
    </div>
  );
}
