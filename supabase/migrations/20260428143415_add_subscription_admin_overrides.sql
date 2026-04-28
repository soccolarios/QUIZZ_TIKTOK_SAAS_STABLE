/*
  # Add admin override and suspension support to subscriptions

  1. Modified Tables
    - `saas_subscriptions`
      - `admin_override_plan` (text, nullable) — Plan code set by admin, overrides Stripe
      - `admin_override_reason` (text, nullable) — Why the admin applied this override
      - `admin_override_by` (uuid, nullable, FK to saas_users) — Which admin did it
      - `admin_override_at` (timestamptz, nullable) — When the override was applied
      - `suspended_at` (timestamptz, nullable) — Non-null means account is suspended
      - `suspended_reason` (text, nullable) — Why the account was suspended

  2. New Indexes
    - Index on `saas_subscriptions.status` for efficient filtering

  3. Important Notes
    - Admin overrides take precedence over Stripe-managed plan_code
    - Suspended accounts always resolve to free-tier access
    - All changes are idempotent (safe to run multiple times)
*/

-- Add admin override columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'saas_subscriptions' AND column_name = 'admin_override_plan'
  ) THEN
    ALTER TABLE saas_subscriptions ADD COLUMN admin_override_plan text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'saas_subscriptions' AND column_name = 'admin_override_reason'
  ) THEN
    ALTER TABLE saas_subscriptions ADD COLUMN admin_override_reason text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'saas_subscriptions' AND column_name = 'admin_override_by'
  ) THEN
    ALTER TABLE saas_subscriptions ADD COLUMN admin_override_by uuid REFERENCES saas_users(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'saas_subscriptions' AND column_name = 'admin_override_at'
  ) THEN
    ALTER TABLE saas_subscriptions ADD COLUMN admin_override_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'saas_subscriptions' AND column_name = 'suspended_at'
  ) THEN
    ALTER TABLE saas_subscriptions ADD COLUMN suspended_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'saas_subscriptions' AND column_name = 'suspended_reason'
  ) THEN
    ALTER TABLE saas_subscriptions ADD COLUMN suspended_reason text;
  END IF;
END $$;

-- Index on status for admin queries
CREATE INDEX IF NOT EXISTS idx_saas_subscriptions_status
  ON saas_subscriptions(status);
