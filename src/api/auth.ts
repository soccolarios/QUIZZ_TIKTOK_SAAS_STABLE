import { api } from './client';
import type { AuthResponse, User } from './types';

export const authApi = {
  register: (email: string, password: string) =>
    api.post<AuthResponse>('/api/auth/register', { email, password }),

  login: (email: string, password: string) =>
    api.post<AuthResponse>('/api/auth/login', { email, password }),

  me: () => api.get<{ user: User }>('/api/auth/me'),

  requestReset: (email: string) =>
    api.post<{ sent: boolean }>('/api/auth/request-reset', { email }),

  confirmReset: (token: string, password: string) =>
    api.post<{ reset: boolean }>('/api/auth/confirm-reset', { token, password }),
};
