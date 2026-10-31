/*
 * Spawn Cloud publish API.
 * Dormant unless CLOUD_PUBLISH_ENABLED=1 AND a storage backend is configured:
 *   - Cloudflare: CF_ACCOUNT_ID, CF_API_TOKEN, CF_D1_DATABASE_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, CLOUD_SECRETS_KEY
 *     (optional R2_BUCKET [spawn-cloud-apps], CF_ZONE_ID for custom domains, CLOUD_APEX [spawnapp.org], CLOUD_ADMIN_EMAILS)
 *   - Local (development/tests only): CLOUD_PUBLISH_LOCAL_DIR + CLOUD_SECRETS_KEY — files on disk, D1 emulated with node:sqlite.
 * While dormant every /api/cloud/* route and /cloud/connect answer 503 {enabled:false}.
 */
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const RESERVED = new Set(["www", "api", "app", "apps", "admin", "mail", "smtp", "cdn", "static", "assets", "cloud", "status", "docs", "help", "support", "blog", "dev", "staging", "preview", "auth", "login", "dashboard", "billing", "spawn", "home", "ns1", "ns2", "mx", "ftp", "test"]);
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
  if (["CF_ACCOUNT_ID", "CF_API_TOKEN", "CF_D1_DATABASE_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"].every((k) => env(k))) return "cloudflare";
  if (env("CLOUD_PUBLISH_LOCAL_DIR")) return "local";
  return null;
}
function enabled() { return !!mode(); }
function apex() { return env("CLOUD_APEX", "spawnapp.org"); }

