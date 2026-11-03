-- Elite perks (card-free). Written by spawn-home (Render); read by the Worker.
-- Password-protected sites: PBKDF2-SHA256 hash + per-app salt. ver bumps on every change so old unlock cookies stop working.
CREATE TABLE IF NOT EXISTS app_protect (
  slug        TEXT PRIMARY KEY,
  pw_hash     TEXT NOT NULL,   -- hex
  pw_salt     TEXT NOT NULL,   -- hex
  iterations  INTEGER NOT NULL,
  ver         INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- Visitor stats: aggregate daily counts only. No IPs, no cookies, no user agents, no personal data.
-- kind: 'v' = page views (k=''), 'p' = page path, 'r' = referrer host ('' = direct / none).
CREATE TABLE IF NOT EXISTS app_stats (
  slug  TEXT NOT NULL,
  day   TEXT NOT NULL,          -- YYYY-MM-DD (UTC)
  kind  TEXT NOT NULL,
  k     TEXT NOT NULL,
  n     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (slug, day, kind, k)
);
-- Which apps count stats (enabled for Elite owners by spawn-home).
CREATE TABLE IF NOT EXISTS app_features (
  slug        TEXT PRIMARY KEY,
  stats       INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
