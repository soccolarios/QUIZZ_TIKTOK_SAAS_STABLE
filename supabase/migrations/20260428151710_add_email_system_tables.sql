/*
  # Add email system tables

  1. New Tables
    - `password_reset_tokens`
      - `id` (uuid, primary key)
      - `user_id` (uuid, FK -> saas_users)
      - `token_hash` (text, unique) — bcrypt hash of the reset token
      - `expires_at` (timestamptz) — when this token becomes invalid
      - `consumed_at` (timestamptz, nullable) — set when token is used
      - `created_at` (timestamptz)

    - `email_log`
      - `id` (uuid, primary key)
      - `user_id` (uuid, nullable, FK -> saas_users)
      - `recipient_email` (text) — the email address the message was sent to
      - `template_key` (text) — which template was used (e.g. 'welcome', 'password_reset')
      - `subject` (text) — the rendered subject line
      - `provider` (text) — 'mailjet' or 'none'
      - `provider_message_id` (text, nullable) — Mailjet message ID for tracking
      - `status` (text) — 'sent', 'failed', 'skipped'
      - `error_message` (text, nullable) — failure details if status = 'failed'
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on both tables
    - password_reset_tokens: no public access (backend-only via service role)
    - email_log: no public access (admin-only via service role)

  3. Indexes
    - password_reset_tokens: token_hash (unique), user_id, expires_at
    - email_log: user_id, template_key, created_at

  4. Important Notes
    - Tokens are hashed with SHA-256 before storage — the raw token is only
      sent in the email link and never stored
    - Expired and consumed tokens are kept for audit trail
    - email_log captures every send attempt for admin diagnostics
*/

-- password_reset_tokens
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

ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;

-- email_log
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

ALTER TABLE email_log ENABLE ROW LEVEL SECURITY;
