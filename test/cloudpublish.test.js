// Run: node --test test/   (needs cloud/node_modules for the Worker end-to-end part)
"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

test("dormant: live server answers 503 not-enabled and the site is unchanged", async () => {
  const port = 4300 + Math.floor(Math.random() * 500);
  const envv = Object.assign({}, process.env, { PORT: String(port) });
  for (const k of Object.keys(envv)) if (/^(CLOUD_|CF_|R2_|DATABASE_URL)/.test(k)) delete envv[k];
  const p = spawn(process.execPath, ["server.js"], { env: envv, stdio: "ignore" });
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/api/health`); break; } catch (_) { await new Promise((r) => setTimeout(r, 100)); } }
    for (const [m, u] of [["GET", "/api/cloud/status"], ["POST", "/api/cloud/device"], ["GET", "/api/cloud/apps"], ["PUT", "/api/cloud/apps/x/blobs/abc"], ["POST", "/api/cloud/apps/x/publish/commit"]]) {
      const r = await fetch(`http://127.0.0.1:${port}${u}`, { method: m, headers: { "content-type": "application/json" }, body: m === "GET" ? undefined : "{}" });
      assert.equal(r.status, 503, u); const j = await r.json(); assert.equal(j.enabled, false); assert.match(j.error, /not enabled/);
    }
    let r = await fetch(`http://127.0.0.1:${port}/cloud/connect`); assert.equal(r.status, 503); assert.match(await r.text(), /isn't available yet/);
    r = await fetch(`http://127.0.0.1:${port}/`); assert.equal(r.status, 200);
    r = await fetch(`http://127.0.0.1:${port}/api/health`); assert.equal((await r.json()).ok, true);
  } finally { p.kill(); }
});

test("manifest rules", () => {
  const cp = require("../cloudpublish");
  for (const bad of ["../x.html", "/abs.html", "server.js", "data/db.json", ".env", "a/.env.local", "node_modules/x.js", "x.exe", "package.json", "_forge_hosted.json", "noext"]) assert.equal(cp.validPath(bad), false, bad);
  for (const ok of ["index.html", "assets/app.js", "icons/i-192.png", "manifest.webmanifest", "sw.js"]) assert.equal(cp.validPath(ok), true, ok);
  assert.match(cp.checkManifest({ files: { "a.html": { h: "0".repeat(64), s: 1 } } }), /index.html/);
  assert.match(cp.checkManifest({ files: { "index.html": { h: "0".repeat(64), s: 11 * 1024 * 1024 } } }), /10 MB/);
});

