import { api } from './client';

export type AdminConfigKey = 'site_config' | 'plans' | 'feature_flags';

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
  [key: string]: boolean;
}
