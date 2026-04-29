import { useState, useEffect, useCallback, useRef } from 'react';
import { Music, Plus, Pencil, Loader2, RefreshCw, Check, Eye, EyeOff, Upload, Play, Pause } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { adminToast } from './AdminLayout';
import { adminMusicApi, adminUploadApi, type AdminMusicTrack } from '../api/admin';

const GENRE_OPTIONS = ['General', 'Upbeat', 'Chill', 'Retro', 'Electronic', 'Acoustic', 'Cinematic', 'None'];

interface TrackFormData {
  slug: string;
  name: string;
  genre: string;
  duration_sec: string;
  file_name: string;
  sort_order: string;
  required_plan_code: string;
}

const EMPTY_FORM: TrackFormData = {
  slug: '',
  name: '',
  genre: 'General',
  duration_sec: '',
  file_name: '',
  sort_order: '0',
  required_plan_code: '',
};

function formatDuration(sec: number | null): string {
  if (sec == null) return '--';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function MusicBankPage() {
  const [tracks, setTracks] = useState<AdminMusicTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<TrackFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [playingFile, setPlayingFile] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminMusicApi.list();
      setTracks(data);
    } catch {
      adminToast('Failed to load music tracks', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const startCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, sort_order: String((tracks.length + 1) * 10) });
    setCreating(true);
  };

  const startEdit = (track: AdminMusicTrack) => {
    setCreating(false);
    setEditingId(track.id);
    setForm({
      slug: track.slug,
      name: track.name,
      genre: track.genre,
      duration_sec: track.duration_sec != null ? String(track.duration_sec) : '',
      file_name: track.file_name || '',
      sort_order: String(track.sort_order),
      required_plan_code: track.required_plan_code || '',
    });
  };

  const cancelForm = () => {
    setEditingId(null);
    setCreating(false);
    setForm(EMPTY_FORM);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { adminToast('Track name is required', 'error'); return; }
    if (!form.slug.trim()) { adminToast('Slug is required', 'error'); return; }

    setSaving(true);
    try {
      const payload = {
        slug: form.slug.trim(),
        name: form.name.trim(),
        genre: form.genre,
        duration_sec: form.duration_sec ? parseInt(form.duration_sec, 10) : null,
        file_name: form.file_name.trim() || null,
        sort_order: parseInt(form.sort_order, 10) || 0,
        required_plan_code: form.required_plan_code.trim() || null,
      };

      if (creating) {
        await adminMusicApi.create(payload);
        adminToast('Track created', 'success');
      } else if (editingId) {
        await adminMusicApi.update(editingId, payload);
        adminToast('Track updated', 'success');
      }
      cancelForm();
      load();
    } catch (err: any) {
      adminToast(err?.message || 'Failed to save track', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const result = await adminUploadApi.upload('music', file);
      setForm((f) => ({ ...f, file_name: result.file_name }));
      adminToast(`Uploaded: ${result.file_name}`, 'success');
    } catch (err: any) {
      adminToast(err?.message || 'Upload failed', 'error');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const toggleActive = async (track: AdminMusicTrack) => {
    try {
      await adminMusicApi.toggleActive(track.id, !track.active);
      setTracks((prev) => prev.map((t) => (t.id === track.id ? { ...t, active: !t.active } : t)));
      adminToast(`Track ${!track.active ? 'activated' : 'deactivated'}`, 'success');
    } catch (err: any) {
      adminToast(err?.message || 'Failed to toggle track', 'error');
    }
  };

  const togglePreview = (fileName: string) => {
    if (playingFile === fileName) {
      audioRef.current?.pause();
      setPlayingFile(null);
    } else {
      if (audioRef.current) audioRef.current.pause();
      const url = adminUploadApi.previewUrl('music', fileName);
      const audio = new Audio(url);
      audio.onended = () => setPlayingFile(null);
      audio.play().catch(() => adminToast('Cannot preview (file may not exist on server)', 'error'));
      audioRef.current = audio;
      setPlayingFile(fileName);
    }
  };

  const activeCount = tracks.filter((t) => t.active).length;

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">Music Bank</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Manage background music tracks. {activeCount} active of {tracks.length} total.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={load}>
            Reload
          </Button>
          <Button size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={startCreate} disabled={creating}>
            Add Track
          </Button>
        </div>
      </div>

      {/* Create / Edit form */}
      {(creating || editingId) && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Music className="w-4 h-4 text-gray-400" />
            <h2 className="text-sm font-semibold text-white">
              {creating ? 'New Track' : 'Edit Track'}
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Track name"
              autoFocus
            />
            <Input
              label="Slug"
              value={form.slug}
              onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/\s+/g, '_') }))}
              placeholder="unique_slug"
            />
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Genre</label>
              <select
                value={form.genre}
                onChange={(e) => setForm((f) => ({ ...f, genre: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              >
                {GENRE_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <Input
              label="Duration (sec)"
              type="number"
              value={form.duration_sec}
              onChange={(e) => setForm((f) => ({ ...f, duration_sec: e.target.value }))}
              placeholder="180"
            />
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-400 mb-1">Audio File</label>
              <div className="flex gap-2 items-center">
                <div className="flex-1">
                  <Input
                    value={form.file_name}
                    onChange={(e) => setForm((f) => ({ ...f, file_name: e.target.value }))}
                    placeholder="filename.mp3 (auto-filled on upload)"
                  />
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".mp3,.wav,.ogg,.m4a"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  icon={uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? 'Uploading...' : 'Upload'}
                </Button>
              </div>
              <p className="text-[11px] text-gray-500 mt-1">
                Accepted: mp3, wav, ogg, m4a. Max 20 MB. Files are auto-renamed safely.
              </p>
            </div>
            <Input
              label="Sort Order"
              type="number"
              value={form.sort_order}
              onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
              placeholder="0"
            />
            <Input
              label="Required Plan (optional)"
              value={form.required_plan_code}
              onChange={(e) => setForm((f) => ({ ...f, required_plan_code: e.target.value }))}
              placeholder="pro, business, or leave empty"
            />
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="secondary" size="sm" onClick={cancelForm}>Cancel</Button>
            <Button size="sm" loading={saving} onClick={handleSave} icon={<Check className="w-3.5 h-3.5" />}>
              {creating ? 'Create' : 'Save Changes'}
            </Button>
          </div>
        </Card>
      )}

      {/* Track list */}
      <Card>
        {tracks.length === 0 ? (
          <div className="text-center py-10">
            <Music className="w-8 h-8 text-gray-600 mx-auto mb-3" />
            <p className="text-sm text-gray-400">No music tracks yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                  <th className="pb-3 pr-3">Track</th>
                  <th className="pb-3 pr-3">Genre</th>
                  <th className="pb-3 pr-3">Duration</th>
                  <th className="pb-3 pr-3">Plan</th>
                  <th className="pb-3 pr-3">Status</th>
                  <th className="pb-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {tracks.map((track) => (
                  <tr key={track.id} className={!track.active ? 'opacity-50' : ''}>
                    <td className="py-3 pr-3">
                      <p className="font-medium text-white">{track.name}</p>
                      <p className="text-xs text-gray-500 font-mono">{track.slug}</p>
                      {track.file_name && (
                        <p className="text-[10px] text-gray-600 font-mono mt-0.5">{track.file_name}</p>
                      )}
                    </td>
                    <td className="py-3 pr-3">
                      <span className="px-2 py-0.5 text-xs rounded-md bg-gray-800 text-gray-300 border border-gray-700">
                        {track.genre}
                      </span>
                    </td>
                    <td className="py-3 pr-3 text-gray-400 tabular-nums">{formatDuration(track.duration_sec)}</td>
                    <td className="py-3 pr-3">
                      {track.required_plan_code ? (
                        <span className="px-2 py-0.5 text-xs rounded-md bg-blue-950/40 text-blue-300 border border-blue-800/40">
                          {track.required_plan_code}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-500">All</span>
                      )}
                    </td>
                    <td className="py-3 pr-3">
                      <button onClick={() => toggleActive(track)} className="flex items-center gap-1.5">
                        {track.active ? (
                          <>
                            <Eye className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-xs text-emerald-400">Active</span>
                          </>
                        ) : (
                          <>
                            <EyeOff className="w-3.5 h-3.5 text-gray-500" />
                            <span className="text-xs text-gray-500">Inactive</span>
                          </>
                        )}
                      </button>
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {track.file_name && (
                          <button
                            onClick={() => togglePreview(track.file_name!)}
                            className="text-gray-500 hover:text-gray-300 transition-colors"
                            title="Preview"
                          >
                            {playingFile === track.file_name
                              ? <Pause className="w-3.5 h-3.5" />
                              : <Play className="w-3.5 h-3.5" />}
                          </button>
                        )}
                        <button
                          onClick={() => startEdit(track)}
                          className="text-blue-400 hover:text-blue-300 transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-white mb-2">Storage Info</h2>
        <p className="text-xs text-gray-400 leading-relaxed">
          Uploaded files are stored in <code className="text-gray-300 bg-gray-800 px-1 py-0.5 rounded text-[11px]">data/music/</code> and served via nginx.
          File names are automatically sanitized (lowercased, accents removed, spaces to hyphens, collision-safe).
        </p>
      </Card>
    </div>
  );
}
