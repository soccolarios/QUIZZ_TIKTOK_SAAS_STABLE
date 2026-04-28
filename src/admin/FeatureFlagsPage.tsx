import { useState, useEffect, useCallback } from 'react';
import { ToggleLeft, Save, Loader2, RefreshCw, Plus, Trash2 } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { adminToast } from './AdminLayout';
import { getAdminConfig, putAdminConfig, type FeatureFlagsConfig } from '../api/admin';

interface FlagMeta {
  key: string;
  label: string;
  description: string;
  builtin: boolean;
}

const BUILTIN_FLAGS: FlagMeta[] = [
  { key: 'x2Enabled', label: 'X2 Bonus Mechanic', description: 'Double-score bonus round during live sessions', builtin: true },
  { key: 'ttsEnabled', label: 'TTS Voice Narration', description: 'Questions read aloud with text-to-speech during live sessions', builtin: true },
  { key: 'aiGeneratorEnabled', label: 'AI Quiz Generator', description: 'Allow users to generate quizzes using AI', builtin: true },
  { key: 'analyticsEnabled', label: 'Session Analytics', description: 'Detailed stats and charts for session history', builtin: true },
  { key: 'customBrandingEnabled', label: 'Custom Branding', description: 'Allow Pro/Premium users to customize overlay branding', builtin: true },
  { key: 'musicEnabled', label: 'Background Music', description: 'Enable background music selection during session launch', builtin: true },
  { key: 'emailEnabled', label: 'Transactional Emails', description: 'Send emails for auth, billing, and admin events via Mailjet', builtin: true },
];

const INITIAL: FeatureFlagsConfig = {
  x2Enabled: true,
  ttsEnabled: true,
  aiGeneratorEnabled: true,
  analyticsEnabled: true,
  customBrandingEnabled: false,
  musicEnabled: true,
  emailEnabled: true,
};

export function FeatureFlagsPage() {
  const [flags, setFlags] = useState<FeatureFlagsConfig>(INITIAL);
  const [customFlags, setCustomFlags] = useState<FlagMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAdminConfig<{ flags: FeatureFlagsConfig; custom: FlagMeta[] }>('feature_flags');
      if (res.value) {
        if (res.value.flags) setFlags({ ...INITIAL, ...res.value.flags });
        if (res.value.custom) setCustomFlags(res.value.custom);
      }
      setLastSaved(res.updated_at);
    } catch {
      adminToast('Failed to load feature flags', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = (key: string) => {
    setFlags((prev) => ({ ...prev, [key]: !prev[key] }));
    setDirty(true);
  };

  const addCustomFlag = () => {
    const safeKey = newKey.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
    if (!safeKey || !newLabel.trim()) return;
    if (flags[safeKey] !== undefined) {
      adminToast('Flag key already exists', 'error');
      return;
    }
    setFlags((prev) => ({ ...prev, [safeKey]: false }));
    setCustomFlags((prev) => [...prev, { key: safeKey, label: newLabel.trim(), description: '', builtin: false }]);
    setNewKey('');
    setNewLabel('');
    setAddingNew(false);
    setDirty(true);
  };

  const removeCustomFlag = (key: string) => {
    setFlags((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setCustomFlags((prev) => prev.filter((f) => f.key !== key));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await putAdminConfig('feature_flags', { flags, custom: customFlags });
      setDirty(false);
      setLastSaved(new Date().toISOString());
      adminToast('Feature flags saved', 'success');
    } catch {
      adminToast('Failed to save feature flags', 'error');
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setFlags(INITIAL);
    setCustomFlags([]);
    setDirty(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
      </div>
    );
  }

  const allFlags: FlagMeta[] = [
    ...BUILTIN_FLAGS,
    ...customFlags.filter((cf) => !BUILTIN_FLAGS.some((bf) => bf.key === cf.key)),
  ];

  const enabledCount = allFlags.filter((f) => flags[f.key]).length;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gray-900 flex items-center justify-center">
            <ToggleLeft className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Feature Flags</h1>
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

      {/* Summary bar */}
      <div className="flex items-center gap-4 px-4 py-3 rounded-xl bg-gray-50 border border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400" />
          <span className="text-xs font-medium text-gray-600">{enabledCount} enabled</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-gray-300" />
          <span className="text-xs font-medium text-gray-600">{allFlags.length - enabledCount} disabled</span>
        </div>
        <span className="text-xs text-gray-400 ml-auto">{allFlags.length} total flags</span>
      </div>

      {/* Core flags */}
      <Card>
        <h2 className="text-sm font-semibold text-gray-800 mb-1">Core Platform Flags</h2>
        <p className="text-xs text-gray-400 mb-4">These flags control major platform features globally.</p>
        <div className="divide-y divide-gray-100">
          {BUILTIN_FLAGS.map((meta) => (
            <FlagRow
              key={meta.key}
              meta={meta}
              enabled={!!flags[meta.key]}
              onToggle={() => toggle(meta.key)}
            />
          ))}
        </div>
      </Card>

      {/* Custom flags */}
      <Card>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-gray-800">Custom Flags</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAddingNew(true)}
            disabled={addingNew}
            icon={<Plus className="w-3.5 h-3.5" />}
          >
            Add flag
          </Button>
        </div>
        <p className="text-xs text-gray-400 mb-4">Add custom feature flags for future capabilities.</p>

        {addingNew && (
          <div className="flex items-end gap-3 mb-4 p-3 rounded-lg bg-gray-50 border border-gray-100">
            <div className="flex-1">
              <Input
                label="Flag Key"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="e.g. betaReports"
                hint="camelCase, no spaces"
              />
            </div>
            <div className="flex-1">
              <Input
                label="Label"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. Beta Reports"
              />
            </div>
            <div className="flex gap-2 pb-0.5">
              <Button size="sm" onClick={addCustomFlag} disabled={!newKey.trim() || !newLabel.trim()}>Add</Button>
              <Button variant="ghost" size="sm" onClick={() => { setAddingNew(false); setNewKey(''); setNewLabel(''); }}>Cancel</Button>
            </div>
          </div>
        )}

        {customFlags.length === 0 && !addingNew ? (
          <div className="text-center py-8 text-xs text-gray-400">
            No custom flags yet. Click "Add flag" to create one.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {customFlags.map((meta) => (
              <FlagRow
                key={meta.key}
                meta={meta}
                enabled={!!flags[meta.key]}
                onToggle={() => toggle(meta.key)}
                onRemove={() => removeCustomFlag(meta.key)}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function FlagRow({ meta, enabled, onToggle, onRemove }: {
  meta: FlagMeta;
  enabled: boolean;
  onToggle: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="flex items-center gap-4 py-3.5">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={onToggle}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${enabled ? 'bg-emerald-500' : 'bg-gray-200'}`}
      >
        <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-800">{meta.label}</span>
          <span className="text-[10px] font-mono text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">{meta.key}</span>
          {meta.builtin && (
            <span className="text-[10px] font-semibold text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded">CORE</span>
          )}
        </div>
        {meta.description && (
          <p className="text-xs text-gray-400 mt-0.5">{meta.description}</p>
        )}
      </div>
      {onRemove && (
        <button
          onClick={onRemove}
          className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
          title="Remove flag"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
