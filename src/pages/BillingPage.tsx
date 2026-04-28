import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Check,
  Minus,
  Zap,
  Star,
  Crown,
  ExternalLink,
  AlertCircle,
  ChevronRight,
  Layers,
  Cpu,
  Mic,
  RadioTower,
  HeartHandshake,
  Loader2,
} from 'lucide-react';
import { billingApi, type Subscription } from '../api/billing';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import { toast } from '../components/layout/DashboardLayout';
import { ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { usePlans, useFeatureGroups } from '../context/PublicConfigContext';
import type { PlanConfig, FeatureGroup as CfgFeatureGroup } from '../config/types';

// ---------------------------------------------------------------------------
// Plan accent styling (visual only -- not business data)
// ---------------------------------------------------------------------------

interface PlanAccent {
  accentBorder: string;
  accentBg: string;
  accentText: string;
  iconBg: string;
  icon: React.ReactNode;
}

const ACCENT_MAP: Record<string, PlanAccent> = {
  free: {
    accentBorder: 'border-gray-200',
    accentBg: 'bg-gray-50',
    accentText: 'text-gray-600',
    iconBg: 'bg-gray-100',
    icon: <Zap className="w-4 h-4 text-gray-500" />,
  },
  pro: {
    accentBorder: 'border-blue-400',
    accentBg: 'bg-blue-600',
    accentText: 'text-blue-600',
    iconBg: 'bg-blue-50',
    icon: <Star className="w-4 h-4 text-blue-600" />,
  },
  premium: {
    accentBorder: 'border-amber-400',
    accentBg: 'bg-amber-500',
    accentText: 'text-amber-600',
    iconBg: 'bg-amber-50',
    icon: <Crown className="w-4 h-4 text-amber-500" />,
  },
};

const DEFAULT_ACCENT: PlanAccent = ACCENT_MAP.free;

function getAccent(code: string): PlanAccent {
  return ACCENT_MAP[code] ?? DEFAULT_ACCENT;
}

// ---------------------------------------------------------------------------
// Icon map for feature groups
// ---------------------------------------------------------------------------

const GROUP_ICON_MAP: Record<string, React.ReactNode> = {
  Layers:        <Layers className="w-3.5 h-3.5" />,
  RadioTower:    <RadioTower className="w-3.5 h-3.5" />,
  Cpu:           <Cpu className="w-3.5 h-3.5" />,
  Mic:           <Mic className="w-3.5 h-3.5" />,
  HeartHandshake:<HeartHandshake className="w-3.5 h-3.5" />,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function planRank(code: string, plans: PlanConfig[]): number {
  return plans.findIndex((p) => p.code === code);
}

function planBadgeVariant(status: string): 'success' | 'warning' | 'error' | 'info' | 'default' {
  switch (status) {
    case 'active':   return 'success';
    case 'trialing': return 'info';
    case 'past_due': return 'error';
    case 'canceled': return 'default';
    default:         return 'default';
  }
}

function formatDate(s: string | null): string {
  if (!s) return '';
  return new Date(s).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function buildHighlights(plan: PlanConfig): string[] {
  const l = plan.limits;
  const highlights: string[] = [
    `${l.maxProjects} project${l.maxProjects !== 1 ? 's' : ''} \u00b7 ${l.maxQuizzesPerProject} quizzes`,
    `${l.maxActiveSessions} active session${l.maxActiveSessions !== 1 ? 's' : ''}`,
  ];
  const extras: string[] = [];
  if (plan.flags.aiEnabled) extras.push('AI');
  if (plan.flags.ttsEnabled) extras.push('TTS');
  if (plan.flags.musicEnabled) extras.push('Music');
  if (plan.flags.x2Enabled) extras.push('X2');
  if (extras.length > 0) {
    highlights.push(extras.join(' \u00b7 '));
  } else {
    highlights.push('Simulation & live mode');
  }
  return highlights;
}

// ---------------------------------------------------------------------------
// Cell renderer
// ---------------------------------------------------------------------------

type CellValue = string | boolean;

function Cell({ value, planCode, currentPlan, plans }: { value: CellValue; planCode: string; currentPlan: string; plans: PlanConfig[] }) {
  const accent = getAccent(planCode);
  const isCurrent = planCode === currentPlan;
  const userRank  = planRank(currentPlan, plans);
  const cellRank  = planRank(planCode, plans);
  const isUpgrade = cellRank > userRank;

  if (value === false) {
    return <Minus className="w-4 h-4 text-gray-300 mx-auto" />;
  }
  if (value === true) {
    const checkColor = isCurrent
      ? 'text-gray-400'
      : isUpgrade
      ? accent.accentText
      : 'text-gray-400';
    return <Check className={`w-4 h-4 mx-auto ${checkColor}`} />;
  }
  return (
    <span className={`text-sm font-semibold tabular-nums ${
      isCurrent ? 'text-gray-700' : isUpgrade ? accent.accentText : 'text-gray-500'
    }`}>
      {value}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Upgrade action button
// ---------------------------------------------------------------------------

interface UpgradeBtnProps {
  plan: PlanConfig;
  currentPlan: string;
  plans: PlanConfig[];
  loading: boolean;
  onUpgrade: (code: string) => void;
}

function UpgradeBtn({ plan, currentPlan, plans, loading, onUpgrade }: UpgradeBtnProps) {
  const rank    = planRank(plan.code, plans);
  const curRank = planRank(currentPlan, plans);
  const isCurrent  = plan.code === currentPlan;
  const isUpgrade  = rank > curRank;
  const isDowngrade = rank < curRank;

  if (isCurrent) {
    return (
      <div className="w-full text-center py-2.5 px-4 rounded-xl text-sm font-medium text-gray-400 bg-gray-50 border border-gray-200 cursor-default select-none">
        Your current plan
      </div>
    );
  }

  if (isDowngrade) {
    return (
      <button
        onClick={() => onUpgrade(plan.code)}
        disabled={loading}
        className="w-full text-center py-2.5 px-4 rounded-xl text-sm font-medium text-gray-400 border border-gray-200 hover:border-gray-300 hover:text-gray-600 transition-colors disabled:opacity-40"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : `Switch to ${plan.name}`}
      </button>
    );
  }

  const isRecommended = plan.recommended;
  return (
    <button
      onClick={() => onUpgrade(plan.code)}
      disabled={loading}
      className={`w-full flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
        isRecommended
          ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-sm hover:shadow-md'
          : isUpgrade
          ? 'bg-amber-500 hover:bg-amber-400 text-white shadow-sm hover:shadow-md'
          : 'border border-gray-200 hover:bg-gray-50 text-gray-700'
      }`}
    >
      {loading
        ? <Loader2 className="w-4 h-4 animate-spin" />
        : <>Upgrade to {plan.name} <ChevronRight className="w-3.5 h-3.5" /></>
      }
    </button>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function BillingPage() {
  const { refreshUser } = useAuth();
  const { plans } = usePlans();
  const cfgFeatureGroups = useFeatureGroups();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [portalLoading,  setPortalLoading]  = useState(false);

  const planCodes = useMemo(() => plans.map((p) => p.code), [plans]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSubscription(await billingApi.getSubscription());
    } catch {
      toast('Failed to load subscription', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('billing') === 'success') {
      window.history.replaceState({}, '', window.location.pathname);
      toast('Payment successful! Your plan has been upgraded.', 'success');
      Promise.all([load(), refreshUser()]);
    } else {
      load();
    }
  }, [load, refreshUser]);

  const handleUpgrade = async (planCode: string) => {
    setCheckoutLoading(planCode);
    try {
      const { checkout_url } = await billingApi.createCheckout(planCode);
      window.location.href = checkout_url;
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to start checkout', 'error');
      setCheckoutLoading(null);
    }
  };

  const handleManageBilling = async () => {
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

  const currentPlan = subscription?.plan_code || 'free';
  const curDef = plans.find((p) => p.code === currentPlan) ?? plans[0];
  const curAccent = getAccent(currentPlan);

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Billing & Plans</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage your subscription</p>
        </div>
        <div className="flex justify-center py-16"><Spinner /></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-8">

      {/* -- Header -- */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Billing & Plans</h1>
          <p className="text-sm text-gray-500 mt-0.5">Compare plans and manage your subscription</p>
        </div>
        {subscription && currentPlan !== 'free' && (
          <Button
            variant="secondary"
            size="sm"
            icon={<ExternalLink className="w-3.5 h-3.5" />}
            onClick={handleManageBilling}
            loading={portalLoading}
          >
            Manage billing
          </Button>
        )}
      </div>

      {/* -- Cancellation warning -- */}
      {subscription?.cancel_at_period_end && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <AlertCircle className="w-4.5 h-4.5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Subscription cancellation scheduled</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Your plan reverts to Free on {formatDate(subscription.current_period_end)}. Reactivate any time from the billing portal.
            </p>
          </div>
        </div>
      )}

      {/* -- Current plan card -- */}
      {subscription && (
        <div className={`rounded-xl border-2 ${curAccent.accentBorder} bg-white p-5`}>
          <div className="flex items-start gap-4 flex-wrap">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${curAccent.iconBg}`}>
              {curAccent.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-base font-bold text-gray-900">{subscription.display_name}</span>
                <Badge variant={planBadgeVariant(subscription.status)}>{subscription.status}</Badge>
                {subscription.current_period_end && !subscription.cancel_at_period_end && (
                  <span className="text-xs text-gray-400">
                    Renews {formatDate(subscription.current_period_end)}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-1">{curDef.tagline}</p>
            </div>
            <div className="flex items-center gap-6 text-center flex-shrink-0">
              <LimitPill label="Sessions" value={subscription.limits.max_active_sessions} />
              <LimitPill label="Projects"  value={subscription.limits.max_projects} />
              <LimitPill label="Quizzes"   value={subscription.limits.max_quizzes_per_project} suffix="/project" />
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100 flex items-center gap-4 flex-wrap">
            <FeatureFlag label="X2 mechanic"    on={subscription.limits.x2_enabled} />
            <FeatureFlag label="TTS narration"  on={subscription.limits.tts_enabled} />
            <FeatureFlag label="AI generation"  on={curDef.flags.aiEnabled} />
            <FeatureFlag label="Music controls" on={curDef.flags.musicEnabled} />
          </div>
        </div>
      )}

      {/* -- Plan cards + comparison -- */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">All plans</h2>

        <div className="grid md:grid-cols-3 gap-4 mb-8">
          {plans.map(plan => {
            const accent = getAccent(plan.code);
            const isCurrent = plan.code === currentPlan;
            const isUpgrade = planRank(plan.code, plans) > planRank(currentPlan, plans);
            return (
              <div
                key={plan.code}
                className={`relative rounded-xl border-2 bg-white p-5 flex flex-col gap-4 transition-shadow ${accent.accentBorder} ${
                  plan.recommended && isUpgrade ? 'shadow-lg ring-1 ring-blue-200' : 'shadow-sm'
                }`}
              >
                {plan.recommended && isUpgrade && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap">
                    <span className="bg-blue-600 text-white text-[11px] font-bold px-3 py-1 rounded-full tracking-wide">
                      RECOMMENDED
                    </span>
                  </div>
                )}

                {isCurrent && !plan.recommended && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap">
                    <span className="bg-gray-700 text-white text-[11px] font-bold px-3 py-1 rounded-full tracking-wide">
                      CURRENT
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${accent.iconBg}`}>
                    {accent.icon}
                  </div>
                  {isCurrent && <Badge variant="info">Active</Badge>}
                </div>

                <div>
                  <p className="text-base font-bold text-gray-900">{plan.name}</p>
                  <div className="flex items-baseline gap-1 mt-0.5">
                    <span className="text-3xl font-extrabold text-gray-900 tracking-tight">{plan.price}</span>
                    <span className="text-sm text-gray-400">{plan.period}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{plan.tagline}</p>
                </div>

                <ul className="flex flex-col gap-1.5">
                  {buildHighlights(plan).map((h, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs text-gray-600">
                      <Check className={`w-3.5 h-3.5 flex-shrink-0 ${accent.accentText}`} />
                      {h}
                    </li>
                  ))}
                </ul>

                <div className="mt-auto pt-1">
                  <UpgradeBtn
                    plan={plan}
                    currentPlan={currentPlan}
                    plans={plans}
                    loading={checkoutLoading === plan.code}
                    onUpgrade={handleUpgrade}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* -- Feature comparison table -- */}
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <div className="bg-gray-50 border-b border-gray-200">
            <div className="grid grid-cols-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">
              <div className="px-4 py-3">Feature</div>
              {plans.map(plan => (
                <div
                  key={plan.code}
                  className={`px-3 py-3 text-center ${plan.code === currentPlan ? 'bg-blue-50/60 text-blue-700' : ''}`}
                >
                  {plan.name}
                  {plan.code === currentPlan && (
                    <span className="ml-1 text-[9px] bg-blue-100 text-blue-600 px-1 py-px rounded font-bold">YOU</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {cfgFeatureGroups.map((group, gi) => (
            <div key={gi}>
              <div className="flex items-center gap-2 px-4 py-2 bg-gray-50/70 border-b border-gray-100 border-t">
                <span className="text-gray-400">{GROUP_ICON_MAP[group.iconName] ?? <Layers className="w-3.5 h-3.5" />}</span>
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{group.groupLabel}</span>
              </div>

              {group.rows.map((row, ri) => (
                <div
                  key={ri}
                  className="grid grid-cols-4 items-center border-b border-gray-100 last:border-b-0 hover:bg-gray-50/50 transition-colors"
                >
                  <div className="px-4 py-2.5">
                    <span className="text-sm text-gray-700">{row.label}</span>
                    {row.hint && (
                      <p className="text-[11px] text-gray-400 mt-0.5">{row.hint}</p>
                    )}
                  </div>
                  {plans.map(plan => {
                    const cellValue = row.values[plan.code];
                    const resolved: CellValue = cellValue === undefined ? false : cellValue;
                    return (
                      <div
                        key={plan.code}
                        className={`px-3 py-2.5 text-center ${plan.code === currentPlan ? 'bg-blue-50/40' : ''}`}
                      >
                        <Cell
                          value={resolved}
                          planCode={plan.code}
                          currentPlan={currentPlan}
                          plans={plans}
                        />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* -- Footer note -- */}
      <p className="text-xs text-gray-400 text-center leading-relaxed">
        Payments processed securely by <strong className="text-gray-500">Stripe</strong>.
        Cancel any time — downgrades take effect at the end of your billing period. All prices USD, billed monthly.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LimitPill({ label, value, suffix = '' }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-xl font-bold text-gray-900 tabular-nums leading-none">
        {value}{suffix}
      </span>
      <span className="text-[11px] text-gray-400 mt-0.5">{label}</span>
    </div>
  );
}

function FeatureFlag({ label, on }: { label: string; on: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full ${
      on ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-400'
    }`}>
      {on
        ? <Check className="w-3 h-3" />
        : <Minus className="w-3 h-3" />
      }
      {label}
    </span>
  );
}
