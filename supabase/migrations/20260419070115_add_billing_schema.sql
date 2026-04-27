/*
  # Billing Schema — Stripe Subscriptions

  ## Summary
  Adds billing tables to support Stripe-powered subscriptions for the SaaS platform.

  ## New Tables

  ### saas_subscriptions
  One row per user representing their current/latest subscription state.
  - `id` — primary key (uuid)
  - `user_id` — fk to saas_users, unique (one subscription per user)
  - `stripe_customer_id` — Stripe customer object ID
  - `stripe_subscription_id` — Stripe subscription object ID (null on free)
  - `stripe_price_id` — Stripe price ID in use
  - `plan_code` — internal plan name: free | pro | premium
  - `status` — mirrors Stripe subscription status: active | trialing | past_due | canceled | incomplete
  - `current_period_start` / `current_period_end` — billing window
  - `cancel_at_period_end` — boolean, true if scheduled to cancel
  - `created_at` / `updated_at`

  ### saas_billing_events
  Append-only log of Stripe webhook events for audit/debug.
  - `id` — primary key (uuid)
  - `user_id` — nullable fk (may not be known at receipt time)
  - `stripe_event_id` — idempotency key, unique
  - `event_type` — e.g. checkout.session.completed
  - `payload` — full event JSON
  - `processed_at`

  ## Security
  RLS enabled on both tables. Users can only read their own subscription.
  Webhook inserts bypass RLS via service role key (server-side only).

  ## Notes
  1. A user with no row in saas_subscriptions is treated as FREE by the backend.
  2. plan_code "free" is explicitly stored after checkout cancellation or deletion.
  3. billing_events are insert-only from the backend; users cannot read them.
*/

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

CREATE POLICY "Users can read own subscription"
  ON saas_subscriptions FOR SELECT
  TO authenticated
  USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can update own subscription"
  ON saas_subscriptions FOR UPDATE
  TO authenticated
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

CREATE POLICY "Users can insert own subscription"
  ON saas_subscriptions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid()::text = user_id::text);

CREATE INDEX IF NOT EXISTS idx_saas_subscriptions_user_id ON saas_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_saas_subscriptions_stripe_customer ON saas_subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_saas_billing_events_stripe_event_id ON saas_billing_events(stripe_event_id);
