import { api } from './client';
import type { AuthResponse, User } from './types';

export const authApi = {
  register: (email: string, password: string) =>
    api.post<AuthResponse>('/api/auth/register', { email, password }),

  login: (email: string, password: string) =>
    api.post<AuthResponse>('/api/auth/login', { email, password }),

  me: () => api.get<{ user: User }>('/api/auth/me'),
};
