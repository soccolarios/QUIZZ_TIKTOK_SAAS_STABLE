export interface User {
  id: string;
  email: string;
  is_active: boolean;
  is_admin: boolean;
  created_at: string;
  plan_code: string;
  subscription_status: string;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface QuizQuestion {
  id: string;
  text: string;
  type: string;
  choices: { A: string; B: string; C: string; D: string };
  correct_answer: 'A' | 'B' | 'C' | 'D';
  category: string;
  difficulty: number;
  active: boolean;
}

export interface Quiz {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  data_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TikTokStats {
  connected: boolean;
  connecting: boolean;
  retry_count: number;
  last_error: string | null;
}

export interface RuntimeInfo {
  is_active: boolean;
  state: string | null;
  engine_state: string | null;
  paused: boolean;
  uptime: number | null;
  ws_connected: number;
  ws_port: number | null;
  error: string | null;
  tiktok: TikTokStats;
}

export interface SessionSummary {
  participant_count: number | null;
  top_player: string | null;
  top_score: number | null;
}

export interface Session {
  id: string;
  user_id: string;
  project_id: string;
  quiz_id: string;
  status: string;
  overlay_token: string;
  overlay_url: string;
  short_code: string | null;
  short_overlay_url: string | null;
  tiktok_username: string | null;
  simulation_mode: boolean;
  launch_options?: Record<string, unknown>;
  scores_db_path?: string | null;
  has_scores: boolean;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  ended_at: string | null;
  runtime: RuntimeInfo;
  // enriched fields — present on list responses
  quiz_title?: string | null;
  project_name?: string | null;
  summary?: SessionSummary | null;
  // overlay / music settings derived from launch_options
  overlay_template?: string | null;
  music_track_slug?: string | null;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface LogEntry {
  level: string;
  message: string;
  timestamp: string;
}

export interface SessionLogs {
  session_id: string;
  logs: LogEntry[];
  count: number;
}

export interface LeaderboardEntry {
  rank: number;
  username: string;
  total_score: number;
  correct_answers: number | null;
  total_answers: number | null;
  games_played: number | null;
}

export interface SessionScores {
  source: 'live' | 'db';
  session_id: string;
  status: string;
  leaderboard: LeaderboardEntry[];
  total_players: number;
  total_answers: number | null;
  correct_answers: number | null;
  accuracy_pct: number | null;
}

export interface SnapshotData {
  session_id?: string;
  phase?: string;
  runtime_state?: string;
  engine_state?: string | null;
  paused?: boolean;
  question_index?: number | null;
  question_total?: number | null;
  question_text?: string | null;
  participant_count?: number;
  leaderboard_top20?: Array<{ rank: number; username: string; score: number }>;
}

export interface SessionSnapshot {
  source: 'live' | 'stored';
  snapshot: SnapshotData;
  updated_at?: string | null;
}

export interface AudioState {
  tts_enabled: boolean;
  music_enabled: boolean;
  music_volume: number; // 0-100
}
