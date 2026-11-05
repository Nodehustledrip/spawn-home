"use strict";

/**
 * A tiny pg-Pool-compatible adapter over Cloudflare D1 (REST API).
 *
 * spawn-home's account/build code was written against `pool.query(sql, params)`
 * returning `{ rows }`. This adapter keeps that interface and translates the
 * handful of Postgres-isms we use (`$1`, `now()`, `interval`, `::casts`,
 * booleans) to SQLite, so auth/billing/cloud tokens work unchanged on D1.
 *
 * Timestamps are stored as ISO-8601 UTC strings (same shape as
 * Date#toISOString), so string comparison == time comparison.
 *
 * `batch([{sql, params}])` runs several statements in one HTTP round trip
 * (D1 runs a batch as a single transaction).
 *
 * `gen` increments on every write to users/sessions so callers can safely
 * cache session lookups in memory.
 */

const TS = "strftime('%Y-%m-%dT%H:%M:%fZ','now'";

function translate(sql) {
  let s = String(sql);
  s = s.replace(/now\(\)\s*([+-])\s*\(\s*(\$\d+)\s*\|\|\s*'\s*(\w+)'\s*\)::interval/gi, (m, op, p, unit) => `${TS},'${op}'||${p}||' ${unit}')`);
  s = s.replace(/now\(\)\s*([+-])\s*interval\s*'(\d+)\s*(\w+)'/gi, (m, op, n, unit) => `${TS},'${op}${n} ${unit}')`);
  s = s.replace(/now\(\)/gi, `${TS})`);
  s = s.replace(/([A-Za-z_][\w.]*)::text\b/g, "CAST($1 AS TEXT)");
  s = s.replace(/::(jsonb|json|timestamptz|int|integer|bigint|interval)\b/gi, "");
  s = s.replace(/\$(\d+)/g, "?$1");
  s = s.replace(/=\s*false\b/gi, "=0").replace(/=\s*true\b/gi, "=1");
  return s;
}

function param(v) {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === undefined) return null;
  return v;
}

function isDdl(sql) {
  return /^\s*(create|alter|drop)\b/i.test(sql);
}

function create(opts) {
  const accountId = opts.accountId;
  const token = opts.token;
  const dbId = opts.databaseId;
  const fetchImpl = opts.fetch || fetch;
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`;
  const pool = { kind: "d1", databaseId: dbId, gen: 0, cacheable: true };

  async function post(body, label) {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetchImpl(url, {
          method: "POST",
          headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.success) return j.result;
        const msg = String(((j.errors || [])[0] || {}).message || "").slice(0, 200);
        const err = new Error("D1 query failed (" + r.status + "): " + msg + " | " + String(label).slice(0, 60));
        if (/UNIQUE constraint/i.test(msg)) err.code = "23505";
        /* Only retry transport/5xx failures, never constraint/SQL errors. */
        if (r.status < 500 && r.status !== 429) throw err;
        lastErr = err;
      } catch (err) {
        if (err.code === "23505" || /D1 query failed \(4/.test(err.message)) throw err;
        lastErr = err;
      }
      await new Promise((res) => setTimeout(res, 250 * (attempt + 1)));
    }
    throw lastErr;
  }

  function touches(sql) {
    return !/^\s*select\b/i.test(sql) && /\b(users|sessions)\b/i.test(sql);
  }

  pool.query = async function (sql, params) {
    if (isDdl(sql)) return { rows: [], rowCount: 0 };
    const t = translate(sql);
    const res = await post({ sql: t, params: (params || []).map(param) }, t);
    if (touches(sql)) pool.gen++;
    const rows = (res && res[0] && res[0].results) || [];
    return { rows, rowCount: rows.length || ((res && res[0] && res[0].meta && res[0].meta.changes) || 0) };
  };

  /** Raw SQLite (no translation), used for schema setup. */
  pool.exec = async function (sql, params) {
    const res = await post({ sql, params: (params || []).map(param) }, sql);
    return (res && res[0] && res[0].results) || [];
  };

  pool.batch = async function (stmts) {
    if (!stmts.length) return [];
    const body = { batch: stmts.map((s) => ({ sql: s.raw ? s.sql : translate(s.sql), params: (s.params || []).map(param) })) };
    const res = await post(body, stmts[0].sql);
    if (stmts.some((s) => touches(s.sql))) pool.gen++;
    return (res || []).map((x) => (x && x.results) || []);
  };

  pool.on = function () {};
  pool.end = async function () {};
  return pool;
}

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS builds (id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, template TEXT, files TEXT NOT NULL DEFAULT '{}', history TEXT NOT NULL DEFAULT '{}', size_bytes INTEGER NOT NULL DEFAULT 0, edit_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))",
  "CREATE INDEX IF NOT EXISTS builds_owner_idx ON builds (owner, updated_at DESC)",
  /* Build files + undo history, JSON split into 512 KiB pieces (D1 rows cap at 2 MB). */
  "CREATE TABLE IF NOT EXISTS build_chunks (id TEXT NOT NULL, idx INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (id, idx))",
  "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), plan TEXT NOT NULL DEFAULT 'free', stripe_customer_id TEXT, stripe_subscription_id TEXT, plan_status TEXT, current_period_end TEXT)",
  "CREATE UNIQUE INDEX IF NOT EXISTS users_stripe_customer_idx ON users (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL",
  "CREATE TABLE IF NOT EXISTS stripe_events (id TEXT PRIMARY KEY, type TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))",
  "CREATE TABLE IF NOT EXISTS login_tokens (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), expires_at TEXT NOT NULL, used_at TEXT)",
  "CREATE TABLE IF NOT EXISTS sessions (id_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), expires_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id)",
  "CREATE TABLE IF NOT EXISTS cloud_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT, token_hash TEXT UNIQUE NOT NULL, created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), last_used_at TEXT, revoked_at TEXT, email TEXT)",
  "CREATE TABLE IF NOT EXISTS cloud_device_codes (device_hash TEXT PRIMARY KEY, user_code TEXT UNIQUE NOT NULL, user_id TEXT, name TEXT, expires_at TEXT NOT NULL, used INTEGER DEFAULT 0, email TEXT)",
  /* Waitlist / updates sign-ups (previously only a disk JSON + PostHog copy). */
  "CREATE TABLE IF NOT EXISTS waitlist (email TEXT PRIMARY KEY, source TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))",
  /* Daily HTML document loads by host (America/Chicago day). Batched UPSERTs from pageloads.js. */
  "CREATE TABLE IF NOT EXISTS page_loads (day TEXT NOT NULL, host TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, host))",
  "CREATE INDEX IF NOT EXISTS page_loads_day_idx ON page_loads (day)",
];

/* Idempotent column additions (SQLite has no ADD COLUMN IF NOT EXISTS). plan holds the tier: 'free' | 'pro' | 'elite'. */
const COLUMNS = [["users", "plan_price_id", "TEXT"]];
async function migrate(pool) {
  for (const [table, col, type] of COLUMNS) {
    const info = await pool.exec("PRAGMA table_info(" + table + ")");
    if ((info || []).some((c) => c.name === col)) continue;
    try { await pool.exec("ALTER TABLE " + table + " ADD COLUMN " + col + " " + type); }
    catch (err) { if (!/duplicate column/i.test(String(err && err.message))) throw err; }
  }
}

module.exports = { create, translate, SCHEMA, migrate, COLUMNS };
