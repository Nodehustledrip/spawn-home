-- Custom domains (card-free): each customer domain becomes a free Cloudflare zone in the Spawn account.
-- The Worker serves hosts listed in `domains` with status 'active'; this table holds the setup state.
CREATE TABLE IF NOT EXISTS custom_domains (
  hostname     TEXT PRIMARY KEY,            -- lower-case host served, e.g. example.com or shop.example.com
  slug         TEXT NOT NULL,
  owner        TEXT NOT NULL,               -- "u:<spawnapp.org user id>"
  zone_name    TEXT NOT NULL,               -- registrable domain, e.g. example.com
  zone_id      TEXT,
  role         TEXT NOT NULL DEFAULT 'primary', -- primary | www
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | active | failed
  nameservers  TEXT,                        -- JSON array assigned by Cloudflare
  record_id    TEXT,
  route_id     TEXT,
  error        TEXT,
  checked_at   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS custom_domains_slug ON custom_domains(slug);
CREATE INDEX IF NOT EXISTS custom_domains_zone ON custom_domains(zone_name);
