-- Spawn Cloud: published apps, versions, domains, per-app data.
-- Apply: wrangler d1 migrations apply spawn-cloud [--local|--remote]

CREATE TABLE IF NOT EXISTS apps (
  slug          TEXT PRIMARY KEY,
  owner         TEXT NOT NULL,              -- "u:<spawnapp.org user id>"
  runtime       TEXT NOT NULL DEFAULT 'static', -- static | spawn-backend | bidboard
  status        TEXT NOT NULL DEFAULT 'active', -- active | unpublished | disabled
  live_version  INTEGER,                    -- NULL = nothing served
  title         TEXT,
  config        TEXT NOT NULL DEFAULT '{}', -- public JSON served by /api/config
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS apps_owner ON apps(owner);

CREATE TABLE IF NOT EXISTS versions (
  slug        TEXT NOT NULL,
  version     INTEGER NOT NULL,
  manifest    TEXT NOT NULL,                -- JSON {files:{"path":{h,s,t}}}
  file_count  INTEGER NOT NULL,
  total_bytes INTEGER NOT NULL,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (slug, version)
);

CREATE TABLE IF NOT EXISTS domains (
  hostname    TEXT PRIMARY KEY,             -- lower-case, e.g. shop.example.com
  slug        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | active | failed
  cf_id       TEXT,                         -- Cloudflare for SaaS custom hostname id
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS domains_slug ON domains(slug);

-- Encrypted per-app secrets (AES-256-GCM, key = Worker secret SECRETS_KEY). Values never leave the Worker.
CREATE TABLE IF NOT EXISTS app_secrets (
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL,
  blob        TEXT NOT NULL,                -- base64(iv[12] | ciphertext | tag[16])
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (slug, name)
);

-- Shared backend storage, scoped by app slug.
CREATE TABLE IF NOT EXISTS records (        -- leads, subscribers, interest
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL,
  kind        TEXT NOT NULL,
  email       TEXT,
  data        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS records_slug_kind ON records(slug, kind, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS records_sub_unique ON records(slug, kind, email) WHERE kind = 'subscriber';

CREATE TABLE IF NOT EXISTS rows (           -- /api/db/:table and /api/posts
  slug        TEXT NOT NULL,
  tbl         TEXT NOT NULL,
  id          TEXT NOT NULL,
  data        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (slug, tbl, id)
);

CREATE TABLE IF NOT EXISTS files (          -- /api/storage uploads (bytes in R2)
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  type        TEXT,
  delete_key  TEXT NOT NULL,               -- sha256 of the delete token handed to the uploader
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (slug, name)
);

CREATE TABLE IF NOT EXISTS rate (           -- fixed-window write rate limits
  k           TEXT PRIMARY KEY,
  n           INTEGER NOT NULL,
  reset_at    INTEGER NOT NULL
);

-- Per-app end-user accounts (/api/auth/*).
CREATE TABLE IF NOT EXISTS app_users (
  slug TEXT NOT NULL, email TEXT NOT NULL, name TEXT, algo TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL,
  created_at TEXT NOT NULL, PRIMARY KEY (slug, email)
);
CREATE TABLE IF NOT EXISTS app_sessions (
  id_hash TEXT PRIMARY KEY, slug TEXT NOT NULL, email TEXT NOT NULL, expires_at INTEGER NOT NULL
);

