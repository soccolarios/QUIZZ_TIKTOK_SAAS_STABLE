import { api } from './client';

export interface PlanLimits {
  max_active_sessions: number;
  max_projects: number;
  max_quizzes_per_project: number;
  x2_enabled: boolean;
  tts_enabled: boolean;
}

export interface Subscription {
  plan_code: string;
  display_name: string;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  limits: PlanLimits;
}

export const billingApi = {
  getSubscription: () => api.get<Subscription>('/api/billing/subscription'),
  createCheckout: (plan_code: string) =>
    api.post<{ checkout_url: string }>('/api/billing/create-checkout-session', { plan_code }),
  createPortal: () =>
    api.post<{ portal_url: string }>('/api/billing/create-portal-session'),
};