/* ---------------- storage backends ---------------- */
function cloudflareBackend() {
  const { AwsClient } = require("aws4fetch");
  const acct = env("CF_ACCOUNT_ID"), bucket = env("R2_BUCKET", "spawn-cloud-apps");
  const aws = new AwsClient({ accessKeyId: env("R2_ACCESS_KEY_ID"), secretAccessKey: env("R2_SECRET_ACCESS_KEY"), service: "s3", region: "auto" });
  const base = `https://${acct}.r2.cloudflarestorage.com/${bucket}/`;
  const enc = (k) => k.split("/").map(encodeURIComponent).join("/");
  async function d1(sql, params) {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/d1/database/${env("CF_D1_DATABASE_ID")}/query`, {
      method: "POST", headers: { Authorization: "Bearer " + env("CF_API_TOKEN"), "Content-Type": "application/json" }, body: JSON.stringify({ sql, params: params || [] }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.success) throw new Error("D1 query failed (" + r.status + ")");
    return (j.result && j.result[0] && j.result[0].results) || [];
  }
  return {
    kind: "cloudflare",
    query: d1,
    async head(key) { const r = await aws.fetch(base + enc(key), { method: "HEAD" }); return r.ok; },
    async put(key, buf, type) { const r = await aws.fetch(base + enc(key), { method: "PUT", body: buf, headers: { "Content-Type": type || "application/octet-stream" } }); if (!r.ok) throw new Error("R2 put failed " + r.status); },
    async copy(from, to, type) {
      const r = await aws.fetch(base + enc(to), { method: "PUT", headers: { "x-amz-copy-source": "/" + bucket + "/" + enc(from), "x-amz-metadata-directive": "REPLACE", "Content-Type": type || "application/octet-stream" } });
      if (!r.ok) throw new Error("R2 copy failed " + r.status);
    },
    async del(key) { await aws.fetch(base + enc(key), { method: "DELETE" }); },
    async list(prefix) {
      const keys = []; let token = "";
      for (let i = 0; i < 50; i++) {
        const u = new URL(base.replace(/\/$/, "")); u.searchParams.set("list-type", "2"); u.searchParams.set("prefix", prefix); if (token) u.searchParams.set("continuation-token", token);
        const t = await (await aws.fetch(u.toString())).text();
        for (const m of t.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1].replace(/&amp;/g, "&"));
        const n = /<NextContinuationToken>([^<]+)</.exec(t); if (!n) break; token = n[1];
      }
      return keys;
    },
  };
}

function localBackend(dir) {
  const { DatabaseSync } = require("node:sqlite");
  fs.mkdirSync(path.join(dir, "r2"), { recursive: true });
  const db = new DatabaseSync(path.join(dir, "d1.sqlite"));
  const migDir = path.join(__dirname, "cloud", "migrations");
  for (const f of fs.readdirSync(migDir).sort()) db.exec(fs.readFileSync(path.join(migDir, f), "utf8"));
  const file = (k) => { const p = path.join(dir, "r2", k); if (!p.startsWith(path.join(dir, "r2"))) throw new Error("bad key"); return p; };
  return {
    kind: "local", dir, db,
    async query(sql, params) { const st = db.prepare(sql); return /^\s*(select|with)|returning/i.test(sql) ? st.all(...(params || [])) : (st.run(...(params || [])), []); },
    async head(k) { return fs.existsSync(file(k)); },
    async put(k, buf) { fs.mkdirSync(path.dirname(file(k)), { recursive: true }); fs.writeFileSync(file(k), buf); },
    async copy(a, b) { fs.mkdirSync(path.dirname(file(b)), { recursive: true }); fs.copyFileSync(file(a), file(b)); },
    async del(k) { try { fs.unlinkSync(file(k)); } catch (_) {} },
    async list(prefix) {
      const root = path.join(dir, "r2"); const out = [];
      (function walk(d) { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : out.push(path.relative(root, p).split(path.sep).join("/")); } })(root);
      return out.filter((k) => k.startsWith(prefix));
    },
  };
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

/* ---------------- publish tokens (Postgres, or memory for local/tests) ---------------- */
function pgTokenStore(getPool) {
  let ready = null;
  const q = async (sql, p) => {
    const pool = getPool(); if (!pool) throw new Error("accounts database unavailable");
    if (!ready) ready = pool.query(
      "CREATE TABLE IF NOT EXISTS cloud_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT, token_hash TEXT UNIQUE NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), last_used_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ);" +
      "CREATE TABLE IF NOT EXISTS cloud_device_codes (device_hash TEXT PRIMARY KEY, user_code TEXT UNIQUE NOT NULL, user_id TEXT, name TEXT, expires_at TIMESTAMPTZ NOT NULL, used BOOLEAN DEFAULT false);"
    ).catch((e) => { ready = null; throw e; });
    await ready; return (await pool.query(sql, p)).rows;
  };
  return {
    async create(userId, name, hash) { const id = crypto.randomBytes(6).toString("hex"); await q("INSERT INTO cloud_tokens (id,user_id,name,token_hash) VALUES ($1,$2,$3,$4)", [id, String(userId), name, hash]); return id; },
    async byHash(hash) { const r = await q("UPDATE cloud_tokens SET last_used_at=now() WHERE token_hash=$1 AND revoked_at IS NULL RETURNING id,user_id", [hash]); return r[0] || null; },
    async list(userId) { return q("SELECT id,name,created_at,last_used_at FROM cloud_tokens WHERE user_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC", [String(userId)]); },
    async revoke(userId, id) { const r = await q("UPDATE cloud_tokens SET revoked_at=now() WHERE user_id=$1 AND id=$2 AND revoked_at IS NULL RETURNING id", [String(userId), id]); return r.length > 0; },
    async deviceCreate(deviceHash, userCode, name) { await q("INSERT INTO cloud_device_codes (device_hash,user_code,name,expires_at) VALUES ($1,$2,$3,now()+interval '10 minutes')", [deviceHash, userCode, name]); },
    async deviceApprove(userCode, userId) { const r = await q("UPDATE cloud_device_codes SET user_id=$2 WHERE user_code=$1 AND user_id IS NULL AND used=false AND expires_at>now() RETURNING device_hash", [userCode, String(userId)]); return r.length > 0; },
    async deviceTake(deviceHash) { const r = await q("UPDATE cloud_device_codes SET used=true WHERE device_hash=$1 AND user_id IS NOT NULL AND used=false AND expires_at>now() RETURNING user_id,name", [deviceHash]); if (r[0]) return r[0];
      const p = await q("SELECT 1 FROM cloud_device_codes WHERE device_hash=$1 AND used=false AND expires_at>now()", [deviceHash]); return p.length ? "pending" : null; },
  };
}
function memoryTokenStore() {
  const tokens = new Map(), devices = new Map();
  return {
    async create(userId, name, hash) { const id = crypto.randomBytes(6).toString("hex"); tokens.set(id, { id, user_id: String(userId), name, hash, created_at: nowIso() }); return id; },
    async byHash(hash) { for (const t of tokens.values()) if (t.hash === hash && !t.revoked) return { id: t.id, user_id: t.user_id }; return null; },
    async list(userId) { return [...tokens.values()].filter((t) => t.user_id === String(userId) && !t.revoked).map(({ id, name, created_at }) => ({ id, name, created_at })); },
    async revoke(userId, id) { const t = tokens.get(id); if (!t || t.user_id !== String(userId) || t.revoked) return false; t.revoked = true; return true; },
    async deviceCreate(h, code, name) { devices.set(h, { code, name, exp: Date.now() + 600000 }); },
    async deviceApprove(code, userId) { for (const d of devices.values()) if (d.code === code && !d.user && !d.used && d.exp > Date.now()) { d.user = String(userId); return true; } return false; },
    async deviceTake(h) { const d = devices.get(h); if (!d || d.used || d.exp < Date.now()) return null; if (!d.user) return "pending"; d.used = true; return { user_id: d.user, name: d.name }; },
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
    return { id: t.user_id, tokenId: t.id, email: null };
  }
  const mint = () => "spk_" + crypto.randomBytes(24).toString("base64url");

  // Token management (signed-in web session).
  r.get("/tokens", wrap(async (req, res) => { const u = await sessionUser(req); res.json({ ok: true, tokens: await tokens.list(u.id) }); }));
  r.post("/tokens", wrap(async (req, res) => {
    const u = await sessionUser(req); const tok = mint();
    const id = await tokens.create(u.id, String((req.body && req.body.name) || "Spawn desktop").slice(0, 60), sha("pt:" + tok));
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
    const ok = await tokens.deviceApprove(String((req.body && req.body.user_code) || "").toUpperCase().trim(), u.id);
    if (!ok) throw fail(400, "That code expired or was already used. Start again from Spawn.");
    res.json({ ok: true });
  }));
  r.post("/device/token", wrap(async (req, res) => {
    const d = String((req.body && req.body.device_code) || "");
    if (limited("poll:" + d.slice(0, 12), 300, 600000)) throw fail(429, "slow_down");
    const t = await tokens.deviceTake(sha("dc:" + d));
    if (t === "pending") return res.status(428).json({ ok: false, pending: true });
    if (!t) throw fail(400, "Sign-in expired. Start again.");
    const tok = mint(); await tokens.create(t.user_id, t.name || "Spawn desktop", sha("pt:" + tok));
    res.json({ ok: true, token: tok });
  }));

  // Apps (publish token).
  async function ownedApp(user, slug, allowNew) {
    if (!SLUG_RE.test(slug) || RESERVED.has(slug)) throw fail(400, "Choose a name with letters, numbers and dashes (2–40 characters).");
    const rows = await be().query("SELECT slug, owner, runtime, status, live_version, title FROM apps WHERE slug=?1", [slug]);
    const a = rows[0];
    if (a && a.owner !== "u:" + user.id) throw fail(409, "That name is taken. Pick another.");
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
    const prev = a && a.live_version ? await prevFiles(slug) : {};
    const need = [];
    for (const f of Object.values(req.body.manifest.files)) {
      if (need.includes(f.h) || Object.values(prev).some((p) => p.h === f.h)) continue;
      if (!(await be().head(`staging/${slug}/${f.h}`))) need.push(f.h);
    }
    res.json({ ok: true, slug, need, url: "https://" + slug + "." + apex() + "/" });
  }));
  async function prevFiles(slug) {
    const rows = await be().query("SELECT v.manifest, v.version FROM versions v JOIN apps a ON a.slug=v.slug AND a.live_version=v.version WHERE a.slug=?1", [slug]);
    if (!rows[0]) return {};
    const files = JSON.parse(rows[0].manifest).files || {};
    for (const k of Object.keys(files)) files[k].v = rows[0].version;
    return files;
  }
  r.put("/apps/:slug/blobs/:hash", express.raw({ type: "*/*", limit: LIMITS.fileBytes }), wrap(async (req, res) => {
    const u = await tokenUser(req); const slug = req.params.slug; await ownedApp(u, slug, true);
    const h = String(req.params.hash);
    if (!/^[a-f0-9]{64}$/.test(h)) throw fail(400, "bad hash");
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (sha(buf) !== h) throw fail(400, "Upload was corrupted (hash mismatch). Try again.");
    await be().put(`staging/${slug}/${h}`, buf);
    res.json({ ok: true });
  }));
  r.post("/apps/:slug/publish/commit", wrap(async (req, res) => {
    const u = await tokenUser(req); const slug = req.params.slug; const a = await ownedApp(u, slug, true);
    const manifest = req.body && req.body.manifest; const err = checkManifest(manifest); if (err) throw fail(400, err);
    const prev = a && a.live_version ? await prevFiles(slug) : {};
    const prevByHash = {}; for (const [p, f] of Object.entries(prev)) prevByHash[f.h] = `apps/${slug}/v${f.v}/${p}`;
    const vr = await be().query("SELECT COALESCE(MAX(version),0) AS v FROM versions WHERE slug=?1", [slug]);
    const version = Number(vr[0].v) + 1;
    const out = {}; let total = 0; const staged = new Set();
    for (const [p, f] of Object.entries(manifest.files)) {
      const type = mimeFor(p); const dest = `apps/${slug}/v${version}/${p}`;
      if (await be().head(`staging/${slug}/${f.h}`)) { await be().copy(`staging/${slug}/${f.h}`, dest, type); staged.add(f.h); }
      else if (prevByHash[f.h]) await be().copy(prevByHash[f.h], dest, type);
      else throw fail(400, "Missing upload for " + p + ". Publish again.");
      out[p] = { h: f.h, s: f.s, t: type }; total += f.s;
    }
    const title = String((req.body && req.body.title) || (a && a.title) || slug).slice(0, 80);
    const backendWanted = !!(req.body && req.body.backend);
    await be().query("INSERT INTO versions (slug, version, manifest, file_count, total_bytes, note) VALUES (?1,?2,?3,?4,?5,?6)",
      [slug, version, JSON.stringify({ files: out }), Object.keys(out).length, total, String((req.body && req.body.note) || "").slice(0, 200)]);
    if (a) await be().query("UPDATE apps SET live_version=?2, status='active', title=?3, updated_at=?4 WHERE slug=?1", [slug, version, title, nowIso()]);
    else await be().query("INSERT INTO apps (slug, owner, runtime, status, live_version, title) VALUES (?1,?2,?3,'active',?4,?5)", [slug, "u:" + u.id, backendWanted ? "spawn-backend" : "static", version, title]);
    for (const h of staged) await be().del(`staging/${slug}/${h}`);
    await prune(slug, version);
    res.json({ ok: true, slug, version, url: "https://" + slug + "." + apex() + "/", files: Object.keys(out).length, bytes: total });
  }));
  async function prune(slug, live) {
    const v = await be().query("SELECT version FROM versions WHERE slug=?1 ORDER BY version DESC", [slug]);
    for (const row of v.slice(LIMITS.keepVersions)) {
      if (Number(row.version) === Number(live)) continue;
      for (const k of await be().list(`apps/${slug}/v${row.version}/`)) await be().del(k);
      await be().query("DELETE FROM versions WHERE slug=?1 AND version=?2", [slug, row.version]);
    }
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

  // Custom domains (Cloudflare for SaaS). Off until CF_ZONE_ID is set.
  r.post("/apps/:slug/domains", wrap(async (req, res) => {
    const u = await tokenUser(req); const a = await ownedApp(u, req.params.slug, false);
    const host = String((req.body && req.body.hostname) || "").toLowerCase().trim();
    if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) || host.endsWith("." + apex()) || host === apex()) throw fail(400, "Enter a domain you own, like shop.example.com.");
    if (!env("CF_ZONE_ID") || be().kind !== "cloudflare") return res.status(501).json({ ok: false, error: "Custom domains are coming soon." });
    const cr = await fetch(`https://api.cloudflare.com/client/v4/zones/${env("CF_ZONE_ID")}/custom_hostnames`, {
      method: "POST", headers: { Authorization: "Bearer " + env("CF_API_TOKEN"), "Content-Type": "application/json" },
      body: JSON.stringify({ hostname: host, ssl: { method: "http", type: "dv" } }),
    });
    const j = await cr.json().catch(() => ({}));
    if (!cr.ok || !j.success) throw fail(400, "Couldn't add that domain. It may already be connected elsewhere.");
    await be().query("INSERT INTO domains (hostname, slug, status, cf_id) VALUES (?1,?2,'pending',?3) ON CONFLICT(hostname) DO NOTHING", [host, a.slug, j.result.id]);
    res.json({ ok: true, hostname: host, status: "pending", dns: { type: "CNAME", name: host, target: env("CLOUD_FALLBACK_ORIGIN", "apps." + apex()) } });
  }));

  app.use("/api/cloud", r);

  // Approval page for desktop sign-in.
  app.get("/cloud/connect", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex");
    if (!enabled()) return res.status(503).type("html").send(page("Spawn Cloud", "<h1>Spawn Cloud</h1><p>Publishing to Spawn Cloud isn't available yet.</p><p><a href=\"/\">Back to Spawn</a></p>"));
    res.type("html").send(page("Connect Spawn", CONNECT_HTML));
  });
}

