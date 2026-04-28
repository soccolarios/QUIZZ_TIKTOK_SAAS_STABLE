import { useState, useEffect, useCallback } from 'react';
import { Settings, Save, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { adminToast } from './AdminLayout';
import { getAdminConfig, putAdminConfig, type SiteConfig } from '../api/admin';
import defaults from '../config/defaults';

const INITIAL: SiteConfig = {
  brandName: defaults.brand.name,
  legalName: defaults.brand.legalName,
  tagline: defaults.brand.tagline,
  supportEmail: defaults.brand.supportEmail,
  dashboardUrl: defaults.brand.dashboardUrl,
  defaultLanguage: 'fr',
  seoTitle: `${defaults.brand.name} — ${defaults.brand.tagline}`,
  seoDescription: 'Run live quizzes on TikTok LIVE directly in OBS. Create quizzes, launch sessions, and let your viewers compete in real time.',
  maintenanceMode: false,
};

export function SiteConfigPage() {
  const [config, setConfig] = useState<SiteConfig>(INITIAL);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAdminConfig<SiteConfig>('site_config');
      if (res.value) {
        setConfig({ ...INITIAL, ...res.value });
      }
      setLastSaved(res.updated_at);
    } catch {
      adminToast('Failed to load site config', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const update = (patch: Partial<SiteConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await putAdminConfig('site_config', config);
      setDirty(false);
      setLastSaved(new Date().toISOString());
      adminToast('Site config saved', 'success');
    } catch {
      adminToast('Failed to save site config', 'error');
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setConfig(INITIAL);
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
            <Settings className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Site Config</h1>
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

      {/* Brand */}
      <Card>
        <h2 className="text-sm font-semibold text-gray-800 mb-4">Brand Identity</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Brand Name"
            value={config.brandName}
            onChange={(e) => update({ brandName: e.target.value })}
            hint="Displayed across the platform"
          />
          <Input
            label="Legal Name"
            value={config.legalName}
            onChange={(e) => update({ legalName: e.target.value })}
            hint="Used in legal pages and footer"
          />
          <div className="md:col-span-2">
            <Input
              label="Tagline"
              value={config.tagline}
              onChange={(e) => update({ tagline: e.target.value })}
              hint="Shown on the landing page and marketing materials"
            />
          </div>
          <Input
            label="Support Email"
            type="email"
            value={config.supportEmail}
            onChange={(e) => update({ supportEmail: e.target.value })}
          />
          <Input
            label="Dashboard URL"
            value={config.dashboardUrl}
            onChange={(e) => update({ dashboardUrl: e.target.value })}
            hint="Full URL of the app domain (e.g. https://app.livegine.com)"
          />
        </div>
      </Card>

      {/* SEO */}
      <Card>
        <h2 className="text-sm font-semibold text-gray-800 mb-4">SEO & Meta</h2>
        <div className="grid grid-cols-1 gap-4">
          <Input
            label="SEO Title"
            value={config.seoTitle}
            onChange={(e) => update({ seoTitle: e.target.value })}
            hint="Page <title> for landing and public pages"
          />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">SEO Description</label>
            <textarea
              value={config.seoDescription}
              onChange={(e) => update({ seoDescription: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white text-gray-900 placeholder-gray-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />
            <p className="text-xs text-gray-500">Meta description for search engines (max 160 chars recommended)</p>
          </div>
        </div>
      </Card>

      {/* Localization */}
      <Card>
        <h2 className="text-sm font-semibold text-gray-800 mb-4">Localization</h2>
        <div className="max-w-xs">
          <label className="text-sm font-medium text-gray-700 block mb-1">Default Language</label>
          <select
            value={config.defaultLanguage}
            onChange={(e) => update({ defaultLanguage: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="fr">French</option>
            <option value="en">English</option>
            <option value="es">Spanish</option>
            <option value="de">German</option>
            <option value="it">Italian</option>
            <option value="pt">Portuguese</option>
          </select>
        </div>
      </Card>

      {/* Maintenance */}
      <Card>
        <div className="flex items-start gap-4">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${config.maintenanceMode ? 'bg-amber-50' : 'bg-gray-50'}`}>
            <AlertTriangle className={`w-5 h-5 ${config.maintenanceMode ? 'text-amber-500' : 'text-gray-300'}`} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-gray-800">Maintenance Mode</h2>
            <p className="text-xs text-gray-500 mt-0.5 mb-3">
              When enabled, the platform shows a maintenance page to all users except admins.
            </p>
            <button
              onClick={() => update({ maintenanceMode: !config.maintenanceMode })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${config.maintenanceMode ? 'bg-amber-500' : 'bg-gray-200'}`}
            >
              <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform shadow-sm ${config.maintenanceMode ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
            {config.maintenanceMode && (
              <p className="text-xs text-amber-600 font-medium mt-2">
                Maintenance mode is ON. Users will see a maintenance page.
              </p>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
