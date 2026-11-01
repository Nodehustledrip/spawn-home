/*
 * Spawn Cloud publish API.
 * Dormant unless CLOUD_PUBLISH_ENABLED=1 AND a storage backend is configured:
 *   - Cloudflare: CF_ACCOUNT_ID, CF_API_TOKEN (D1 edit), CF_D1_DATABASE_ID, CLOUD_SECRETS_KEY
 *     (optional CF_D1_FILES_DATABASE_ID [= CF_D1_DATABASE_ID], CLOUD_APEX [spawnapp.org], CLOUD_ADMIN_EMAILS). No R2.
 *   - Local (development/tests only): CLOUD_PUBLISH_LOCAL_DIR + CLOUD_SECRETS_KEY — files on disk, D1 emulated with node:sqlite.
 * While dormant every /api/cloud/* route and /cloud/connect answer 503 {enabled:false}.
 */
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const RESERVED = new Set(["www", "api", "app", "apps", "admin", "mail", "smtp", "cdn", "static", "assets", "cloud", "status", "docs", "help", "support", "blog", "dev", "staging", "preview", "auth", "login", "dashboard", "billing", "spawn", "home", "ns1", "ns2", "mx", "ftp", "test", "pay", "send", "rsend", "_domainconnect"]);
const LIMITS = { files: 2000, fileBytes: 10 * 1024 * 1024, totalBytes: 100 * 1024 * 1024, keepVersions: 10 };
const ALLOWED_EXT = new Set(["html", "htm", "css", "js", "mjs", "json", "webmanifest", "map", "txt", "xml", "md", "csv", "png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "bmp", "woff", "woff2", "ttf", "otf", "eot", "mp3", "wav", "ogg", "m4a", "mp4", "webm", "pdf", "wasm", "glb", "gltf", "bin"]);
const BLOCKED = [/(^|\/)\.env/i, /(^|\/)node_modules\//, /(^|\/)\.git\//, /(^|\/)data\//, /(^|\/)(server|db|ai|auth|storage|places)\.js$/, /(^|\/)package(-lock)?\.json$/, /\.(sqlite|db|pem|key)$/i, /(^|\/)_forge_[^/]*$/];
const MIME = { html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8", json: "application/json", webmanifest: "application/manifest+json", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", ico: "image/x-icon", woff2: "font/woff2", woff: "font/woff", txt: "text/plain; charset=utf-8", xml: "application/xml", pdf: "application/pdf", wasm: "application/wasm", mp4: "video/mp4", mp3: "audio/mpeg" };
const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const sha = (v) => crypto.createHash("sha256").update(v).digest("hex");
const nowIso = () => new Date().toISOString();

function env(name, def) { const v = process.env[name]; return v == null || v === "" ? def : v; }
function mode() {
  if (env("CLOUD_PUBLISH_ENABLED") !== "1") return null;
  if (!env("CLOUD_SECRETS_KEY")) return null;
  if (["CF_ACCOUNT_ID", "CF_API_TOKEN", "CF_D1_DATABASE_ID"].every((k) => env(k))) return "cloudflare";
  if (env("CLOUD_PUBLISH_LOCAL_DIR")) return "local";
  return null;
}
function enabled() { return !!mode(); }
function apex() { return env("CLOUD_APEX", "spawnapp.org"); }

/* ---------------- storage backends ----------------
 * Everything lives in D1 (no R2, no card): metadata in CF_D1_DATABASE_ID, files in CF_D1_FILES_DATABASE_ID
 * (defaults to the same database). Files are content-addressed (blob/<slug>/<sha256>) and split into base64
 * chunks of 512 KiB so each row stays far below D1's 2 MB row limit. Versions share unchanged files.
 */
const CHUNK = 512 * 1024;
function blobOps(fq) {
  return {
    async head(key) { return (await fq("SELECT 1 AS x FROM blobs WHERE key=?1", [key])).length > 0; },
    async put(key, buf, type) {
      const n = Math.max(1, Math.ceil(buf.length / CHUNK));
      await fq("DELETE FROM blobs WHERE key=?1", [key]);
      await fq("DELETE FROM blob_chunks WHERE key=?1", [key]);
      for (let i = 0; i < n; i++) await fq("INSERT INTO blob_chunks (key, idx, data) VALUES (?1,?2,?3)", [key, i, buf.subarray(i * CHUNK, (i + 1) * CHUNK).toString("base64")]);
      // the blobs row goes last, so a half-written file is never visible
      await fq("INSERT INTO blobs (key, type, size, chunks) VALUES (?1,?2,?3,?4)", [key, type || null, buf.length, n]);
    },
    async del(key) { await fq("DELETE FROM blobs WHERE key=?1", [key]); await fq("DELETE FROM blob_chunks WHERE key=?1", [key]); },
    async list(prefix, olderThanIso) {
      const rows = await fq("SELECT key FROM blobs WHERE substr(key,1,length(?1))=?1 AND created_at < ?2", [prefix, olderThanIso || "9999"]);
      return rows.map((r) => r.key);
    },
  };
}

function cloudflareBackend() {
  const acct = env("CF_ACCOUNT_ID");
  const mk = (dbId) => async function d1(sql, params) {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/d1/database/${dbId}/query`, {
      method: "POST", headers: { Authorization: "Bearer " + env("CF_API_TOKEN"), "Content-Type": "application/json" }, body: JSON.stringify({ sql, params: params || [] }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.success) throw new Error("D1 query failed (" + r.status + "): " + String(((j.errors || [])[0] || {}).message || "").slice(0, 160) + " | " + sql.slice(0, 60));
    return (j.result && j.result[0] && j.result[0].results) || [];
  };
  const query = mk(env("CF_D1_DATABASE_ID"));
  const fquery = mk(env("CF_D1_FILES_DATABASE_ID", env("CF_D1_DATABASE_ID")));
  return Object.assign({ kind: "cloudflare", query }, blobOps(fquery));
}

function localBackend(dir) {
  const { DatabaseSync } = require("node:sqlite");
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "d1.sqlite"));
  const migDir = path.join(__dirname, "cloud", "migrations");
  for (const f of fs.readdirSync(migDir).sort()) db.exec(fs.readFileSync(path.join(migDir, f), "utf8"));
  async function query(sql, params) { const st = db.prepare(sql); return /^\s*(select|with)|returning/i.test(sql) ? st.all(...(params || [])) : (st.run(...(params || [])), []); }
  return Object.assign({ kind: "local", dir, db, query }, blobOps(query));
}

/* ---------------- secrets (same format the Worker decrypts) ---------------- */
function encryptSecret(slug, name, value) {
  const key = Buffer.from(env("CLOUD_SECRETS_KEY"), "base64");
  if (key.length !== 32) throw new Error("CLOUD_SECRETS_KEY must be 32 bytes base64");
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(slug + ":" + name));
  const ct = Buffer.concat([c.update(String(value), "utf8"), c.final()]);
  return Buffer.concat([iv, ct, c.getAuthTag()]).toString("base64");
}

/* ---------------- app presets: runtime, config and keys that come from Render env ----------------
 * Keys are set once on Render (never pasted anywhere else) and copied, encrypted, into the app's secrets
 * whenever spawn-home starts and right after each publish of that app. Only runs when Spawn Cloud is enabled.
 * A preset slug is reserved for its owner (by spawnapp.org account email); without an owner email it can't be claimed.
 */
const APP_PRESETS = {
  bidboard: {
    ownerEnv: "BIDBOARD_OWNER_EMAIL",
    runtime: "bidboard",
    config: { LEAD_FEE_CENTS: 2500, PRO_FEE_CENTS: 9900 },
    secrets: {
      STRIPE_SECRET_KEY: "BIDBOARD_STRIPE_SECRET_KEY",
      STRIPE_WEBHOOK_SECRET: "BIDBOARD_STRIPE_WEBHOOK_SECRET",
      STRIPE_PRICE_LEAD: "BIDBOARD_STRIPE_PRICE_LEAD",
      STRIPE_PRICE_PRO: "BIDBOARD_STRIPE_PRICE_PRO",
      STRIPE_PORTAL_CONFIG: "BIDBOARD_STRIPE_PORTAL_CONFIG",
      AI_API_KEY: "BIDBOARD_AI_API_KEY",
      AI_BASE_URL: "BIDBOARD_AI_BASE_URL",
      AI_MODEL: "BIDBOARD_AI_MODEL",
    },
  },
};
const presetSynced = new Map(); // "slug:name" -> sha256 of last value written by this process
function presetOwnerOk(slug, user) {
  const p = APP_PRESETS[slug];
  if (!p) return true;
  const owner = String(env(p.ownerEnv, "")).trim().toLowerCase();
  return !!owner && !!user && String(user.email || "").toLowerCase() === owner;
}
async function syncPresets(backend, onlySlug) {
  const out = [];
  for (const [slug, p] of Object.entries(APP_PRESETS)) {
    if (onlySlug && onlySlug !== slug) continue;
    const rows = await backend.query("SELECT slug, runtime, config FROM apps WHERE slug=?1", [slug]);
    if (!rows[0]) { out.push({ slug, skipped: "not published yet" }); continue; }
    let cfg = {}; try { cfg = JSON.parse(rows[0].config || "{}") || {}; } catch (_) {}
    const merged = Object.assign({}, p.config, cfg);
    if (rows[0].runtime !== p.runtime || JSON.stringify(merged) !== JSON.stringify(cfg))
      await backend.query("UPDATE apps SET runtime=?2, config=?3, updated_at=?4 WHERE slug=?1", [slug, p.runtime, JSON.stringify(merged), nowIso()]);
    const written = [];
    for (const [name, envName] of Object.entries(p.secrets)) {
      const v = env(envName);
      if (!v) continue;
      const fp = sha(slug + ":" + name + ":" + v);
      if (presetSynced.get(slug + ":" + name) === fp) continue;
      await backend.query("INSERT INTO app_secrets (slug, name, blob, updated_at) VALUES (?1,?2,?3,?4) ON CONFLICT(slug, name) DO UPDATE SET blob=excluded.blob, updated_at=excluded.updated_at",
        [slug, name, encryptSecret(slug, name, v), nowIso()]);
      presetSynced.set(slug + ":" + name, fp);
      written.push(name);
    }
    out.push({ slug, runtime: p.runtime, secretsWritten: written });
    if (written.length) console.log("[cloud] " + slug + ": updated app secrets " + written.join(", ")); // names only
  }
  return out;
}

/* ---------------- publish tokens (Postgres, or memory for local/tests) ---------------- */
function pgTokenStore(getPool) {
  let ready = null;
  const q = async (sql, p) => {
    const pool = getPool(); if (!pool) throw new Error("accounts database unavailable");
    if (!ready) ready = pool.query(
      "CREATE TABLE IF NOT EXISTS cloud_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT, token_hash TEXT UNIQUE NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), last_used_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, email TEXT);" +
      "ALTER TABLE cloud_tokens ADD COLUMN IF NOT EXISTS email TEXT;" +
      "CREATE TABLE IF NOT EXISTS cloud_device_codes (device_hash TEXT PRIMARY KEY, user_code TEXT UNIQUE NOT NULL, user_id TEXT, name TEXT, expires_at TIMESTAMPTZ NOT NULL, used BOOLEAN DEFAULT false, email TEXT);" +
      "ALTER TABLE cloud_device_codes ADD COLUMN IF NOT EXISTS email TEXT;"
    ).catch((e) => { ready = null; throw e; });
    await ready; return (await pool.query(sql, p)).rows;
  };
  return {
    async create(userId, name, hash, email) { const id = crypto.randomBytes(6).toString("hex"); await q("INSERT INTO cloud_tokens (id,user_id,name,token_hash,email) VALUES ($1,$2,$3,$4,$5)", [id, String(userId), name, hash, email || null]); return id; },
    async byHash(hash) { const r = await q("UPDATE cloud_tokens SET last_used_at=now() WHERE token_hash=$1 AND revoked_at IS NULL RETURNING id,user_id,email", [hash]); return r[0] || null; },
    async list(userId) { return q("SELECT id,name,created_at,last_used_at FROM cloud_tokens WHERE user_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC", [String(userId)]); },
    async revoke(userId, id) { const r = await q("UPDATE cloud_tokens SET revoked_at=now() WHERE user_id=$1 AND id=$2 AND revoked_at IS NULL RETURNING id", [String(userId), id]); return r.length > 0; },
    async deviceCreate(deviceHash, userCode, name) { await q("INSERT INTO cloud_device_codes (device_hash,user_code,name,expires_at) VALUES ($1,$2,$3,now()+interval '10 minutes')", [deviceHash, userCode, name]); },
    async deviceApprove(userCode, userId, email) { const r = await q("UPDATE cloud_device_codes SET user_id=$2, email=$3 WHERE user_code=$1 AND user_id IS NULL AND used=false AND expires_at>now() RETURNING device_hash", [userCode, String(userId), email || null]); return r.length > 0; },
    async deviceTake(deviceHash) { const r = await q("UPDATE cloud_device_codes SET used=true WHERE device_hash=$1 AND user_id IS NOT NULL AND used=false AND expires_at>now() RETURNING user_id,name,email", [deviceHash]); if (r[0]) return r[0];
      const p = await q("SELECT 1 FROM cloud_device_codes WHERE device_hash=$1 AND used=false AND expires_at>now()", [deviceHash]); return p.length ? "pending" : null; },
  };
}
function memoryTokenStore() {
  const tokens = new Map(), devices = new Map();
  return {
    async create(userId, name, hash, email) { const id = crypto.randomBytes(6).toString("hex"); tokens.set(id, { id, user_id: String(userId), name, hash, email: email || null, created_at: nowIso() }); return id; },
    async byHash(hash) { for (const t of tokens.values()) if (t.hash === hash && !t.revoked) return { id: t.id, user_id: t.user_id, email: t.email }; return null; },
    async list(userId) { return [...tokens.values()].filter((t) => t.user_id === String(userId) && !t.revoked).map(({ id, name, created_at }) => ({ id, name, created_at })); },
    async revoke(userId, id) { const t = tokens.get(id); if (!t || t.user_id !== String(userId) || t.revoked) return false; t.revoked = true; return true; },
    async deviceCreate(h, code, name) { devices.set(h, { code, name, exp: Date.now() + 600000 }); },
    async deviceApprove(code, userId, email) { for (const d of devices.values()) if (d.code === code && !d.user && !d.used && d.exp > Date.now()) { d.user = String(userId); d.email = email || null; return true; } return false; },
    async deviceTake(h) { const d = devices.get(h); if (!d || d.used || d.exp < Date.now()) return null; if (!d.user) return "pending"; d.used = true; return { user_id: d.user, name: d.name, email: d.email }; },
  };
}

/* ---------------- validation ---------------- */
function validPath(p) {
  if (typeof p !== "string" || !p || p.length > 300 || p.startsWith("/") || p.includes("\\") || p.includes("\0")) return false;
  if (p.split("/").some((s) => !s || s === "." || s === "..")) return false;
  if (BLOCKED.some((re) => re.test(p))) return false;
  const ext = (p.split(".").pop() || "").toLowerCase();
  return p.includes(".") && ALLOWED_EXT.has(ext);
}
function checkManifest(m) {
  const files = m && m.files;
  if (!files || typeof files !== "object") return "manifest.files required";
  const entries = Object.entries(files);
  if (!entries.length) return "Nothing to publish.";
  if (entries.length > LIMITS.files) return "Too many files (max " + LIMITS.files + ").";
  let total = 0;
  for (const [p, f] of entries) {
    if (!validPath(p)) return "File not allowed: " + String(p).slice(0, 120);
    if (!f || !/^[a-f0-9]{64}$/.test(f.h) || !Number.isInteger(f.s) || f.s < 0) return "Bad manifest entry for " + p;
    if (f.s > LIMITS.fileBytes) return p + " is larger than 10 MB.";
    total += f.s;
  }
  if (total > LIMITS.totalBytes) return "Site is larger than 100 MB.";
  if (!files["index.html"]) return "index.html is required.";
  return null;
}
const mimeFor = (p) => MIME[(p.split(".").pop() || "").toLowerCase()] || "application/octet-stream";

/* ---------------- routes ---------------- */
function mount(app, opts) {
  opts = opts || {};
  const auth = opts.auth || require("./auth");
  const tokens = opts.tokenStore || (mode() === "local" ? memoryTokenStore() : pgTokenStore(() => require("./buildstore").getPool && require("./buildstore").getPool()));
  let backend = opts.backend || null;
  const be = () => backend || (backend = mode() === "cloudflare" ? cloudflareBackend() : localBackend(env("CLOUD_PUBLISH_LOCAL_DIR")));
  const r = express.Router();
  const rate = new Map();
  function limited(key, max, windowMs) {
    const t = Date.now(); const e = rate.get(key);
    if (!e || e.reset < t) { rate.set(key, { n: 1, reset: t + windowMs }); return false; }
    return ++e.n > max;
  }
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((err) => {
    console.error("[cloud]", err && err.message);
    if (!res.headersSent) res.status(err.status || 500).json({ ok: false, error: err.status ? err.message : "Something went wrong publishing. Try again." });
  });
  const fail = (status, message) => Object.assign(new Error(message), { status });

  r.use(express.json({ limit: "2mb" }));
  r.use((req, res, next) => {
    if (!enabled()) return res.status(503).json({ ok: false, enabled: false, error: "Spawn Cloud publishing is not enabled yet." });
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  r.get("/status", (req, res) => res.json({ ok: true, enabled: true, apex: apex() }));

  async function sessionUser(req) { const u = await auth.currentUser(req); if (!u) throw fail(401, "Sign in to spawnapp.org first."); return u; }
  async function tokenUser(req) {
    const m = /^Bearer\s+(spk_[A-Za-z0-9_-]{30,80})$/.exec(String(req.headers.authorization || ""));
    if (!m) throw fail(401, "Publish token required. Connect Spawn to your spawnapp.org account.");
    const t = await tokens.byHash(sha("pt:" + m[1]));
    if (!t) throw fail(401, "This publish token was revoked or is invalid. Reconnect Spawn.");
    return { id: t.user_id, tokenId: t.id, email: t.email || null };
  }
  const mint = () => "spk_" + crypto.randomBytes(24).toString("base64url");

  // Token management (signed-in web session).
  r.get("/tokens", wrap(async (req, res) => { const u = await sessionUser(req); res.json({ ok: true, tokens: await tokens.list(u.id) }); }));
  r.post("/tokens", wrap(async (req, res) => {
    const u = await sessionUser(req); const tok = mint();
    const id = await tokens.create(u.id, String((req.body && req.body.name) || "Spawn desktop").slice(0, 60), sha("pt:" + tok), u.email);
    res.status(201).json({ ok: true, id, token: tok, note: "Shown once. Paste it into Spawn → Go Live → Spawn Cloud." });
  }));
  r.delete("/tokens/:id", wrap(async (req, res) => { const u = await sessionUser(req); res.json({ ok: await tokens.revoke(u.id, String(req.params.id)) }); }));

  // Device sign-in for the desktop app.
  r.post("/device", wrap(async (req, res) => {
    if (limited("dev:" + req.ip, 20, 600000)) throw fail(429, "Too many sign-in attempts. Try again shortly.");
    const device = crypto.randomBytes(24).toString("base64url");
    const A = "BCDFGHJKLMNPQRSTVWXZ23456789"; const pick = () => Array.from(crypto.randomBytes(4), (b) => A[b % A.length]).join("");
    const userCode = pick() + "-" + pick();
    await tokens.deviceCreate(sha("dc:" + device), userCode, String((req.body && req.body.name) || "Spawn desktop").slice(0, 60));
    const site = env("PUBLIC_BASE_URL", "https://" + apex());
    res.json({ ok: true, device_code: device, user_code: userCode, verify_url: site + "/cloud/connect?code=" + userCode, interval: 3, expires_in: 600 });
  }));
  r.post("/device/approve", wrap(async (req, res) => {
    const u = await sessionUser(req);
    const ok = await tokens.deviceApprove(String((req.body && req.body.user_code) || "").toUpperCase().trim(), u.id, u.email);
    if (!ok) throw fail(400, "That code expired or was already used. Start again from Spawn.");
    res.json({ ok: true });
  }));
  r.post("/device/token", wrap(async (req, res) => {
    const d = String((req.body && req.body.device_code) || "");
    if (limited("poll:" + d.slice(0, 12), 300, 600000)) throw fail(429, "slow_down");
    const t = await tokens.deviceTake(sha("dc:" + d));
    if (t === "pending") return res.status(428).json({ ok: false, pending: true });
    if (!t) throw fail(400, "Sign-in expired. Start again.");
    const tok = mint(); await tokens.create(t.user_id, t.name || "Spawn desktop", sha("pt:" + tok), t.email);
    res.json({ ok: true, token: tok });
  }));

  // Apps (publish token).
  async function ownedApp(user, slug, allowNew) {
    if (!SLUG_RE.test(slug) || RESERVED.has(slug)) throw fail(400, "Choose a name with letters, numbers and dashes (2–40 characters).");
    const rows = await be().query("SELECT slug, owner, runtime, status, live_version, title FROM apps WHERE slug=?1", [slug]);
    const a = rows[0];
    if (a && a.owner !== "u:" + user.id) throw fail(409, "That name is taken. Pick another.");
    if (!a && allowNew && !presetOwnerOk(slug, user)) throw fail(409, "That name is taken. Pick another.");
    if (!a && !allowNew) throw fail(404, "App not found.");
    return a || null;
  }
  r.get("/apps", wrap(async (req, res) => {
    const u = await tokenUser(req);
    const apps = await be().query("SELECT slug, runtime, status, live_version, title, updated_at FROM apps WHERE owner=?1 ORDER BY updated_at DESC", ["u:" + u.id]);
    res.json({ ok: true, apps: apps.map((a) => Object.assign(a, { url: "https://" + a.slug + "." + apex() + "/" })) });
  }));
  r.get("/apps/:slug/versions", wrap(async (req, res) => {
    const u = await tokenUser(req); const a = await ownedApp(u, req.params.slug, false);
    const v = await be().query("SELECT version, file_count, total_bytes, note, created_at FROM versions WHERE slug=?1 ORDER BY version DESC", [a.slug]);
    res.json({ ok: true, live: a.status === "active" ? a.live_version : null, status: a.status, versions: v });
  }));

  r.post("/apps/:slug/publish/begin", wrap(async (req, res) => {
    const u = await tokenUser(req);
    if (limited("pub:" + u.id, 30, 3600000)) throw fail(429, "Publishing limit reached. Try again in an hour.");
    const slug = req.params.slug; const a = await ownedApp(u, slug, true);
    const err = checkManifest(req.body && req.body.manifest); if (err) throw fail(400, err);
    const need = [];
    for (const f of Object.values(req.body.manifest.files)) {
      if (need.includes(f.h)) continue;
      if (!(await be().head(`blob/${slug}/${f.h}`))) need.push(f.h);
    }
    res.json({ ok: true, slug, need, url: "https://" + slug + "." + apex() + "/" });
  }));
  r.put("/apps/:slug/blobs/:hash", express.raw({ type: "*/*", limit: LIMITS.fileBytes }), wrap(async (req, res) => {
    const u = await tokenUser(req); const slug = req.params.slug; await ownedApp(u, slug, true);
    const h = String(req.params.hash);
    if (!/^[a-f0-9]{64}$/.test(h)) throw fail(400, "bad hash");
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (sha(buf) !== h) throw fail(400, "Upload was corrupted (hash mismatch). Try again.");
    await be().put(`blob/${slug}/${h}`, buf);
    res.json({ ok: true });
  }));
  r.post("/apps/:slug/publish/commit", wrap(async (req, res) => {
    const u = await tokenUser(req); const slug = req.params.slug; const a = await ownedApp(u, slug, true);
    const manifest = req.body && req.body.manifest; const err = checkManifest(manifest); if (err) throw fail(400, err);
    const vr = await be().query("SELECT COALESCE(MAX(version),0) AS v FROM versions WHERE slug=?1", [slug]);
    const version = Number(vr[0].v) + 1;
    const out = {}; let total = 0;
    for (const [p, f] of Object.entries(manifest.files)) {
      const type = mimeFor(p);
      if (!(await be().head(`blob/${slug}/${f.h}`))) throw fail(400, "Missing upload for " + p + ". Publish again.");
      out[p] = { h: f.h, s: f.s, t: type }; total += f.s;
    }
    const title = String((req.body && req.body.title) || (a && a.title) || slug).slice(0, 80);
    const backendWanted = !!(req.body && req.body.backend);
    await be().query("INSERT INTO versions (slug, version, manifest, file_count, total_bytes, note) VALUES (?1,?2,?3,?4,?5,?6)",
      [slug, version, JSON.stringify({ files: out }), Object.keys(out).length, total, String((req.body && req.body.note) || "").slice(0, 200)]);
    if (a) await be().query("UPDATE apps SET live_version=?2, status='active', title=?3, updated_at=?4 WHERE slug=?1", [slug, version, title, nowIso()]);
    else await be().query("INSERT INTO apps (slug, owner, runtime, status, live_version, title) VALUES (?1,?2,?3,'active',?4,?5)", [slug, "u:" + u.id, backendWanted ? "spawn-backend" : "static", version, title]);
    await prune(slug, version);
    if (APP_PRESETS[slug]) { try { await syncPresets(be(), slug); } catch (e) { console.warn("[cloud] preset sync failed for " + slug + ": " + e.message); } }
    res.json({ ok: true, slug, version, url: "https://" + slug + "." + apex() + "/", files: Object.keys(out).length, bytes: total });
  }));
  async function prune(slug, live) {
    const v = await be().query("SELECT version FROM versions WHERE slug=?1 ORDER BY version DESC", [slug]);
    for (const row of v.slice(LIMITS.keepVersions)) {
      if (Number(row.version) === Number(live)) continue;
      await be().query("DELETE FROM versions WHERE slug=?1 AND version=?2", [slug, row.version]);
    }
    // Drop files no kept version uses. A day's grace keeps uploads of a publish that is still in flight.
    const keep = new Set();
    for (const row of await be().query("SELECT manifest FROM versions WHERE slug=?1", [slug])) for (const f of Object.values(JSON.parse(row.manifest).files || {})) keep.add(f.h);
    const cutoff = new Date(Date.now() - 86400000).toISOString();
    for (const k of await be().list(`blob/${slug}/`, cutoff)) if (!keep.has(k.slice(k.lastIndexOf("/") + 1))) await be().del(k);
  }
  r.post("/apps/:slug/rollback", wrap(async (req, res) => {
    const u = await tokenUser(req); const a = await ownedApp(u, req.params.slug, false);
    const ver = Number(req.body && req.body.version);
    const v = await be().query("SELECT version FROM versions WHERE slug=?1 AND version=?2", [a.slug, ver]);
    if (!v[0]) throw fail(404, "That version no longer exists.");
    await be().query("UPDATE apps SET live_version=?2, status='active', updated_at=?3 WHERE slug=?1", [a.slug, ver, nowIso()]);
    res.json({ ok: true, live: ver });
  }));
  r.post("/apps/:slug/unpublish", wrap(async (req, res) => {
    const u = await tokenUser(req); const a = await ownedApp(u, req.params.slug, false);
    await be().query("UPDATE apps SET status='unpublished', updated_at=?2 WHERE slug=?1", [a.slug, nowIso()]);
    res.json({ ok: true, status: "unpublished", note: "Your app is offline. Versions are kept — roll back or publish to bring it back." });
  }));

  // Per-app secrets: write-only, names listed, values never returned.
  r.get("/apps/:slug/secrets", wrap(async (req, res) => {
    const u = await tokenUser(req); const a = await ownedApp(u, req.params.slug, false);
    res.json({ ok: true, names: (await be().query("SELECT name, updated_at FROM app_secrets WHERE slug=?1 ORDER BY name", [a.slug])) });
  }));
  r.put("/apps/:slug/secrets/:name", wrap(async (req, res) => {
    const u = await tokenUser(req); const a = await ownedApp(u, req.params.slug, false);
    const name = String(req.params.name); const value = String((req.body && req.body.value) || "");
    if (!SECRET_NAME_RE.test(name)) throw fail(400, "Secret names are UPPER_SNAKE_CASE.");
    if (!value || value.length > 4096) throw fail(400, "Secret value required (max 4 KB).");
    await be().query("INSERT INTO app_secrets (slug, name, blob, updated_at) VALUES (?1,?2,?3,?4) ON CONFLICT(slug, name) DO UPDATE SET blob=excluded.blob, updated_at=excluded.updated_at",
      [a.slug, name, encryptSecret(a.slug, name, value), nowIso()]);
    res.json({ ok: true, name });
  }));
  r.delete("/apps/:slug/secrets/:name", wrap(async (req, res) => {
    const u = await tokenUser(req); const a = await ownedApp(u, req.params.slug, false);
    await be().query("DELETE FROM app_secrets WHERE slug=?1 AND name=?2", [a.slug, String(req.params.name)]);
    res.json({ ok: true });
  }));

  // Custom domains (card-free): the domain becomes a free zone in the Spawn Cloudflare account; see clouddomains.js.
  // Publish token (desktop) or a signed-in spawnapp.org session; only the app's owner.
  const dom = opts.domains || require("./clouddomains").create({ env, apex, fail, query: (sql, p) => be().query(sql, p), cf: opts.cf });
  async function anyUser(req) {
    if (/^Bearer\s/.test(String(req.headers.authorization || ""))) return tokenUser(req);
    const u = await auth.currentUser(req); if (!u) throw fail(401, "Sign in to spawnapp.org or connect Spawn first."); return u;
  }
  const domainsOn = () => mode() === "local" || (env("CLOUD_DOMAINS_ENABLED", "1") === "1");
  r.get("/apps/:slug/domains", wrap(async (req, res) => {
    const u = await anyUser(req); const a = await ownedApp(u, req.params.slug, false);
    res.json({ ok: true, enabled: domainsOn(), slug: a.slug, defaultUrl: "https://" + a.slug + "." + apex() + "/", domains: await dom.list(a.slug) });
  }));
  r.post("/apps/:slug/domains", wrap(async (req, res) => {
    const u = await anyUser(req); const a = await ownedApp(u, req.params.slug, false);
    if (!domainsOn()) throw fail(503, "Custom domains are paused. Try again soon.");
    if (limited("dom:" + u.id, 20, 3600000)) throw fail(429, "Too many domain changes. Try again in an hour.");
    const d = await dom.attach("u:" + u.id, a.slug, String((req.body && (req.body.hostname || req.body.domain)) || ""));
    res.status(201).json({ ok: true, domain: d });
  }));
  r.post("/apps/:slug/domains/check", wrap(async (req, res) => {
    const u = await anyUser(req); const a = await ownedApp(u, req.params.slug, false);
    res.json({ ok: true, domains: await dom.check(a.slug) });
  }));
  r.delete("/apps/:slug/domains/:host", wrap(async (req, res) => {
    const u = await anyUser(req); const a = await ownedApp(u, req.params.slug, false);
    res.json(await dom.remove("u:" + u.id, a.slug, String(req.params.host)));
  }));
  r.get("/domain-search", (req, res) => res.json({ ok: true, links: require("./clouddomains").registrarLinks(req.query.q) }));
  r.get("/my-apps", wrap(async (req, res) => {
    const u = await sessionUser(req);
    const apps = await be().query("SELECT slug, status, live_version, title FROM apps WHERE owner=?1 ORDER BY updated_at DESC", ["u:" + u.id]);
    res.json({ ok: true, apex: apex(), apps });
  }));

  app.use("/api/cloud", r);
  if (enabled() && !opts.noPresetSync) setInterval(() => { dom.sweep().catch((e) => console.warn("[cloud-domains] sweep failed: " + e.message)); }, 5 * 60000).unref();
  if (enabled() && !opts.noPresetSync) setTimeout(() => { syncPresets(be()).catch((e) => console.warn("[cloud] preset sync failed: " + e.message)); }, 5000).unref();

  // Manage custom domains for your published apps (signed-in session).
  app.get("/cloud/domains", (req, res) => {
    res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Robots-Tag", "noindex");
    if (!enabled()) return res.status(503).type("html").send(page("Custom domains", "<h1>Custom domains</h1><p>Spawn Cloud isn't available right now.</p>"));
    res.type("html").send(page("Custom domains", DOMAINS_HTML, true));
  });

  // Approval page for desktop sign-in.
  app.get("/cloud/connect", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex");
    if (!enabled()) return res.status(503).type("html").send(page("Spawn Cloud", "<h1>Spawn Cloud</h1><p>Publishing to Spawn Cloud isn't available yet.</p><p><a href=\"/\">Back to Spawn</a></p>"));
    res.type("html").send(page("Connect Spawn", CONNECT_HTML));
  });
}

function page(title, body, wide) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>' + title +
    ' · Spawn</title><style>body{font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;background:#0b0b0f;color:#ececf1;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:'+(wide?'640px':'440px')+';padding:32px;border:1px solid #26262e;border-radius:16px;background:#121218}h1{font-size:22px;margin:0 0 8px}p{color:#a9a9b6}code{font-size:22px;letter-spacing:2px;color:#fff}button{background:#fff;color:#000;border:0;border-radius:10px;padding:12px 18px;font-weight:600;cursor:pointer}a{color:#c9c9ff}</style></head><body><main>' + body + "</main></body></html>";
}
const DOMAINS_HTML = `<style>.app{border-top:1px solid #26262e;padding:18px 0}.row{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}input{flex:1;min-width:200px;background:#0b0b0f;border:1px solid #33333d;border-radius:10px;color:#fff;padding:11px 12px;font:inherit}.ghost{background:transparent;color:#ececf1;border:1px solid #33333d}.d{background:#0e0e14;border:1px solid #26262e;border-radius:12px;padding:14px;margin:10px 0}.pill{font-size:12px;border-radius:99px;padding:2px 9px;margin-left:6px}.active{background:#123d2a;color:#7ff0b5}.pending{background:#3a3014;color:#f5d27a}.failed{background:#40171b;color:#ff9aa2}ol{color:#c9c9d6;padding-left:20px}.ns{font-family:ui-monospace,monospace;color:#fff;background:#1b1b24;padding:2px 6px;border-radius:6px}small{color:#8b8b98}h2{font-size:17px;margin:0}</style>
<h1>Custom domains</h1><p>Serve a published app at your own domain, with HTTPS. Don't have one yet? Buy one at any registrar, then connect it here — no extra cost from Spawn.</p>
<div id="apps"><p>Loading…</p></div>
<script>
function e(t){return String(t==null?'':t).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function j(m,u,b){return fetch(u,{method:m,headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined}).then(function(r){if(r.status===401){location.href='/signin?next=/cloud/domains';throw 0}return r.json()})}
function dom(slug,d){var h='<div class="d"><strong>'+e(d.hostnames.join(' + '))+'</strong><span class="pill '+e(d.status)+'">'+(d.status==='active'?'Live':d.status==='pending'?'Waiting for nameservers':'Needs attention')+'</span>';
if(d.status==='active')h+='<p><a href="'+e(d.url)+'" target="_blank" rel="noopener">'+e(d.url)+'</a></p>';
else{h+='<ol>'+d.dns.steps.map(function(s){return'<li>'+e(s)+'</li>'}).join('')+'</ol><p>Nameservers: '+d.nameservers.map(function(n){return'<span class="ns">'+e(n)+'</span>'}).join(' ')+'</p>'+(d.dns.notes||[]).map(function(n){return'<small>'+e(n)+'</small><br>'}).join('')}
if(d.error)h+='<p>'+e(d.error)+'</p>';
return h+'<div class="row"><button class="ghost" onclick="chk(\''+slug+'\')">Check now</button><button class="ghost" onclick="rm(\''+slug+'\',\''+e(d.hostname)+'\')">Remove</button></div></div>'}
function draw(slug,ds){document.getElementById('l-'+slug).innerHTML=ds.map(function(d){return dom(slug,d)}).join('')||'<small>No custom domain yet.</small>'}
function load(slug){j('GET','/api/cloud/apps/'+slug+'/domains').then(function(x){draw(slug,x.domains||[])})}
function chk(slug){j('POST','/api/cloud/apps/'+slug+'/domains/check').then(function(x){draw(slug,x.domains||[])})}
function rm(slug,h){if(!confirm('Disconnect '+h+'?'))return;j('DELETE','/api/cloud/apps/'+slug+'/domains/'+encodeURIComponent(h)).then(function(x){alert(x.note||x.error);load(slug)})}
function add(slug){var i=document.getElementById('i-'+slug),m=document.getElementById('m-'+slug);m.textContent='Connecting…';j('POST','/api/cloud/apps/'+slug+'/domains',{hostname:i.value}).then(function(x){m.textContent=x.ok?'':x.error;if(x.ok){i.value='';load(slug)}})}
function find(slug){var q=document.getElementById('i-'+slug).value||slug;j('GET','/api/cloud/domain-search?q='+encodeURIComponent(q)).then(function(x){document.getElementById('m-'+slug).innerHTML='Find a domain: '+x.links.map(function(l){return'<a href="'+e(l.url)+'" target="_blank" rel="noopener">'+e(l.name)+'</a>'}).join(' · ')+' <small>(you buy it directly from the registrar)</small>'})}
j('GET','/api/cloud/my-apps').then(function(x){var el=document.getElementById('apps');if(!x.apps||!x.apps.length){el.innerHTML='<p>Publish an app from Spawn first — then connect a domain here.</p>';return}
el.innerHTML=x.apps.map(function(a){var s=e(a.slug);return'<div class="app"><h2>'+e(a.title||a.slug)+'</h2><small>'+s+'.'+e(x.apex)+'</small><div id="l-'+s+'"></div><div class="row"><input id="i-'+s+'" placeholder="example.com or shop.example.com"><button onclick="add(\''+s+'\')">Connect domain</button><button class="ghost" onclick="find(\''+s+'\')">Find a domain</button></div><p id="m-'+s+'"></p></div>'}).join('');x.apps.forEach(function(a){load(a.slug)})})['catch'](function(){});
</script>`;
const CONNECT_HTML = `<h1>Connect Spawn on this computer</h1><p>Confirm the code matches the one shown in Spawn. This lets Spawn publish apps to your account.</p>
<p><code id="c"></code></p><p id="m"></p><button id="b">Approve</button>
<script>
var code=(new URLSearchParams(location.search).get('code')||'').toUpperCase();document.getElementById('c').textContent=code||'—';
document.getElementById('b').onclick=function(){fetch('/api/cloud/device/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_code:code})}).then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})}).then(function(x){
var m=document.getElementById('m');if(x.s===401){location.href='/signin?next='+encodeURIComponent(location.pathname+location.search);return}
if(x.j.ok){m.textContent='Connected. You can return to Spawn.';document.getElementById('b').remove()}else m.textContent=x.j.error||'Something went wrong.'})};
</script>`;

module.exports = { mount, enabled, mode, encryptSecret, syncPresets, APP_PRESETS, checkManifest, validPath, memoryTokenStore, localBackend, LIMITS };
