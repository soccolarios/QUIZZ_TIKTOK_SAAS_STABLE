import { useState, useEffect, useCallback, useRef } from 'react';
import { Volume2, Save, Loader2, RefreshCw, Upload, Play, Pause, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { adminToast } from './AdminLayout';
import { getAdminConfig, putAdminConfig, adminUploadApi, type SoundBankConfig } from '../api/admin';

const DEFAULT_SOUNDS: Record<string, { label: string; description: string }> = {
  correct_answer: { label: 'Correct Answer', description: 'Played when a correct answer is revealed' },
  question_show: { label: 'Question Appear', description: 'Played when a new question is shown' },
  countdown_warning: { label: 'Countdown Warning', description: 'Played during final seconds of timer' },
  leaderboard_show: { label: 'Leaderboard Reveal', description: 'Played when leaderboard is displayed' },
  next_question: { label: 'Next Question', description: 'Transition sound between questions' },
  tick: { label: 'Timer Tick', description: 'Repeating tick during countdown' },
};

function buildInitialConfig(): SoundBankConfig {
  return {
    enabled: true,
    sounds: Object.fromEntries(
      Object.entries(DEFAULT_SOUNDS).map(([key, { label }]) => [
        key, { file_name: `${key}.mp3`, label, enabled: true },
      ]),
    ),
  };
}

export function SoundBankPage() {
  const [config, setConfig] = useState<SoundBankConfig>(buildInitialConfig());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadKeyRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAdminConfig<SoundBankConfig>('sound_bank');
      if (res.value) {
        const merged = { ...buildInitialConfig(), ...res.value };
        for (const key of Object.keys(DEFAULT_SOUNDS)) {
          if (!merged.sounds[key]) {
            merged.sounds[key] = { file_name: `${key}.mp3`, label: DEFAULT_SOUNDS[key].label, enabled: true };
          }
        }
        setConfig(merged);
      }
      if (res.updated_at) setLastSaved(res.updated_at);
    } catch {
      adminToast('Failed to load sound bank', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleSound = (key: string) => {
    setConfig((prev) => ({
      ...prev,
      sounds: { ...prev.sounds, [key]: { ...prev.sounds[key], enabled: !prev.sounds[key].enabled } },
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
      adminToast('Sound bank saved', 'success');
    } catch (err: any) {
      adminToast(err?.message || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const triggerUpload = (key: string) => {
    uploadKeyRef.current = key;
    fileInputRef.current?.click();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const key = uploadKeyRef.current;
    if (!file || !key) return;

    setUploading(key);
    try {
      const result = await adminUploadApi.upload('sounds', file);
      setConfig((prev) => ({
        ...prev,
        sounds: { ...prev.sounds, [key]: { ...prev.sounds[key], file_name: result.file_name } },
      }));
      setDirty(true);
      adminToast(`Uploaded: ${result.file_name}`, 'success');
    } catch (err: any) {
      adminToast(err?.message || 'Upload failed', 'error');
    } finally {
      setUploading(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const togglePreview = (key: string, fileName: string) => {
    if (playingKey === key) {
      audioRef.current?.pause();
      setPlayingKey(null);
    } else {
      if (audioRef.current) audioRef.current.pause();
      const url = adminUploadApi.previewUrl('sounds', fileName);
      const audio = new Audio(url);
      audio.onended = () => setPlayingKey(null);
      audio.play().catch(() => adminToast('Cannot preview', 'error'));
      audioRef.current = audio;
      setPlayingKey(key);
    }
  };

  const enabledCount = Object.values(config.sounds).filter((s) => s.enabled).length;

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 text-gray-400 animate-spin" /></div>;
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">Sound Bank</h1>
          <p className="text-sm text-gray-400 mt-0.5">Sound effects for quiz events. Upload custom sounds or use defaults.</p>
        </div>
        <Button variant="secondary" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={load}>Reload</Button>
      </div>

      {/* Global toggle */}
      <div className={`flex items-center justify-between px-4 py-3 rounded-xl border ${
        config.enabled ? 'bg-emerald-950/30 border-emerald-800/50' : 'bg-gray-900 border-gray-800'
      }`}>
        <div className="flex items-center gap-2.5">
          {config.enabled
            ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            : <XCircle className="w-4 h-4 text-gray-500" />}
          <span className={`text-sm ${config.enabled ? 'text-emerald-300' : 'text-gray-400'}`}>
            {config.enabled ? `Sound effects enabled (${enabledCount}/${Object.keys(config.sounds).length})` : 'Sound effects disabled'}
          </span>
        </div>
        <button onClick={toggleGlobal}
          className={`relative w-10 h-5 rounded-full transition-colors ${config.enabled ? 'bg-emerald-500' : 'bg-gray-700'}`}>
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${config.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>

      <input ref={fileInputRef} type="file" accept=".mp3,.wav,.ogg" onChange={handleFileUpload} className="hidden" />

      {/* Sound list */}
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
              <div key={key} className="flex items-center justify-between py-3 gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white">{label}</p>
                    <code className="text-[10px] text-gray-600 bg-gray-800/50 px-1.5 py-0.5 rounded font-mono">{sound.file_name}</code>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{description}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => togglePreview(key, sound.file_name)}
                    className="text-gray-500 hover:text-gray-300 transition-colors" title="Preview">
                    {playingKey === key ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={() => triggerUpload(key)}
                    className="text-gray-500 hover:text-gray-300 transition-colors" title="Upload replacement">
                    {uploading === key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={() => toggleSound(key)} disabled={!config.enabled}
                    className={`relative w-9 h-5 rounded-full transition-colors ${sound.enabled && config.enabled ? 'bg-emerald-500' : 'bg-gray-700'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${sound.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-500">{lastSaved && `Last saved ${new Date(lastSaved).toLocaleString()}`}</div>
        <Button onClick={handleSave} loading={saving} disabled={!dirty} icon={<Save className="w-3.5 h-3.5" />}>Save Configuration</Button>
      </div>

      <Card>
        <h2 className="text-sm font-semibold text-white mb-2">Storage</h2>
        <p className="text-xs text-gray-400">
          Sound files are stored in <code className="text-gray-300 bg-gray-800 px-1 py-0.5 rounded text-[11px]">data/sounds/</code>.
          Uploaded files are auto-renamed safely. Max 5 MB per file.
        </p>
      </Card>
    </div>
  );
}
