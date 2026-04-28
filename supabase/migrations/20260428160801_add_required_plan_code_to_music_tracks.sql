/*
  # Add required_plan_code to music tracks

  1. Modified Tables
    - `saas_music_tracks`
      - `required_plan_code` (text, nullable) - Plan code required to use this track (null = available to all plans)

  2. Notes
    - Allows admins to restrict certain music tracks to specific plan tiers
    - null means the track is available to all users
    - Values match plan codes from the pricing plans config (e.g., 'pro', 'business')
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'saas_music_tracks' AND column_name = 'required_plan_code'
  ) THEN
    ALTER TABLE saas_music_tracks ADD COLUMN required_plan_code text;
  END IF;
END $$;