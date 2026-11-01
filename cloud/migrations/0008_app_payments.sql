-- Payments for any app whose owner connected their own Stripe account (premium templates).
CREATE TABLE IF NOT EXISTS app_payments (
  slug TEXT NOT NULL, ref TEXT NOT NULL, kind TEXT NOT NULL, item TEXT, email TEXT, name TEXT,
  status TEXT NOT NULL DEFAULT 'pending', amount INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'usd',
  paid_amount INTEGER NOT NULL DEFAULT 0, refunded_amount INTEGER NOT NULL DEFAULT 0, lines TEXT, details TEXT,
  session_id TEXT, payment_intent TEXT, subscription_id TEXT, customer_id TEXT, period_end INTEGER,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (slug, ref)
);
CREATE INDEX IF NOT EXISTS app_payments_session ON app_payments (slug, session_id);
CREATE INDEX IF NOT EXISTS app_payments_sub ON app_payments (slug, subscription_id);
CREATE INDEX IF NOT EXISTS app_payments_pi ON app_payments (slug, payment_intent);
CREATE INDEX IF NOT EXISTS app_payments_email ON app_payments (slug, kind, email);
