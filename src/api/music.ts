import { api } from './client';

export interface MusicTrack {
  id: string;
  slug: string;
  name: string;
  genre: string;
  duration_sec: number | null;
  sort_order: number;
}

export const musicApi = {
  list: () => api.get<MusicTrack[]>('/api/music/'),
};
