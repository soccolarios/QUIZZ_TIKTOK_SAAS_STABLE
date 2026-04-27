/*
  # Add "prepared" session status

  ## Changes
  - Drops the existing CHECK constraint on saas_game_sessions.status
  - Re-adds it with 'prepared' as an allowed value
  - 'prepared' means: DB row exists, overlay_token and short_code assigned,
    but NO runtime has been started yet. The overlay URL is shareable in advance.

  ## Notes
  - Idempotent: constraint is dropped by name and recreated
  - No data migration needed; existing rows are unaffected
*/

ALTER TABLE saas_game_sessions
  DROP CONSTRAINT IF EXISTS saas_game_sessions_status_check;

ALTER TABLE saas_game_sessions
  ADD CONSTRAINT saas_game_sessions_status_check
  CHECK (status IN ('prepared','created','starting','running','paused','stopped','failed','orphaned'));
