import { useState, useEffect, useCallback, useRef } from 'react';
import { Image, Upload, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { adminToast } from './AdminLayout';
import { adminUploadApi, type UploadedFile } from '../api/admin';

interface AssetSlot {
  key: string;
  label: string;
  description: string;
  accept: string;
}

const ASSET_SLOTS: AssetSlot[] = [
  { key: 'logo', label: 'Logo', description: 'Main brand logo (PNG or SVG recommended, max 5 MB)', accept: '.png,.jpg,.jpeg,.svg,.webp' },
  { key: 'favicon', label: 'Favicon', description: 'Browser tab icon (ICO, PNG, or SVG, 32x32 or 64x64)', accept: '.ico,.png,.svg' },
  { key: 'landing-hero', label: 'Landing Hero Image', description: 'Hero image for the landing page (PNG, JPG, WebP)', accept: '.png,.jpg,.jpeg,.webp' },
  { key: 'og-image', label: 'Social Share Image', description: 'Open Graph image for social media previews (1200x630 recommended)', accept: '.png,.jpg,.jpeg,.webp' },
];

export function BrandAssetsPage() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadSlotRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminUploadApi.list('brand');
      setFiles(data);
    } catch {
      adminToast('Failed to load brand assets', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const triggerUpload = (slot: AssetSlot) => {
    uploadSlotRef.current = slot.key;
    if (fileInputRef.current) {
      fileInputRef.current.accept = slot.accept;
      fileInputRef.current.click();
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(uploadSlotRef.current);
    try {
      const result = await adminUploadApi.upload('brand', file);
      adminToast(`Uploaded: ${result.file_name}`, 'success');
      load();
    } catch (err: any) {
      adminToast(err?.message || 'Upload failed', 'error');
    } finally {
      setUploading(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (fileName: string) => {
    if (!confirm(`Delete ${fileName}?`)) return;
    try {
      await adminUploadApi.delete('brand', fileName);
      adminToast('File deleted', 'success');
      load();
    } catch (err: any) {
      adminToast(err?.message || 'Delete failed', 'error');
    }
  };

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 text-gray-400 animate-spin" /></div>;
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">Brand Assets</h1>
          <p className="text-sm text-gray-400 mt-0.5">Upload logo, favicon, and other visual brand assets.</p>
        </div>
        <Button variant="secondary" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={load}>Reload</Button>
      </div>

      <input ref={fileInputRef} type="file" onChange={handleFileUpload} className="hidden" />

      {/* Upload slots */}
      {ASSET_SLOTS.map((slot) => (
        <Card key={slot.key}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-white">{slot.label}</h2>
              <p className="text-xs text-gray-500 mt-0.5">{slot.description}</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              icon={uploading === slot.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              onClick={() => triggerUpload(slot)}
              disabled={uploading === slot.key}
            >
              Upload
            </Button>
          </div>
        </Card>
      ))}

      {/* Uploaded files list */}
      {files.length > 0 && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Image className="w-4 h-4 text-gray-400" />
            <h2 className="text-sm font-semibold text-white">Uploaded Files</h2>
          </div>
          <div className="divide-y divide-gray-800">
            {files.map((file) => (
              <div key={file.file_name} className="flex items-center justify-between py-3 gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {file.file_name.match(/\.(png|jpg|jpeg|webp|svg)$/i) && (
                    <img
                      src={adminUploadApi.previewUrl('brand', file.file_name)}
                      alt={file.file_name}
                      className="w-10 h-10 rounded-lg object-cover bg-gray-800 border border-gray-700"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{file.file_name}</p>
                    <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                </div>
                <button onClick={() => handleDelete(file.file_name)}
                  className="text-gray-500 hover:text-red-400 transition-colors flex-shrink-0" title="Delete">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <h2 className="text-sm font-semibold text-white mb-2">File Naming</h2>
        <p className="text-xs text-gray-400 leading-relaxed">
          Uploaded files are automatically renamed for safety: lowercased, accents stripped, special characters removed,
          spaces replaced with hyphens. Duplicates get a numeric suffix (e.g., <code className="text-gray-300 bg-gray-800 px-1 py-0.5 rounded text-[11px]">logo-2.png</code>).
        </p>
      </Card>
    </div>
  );
}
