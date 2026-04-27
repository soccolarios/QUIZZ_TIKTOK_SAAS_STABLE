import { api } from './client';
import type { Session, SessionLogs, SessionScores, SessionSnapshot, AudioState } from './types';

export type PlayMode = 'single' | 'sequential' | 'loop_single' | 'loop_all';

export type OverlayTemplate = 'default' | 'football';

export interface PrepareSessionParams {
  project_id: string;
  quiz_id: string;
  overlay_template?: string;
  /** Relaunch only — reuse existing overlay identity */
  overlay_token?: string;
  short_code?: string;
}

export interface StartSessionParams {
  /** If provided, activates an existing 'prepared' session instead of creating a new one. */
  session_id?: string;
  project_id: string;
  quiz_id: string;
  tiktok_username?: string;
  simulation_mode?: boolean;
  x2_enabled?: boolean;
  no_tts?: boolean;
  question_time?: number;
  countdown_time?: number;
  total_questions?: number;
  play_mode?: PlayMode;
  overlay_template?: OverlayTemplate;
  music_track_slug?: string;
  /** Relaunch only — reuse overlay identity from a previous terminal session */
  overlay_token?: string;
  short_code?: string;
}

export interface CleanupParams {
  retention_days?: number;
  dry_run?: boolean;
}

export interface CleanupResult {
  retention_days: number;
  dry_run: boolean;
  candidates_found: number;
  deleted: Array<{ session_id: string; path: string; dry_run?: boolean }>;
  skipped: Array<{ session_id: string; reason: string }>;
  errors: Array<{ session_id: string; error: string }>;
}

export const sessionsApi = {
  list: () => api.get<Session[]>('/api/sessions/'),
  get: (id: string) => api.get<Session>(`/api/sessions/${id}`),
  prepare: (params: PrepareSessionParams) => api.post<Session>('/api/sessions/prepare', params),
  start: (params: StartSessionParams) => api.post<Session>('/api/sessions/start', params),
  stop: (id: string) => api.post<Session>(`/api/sessions/${id}/stop`),
  pause: (id: string) => api.post<Session>(`/api/sessions/${id}/pause`),
  resume: (id: string) => api.post<Session>(`/api/sessions/${id}/resume`),
  replay: (id: string) => api.post<Session>(`/api/sessions/${id}/replay`),
  logs: (id: string, limit = 200) =>
    api.get<SessionLogs>(`/api/sessions/${id}/logs?limit=${limit}`),
  scores: (id: string, limit = 50) =>
    api.get<SessionScores>(`/api/sessions/${id}/scores?limit=${limit}`),
  snapshot: (id: string) =>
    api.get<SessionSnapshot>(`/api/sessions/${id}/snapshot`),
  delete: (id: string) =>
    api.delete<{ deleted: boolean; session_id: string }>(`/api/sessions/${id}`),
  cleanup: (params: CleanupParams = {}) =>
    api.post<CleanupResult>('/api/sessions/maintenance/cleanup', params),
  audioState: (id: string) =>
    api.get<AudioState>(`/api/sessions/${id}/audio`),
  setTts: (id: string, enabled: boolean) =>
    api.post<AudioState>(`/api/sessions/${id}/audio/tts`, { enabled }),
  setMusic: (id: string, enabled: boolean) =>
    api.post<AudioState>(`/api/sessions/${id}/audio/music`, { enabled }),
  setVolume: (id: string, volume: number) =>
    api.post<AudioState>(`/api/sessions/${id}/audio/volume`, { volume }),
};
