"""
Database bootstrap for bare PostgreSQL deployments (VPS / no Supabase).

Usage:
    python3 -m backend.saas.db.bootstrap

What it does:
  - Creates all required tables if they don't exist.
  - Does NOT use Supabase-specific auth.uid() or RLS policies.
  - Safe to run multiple times (idempotent).
  - Access control is enforced by the backend application layer (JWT auth).

When to use:
  - VPS deployment with a plain PostgreSQL instance.
  - Local development without Supabase.

When NOT to use:
  - When using Supabase as the database: apply the migrations in
    supabase/migrations/ through the Supabase dashboard or CLI instead.
"""

from __future__ import annotations

import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))

_SQL = """
-- -------------------------------------------------------
-- Helper: updated_at trigger function
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -------------------------------------------------------
-- saas_users
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS saas_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  is_admin      boolean NOT NULL DEFAULT false,
  plan_code     text NOT NULL DEFAULT 'free',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Add is_admin if bootstrapping against an existing DB (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'saas_users' AND column_name = 'is_admin'
  ) THEN
    ALTER TABLE saas_users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_saas_users_email ON saas_users(email);

DROP TRIGGER IF EXISTS trg_saas_users_updated_at ON saas_users;
CREATE TRIGGER trg_saas_users_updated_at
  BEFORE UPDATE ON saas_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- -------------------------------------------------------
-- saas_projects
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS saas_projects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES saas_users(id) ON DELETE CASCADE,
  name       text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saas_projects_user_id ON saas_projects(user_id);

DROP TRIGGER IF EXISTS trg_saas_projects_updated_at ON saas_projects;
CREATE TRIGGER trg_saas_projects_updated_at
  BEFORE UPDATE ON saas_projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- -------------------------------------------------------
-- saas_quizzes
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS saas_quizzes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES saas_projects(id) ON DELETE CASCADE,
  title       text NOT NULL DEFAULT '',
  description text,
  data_json   jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saas_quizzes_project_id ON saas_quizzes(project_id);

DROP TRIGGER IF EXISTS trg_saas_quizzes_updated_at ON saas_quizzes;
CREATE TRIGGER trg_saas_quizzes_updated_at
  BEFORE UPDATE ON saas_quizzes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- -------------------------------------------------------
-- saas_game_sessions
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS saas_game_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES saas_users(id) ON DELETE CASCADE,
  project_id       uuid NOT NULL REFERENCES saas_projects(id) ON DELETE CASCADE,
  quiz_id          uuid NOT NULL REFERENCES saas_quizzes(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'created'
                     CHECK (status IN ('prepared','created','starting','running','paused','stopped','failed','orphaned')),
  overlay_token    text UNIQUE,
  overlay_url      text,
  tiktok_username  text,
  simulation_mode  boolean NOT NULL DEFAULT false,
  launch_options   jsonb NOT NULL DEFAULT '{}',
  scores_db_path   text,
  started_at       timestamptz,
  ended_at         timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saas_game_sessions_user_id ON saas_game_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_saas_game_sessions_quiz_id ON saas_game_sessions(quiz_id);

-- Ensure 'prepared' is included in the status CHECK constraint.
-- Drops and recreates the constraint only when it is outdated (idempotent).
DO $$
DECLARE
  v_constraint_def text;
BEGIN
  SELECT pg_get_constraintdef(oid)
    INTO v_constraint_def
    FROM pg_constraint
   WHERE conrelid = 'saas_game_sessions'::regclass
     AND conname  = 'saas_game_sessions_status_check';

  -- Nothing to do if the constraint already includes 'prepared'
  IF v_constraint_def IS NULL OR position('''prepared''' IN v_constraint_def) > 0 THEN
    RETURN;
  END IF;

  ALTER TABLE saas_game_sessions
    DROP CONSTRAINT saas_game_sessions_status_check;

  ALTER TABLE saas_game_sessions
    ADD CONSTRAINT saas_game_sessions_status_check
    CHECK (status IN ('prepared','created','starting','running','paused','stopped','failed','orphaned'));
END $$;

-- Add short_code column if it doesn't exist yet (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'saas_game_sessions' AND column_name = 'short_code'
  ) THEN
    ALTER TABLE saas_game_sessions ADD COLUMN short_code text UNIQUE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_saas_game_sessions_short_code
  ON saas_game_sessions(short_code)
  WHERE short_code IS NOT NULL;

-- Add ws_port column if it doesn't exist yet (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'saas_game_sessions' AND column_name = 'ws_port'
  ) THEN
    ALTER TABLE saas_game_sessions ADD COLUMN ws_port integer;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_saas_game_sessions_updated_at ON saas_game_sessions;
CREATE TRIGGER trg_saas_game_sessions_updated_at
  BEFORE UPDATE ON saas_game_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- -------------------------------------------------------
-- saas_session_snapshots
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS saas_session_snapshots (
  session_id  uuid PRIMARY KEY REFERENCES saas_game_sessions(id) ON DELETE CASCADE,
  snapshot    jsonb NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saas_session_snapshots_session_id
  ON saas_session_snapshots(session_id);

CREATE OR REPLACE FUNCTION update_session_snapshot_ts()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_saas_session_snapshots_updated_at ON saas_session_snapshots;
CREATE TRIGGER trg_saas_session_snapshots_updated_at
  BEFORE UPDATE ON saas_session_snapshots
  FOR EACH ROW EXECUTE FUNCTION update_session_snapshot_ts();

-- -------------------------------------------------------
-- saas_session_logs
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS saas_session_logs (
  id         bigserial PRIMARY KEY,
  session_id uuid NOT NULL,
  level      text NOT NULL DEFAULT 'INFO',
  message    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saas_session_logs_session_id ON saas_session_logs(session_id);

-- -------------------------------------------------------
-- saas_subscriptions
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS saas_subscriptions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL REFERENCES saas_users(id) ON DELETE CASCADE,
  stripe_customer_id     text,
  stripe_subscription_id text,
  stripe_price_id        text,
  plan_code              text NOT NULL DEFAULT 'free',
  status                 text NOT NULL DEFAULT 'active',
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean NOT NULL DEFAULT false,
  admin_override_plan_code    text,
  admin_override_reason  text,
  admin_override_by      uuid REFERENCES saas_users(id),
  admin_override_at      timestamptz,
  suspended_at           timestamptz,
  suspension_reason       text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_saas_subscriptions_user_id ON saas_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_saas_subscriptions_status ON saas_subscriptions(status);

-- Idempotent: add admin override and suspension columns for existing deployments
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'saas_subscriptions' AND column_name = 'admin_override_plan_code'
  ) THEN
    ALTER TABLE saas_subscriptions ADD COLUMN admin_override_plan_code text;
    ALTER TABLE saas_subscriptions ADD COLUMN admin_override_reason text;
    ALTER TABLE saas_subscriptions ADD COLUMN admin_override_by uuid REFERENCES saas_users(id);
    ALTER TABLE saas_subscriptions ADD COLUMN admin_override_at timestamptz;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'saas_subscriptions' AND column_name = 'suspended_at'
  ) THEN
    ALTER TABLE saas_subscriptions ADD COLUMN suspended_at timestamptz;
    ALTER TABLE saas_subscriptions ADD COLUMN suspension_reason text;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_saas_subscriptions_updated_at ON saas_subscriptions;
CREATE TRIGGER trg_saas_subscriptions_updated_at
  BEFORE UPDATE ON saas_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- -------------------------------------------------------
-- saas_billing_events
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS saas_billing_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES saas_users(id) ON DELETE SET NULL,
  stripe_event_id text UNIQUE NOT NULL,
  event_type      text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}',
  processed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saas_billing_events_stripe_event_id
  ON saas_billing_events(stripe_event_id);

-- -------------------------------------------------------
-- saas_music_tracks  (admin-managed background music catalog)
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS saas_music_tracks (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text        UNIQUE NOT NULL,
  name         text        NOT NULL,
  genre        text        NOT NULL DEFAULT 'General',
  duration_sec integer,
  file_name    text,
  active       boolean     NOT NULL DEFAULT true,
  sort_order   integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Idempotent: add file_name column for existing deployments upgrading from older schema.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'saas_music_tracks' AND column_name = 'file_name'
  ) THEN
    ALTER TABLE saas_music_tracks ADD COLUMN file_name text;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_saas_music_tracks_active_order
  ON saas_music_tracks(active, sort_order);

-- Seed default catalog; safe to run multiple times (ON CONFLICT DO NOTHING).
INSERT INTO saas_music_tracks (slug, name, genre, duration_sec, sort_order) VALUES
  ('none',        'No music',      'None',   null, 0),
  ('energetic_1', 'High Energy',   'Upbeat', 180,  10),
  ('chill_1',     'Chill Vibes',   'Chill',  210,  20),
  ('hype_1',      'Hype Mix',      'Upbeat', 195,  30),
  ('lofi_1',      'Lo-Fi Focus',   'Chill',  240,  40),
  ('retro_1',     'Retro Arcade',  'Retro',  160,  50)
ON CONFLICT (slug) DO NOTHING;

-- -------------------------------------------------------
-- platform_config  (admin-managed key/value config store)
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_config (
  key         text        PRIMARY KEY,
  value       jsonb       NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid        REFERENCES saas_users(id)
);

CREATE INDEX IF NOT EXISTS idx_platform_config_updated_at
  ON platform_config(updated_at);

DROP TRIGGER IF EXISTS trg_platform_config_updated_at ON platform_config;
CREATE TRIGGER trg_platform_config_updated_at
  BEFORE UPDATE ON platform_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- -------------------------------------------------------
-- password_reset_tokens
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES saas_users(id) ON DELETE CASCADE,
  token_hash  text        UNIQUE NOT NULL,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id
  ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at
  ON password_reset_tokens(expires_at);

-- -------------------------------------------------------
-- email_log
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_log (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        REFERENCES saas_users(id) ON DELETE SET NULL,
  recipient_email     text        NOT NULL,
  template_key        text        NOT NULL,
  subject             text        NOT NULL DEFAULT '',
  provider            text        NOT NULL DEFAULT 'mailjet',
  provider_message_id text,
  status              text        NOT NULL DEFAULT 'sent',
  error_message       text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_log_user_id ON email_log(user_id);
CREATE INDEX IF NOT EXISTS idx_email_log_template_key ON email_log(template_key);
CREATE INDEX IF NOT EXISTS idx_email_log_created_at ON email_log(created_at);

-- -------------------------------------------------------
-- auth_rate_limits  (per-action, per-identifier rate tracking)
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  id          bigserial   PRIMARY KEY,
  action      text        NOT NULL,
  identifier  text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_action_identifier
  ON auth_rate_limits(action, identifier, created_at);
"""


def run_bootstrap() -> None:
    from backend.saas.config import settings

    print("[Bootstrap] Connecting to database...")
    try:
        import psycopg2
        conn = psycopg2.connect(settings.DATABASE_URL)
        conn.autocommit = False
        cur = conn.cursor()
        print("[Bootstrap] Running schema SQL...")
        cur.execute(_SQL)
        conn.commit()
        cur.close()
        conn.close()
        print("[Bootstrap] Done. All tables created / already exist.")
    except Exception as e:
        print(f"[Bootstrap] FAILED: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    run_bootstrap()
