/*
  # Create platform_config key-value table

  1. New Tables
    - `platform_config`
      - `key` (text, primary key) — config namespace like 'site_config', 'plans', 'feature_flags'
      - `value` (jsonb) — the full JSON config object for that namespace
      - `updated_at` (timestamptz) — last modification timestamp
      - `updated_by` (uuid, nullable, FK to saas_users) — admin who last changed it

  2. Security
    - RLS enabled
    - Public SELECT for all authenticated users (config is public data)
    - INSERT/UPDATE/DELETE restricted to admin users only (is_admin = true)

  3. Notes
    - Uses a simple key-value pattern so each admin module stores its config
      under a single key without needing separate tables
    - Default rows are NOT inserted here — the backend falls back to defaults.ts
      values when no DB row exists, and the admin UI writes rows on first save
*/

CREATE TABLE IF NOT EXISTS platform_config (
  key         text        PRIMARY KEY,
  value       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid        REFERENCES saas_users(id)
);

ALTER TABLE platform_config ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read platform config
CREATE POLICY "Authenticated users can read platform config"
  ON platform_config
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- Only admin users can insert config
CREATE POLICY "Admins can insert platform config"
  ON platform_config
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM saas_users
      WHERE saas_users.id = auth.uid()
      AND saas_users.is_admin = true
    )
  );

-- Only admin users can update config
CREATE POLICY "Admins can update platform config"
  ON platform_config
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM saas_users
      WHERE saas_users.id = auth.uid()
      AND saas_users.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM saas_users
      WHERE saas_users.id = auth.uid()
      AND saas_users.is_admin = true
    )
  );

-- Only admin users can delete config
CREATE POLICY "Admins can delete platform config"
  ON platform_config
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM saas_users
      WHERE saas_users.id = auth.uid()
      AND saas_users.is_admin = true
    )
  );
