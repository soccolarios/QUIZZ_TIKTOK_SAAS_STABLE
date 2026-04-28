import { useState, useEffect, useCallback } from 'react';
import { Volume2, Save, Loader2, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { adminToast } from './AdminLayout';
import {
  getAdminConfig,
  putAdminConfig,
  type SoundBankConfig,
} from '../api/admin';
import { ApiError } from '../api/client';

const DEFAULT_SOUNDS: Record<string, { label: string; description: string }> = {
  correct_answer: { label: 'Correct Answer', description: 'Played when a correct answer is revealed' },
  question_show: { label: 'Question Appear', description: 'Played when a new question is shown' },
  countdown_warning: { label: 'Countdown Warning', description: 'Played during the final seconds of a question timer' },
  leaderboard_show: { label: 'Leaderboard Reveal', description: 'Played when the leaderboard is displayed' },
  next_question: { label: 'Next Question', description: 'Transition sound between questions' },
  tick: { label: 'Timer Tick', description: 'Repeating tick sound during the countdown' },
};

const EMPTY_CONFIG: SoundBankConfig = {
  enabled: true,
  sounds: Object.fromEntries(
    Object.entries(DEFAULT_SOUNDS).map(([key, { label }]) => [
      key,
      { file_name: `${key}.mp3`, label, enabled: true },
    ]),
  ),
};

export function SoundBankPage() {
  const [config, setConfig] = useState<SoundBankConfig>(EMPTY_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAdminConfig<SoundBankConfig>('sound_bank');
      if (res.value) {
        const merged = { ...EMPTY_CONFIG, ...res.value };
        for (const key of Object.keys(DEFAULT_SOUNDS)) {
          if (!merged.sounds[key]) {
            merged.sounds[key] = {
              file_name: `${key}.mp3`,
              label: DEFAULT_SOUNDS[key].label,
              enabled: true,
            };
          }
        }
        setConfig(merged);
      }
      if (res.updated_at) setLastSaved(res.updated_at);
    } catch {
      adminToast('Failed to load sound bank config', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleSound = (key: string) => {
    setConfig((prev) => ({
      ...prev,
      sounds: {
        ...prev.sounds,
        [key]: { ...prev.sounds[key], enabled: !prev.sounds[key].enabled },
      },
    }));
    setDirty(true);
  };

  const toggleGlobal = () => {
    setConfig((prev) => ({ ...prev, enabled: !prev.enabled }));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await putAdminConfig('sound_bank', config);
      setDirty(false);
      setLastSaved(new Date().toISOString());
      adminToast('Sound bank configuration saved', 'success');
    } catch (err) {
      adminToast(err instanceof ApiError ? err.message : 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const enabledCount = Object.values(config.sounds).filter((s) => s.enabled).length;
  const totalCount = Object.keys(config.sounds).length;

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
          <h1 className="text-xl font-bold text-white">Sound Bank</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Configure sound effects played during quiz events. Toggle individual sounds or disable globally.
          </p>
        </div>
        <Button variant="secondary" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={load}>
          Reload
        </Button>
      </div>

      {/* Global toggle */}
      <div className={`flex items-center justify-between px-4 py-3 rounded-xl border ${
        config.enabled
          ? 'bg-emerald-950/30 border-emerald-800/50'
          : 'bg-gray-900 border-gray-800'
      }`}>
        <div className="flex items-center gap-2.5">
          {config.enabled ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          ) : (
            <XCircle className="w-4 h-4 text-gray-500 flex-shrink-0" />
          )}
          <span className={`text-sm ${config.enabled ? 'text-emerald-300' : 'text-gray-400'}`}>
            {config.enabled
              ? `Sound effects enabled (${enabledCount}/${totalCount} active)`
              : 'Sound effects disabled globally'}
          </span>
        </div>
        <button
          onClick={toggleGlobal}
          className={`relative w-10 h-5 rounded-full transition-colors ${
            config.enabled ? 'bg-emerald-500' : 'bg-gray-700'
          }`}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
            config.enabled ? 'translate-x-5' : 'translate-x-0.5'
          }`} />
        </button>
      </div>

      {/* Sound effects list */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Volume2 className="w-4 h-4 text-gray-400" />
          <h2 className="text-sm font-semibold text-white">Sound Effects</h2>
        </div>
        <div className="divide-y divide-gray-800">
          {Object.entries(DEFAULT_SOUNDS).map(([key, { label, description }]) => {
            const sound = config.sounds[key];
            if (!sound) return null;
            return (
              <div key={key} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white">{label}</p>
                    <code className="text-[10px] text-gray-600 bg-gray-800/50 px-1.5 py-0.5 rounded font-mono">
                      {sound.file_name}
                    </code>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{description}</p>
                </div>
                <button
                  onClick={() => toggleSound(key)}
                  className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ml-4 ${
                    sound.enabled && config.enabled ? 'bg-emerald-500' : 'bg-gray-700'
                  }`}
                  disabled={!config.enabled}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                    sound.enabled ? 'translate-x-4' : 'translate-x-0.5'
                  }`} />
                </button>
              </div>
            );
          })}
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

      {/* Info */}
      <Card>
        <h2 className="text-sm font-semibold text-white mb-2">Audio Files</h2>
        <p className="text-xs text-gray-400 leading-relaxed">
          Sound files are served from <code className="text-gray-300 bg-gray-800 px-1 py-0.5 rounded text-[11px]">public/assets/sounds/</code>.
          File names are configured here but the actual audio files must be present on the server.
          Custom sound upload will be available in a future update.
        </p>
      </Card>
    </div>
  );
}
