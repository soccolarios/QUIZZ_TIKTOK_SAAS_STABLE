/*
  # Add is_admin column to saas_users

  ## Changes
  - New column: `is_admin` BOOLEAN NOT NULL DEFAULT false on `saas_users`
  - Existing users default to non-admin (false)
  - Admins are set manually via direct DB update

  ## Notes
  - Safe to run multiple times (IF NOT EXISTS guard)
  - No RLS changes needed; admin flag is enforced at the application layer
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'saas_users' AND column_name = 'is_admin'
  ) THEN
    ALTER TABLE saas_users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;
