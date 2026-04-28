import { useState, useEffect, useCallback } from 'react';
import { Key, Save, Loader2, RefreshCw, Eye, EyeOff, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { adminToast } from './AdminLayout';
import {
  getAdminConfig,
  putAdminConfig,
  type ApiKeysConfig,
} from '../api/admin';
import { ApiError } from '../api/client';

const EMPTY_CONFIG: ApiKeysConfig = {
  openai_api_key: '',
  elevenlabs_api_key: '',
  azure_tts_key: '',
  tiktok_api_key: '',
};

interface KeyDef {
  field: keyof ApiKeysConfig;
  label: string;
  placeholder: string;
  description: string;
  status: 'active' | 'placeholder';
}

const KEY_DEFS: KeyDef[] = [
  {
    field: 'openai_api_key',
    label: 'OpenAI API Key',
    placeholder: 'sk-...',
    description: 'Used for AI quiz generation. Required for the AI Generator feature.',
    status: 'active',
  },
  {
    field: 'elevenlabs_api_key',
    label: 'ElevenLabs API Key',
    placeholder: 'Your ElevenLabs API key',
    description: 'Used for text-to-speech voice generation during live sessions.',
    status: 'active',
  },
  {
    field: 'azure_tts_key',
    label: 'Azure TTS Key',
    placeholder: 'Your Azure Cognitive Services key',
    description: 'Alternative TTS provider. Used when ElevenLabs is not configured.',
    status: 'active',
  },
  {
    field: 'tiktok_api_key',
    label: 'TikTok API Key',
    placeholder: 'Your TikTok API key',
    description: 'Reserved for future TikTok API integration. Not currently used.',
    status: 'placeholder',
  },
];

export function ApiKeysPage() {
  const [config, setConfig] = useState<ApiKeysConfig>(EMPTY_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [secretsMasked, setSecretsMasked] = useState(false);

  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [newValues, setNewValues] = useState<Record<string, string>>({});
  const [showValues, setShowValues] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAdminConfig<ApiKeysConfig & { _secrets_masked?: boolean }>('api_keys');
      if (res.value) {
        setConfig({ ...EMPTY_CONFIG, ...res.value });
        setSecretsMasked(!!res.value._secrets_masked);
      }
      if (res.updated_at) setLastSaved(res.updated_at);
      setEditing({});
      setNewValues({});
    } catch {
      adminToast('Failed to load API keys config', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, string> = { ...config };
      for (const def of KEY_DEFS) {
        if (editing[def.field]) {
          payload[def.field] = newValues[def.field] || '';
        }
      }
      await putAdminConfig('api_keys', payload);
      setDirty(false);
      setLastSaved(new Date().toISOString());
      adminToast('API keys saved', 'success');
      load();
    } catch (err) {
      adminToast(err instanceof ApiError ? err.message : 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const startEditing = (field: string) => {
    setEditing((prev) => ({ ...prev, [field]: true }));
    setNewValues((prev) => ({ ...prev, [field]: '' }));
    setDirty(true);
  };

  const cancelEditing = (field: string) => {
    setEditing((prev) => ({ ...prev, [field]: false }));
    setNewValues((prev) => ({ ...prev, [field]: '' }));
  };

  const handleFieldChange = (field: keyof ApiKeysConfig, value: string) => {
    if (secretsMasked && !editing[field]) return;
    if (editing[field]) {
      setNewValues((prev) => ({ ...prev, [field]: value }));
    } else {
      setConfig((prev) => ({ ...prev, [field]: value }));
    }
    setDirty(true);
  };

  const configuredCount = KEY_DEFS.filter(
    (d) => d.status === 'active' && config[d.field] && config[d.field] !== '',
  ).length;
  const activeCount = KEY_DEFS.filter((d) => d.status === 'active').length;

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">API Keys</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Manage third-party API keys used by the platform for AI generation, text-to-speech, and integrations.
          </p>
        </div>
        <Button variant="secondary" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={load}>
          Reload
        </Button>
      </div>

      {/* Status */}
      <div className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border ${
        configuredCount === activeCount
          ? 'bg-emerald-950/30 border-emerald-800/50'
          : 'bg-amber-950/30 border-amber-800/50'
      }`}>
        {configuredCount === activeCount ? (
          <>
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span className="text-sm text-emerald-300">All {activeCount} active API keys are configured.</span>
          </>
        ) : (
          <>
            <XCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span className="text-sm text-amber-300">{configuredCount} of {activeCount} active API keys configured.</span>
          </>
        )}
      </div>

      {secretsMasked && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-blue-950/30 border border-blue-800/40">
          <AlertTriangle className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-blue-300">Secrets are masked for security. Click "Change" to set a new value.</p>
        </div>
      )}

      {/* Key cards */}
      {KEY_DEFS.map((def) => {
        const hasValue = !!(config[def.field] && config[def.field] !== '');
        const isEditing = editing[def.field];

        return (
          <Card key={def.field}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-gray-400" />
                <div>
                  <h2 className="text-sm font-semibold text-white">{def.label}</h2>
                  <p className="text-xs text-gray-500 mt-0.5">{def.description}</p>
                </div>
              </div>
              {def.status === 'placeholder' && (
                <span className="px-2 py-0.5 text-[10px] font-medium rounded-md bg-gray-800 text-gray-500 border border-gray-700 uppercase tracking-wide">
                  Placeholder
                </span>
              )}
            </div>

            {isEditing ? (
              <div className="flex gap-2 items-start">
                <div className="flex-1 relative">
                  <Input
                    type={showValues[def.field] ? 'text' : 'password'}
                    value={newValues[def.field] || ''}
                    onChange={(e) => handleFieldChange(def.field, e.target.value)}
                    placeholder={def.placeholder}
                    autoComplete="off"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowValues((prev) => ({ ...prev, [def.field]: !prev[def.field] }))}
                    className="absolute right-3 top-[10px] text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    {showValues[def.field] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <button
                  onClick={() => cancelEditing(def.field)}
                  className="text-xs text-gray-500 hover:text-gray-300 px-2 pt-2.5"
                >
                  Cancel
                </button>
              </div>
            ) : secretsMasked && hasValue ? (
              <div className="flex items-center justify-between gap-2">
                <div className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-400 font-mono flex-1">
                  {config[def.field]}
                </div>
                <button
                  onClick={() => startEditing(def.field)}
                  className="text-xs text-blue-400 hover:text-blue-300 px-2 flex-shrink-0"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="relative">
                <Input
                  type={showValues[def.field] ? 'text' : 'password'}
                  value={config[def.field]}
                  onChange={(e) => handleFieldChange(def.field, e.target.value)}
                  placeholder={def.placeholder}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowValues((prev) => ({ ...prev, [def.field]: !prev[def.field] }))}
                  className="absolute right-3 top-[10px] text-gray-500 hover:text-gray-300 transition-colors"
                >
                  {showValues[def.field] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            )}
          </Card>
        );
      })}

      {/* Save */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-500">
          {lastSaved && `Last saved ${new Date(lastSaved).toLocaleString()}`}
        </div>
        <Button onClick={handleSave} loading={saving} disabled={!dirty} icon={<Save className="w-3.5 h-3.5" />}>
          Save API Keys
        </Button>
      </div>

      {/* Compatibility note */}
      <Card>
        <h2 className="text-sm font-semibold text-white mb-3">Compatibility</h2>
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
            <span><strong className="text-gray-300">Mailjet</strong> keys are managed in the dedicated Mailjet configuration page.</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
            <span><strong className="text-gray-300">Stripe</strong> keys are configured via environment variables on the server.</span>
          </div>
        </div>
      </Card>
    </div>
  );
}
