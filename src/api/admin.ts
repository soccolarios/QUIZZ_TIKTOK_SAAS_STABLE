import { api } from './client';

export type AdminConfigKey = 'site_config' | 'plans' | 'feature_flags' | 'mailjet' | 'api_keys' | 'sound_bank';

interface ConfigResponse<T> {
  key: string;
  value: T | null;
  updated_at: string | null;
}

interface SaveResponse {
  key: string;
  saved: boolean;
}

export async function getAdminConfig<T>(key: AdminConfigKey): Promise<ConfigResponse<T>> {
  return api.get<ConfigResponse<T>>(`/api/admin/config/${key}`);
}

export async function putAdminConfig<T>(key: AdminConfigKey, value: T): Promise<SaveResponse> {
  return api.put<SaveResponse>(`/api/admin/config/${key}`, { value });
}

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------

export interface ApiKeysConfig {
  openai_api_key: string;
  elevenlabs_api_key: string;
  azure_tts_key: string;
  tiktok_api_key: string;
  _secrets_masked?: boolean;
}

// ---------------------------------------------------------------------------
// Music Bank
// ---------------------------------------------------------------------------

export interface AdminMusicTrack {
  id: string;
  slug: string;
  name: string;
  genre: string;
  duration_sec: number | null;
  file_name: string | null;
  active: boolean;
  sort_order: number;
  required_plan_code: string | null;
  created_at: string | null;
}

export const adminMusicApi = {
  list: () => api.get<AdminMusicTrack[]>('/api/admin/music/'),
  create: (data: Partial<AdminMusicTrack>) => api.post<AdminMusicTrack>('/api/admin/music/', data),
  update: (id: string, data: Partial<AdminMusicTrack>) => api.put<AdminMusicTrack>(`/api/admin/music/${id}`, data),
  toggleActive: (id: string, active: boolean) => api.patch<AdminMusicTrack>(`/api/admin/music/${id}/active`, { active }),
};

// ---------------------------------------------------------------------------
// Sound Bank
// ---------------------------------------------------------------------------

export interface SoundBankConfig {
  enabled: boolean;
  sounds: Record<string, { file_name: string; label: string; enabled: boolean }>;
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export type UploadCategory = 'music' | 'sounds' | 'brand';

export interface UploadedFile {
  file_name: string;
  size: number;
  modified_at?: number;
}

export interface UploadResult {
  file_name: string;
  category: string;
  size: number;
  original_name: string;
}

const BASE_URL = (import.meta.env.VITE_SAAS_API_URL as string | undefined) || '';

function getToken(): string | null {
  return localStorage.getItem('saas_token');
}

export const adminUploadApi = {
  upload: async (category: UploadCategory, file: File): Promise<UploadResult> => {
    const form = new FormData();
    form.append('file', file);
    const headers: Record<string, string> = {};
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${BASE_URL}/api/admin/upload/${category}`, {
      method: 'POST',
      headers,
      body: form,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Upload failed');
    return (json.data ?? json) as UploadResult;
  },

  list: (category: UploadCategory) =>
    api.get<UploadedFile[]>(`/api/admin/upload/${category}`),

  delete: (category: UploadCategory, filename: string) =>
    api.delete<{ deleted: boolean }>(`/api/admin/upload/${category}/${filename}`),

  previewUrl: (category: UploadCategory, filename: string) =>
    `${BASE_URL}/api/admin/upload/${category}/${filename}`,
};
