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

export interface SiteConfig {
  brandName: string;
  legalName: string;
  tagline: string;
  supportEmail: string;
  dashboardUrl: string;
  defaultLanguage: string;
  seoTitle: string;
  seoDescription: string;
  maintenanceMode: boolean;
}

export interface AdminPlanConfig {
  code: string;
  name: string;
  price: string;
  period: string;
  tagline: string;
  cta: string;
  recommended: boolean;
  enabled: boolean;
  limits: {
    maxActiveSessions: number;
    maxProjects: number;
    maxQuizzesPerProject: number;
  };
}

export interface FeatureFlagsConfig {
  x2Enabled: boolean;
  ttsEnabled: boolean;
  aiGeneratorEnabled: boolean;
  analyticsEnabled: boolean;
  customBrandingEnabled: boolean;
  musicEnabled: boolean;
  emailEnabled: boolean;
  [key: string]: boolean;
}

// ---------------------------------------------------------------------------
// Admin Billing
// ---------------------------------------------------------------------------

export interface AdminSubscription {
  id: string;
  user_id: string;
  email: string;
  user_is_active: boolean;
  plan_code: string;
  effective_plan: string;
  status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  admin_override_plan_code: string | null;
  admin_override_reason: string | null;
  admin_override_by: string | null;
  admin_override_at: string | null;
  suspended_at: string | null;
  suspension_reason: string | null;
  created_at: string;
  updated_at: string;
}

export const adminBillingApi = {
  listSubscriptions: () =>
    api.get<AdminSubscription[]>('/api/admin/billing/subscriptions'),

  getSubscription: (userId: string) =>
    api.get<AdminSubscription>(`/api/admin/billing/subscriptions/${userId}`),

  setOverride: (userId: string, planCode: string | null, reason: string) =>
    api.post<AdminSubscription>(`/api/admin/billing/subscriptions/${userId}/override`, {
      plan_code: planCode,
      reason,
    }),

  setSuspended: (userId: string, suspended: boolean, reason: string) =>
    api.post<AdminSubscription>(`/api/admin/billing/subscriptions/${userId}/suspend`, {
      suspended,
      reason,
    }),
};

// ---------------------------------------------------------------------------
// Admin Email / Mailjet
// ---------------------------------------------------------------------------

export interface MailjetConfig {
  api_key: string;
  secret_key: string;
  sender_email: string;
  sender_name: string;
}

export const adminEmailApi = {
  sendTestEmail: (email: string) =>
    api.post<{ sent: boolean; message: string }>('/api/admin/config/test-email', { email }),
};

// ---------------------------------------------------------------------------
// Admin API Keys
// ---------------------------------------------------------------------------

export interface ApiKeysConfig {
  openai_api_key: string;
  elevenlabs_api_key: string;
  azure_tts_key: string;
  tiktok_api_key: string;
}

// ---------------------------------------------------------------------------
// Admin Music Bank
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
  list: () =>
    api.get<AdminMusicTrack[]>('/api/admin/music/'),

  create: (data: Partial<AdminMusicTrack>) =>
    api.post<AdminMusicTrack>('/api/admin/music/', data),

  update: (id: string, data: Partial<AdminMusicTrack>) =>
    api.put<AdminMusicTrack>(`/api/admin/music/${id}`, data),

  toggleActive: (id: string, active: boolean) =>
    api.patch<AdminMusicTrack>(`/api/admin/music/${id}/active`, { active }),
};

// ---------------------------------------------------------------------------
// Admin Sound Bank (config-based placeholder)
// ---------------------------------------------------------------------------

export interface SoundBankConfig {
  enabled: boolean;
  sounds: Record<string, { file_name: string; label: string; enabled: boolean }>;
}
