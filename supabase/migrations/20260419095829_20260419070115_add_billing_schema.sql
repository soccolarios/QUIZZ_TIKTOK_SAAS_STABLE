-- Billing schema: saas_subscriptions + saas_billing_events

CREATE TABLE IF NOT EXISTS saas_subscriptions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL REFERENCES saas_users(id) ON DELETE CASCADE,
  stripe_customer_id     text,
  stripe_subscription_id text,
  stripe_price_id        text,
  plan_code              text NOT NULL DEFAULT 'free',
  status                 text NOT NULL DEFAULT 'active',
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS saas_billing_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid REFERENCES saas_users(id) ON DELETE SET NULL,
  stripe_event_id  text UNIQUE NOT NULL,
  event_type       text NOT NULL,
  payload          jsonb NOT NULL DEFAULT '{}',
  processed_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE saas_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_billing_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'saas_subscriptions' AND policyname = 'Users can read own subscription') THEN
    CREATE POLICY "Users can read own subscription" ON saas_subscriptions FOR SELECT TO authenticated USING (auth.uid()::text = user_id::text);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'saas_subscriptions' AND policyname = 'Users can update own subscription') THEN
    CREATE POLICY "Users can update own subscription" ON saas_subscriptions FOR UPDATE TO authenticated USING (auth.uid()::text = user_id::text) WITH CHECK (auth.uid()::text = user_id::text);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'saas_subscriptions' AND policyname = 'Users can insert own subscription') THEN
    CREATE POLICY "Users can insert own subscription" ON saas_subscriptions FOR INSERT TO authenticated WITH CHECK (auth.uid()::text = user_id::text);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_saas_subscriptions_user_id ON saas_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_saas_subscriptions_stripe_customer ON saas_subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_saas_billing_events_stripe_event_id ON saas_billing_events(stripe_event_id);
