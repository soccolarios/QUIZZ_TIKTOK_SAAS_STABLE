/*
  # Add file_name column to saas_music_tracks

  ## Summary
  Adds a `file_name` column to the existing `saas_music_tracks` table so the
  backend can resolve a user-selected slug to the actual audio file stored on
  disk at /opt/tiktok-quiz-saas/data/music/<file_name>.

  ## Changes
  - `saas_music_tracks`
    - New column `file_name` (text, nullable) — the filename of the MP3 on disk,
      e.g. "battle-anthem.mp3". Nullable because the seed rows ("No music",
      placeholder slugs) have no real file. The backend treats NULL as music
      disabled for that track.

  ## Notes
  - The column is nullable so the existing seeded placeholder rows remain valid
    without requiring fake filenames.
  - Admins populate this column (via service-role INSERT/UPDATE) when adding
    real audio files.
  - The "none" slug deliberately stays NULL — the overlay treats NULL file_name
    as music_enabled=false.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'saas_music_tracks' AND column_name = 'file_name'
  ) THEN
    ALTER TABLE saas_music_tracks ADD COLUMN file_name text;
  END IF;
END $$;
