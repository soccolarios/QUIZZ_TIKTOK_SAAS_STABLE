import { api } from './client';

export interface DashboardStats {
  total_projects: number;
  total_quizzes: number;
  total_sessions: number;
  active_sessions: number;
  last_session_at: string | null;
}

export const analyticsApi = {
  getStats: () => api.get<DashboardStats>('/api/analytics/stats'),
};
