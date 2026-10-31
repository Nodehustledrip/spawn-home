-- BidBoard runtime tables (runtime = 'bidboard').
CREATE TABLE IF NOT EXISTS bb_jobs (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
  trade TEXT, state TEXT, city TEXT, zip TEXT, urgency TEXT,
  email TEXT, phone TEXT, photo_key TEXT,
  data TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bb_jobs_slug ON bb_jobs(slug, created_at);

CREATE TABLE IF NOT EXISTS bb_contractors (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL, email TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'pay_per_lead', stripe_customer TEXT, stripe_subscription TEXT,
  data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS bb_contractors_email ON bb_contractors(slug, email);

CREATE TABLE IF NOT EXISTS bb_unlocks (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL, job_id TEXT NOT NULL, token TEXT NOT NULL,
  email TEXT NOT NULL, status TEXT NOT NULL, amount_cents INTEGER NOT NULL,
  stripe_session TEXT, data TEXT NOT NULL, created_at TEXT NOT NULL, paid_at TEXT
);
CREATE INDEX IF NOT EXISTS bb_unlocks_job ON bb_unlocks(slug, job_id, token);

CREATE TABLE IF NOT EXISTS bb_places (
  city TEXT NOT NULL, state TEXT NOT NULL, code TEXT NOT NULL, city_l TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bb_places_city ON bb_places(city_l);
CREATE INDEX IF NOT EXISTS bb_places_code ON bb_places(code, city_l);

CREATE TABLE IF NOT EXISTS stripe_events (  -- webhook idempotency
  id TEXT PRIMARY KEY, slug TEXT NOT NULL, type TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
