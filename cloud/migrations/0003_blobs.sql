-- File storage in D1 (no R2): published files, uploads and photos. Content is base64 text in chunks of <= 512 KiB raw.
-- Applied to both databases (DB and FILES); FILES may be a separate D1 database to keep each under the free 500 MB cap.
CREATE TABLE IF NOT EXISTS blobs (
  key        TEXT PRIMARY KEY,   -- blob/<slug>/<sha256> | data/<slug>/uploads/<name> | data/<slug>/photos/<id>
  type       TEXT,
  size       INTEGER NOT NULL,
  chunks     INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS blob_chunks (
  key  TEXT NOT NULL,
  idx  INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (key, idx)
);
