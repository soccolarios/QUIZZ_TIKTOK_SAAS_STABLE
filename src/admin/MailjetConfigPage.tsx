import { useState, useEffect, useCallback } from 'react';
import { Mail, Save, Send, Loader2, RefreshCw, Eye, EyeOff, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { adminToast } from './AdminLayout';
import {
  getAdminConfig,
  putAdminConfig,
  adminEmailApi,
  type MailjetConfig,
} from '../api/admin';
import { ApiError } from '../api/client';

const EMPTY_CONFIG: MailjetConfig = {
  api_key: '',
  secret_key: '',
  sender_email: '',
  sender_name: '',
};

export function MailjetConfigPage() {
  const [config, setConfig] = useState<MailjetConfig>(EMPTY_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [testEmail, setTestEmail] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [secretsMasked, setSecretsMasked] = useState(false);
  const [editApiKey, setEditApiKey] = useState(false);
  const [editSecretKey, setEditSecretKey] = useState(false);
  const [newApiKey, setNewApiKey] = useState('');
  const [newSecretKey, setNewSecretKey] = useState('');
  const [showNewSecret, setShowNewSecret] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAdminConfig<MailjetConfig & { _secrets_masked?: boolean }>('mailjet');
      if (res.value) {
        setConfig({ ...EMPTY_CONFIG, ...res.value });
        setSecretsMasked(!!res.value._secrets_masked);
      }
      if (res.updated_at) setLastSaved(res.updated_at);
      setEditApiKey(false);
      setEditSecretKey(false);
      setNewApiKey('');
      setNewSecretKey('');
    } catch {
      adminToast('Failed to load Mailjet config', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleChange = (field: keyof MailjetConfig, value: string) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    if (config.sender_email && !config.sender_email.includes('@')) {
      adminToast('Sender email must be a valid email address', 'error');
      return;
    }

    setSaving(true);
    try {
      const payload: MailjetConfig = {
        ...config,
        api_key: editApiKey ? newApiKey : config.api_key,
        secret_key: editSecretKey ? newSecretKey : config.secret_key,
      };
      await putAdminConfig('mailjet', payload);
      setDirty(false);
      setLastSaved(new Date().toISOString());
      setEditApiKey(false);
      setEditSecretKey(false);
      setNewApiKey('');
      setNewSecretKey('');
      adminToast('Mailjet configuration saved', 'success');
      load();
    } catch (err) {
      adminToast(err instanceof ApiError ? err.message : 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleTestEmail = async () => {
    if (!testEmail.trim()) {
      adminToast('Enter an email address', 'error');
      return;
    }
    setTestSending(true);
    setTestResult(null);
    try {
      const res = await adminEmailApi.sendTestEmail(testEmail.trim());
      setTestResult({ ok: true, message: res.message || 'Test email sent successfully' });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to send test email';
      setTestResult({ ok: false, message: msg });
    } finally {
      setTestSending(false);
    }
  };

  const hasApiKey = !!(config.api_key && config.api_key !== '');
  const hasSecretKey = !!(config.secret_key && config.secret_key !== '');
  const isConfigured = hasApiKey && hasSecretKey && !!config.sender_email;

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
          <h1 className="text-xl font-bold text-white">Mailjet Configuration</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Configure transactional email delivery for auth, billing, and admin notifications.
          </p>
        </div>
        <Button variant="secondary" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={load}>
          Reload
        </Button>
      </div>

      {/* Status banner */}
      <div className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border ${
        isConfigured
          ? 'bg-emerald-950/30 border-emerald-800/50'
          : 'bg-amber-950/30 border-amber-800/50'
      }`}>
        {isConfigured ? (
          <>
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span className="text-sm text-emerald-300">Mailjet is configured. Transactional emails will be delivered.</span>
          </>
        ) : (
          <>
            <XCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span className="text-sm text-amber-300">Mailjet is not configured. Emails will be logged but not delivered.</span>
          </>
        )}
      </div>

      {/* API Credentials */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Mail className="w-4 h-4 text-gray-400" />
          <h2 className="text-sm font-semibold text-white">API Credentials</h2>
        </div>
        {secretsMasked && (
          <div className="flex items-start gap-2 mb-4 px-3 py-2 rounded-lg bg-blue-950/30 border border-blue-800/40">
            <AlertTriangle className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-blue-300">Secrets are masked for security. Click "Change" to set a new value.</p>
          </div>
        )}
        <div className="grid gap-4">
          {/* API Key */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-gray-400">API Key</label>
              {secretsMasked && !editApiKey && hasApiKey && (
                <button
                  onClick={() => { setEditApiKey(true); setDirty(true); }}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  Change
                </button>
              )}
            </div>
            {editApiKey ? (
              <div className="flex gap-2">
                <div className="flex-1">
                  <Input
                    value={newApiKey}
                    onChange={(e) => { setNewApiKey(e.target.value); setDirty(true); }}
                    placeholder="Enter new API key"
                    autoComplete="off"
                    autoFocus
                  />
                </div>
                <button
                  onClick={() => { setEditApiKey(false); setNewApiKey(''); }}
                  className="text-xs text-gray-500 hover:text-gray-300 px-2"
                >
                  Cancel
                </button>
              </div>
            ) : secretsMasked && hasApiKey ? (
              <div className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-400 font-mono">
                {config.api_key}
              </div>
            ) : (
              <Input
                value={config.api_key}
                onChange={(e) => handleChange('api_key', e.target.value)}
                placeholder="Your Mailjet API key"
                autoComplete="off"
              />
            )}
          </div>

          {/* Secret Key */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-gray-400">Secret Key</label>
              {secretsMasked && !editSecretKey && hasSecretKey && (
                <button
                  onClick={() => { setEditSecretKey(true); setDirty(true); }}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  Change
                </button>
              )}
            </div>
            {editSecretKey ? (
              <div className="flex gap-2 items-start">
                <div className="flex-1 relative">
                  <Input
                    type={showNewSecret ? 'text' : 'password'}
                    value={newSecretKey}
                    onChange={(e) => { setNewSecretKey(e.target.value); setDirty(true); }}
                    placeholder="Enter new secret key"
                    autoComplete="off"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewSecret(!showNewSecret)}
                    className="absolute right-3 top-[10px] text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    {showNewSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <button
                  onClick={() => { setEditSecretKey(false); setNewSecretKey(''); }}
                  className="text-xs text-gray-500 hover:text-gray-300 px-2 pt-2.5"
                >
                  Cancel
                </button>
              </div>
            ) : secretsMasked && hasSecretKey ? (
              <div className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-400 font-mono">
                {config.secret_key}
              </div>
            ) : (
              <div className="relative">
                <Input
                  type={showNewSecret ? 'text' : 'password'}
                  value={config.secret_key}
                  onChange={(e) => handleChange('secret_key', e.target.value)}
                  placeholder="Your Mailjet secret key"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowNewSecret(!showNewSecret)}
                  className="absolute right-3 top-[10px] text-gray-500 hover:text-gray-300 transition-colors"
                >
                  {showNewSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Sender Identity */}
      <Card>
        <h2 className="text-sm font-semibold text-white mb-4">Sender Identity</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Sender Email"
            type="email"
            value={config.sender_email}
            onChange={(e) => handleChange('sender_email', e.target.value)}
            placeholder="noreply@yourdomain.com"
          />
          <Input
            label="Sender Name"
            value={config.sender_name}
            onChange={(e) => handleChange('sender_name', e.target.value)}
            placeholder="LiveGine"
          />
        </div>
        {config.sender_email && !config.sender_email.includes('@') && (
          <p className="text-xs text-red-400 mt-2">Please enter a valid email address.</p>
        )}
      </Card>

      {/* Save */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-500">
          {lastSaved && `Last saved ${new Date(lastSaved).toLocaleString()}`}
        </div>
        <Button onClick={handleSave} loading={saving} disabled={!dirty} icon={<Save className="w-3.5 h-3.5" />}>
          Save Configuration
        </Button>
      </div>

      {/* Test Email */}
      <Card>
        <h2 className="text-sm font-semibold text-white mb-1">Send Test Email</h2>
        <p className="text-xs text-gray-500 mb-4">
          Verify your Mailjet setup by sending a test message. Save your configuration first. Limited to 3 tests per 5 minutes.
        </p>
        <div className="flex gap-2">
          <div className="flex-1">
            <Input
              value={testEmail}
              onChange={(e) => { setTestEmail(e.target.value); setTestResult(null); }}
              placeholder="recipient@example.com"
              type="email"
            />
          </div>
          <Button
            onClick={handleTestEmail}
            loading={testSending}
            disabled={!isConfigured}
            icon={<Send className="w-3.5 h-3.5" />}
          >
            Send Test
          </Button>
        </div>
        {testResult && (
          <div className={`flex items-center gap-2 mt-3 px-3 py-2 rounded-lg text-sm ${
            testResult.ok
              ? 'bg-emerald-950/30 text-emerald-300'
              : 'bg-red-950/30 text-red-300'
          }`}>
            {testResult.ok
              ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
              : <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
            }
            <span>{testResult.message}</span>
          </div>
        )}
      </Card>

      {/* Email Types Reference */}
      <Card>
        <h2 className="text-sm font-semibold text-white mb-3">Email Lifecycle</h2>
        <div className="space-y-3">
          {[
            { category: 'Authentication', emails: ['Welcome', 'Password Reset', 'Password Changed'] },
            { category: 'Billing', emails: ['Subscription Activated', 'Payment Success', 'Payment Failed', 'Subscription Canceled'] },
            { category: 'Admin Actions', emails: ['Account Suspended', 'Account Unsuspended', 'Plan Override'] },
          ].map((group) => (
            <div key={group.category}>
              <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">{group.category}</h3>
              <div className="flex flex-wrap gap-1.5">
                {group.emails.map((e) => (
                  <span key={e} className="px-2 py-0.5 text-xs rounded-md bg-gray-800 text-gray-300 border border-gray-700">
                    {e}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-4">
          All emails can be disabled globally via the "Transactional Emails" feature flag in Feature Flags.
        </p>
      </Card>
    </div>
  );
}
