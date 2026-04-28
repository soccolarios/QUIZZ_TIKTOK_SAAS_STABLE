/*
  # Add auth rate limits table

  1. New Tables
    - `auth_rate_limits`
      - `id` (bigserial, primary key)
      - `action` (text) — the action being rate-limited (e.g. 'password_reset', 'test_email')
      - `identifier` (text) — email address or IP address
      - `created_at` (timestamptz) — when the attempt occurred

  2. Purpose
    - Track password reset requests per email (cooldown enforcement)
    - Track password reset requests per IP (flood protection)
    - Track test email sends (abuse prevention)

  3. Indexes
    - Composite index on (action, identifier, created_at) for fast lookups
    - created_at index for expired record cleanup

  4. Security
    - RLS enabled, no public access (backend-only via service role)
    - Old records auto-cleaned by the application layer
*/

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  id          bigserial   PRIMARY KEY,
  action      text        NOT NULL,
  identifier  text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_lookup
  ON auth_rate_limits(action, identifier, created_at);
CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_cleanup
  ON auth_rate_limits(created_at);

ALTER TABLE auth_rate_limits ENABLE ROW LEVEL SECURITY;
