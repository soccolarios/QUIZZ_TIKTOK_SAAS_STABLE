/*
  # Create admin-managed music tracks library

  ## Summary
  Adds a `saas_music_tracks` table that holds the background music catalog
  managed exclusively by the SaaS admin. End users can browse and select
  tracks at session launch time but cannot upload or modify them.

  ## New Tables
  - `saas_music_tracks`
    - `id` (uuid, primary key)
    - `slug` (text, unique) — short identifier used in launch_options
    - `name` (text) — display name shown to users
    - `genre` (text) — genre label for grouping (e.g. "Upbeat", "Chill")
    - `duration_sec` (integer, nullable) — track length in seconds
    - `active` (boolean, default true) — admin can deactivate tracks
    - `sort_order` (integer, default 0) — display ordering
    - `created_at` (timestamptz)

  ## Security
  - RLS enabled
  - SELECT allowed for all authenticated users (read-only catalog)
  - No INSERT/UPDATE/DELETE policies for regular users (admin uses service role)

  ## Notes
  - File paths, CDN URLs, and copyright metadata are NOT stored here —
    those live on the server filesystem and are never exposed to the API
  - The `slug` is the only identifier passed via launch_options; the server
    resolves it to a file path internally
*/

CREATE TABLE IF NOT EXISTS saas_music_tracks (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text        UNIQUE NOT NULL,
  name         text        NOT NULL,
  genre        text        NOT NULL DEFAULT 'General',
  duration_sec integer,
  active       boolean     NOT NULL DEFAULT true,
  sort_order   integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE saas_music_tracks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view active music tracks"
  ON saas_music_tracks FOR SELECT
  TO authenticated
  USING (active = true);

-- Seed a small example catalog so the picker is non-empty.
-- Admin replaces these via the service-role client or admin panel.
INSERT INTO saas_music_tracks (slug, name, genre, duration_sec, sort_order) VALUES
  ('none',        'No music',      'None',    null, 0),
  ('energetic_1', 'High Energy',   'Upbeat',  180,  10),
  ('chill_1',     'Chill Vibes',   'Chill',   210,  20),
  ('hype_1',      'Hype Mix',      'Upbeat',  195,  30),
  ('lofi_1',      'Lo-Fi Focus',   'Chill',   240,  40),
  ('retro_1',     'Retro Arcade',  'Retro',   160,  50)
ON CONFLICT (slug) DO NOTHING;
