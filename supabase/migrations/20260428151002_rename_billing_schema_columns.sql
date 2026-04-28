/*
  # Rename billing schema columns for consistency

  1. Column Renames
    - `saas_subscriptions.admin_override_plan` -> `admin_override_plan_code`
      (Consistent with `plan_code` naming convention)
    - `saas_subscriptions.suspended_reason` -> `suspension_reason`
      (Consistent with `suspension` noun form)

  2. Safety
    - Uses ALTER TABLE RENAME COLUMN (non-destructive, no data loss)
    - Guarded by IF EXISTS checks to handle fresh deployments
      where the old column names never existed

  3. Important Notes
    - All backend code, frontend types, and bootstrap.py have been
      updated to use the new column names in the same release
    - No backward-compatibility aliases are needed since the rename
      is deployed atomically with the code changes
*/

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'saas_subscriptions' AND column_name = 'admin_override_plan'
  ) THEN
    ALTER TABLE saas_subscriptions RENAME COLUMN admin_override_plan TO admin_override_plan_code;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'saas_subscriptions' AND column_name = 'suspended_reason'
  ) THEN
    ALTER TABLE saas_subscriptions RENAME COLUMN suspended_reason TO suspension_reason;
  END IF;
END $$;
