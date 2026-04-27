/*
  # Add ws_port to saas_game_sessions

  ## Summary
  Persists the dynamically allocated WebSocket port for each SaaS session
  directly on the session row. This allows overlay_resolver to retrieve the
  correct ws_port from the database even when the in-memory runtime is not
  yet started or has restarted.

  ## Changes

  ### saas_game_sessions
  - New column `ws_port` (integer, nullable): the TCP port allocated for this
    session's WebSocket server (range 9100-9199). Written once at session
    creation; never updated. NULL for sessions created before this migration.

  ## Notes
  - No RLS changes needed; this column is on an existing table with existing
    policies that already cover it.
  - The column is intentionally nullable: pre-existing / orphaned sessions
    will have ws_port = NULL, and overlay_resolver handles that gracefully.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'saas_game_sessions' AND column_name = 'ws_port'
  ) THEN
    ALTER TABLE saas_game_sessions ADD COLUMN ws_port integer;
  END IF;
END $$;
