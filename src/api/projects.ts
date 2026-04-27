import { api } from './client';
import type { Project } from './types';

export const projectsApi = {
  list: () => api.get<Project[]>('/api/projects/'),
  get: (id: string) => api.get<Project>(`/api/projects/${id}`),
  create: (name: string) => api.post<Project>('/api/projects/', { name }),
  update: (id: string, name: string) => api.patch<Project>(`/api/projects/${id}`, { name }),
  delete: (id: string) => api.delete<{ message: string }>(`/api/projects/${id}`),
};
