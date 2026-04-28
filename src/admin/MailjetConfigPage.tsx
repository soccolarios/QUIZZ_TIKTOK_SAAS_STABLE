import { useState, useEffect, useCallback } from 'react';
import { Mail, Save, Send, Loader2, RefreshCw, Eye, EyeOff, CheckCircle2, XCircle } from 'lucide-react';
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

const INITIAL: MailjetConfig = {
  api_key: '',
  secret_key: '',
  sender_email: '',
  sender_name: '',
};

export function MailjetConfigPage() {
  const [config, setConfig] = useState<MailjetConfig>(INITIAL);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAdminConfig<MailjetConfig>('mailjet');
      if (res.value) setConfig({ ...INITIAL, ...res.value });
      if (res.updated_at) setLastSaved(res.updated_at);
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
    setSaving(true);
    try {
      await putAdminConfig('mailjet', config);
      setDirty(false);
      setLastSaved(new Date().toISOString());
      adminToast('Mailjet configuration saved', 'success');
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

  const isConfigured = !!(config.api_key && config.secret_key && config.sender_email);

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
        <div className="grid gap-4">
          <Input
            label="API Key"
            value={config.api_key}
            onChange={(e) => handleChange('api_key', e.target.value)}
            placeholder="Your Mailjet API key"
            autoComplete="off"
          />
          <div className="relative">
            <Input
              label="Secret Key"
              type={showSecret ? 'text' : 'password'}
              value={config.secret_key}
              onChange={(e) => handleChange('secret_key', e.target.value)}
              placeholder="Your Mailjet secret key"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowSecret(!showSecret)}
              className="absolute right-3 top-[34px] text-gray-500 hover:text-gray-300 transition-colors"
            >
              {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
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
          Verify your Mailjet setup by sending a test message. Save your configuration first.
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
          All emails can be disabled globally via the "Transactional Emails" feature flag.
        </p>
      </Card>
    </div>
  );
}