let dir, server, base, mf, cp;
const users = { a: { id: 7, email: "a@x.co" }, b: { id: 8, email: "b@x.co" } };
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "spawncloud-"));
  Object.assign(process.env, { CLOUD_PUBLISH_ENABLED: "1", CLOUD_PUBLISH_LOCAL_DIR: dir, CLOUD_SECRETS_KEY: crypto.randomBytes(32).toString("base64") });
  delete require.cache[require.resolve("../cloudpublish")];
  cp = require("../cloudpublish");
  const app = express();
  const fakeAuth = { currentUser: async (req) => users[req.headers["x-test-user"]] || null };
  cp.mount(app, { auth: fakeAuth, tokenStore: cp.memoryTokenStore() });
  await new Promise((r) => { server = app.listen(0, "127.0.0.1", r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server && server.close(); mf && (await mf.dispose()); for (const k of ["CLOUD_PUBLISH_ENABLED", "CLOUD_PUBLISH_LOCAL_DIR", "CLOUD_SECRETS_KEY"]) delete process.env[k]; });

const call = async (method, p, { token, user, body, raw } = {}) => {
  const h = {}; if (token) h.authorization = "Bearer " + token; if (user) h["x-test-user"] = user;
  if (raw) h["content-type"] = "application/octet-stream"; else if (body) h["content-type"] = "application/json";
  const r = await fetch(base + p, { method, headers: h, body: raw || (body ? JSON.stringify(body) : undefined) });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { status: r.status, body: j };
};
async function publishSite(token, slug, files, extra = {}) {
  const manifest = { files: {} };
  for (const [p, c] of Object.entries(files)) manifest.files[p] = { h: sha(c), s: Buffer.byteLength(c) };
  const b = await call("POST", `/api/cloud/apps/${slug}/publish/begin`, { token, body: { manifest } });
  if (b.status !== 200) return b;
  for (const [p, c] of Object.entries(files)) if (b.body.need.includes(sha(c))) {
    const u = await call("PUT", `/api/cloud/apps/${slug}/blobs/${sha(c)}`, { token, raw: Buffer.from(c) }); assert.equal(u.status, 200, JSON.stringify(u.body));
  }
  const c = await call("POST", `/api/cloud/apps/${slug}/publish/commit`, { token, body: Object.assign({ manifest }, extra) });
  return Object.assign(c, { need: b.body.need });
}

test("local mode: device sign-in, publish, dedupe, versions, rollback, unpublish, secrets, ownership, then the Worker serves it", async () => {
  let x = await call("GET", "/api/cloud/status"); assert.equal(x.body.enabled, true);
  x = await call("GET", "/api/cloud/apps"); assert.equal(x.status, 401);
  // device flow
  const d = (await call("POST", "/api/cloud/device", { body: { name: "Test PC" } })).body;
  assert.match(d.user_code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  x = await call("POST", "/api/cloud/device/token", { body: { device_code: d.device_code } }); assert.equal(x.status, 428);
  x = await call("POST", "/api/cloud/device/approve", { body: { user_code: d.user_code } }); assert.equal(x.status, 401);
  x = await call("POST", "/api/cloud/device/approve", { user: "a", body: { user_code: d.user_code } }); assert.equal(x.body.ok, true);
  x = await call("POST", "/api/cloud/device/token", { body: { device_code: d.device_code } }); const tokA = x.body.token; assert.match(tokA, /^spk_/);
  x = await call("POST", "/api/cloud/device/token", { body: { device_code: d.device_code } }); assert.equal(x.status, 400, "device code single use");
  const tokB = (await call("POST", "/api/cloud/tokens", { user: "b" })).body.token;

  // publish v1
  const v1 = { "index.html": "<h1>Hello v1</h1>", "app.js": "console.log('same')", "img/logo.svg": "<svg/>" };
  x = await publishSite(tokA, "acme", v1, { title: "Acme" }); assert.equal(x.body.version, 1, JSON.stringify(x.body)); assert.equal(x.need.length, 3);
  assert.equal(x.body.url, "https://acme.spawnapp.org/");
  // v2: only changed file uploaded
  x = await publishSite(tokA, "acme", Object.assign({}, v1, { "index.html": "<h1>Hello v2</h1>" })); assert.equal(x.body.version, 2); assert.equal(x.need.length, 1, "unchanged files deduped");
  // rejects bad files, other owners, reserved
  x = await call("POST", "/api/cloud/apps/acme/publish/begin", { token: tokA, body: { manifest: { files: { "index.html": { h: sha("a"), s: 1 }, "server.js": { h: sha("b"), s: 1 } } } } }); assert.equal(x.status, 400);
  x = await publishSite(tokB, "acme", v1); assert.equal(x.status, 409);
  x = await publishSite(tokB, "admin", v1); assert.equal(x.status, 400);
  x = await call("PUT", `/api/cloud/apps/acme/blobs/${sha("zzz")}`, { token: tokA, raw: Buffer.from("not zzz") }); assert.equal(x.status, 400);
  // versions + rollback
  x = await call("GET", "/api/cloud/apps/acme/versions", { token: tokA }); assert.equal(x.body.live, 2); assert.equal(x.body.versions.length, 2);
  x = await call("POST", "/api/cloud/apps/acme/rollback", { token: tokA, body: { version: 1 } }); assert.equal(x.body.live, 1);
  // secrets: write-only
  x = await call("PUT", "/api/cloud/apps/acme/secrets/AI_API_KEY", { token: tokA, body: { value: "sk-test-not-real" } }); assert.equal(x.body.ok, true);
  x = await call("GET", "/api/cloud/apps/acme/secrets", { token: tokA }); assert.deepEqual(x.body.names.map((n) => n.name), ["AI_API_KEY"]); assert.ok(!JSON.stringify(x.body).includes("sk-test"));
  x = await call("PUT", "/api/cloud/apps/acme/secrets/bad-name", { token: tokA, body: { value: "v" } }); assert.equal(x.status, 400);
  x = await call("POST", "/api/cloud/apps/acme/domains", { token: tokA, body: { hostname: "not a domain" } }); assert.equal(x.status, 400);
  x = await call("GET", "/api/cloud/apps/acme/domains", { token: tokA }); assert.deepEqual(x.body.domains, []);
  x = await call("GET", "/api/cloud/apps/acme/domains", { token: tokB }); assert.equal(x.status, 409);
  x = await call("GET", "/api/cloud/apps", { token: tokA }); assert.deepEqual(x.body.apps.map((a) => a.slug), ["acme"]);
  // revoke
  const list = (await call("GET", "/api/cloud/tokens", { user: "b" })).body.tokens; assert.equal(list.length, 1);
  await call("DELETE", "/api/cloud/tokens/" + list[0].id, { user: "b" });
  x = await call("GET", "/api/cloud/apps", { token: tokB }); assert.equal(x.status, 401);

  // ---- hand the local D1 (incl. file blobs) to the Worker (Miniflare) and fetch the site ----
  const { Miniflare } = require(path.join(__dirname, "../cloud/node_modules/miniflare"));
  require("node:child_process").execSync("npx wrangler deploy --dry-run --outdir dist", { cwd: path.join(__dirname, "../cloud"), stdio: "ignore" });
  mf = new Miniflare({ modules: true, scriptPath: path.join(__dirname, "../cloud/dist/index.js"), compatibilityDate: "2026-08-01", compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: "e2e" }, bindings: { APEX_DOMAIN: "spawnapp.org", SECRETS_KEY: process.env.CLOUD_SECRETS_KEY } });
  const db = await mf.getD1Database("DB");
  for (const f of fs.readdirSync(path.join(__dirname, "../cloud/migrations")).sort()) {
    const sql = fs.readFileSync(path.join(__dirname, "../cloud/migrations", f), "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    for (const s of sql.split(";").map((v) => v.trim()).filter(Boolean)) await db.prepare(s).run();
  }
  const { DatabaseSync } = require("node:sqlite"); const local = new DatabaseSync(path.join(dir, "d1.sqlite"));
  for (const t of ["apps", "versions", "app_secrets", "blobs", "blob_chunks"]) for (const row of local.prepare("SELECT * FROM " + t).all()) {
    const cols = Object.keys(row); await db.prepare(`INSERT INTO ${t} (${cols}) VALUES (${cols.map((_, i) => "?" + (i + 1))})`).bind(...cols.map((c) => row[c])).run();
  }
  assert.ok(local.prepare("SELECT COUNT(*) AS n FROM blobs WHERE key LIKE 'blob/acme/%'").get().n >= 2, "files stored as D1 blobs");
  let r = await mf.dispatchFetch("https://acme.spawnapp.org/"); assert.match(await r.text(), /Hello v1/, "rolled-back version is live");
  r = await mf.dispatchFetch("https://acme.spawnapp.org/img/logo.svg"); assert.equal(r.headers.get("content-type"), "image/svg+xml"); await r.text();
  r = await mf.dispatchFetch("https://acme.spawnapp.org/api/ai/status"); assert.equal((await r.json()).configured, true, "Render-encrypted secret decrypts in the Worker");
  x = await call("POST", "/api/cloud/apps/acme/unpublish", { token: tokA }); assert.equal(x.body.status, "unpublished");
  assert.equal(local.prepare("SELECT status FROM apps WHERE slug='acme'").get().status, "unpublished");
});

test("BidBoard keys flow from Render env into encrypted app secrets (owner-only slug, names only, never returned)", async () => {
  const fakeKey = "sk_test_" + crypto.randomBytes(12).toString("hex"), fakeWh = "whsec_" + crypto.randomBytes(12).toString("hex");
  Object.assign(process.env, { BIDBOARD_STRIPE_SECRET_KEY: fakeKey, BIDBOARD_STRIPE_WEBHOOK_SECRET: fakeWh, BIDBOARD_STRIPE_PRICE_LEAD: "price_lead_x", BIDBOARD_STRIPE_PRICE_PRO: "price_pro_x" });
  const logs = []; const orig = console.log; console.log = (...a) => { logs.push(a.join(" ")); };
  try {
    const tokA = (await call("POST", "/api/cloud/tokens", { user: "a" })).body.token;
    const tokB = (await call("POST", "/api/cloud/tokens", { user: "b" })).body.token;
    const files = { "index.html": "<h1>BidBoard</h1>" };
    delete process.env.BIDBOARD_OWNER_EMAIL;
    let x = await publishSite(tokA, "bidboard", files); assert.equal(x.status, 409, "reserved until an owner email is set");
    process.env.BIDBOARD_OWNER_EMAIL = "A@x.co";
    x = await publishSite(tokB, "bidboard", files); assert.equal(x.status, 409, "other accounts can't claim it");
    x = await publishSite(tokA, "bidboard", files, { backend: true }); assert.equal(x.status, 200, JSON.stringify(x.body));
    const be = cp.localBackend(dir);
    const app = (await be.query("SELECT runtime, config FROM apps WHERE slug='bidboard'"))[0];
    assert.equal(app.runtime, "bidboard"); assert.deepEqual(JSON.parse(app.config), { LEAD_FEE_CENTS: 2500, PRO_FEE_CENTS: 9900 });
    x = await call("GET", "/api/cloud/apps/bidboard/secrets", { token: tokA });
    assert.deepEqual(x.body.names.map((n) => n.name).sort(), ["STRIPE_PRICE_LEAD", "STRIPE_PRICE_PRO", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]);
    assert.ok(!JSON.stringify(x.body).includes(fakeKey) && !JSON.stringify(x.body).includes(fakeWh));
    // stored encrypted with slug:name AAD, decryptable with the shared key
    const row = (await be.query("SELECT blob FROM app_secrets WHERE slug='bidboard' AND name='STRIPE_SECRET_KEY'"))[0];
    assert.ok(!row.blob.includes(fakeKey));
    const raw = Buffer.from(row.blob, "base64"); const dc = crypto.createDecipheriv("aes-256-gcm", Buffer.from(process.env.CLOUD_SECRETS_KEY, "base64"), raw.subarray(0, 12));
    dc.setAAD(Buffer.from("bidboard:STRIPE_SECRET_KEY")); dc.setAuthTag(raw.subarray(raw.length - 16));
    assert.equal(Buffer.concat([dc.update(raw.subarray(12, raw.length - 16)), dc.final()]).toString(), fakeKey);
    // second sync with unchanged env writes nothing; a rotated key is picked up
    let r = await cp.syncPresets(be); assert.deepEqual(r[0].secretsWritten, []);
    process.env.BIDBOARD_STRIPE_WEBHOOK_SECRET = fakeWh + "2";
    r = await cp.syncPresets(be); assert.deepEqual(r[0].secretsWritten, ["STRIPE_WEBHOOK_SECRET"]);
    const all = logs.join("\n"); assert.ok(!all.includes(fakeKey) && !all.includes(fakeWh), "values never logged");
  } finally {
    console.log = orig;
    for (const k of ["BIDBOARD_STRIPE_SECRET_KEY", "BIDBOARD_STRIPE_WEBHOOK_SECRET", "BIDBOARD_STRIPE_PRICE_LEAD", "BIDBOARD_STRIPE_PRICE_PRO", "BIDBOARD_OWNER_EMAIL"]) delete process.env[k];
  }
});
