-- Add started_at and ended_at timestamps to saas_game_sessions
-- These track when a session actually began running and when it stopped/failed

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'saas_game_sessions' AND column_name = 'started_at'
  ) THEN
    ALTER TABLE saas_game_sessions ADD COLUMN started_at timestamptz;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'saas_game_sessions' AND column_name = 'ended_at'
  ) THEN
    ALTER TABLE saas_game_sessions ADD COLUMN ended_at timestamptz;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'saas_game_sessions' AND column_name = 'tiktok_username'
  ) THEN
    ALTER TABLE saas_game_sessions ADD COLUMN tiktok_username text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'saas_game_sessions' AND column_name = 'simulation_mode'
  ) THEN
    ALTER TABLE saas_game_sessions ADD COLUMN simulation_mode boolean DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'saas_game_sessions' AND column_name = 'launch_options'
  ) THEN
    ALTER TABLE saas_game_sessions ADD COLUMN launch_options jsonb DEFAULT '{}';
  END IF;
END $$;

-- Update status check constraint to include 'failed' state
ALTER TABLE saas_game_sessions
  DROP CONSTRAINT IF EXISTS saas_game_sessions_status_check;

ALTER TABLE saas_game_sessions
  ADD CONSTRAINT saas_game_sessions_status_check
  CHECK (status IN ('created', 'starting', 'running', 'paused', 'stopped', 'failed'));
