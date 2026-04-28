import { useState, useEffect, useCallback } from 'react';
import { Tag, Save, Loader2, RefreshCw, ChevronDown, Star, GripVertical } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { adminToast } from './AdminLayout';
import { getAdminConfig, putAdminConfig, type AdminPlanConfig } from '../api/admin';
import defaults from '../config/defaults';

function planFromDefaults(p: typeof defaults.plans[number]): AdminPlanConfig {
  return {
    code: p.code,
    name: p.name,
    price: p.price,
    period: p.period,
    tagline: p.tagline,
    cta: p.cta,
    recommended: p.recommended,
    enabled: true,
    limits: { ...p.limits },
  };
}

const INITIAL: AdminPlanConfig[] = defaults.plans.map(planFromDefaults);

export function PricingPlansPage() {
  const [plans, setPlans] = useState<AdminPlanConfig[]>(INITIAL);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAdminConfig<AdminPlanConfig[]>('plans');
      if (res.value && Array.isArray(res.value) && res.value.length > 0) {
        setPlans(res.value);
      }
      setLastSaved(res.updated_at);
    } catch {
      adminToast('Failed to load pricing plans', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const updatePlan = (idx: number, patch: Partial<AdminPlanConfig>) => {
    setPlans((prev) => prev.map((p, i) => i === idx ? { ...p, ...patch } : p));
    setDirty(true);
  };

  const updateLimits = (idx: number, patch: Partial<AdminPlanConfig['limits']>) => {
    setPlans((prev) => prev.map((p, i) => i === idx ? { ...p, limits: { ...p.limits, ...patch } } : p));
    setDirty(true);
  };

  const setRecommended = (idx: number) => {
    setPlans((prev) => prev.map((p, i) => ({ ...p, recommended: i === idx })));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await putAdminConfig('plans', plans);
      setDirty(false);
      setLastSaved(new Date().toISOString());
      adminToast('Pricing plans saved', 'success');
    } catch {
      adminToast('Failed to save pricing plans', 'error');
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setPlans(INITIAL);
    setDirty(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gray-900 flex items-center justify-center">
            <Tag className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Pricing Plans</h1>
            <p className="text-xs text-gray-400 font-medium">Content</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={reset} disabled={saving}>
            <RefreshCw className="w-3.5 h-3.5" />
            Reset to defaults
          </Button>
          <Button size="sm" onClick={save} loading={saving} disabled={!dirty} icon={<Save className="w-3.5 h-3.5" />}>
            Save changes
          </Button>
        </div>
      </div>

      {lastSaved && (
        <p className="text-xs text-gray-400 -mt-3">
          Last saved: {new Date(lastSaved).toLocaleString()}
        </p>
      )}

      {/* Plans */}
      <div className="flex flex-col gap-4">
        {plans.map((plan, idx) => {
          const expanded = expandedIdx === idx;
          return (
            <Card key={plan.code} padding={false}>
              {/* Plan header row */}
              <button
                onClick={() => setExpandedIdx(expanded ? null : idx)}
                className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-gray-50 transition-colors rounded-xl"
              >
                <GripVertical className="w-4 h-4 text-gray-300 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">{plan.name}</span>
                    <span className="text-xs text-gray-400 font-mono">{plan.code}</span>
                    {plan.recommended && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                        <Star className="w-2.5 h-2.5" />
                        RECOMMENDED
                      </span>
                    )}
                    {!plan.enabled && (
                      <span className="text-[10px] font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                        DISABLED
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{plan.price} {plan.period} -- {plan.tagline}</p>
                </div>
                <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`} />
              </button>

              {/* Expanded content */}
              {expanded && (
                <div className="px-5 pb-5 pt-1 border-t border-gray-100 space-y-5">
                  {/* Display */}
                  <div>
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Display</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Input
                        label="Plan Name"
                        value={plan.name}
                        onChange={(e) => updatePlan(idx, { name: e.target.value })}
                      />
                      <Input
                        label="Tagline"
                        value={plan.tagline}
                        onChange={(e) => updatePlan(idx, { tagline: e.target.value })}
                      />
                      <Input
                        label="CTA Button Text"
                        value={plan.cta}
                        onChange={(e) => updatePlan(idx, { cta: e.target.value })}
                      />
                      <div className="flex items-end gap-3">
                        <div className="flex-1">
                          <Input
                            label="Price"
                            value={plan.price}
                            onChange={(e) => updatePlan(idx, { price: e.target.value })}
                          />
                        </div>
                        <div className="flex-1">
                          <label className="text-sm font-medium text-gray-700 block mb-1">Period</label>
                          <select
                            value={plan.period}
                            onChange={(e) => updatePlan(idx, { period: e.target.value })}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          >
                            <option value="forever">forever</option>
                            <option value="/month">/month</option>
                            <option value="/year">/year</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Limits */}
                  <div>
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Limits</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <Input
                        label="Max Active Sessions"
                        type="number"
                        min={1}
                        value={plan.limits.maxActiveSessions}
                        onChange={(e) => updateLimits(idx, { maxActiveSessions: parseInt(e.target.value) || 1 })}
                      />
                      <Input
                        label="Max Projects"
                        type="number"
                        min={1}
                        value={plan.limits.maxProjects}
                        onChange={(e) => updateLimits(idx, { maxProjects: parseInt(e.target.value) || 1 })}
                      />
                      <Input
                        label="Max Quizzes per Project"
                        type="number"
                        min={1}
                        value={plan.limits.maxQuizzesPerProject}
                        onChange={(e) => updateLimits(idx, { maxQuizzesPerProject: parseInt(e.target.value) || 1 })}
                      />
                    </div>
                  </div>

                  {/* Toggles */}
                  <div>
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Options</h3>
                    <div className="flex flex-wrap gap-x-8 gap-y-3">
                      <ToggleField
                        label="Enabled"
                        hint="Show this plan to users"
                        checked={plan.enabled}
                        onChange={(v) => updatePlan(idx, { enabled: v })}
                      />
                      <ToggleField
                        label="Recommended"
                        hint="Highlight as 'Most popular'"
                        checked={plan.recommended}
                        onChange={(v) => { if (v) setRecommended(idx); }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function ToggleField({ label, hint, checked, onChange }: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-gray-200'}`}
      >
        <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
      </button>
      <div>
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <span className="text-xs text-gray-400 ml-1.5">{hint}</span>
      </div>
    </label>
  );
}
