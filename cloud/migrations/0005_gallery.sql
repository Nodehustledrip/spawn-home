-- Public gallery (spawnapp.org/gallery): opt-in listing for published apps.
-- listed: owner opted in; hidden: admin moderation; remixable: owner allows "Remix this" (static files only).
CREATE TABLE IF NOT EXISTS gallery (
  slug         TEXT PRIMARY KEY,
  owner        TEXT NOT NULL,
  listed       INTEGER NOT NULL DEFAULT 0,
  remixable    INTEGER NOT NULL DEFAULT 1,
  hidden       INTEGER NOT NULL DEFAULT 0,
  title        TEXT,
  description  TEXT,
  category     TEXT NOT NULL DEFAULT 'other',
  accent       TEXT,
  thumb_key    TEXT,
  remix_count  INTEGER NOT NULL DEFAULT 0,
  listed_at    TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS gallery_listed ON gallery(listed, hidden, listed_at);
CREATE TABLE IF NOT EXISTS gallery_reports (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL,
  reason      TEXT NOT NULL,
  note        TEXT,
  reporter    TEXT,                          -- sha256 of ip + day (no raw IP)
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS gallery_reports_slug ON gallery_reports(slug, created_at);
