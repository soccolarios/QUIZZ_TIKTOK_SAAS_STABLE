/*
  # Add plan_code to saas_users for backward compatibility

  1. Changes
    - `saas_users`
      - Add `plan_code` column (text, default 'free') — mirrors saas_subscriptions.plan_code
      - This column is kept in sync by upsert_subscription for guard queries and quick reads
      - The single source of truth remains saas_subscriptions; this is a denormalised cache only

  2. Notes
    - Existing rows get plan_code = 'free' by default
    - No data loss risk (additive change only)
    - RLS unchanged
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'saas_users' AND column_name = 'plan_code'
  ) THEN
    ALTER TABLE saas_users ADD COLUMN plan_code text NOT NULL DEFAULT 'free';
  END IF;
END $$;
