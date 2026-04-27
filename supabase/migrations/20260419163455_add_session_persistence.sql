/*
  # Session Persistence — SaaS Runtime State

  ## Summary
  Adds the infrastructure to persist SaaS session runtime state outside of
  process memory so that:
    1. Sessions survive a gunicorn/backend restart without data loss.
    2. Scores and participants (stored in per-session SQLite) are never in /tmp.
    3. The UI can display orphaned sessions (were running at last restart)
       and let the user close or inspect them.

  ## Changes

  ### saas_game_sessions
    - New column `scores_db_path` (text): absolute path to the session's
      persistent SQLite scores database. Written at session start.
    - Status CHECK extended: adds `'orphaned'` as a valid status.
      An orphaned session was running or paused when the process restarted.

  ### New table: saas_session_snapshots
    - One row per session (upserted on every state-change or question transition).
    - `snapshot` (jsonb): serialisable summary:
        { phase, question_index, question_total, leaderboard (top-20),
          engine_state, runtime_state, participant_count, scores_summary }
    - `updated_at`: updated on every upsert via trigger.

  ## Security
    - RLS enabled on `saas_session_snapshots`.
    - SELECT and DELETE policies scoped to the owning user via a JOIN on
      saas_game_sessions.
    - No INSERT/UPDATE policy needed: writes are done server-side via the
      service-role / direct DB connection (not via Supabase JS client).

  ## Notes
    - The `orphaned` status does NOT prevent future sessions; it is purely
      informational. The UI should show it as "interrupted".
    - scores_db_path is written once at session creation; never updated.
*/

-- -------------------------------------------------------
-- 1. Add orphaned to the status check on saas_game_sessions
-- -------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'saas_game_sessions'
      AND constraint_name = 'saas_game_sessions_status_check'
  ) THEN
    ALTER TABLE saas_game_sessions
      DROP CONSTRAINT saas_game_sessions_status_check;
  END IF;
END $$;

ALTER TABLE saas_game_sessions
  ADD CONSTRAINT saas_game_sessions_status_check
  CHECK (status IN ('created','starting','running','paused','stopped','failed','orphaned'));

-- -------------------------------------------------------
-- 2. Add scores_db_path column if it does not exist
-- -------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'saas_game_sessions' AND column_name = 'scores_db_path'
  ) THEN
    ALTER TABLE saas_game_sessions ADD COLUMN scores_db_path text;
  END IF;
END $$;

-- -------------------------------------------------------
-- 3. Create saas_session_snapshots table
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS saas_session_snapshots (
  session_id  uuid PRIMARY KEY REFERENCES saas_game_sessions(id) ON DELETE CASCADE,
  snapshot    jsonb NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saas_session_snapshots_session_id
  ON saas_session_snapshots(session_id);

-- Trigger: auto-update updated_at on upsert
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
-- 4. RLS on saas_session_snapshots
-- -------------------------------------------------------
ALTER TABLE saas_session_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own session snapshots"
  ON saas_session_snapshots FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM saas_game_sessions gs
      WHERE gs.id = saas_session_snapshots.session_id
        AND gs.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own session snapshots"
  ON saas_session_snapshots FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM saas_game_sessions gs
      WHERE gs.id = saas_session_snapshots.session_id
        AND gs.user_id = auth.uid()
    )
  );