function page(title, body) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>' + title +
    ' · Spawn</title><style>body{font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;background:#0b0b0f;color:#ececf1;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:440px;padding:32px;border:1px solid #26262e;border-radius:16px;background:#121218}h1{font-size:22px;margin:0 0 8px}p{color:#a9a9b6}code{font-size:22px;letter-spacing:2px;color:#fff}button{background:#fff;color:#000;border:0;border-radius:10px;padding:12px 18px;font-weight:600;cursor:pointer}a{color:#c9c9ff}</style></head><body><main>' + body + "</main></body></html>";
}
const CONNECT_HTML = `<h1>Connect Spawn on this computer</h1><p>Confirm the code matches the one shown in Spawn. This lets Spawn publish apps to your account.</p>
<p><code id="c"></code></p><p id="m"></p><button id="b">Approve</button>
<script>
var code=(new URLSearchParams(location.search).get('code')||'').toUpperCase();document.getElementById('c').textContent=code||'—';
document.getElementById('b').onclick=function(){fetch('/api/cloud/device/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_code:code})}).then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})}).then(function(x){
var m=document.getElementById('m');if(x.s===401){location.href='/signin?next='+encodeURIComponent(location.pathname+location.search);return}
if(x.j.ok){m.textContent='Connected. You can return to Spawn.';document.getElementById('b').remove()}else m.textContent=x.j.error||'Something went wrong.'})};
</script>`;

module.exports = { mount, enabled, mode, encryptSecret, checkManifest, validPath, memoryTokenStore, localBackend, LIMITS };
