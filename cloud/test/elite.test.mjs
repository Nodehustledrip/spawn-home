// Elite perks at the edge: password gate + visitor stats. Miniflare + local D1. No network.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { readFileSync } from "node:fs";
import { createHash, randomBytes, pbkdf2Sync } from "node:crypto";
import { execSync } from "node:child_process";
import { putBlob } from "./blob-helper.mjs";

const KEY = randomBytes(32);
let mf, db, fdb;
const sha = (b) => createHash("sha256").update(b).digest("hex");
const UA = { "user-agent": "Mozilla/5.0 (Macintosh) Safari/605" };
const F = (host, path, init = {}) => mf.dispatchFetch("https://" + host + path, Object.assign({ redirect: "manual" }, init));

async function publish(slug, files) {
  const manifest = {};
  for (const [p, body] of Object.entries(files)) {
    const h = sha(body);
    manifest[p] = { h, s: Buffer.byteLength(body), t: p.endsWith(".html") ? "text/html" : "application/octet-stream" };
    await putBlob(fdb, `blob/${slug}/${h}`, body);
  }
  await db.prepare("INSERT INTO apps (slug, owner, runtime, live_version, title) VALUES (?1,'u:1','static',1,?2)").bind(slug, slug).run();
  await db.prepare("INSERT INTO versions (slug, version, manifest, file_count, total_bytes) VALUES (?1,1,?2,?3,0)").bind(slug, JSON.stringify({ files: manifest }), Object.keys(files).length).run();
}
function protect(slug, pw, ver = 1) { // identical to what spawn-home (cloudelite.js) writes
  const salt = randomBytes(16).toString("hex"); const it = 20000;
  const hash = pbkdf2Sync(pw, Buffer.from(salt, "hex"), it, 32, "sha256").toString("hex");
  return db.prepare("INSERT INTO app_protect (slug, pw_hash, pw_salt, iterations, ver) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(slug) DO UPDATE SET pw_hash=excluded.pw_hash, pw_salt=excluded.pw_salt, ver=excluded.ver").bind(slug, hash, salt, it, ver).run();
}
const unlock = (host, pw, next = "/") => F(host, "/__spawn/unlock", { method: "POST", headers: Object.assign({ "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": "9.9.9." + Math.floor(Math.random() * 200) }, UA), body: new URLSearchParams({ password: pw, next }).toString() });

before(async () => {
  execSync("npx wrangler deploy --dry-run --outdir dist", { stdio: "ignore" });
  mf = new Miniflare({ modules: true, scriptPath: "dist/index.js", compatibilityDate: "2026-08-01", compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: "elite-db", FILES: "elite-files" }, bindings: { APEX_DOMAIN: "spawnapp.org", ALLOW_HOST_OVERRIDE: "0", SECRETS_KEY: KEY.toString("base64") } });
  db = await mf.getD1Database("DB"); fdb = await mf.getD1Database("FILES");
  for (const f of ["migrations/0001_init.sql", "migrations/0003_blobs.sql", "migrations/0005_gallery.sql", "migrations/0009_elite.sql"]) for (const d of [db, fdb]) {
    const sql = readFileSync(f, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    for (const s of sql.split(";").map((x) => x.trim()).filter(Boolean)) await d.prepare(s).run();
  }
});
after(async () => mf && (await mf.dispose()));

test("password gate: branded page, wrong password rejected, right one admits via signed cookie", async () => {
  await publish("vault", { "index.html": "<h1>Private plans</h1>", "about.html": "<p>About</p>" });
  await protect("vault", "correct horse");
  let r = await F("vault.spawnapp.org", "/about", { headers: UA });
  assert.equal(r.status, 401); let html = await r.text();
  assert.match(html, /password/i); assert.doesNotMatch(html, /Private plans/); assert.match(html, /name="next" value="\/about"/);
  assert.equal(r.headers.get("cache-control"), "no-store");
  r = await F("vault.spawnapp.org", "/api/kv/x", { headers: UA }); assert.equal(r.status, 401); await r.text();
  r = await unlock("vault.spawnapp.org", "wrong"); assert.equal(r.status, 401); assert.match(await r.text(), /isn&#39;t right/); assert.equal(r.headers.get("set-cookie"), null);
  r = await unlock("vault.spawnapp.org", "correct horse", "/about");
  assert.equal(r.status, 303); assert.equal(new URL(r.headers.get("location")).pathname, "/about");
  const sc = r.headers.get("set-cookie"); assert.match(sc, /HttpOnly/); assert.match(sc, /Secure/); assert.match(sc, /SameSite=Lax/);
  const ck = sc.split(";")[0];
  r = await F("vault.spawnapp.org", "/", { headers: Object.assign({ cookie: ck }, UA) }); assert.equal(r.status, 200); assert.match(await r.text(), /Private plans/);
  assert.equal(r.headers.get("cache-control"), "private, no-store");
  // tampered cookie and open-redirect attempts fail
  r = await F("vault.spawnapp.org", "/", { headers: Object.assign({ cookie: ck.slice(0, -2) + "00" }, UA) }); assert.equal(r.status, 401); await r.text();
  r = await unlock("vault.spawnapp.org", "correct horse", "//evil.example"); assert.equal(new URL(r.headers.get("location")).host, "vault.spawnapp.org");
  // cookie for one app does not open another
  await publish("vault2", { "index.html": "<h1>Two</h1>" }); await protect("vault2", "correct horse");
  r = await F("vault2.spawnapp.org", "/", { headers: Object.assign({ cookie: ck.replace("spawn_gate_vault", "spawn_gate_vault2") }, UA) }); assert.equal(r.status, 401); await r.text();
  // changing the password (ver bump) logs everyone out; removing it opens the site (after the 15 s app cache)
  await protect("vault", "new one", 2);
  await db.prepare("DELETE FROM app_protect WHERE slug='vault2'").run();
  await new Promise((res) => setTimeout(res, 16000));
  r = await F("vault.spawnapp.org", "/", { headers: Object.assign({ cookie: ck }, UA) }); assert.equal(r.status, 401); await r.text();
  r = await F("vault2.spawnapp.org", "/", { headers: UA }); assert.equal(r.status, 200); assert.match(await r.text(), /Two/);
});

test("unprotected apps are untouched", async () => {
  await publish("open1", { "index.html": "<h1>Open</h1>" });
  const r = await F("open1.spawnapp.org", "/", { headers: UA }); assert.equal(r.status, 200); assert.match(await r.text(), /Open/);
  assert.match(r.headers.get("cache-control"), /max-age=0/);
});

test("visitor stats: aggregate daily counts, pages, referrers; bots and assets skipped; nothing personal stored", async () => {
  await publish("stat", { "index.html": "<h1>S</h1>", "pricing.html": "<p>P</p>", "app.js": "1" });
  await publish("nostat", { "index.html": "<h1>N</h1>" });
  await db.prepare("INSERT INTO app_features (slug, stats) VALUES ('stat',1)").run();
  const hit = (p, h = {}) => F("stat.spawnapp.org", p, { headers: Object.assign({}, UA, { "cf-connecting-ip": "5.6.7.8" }, h) }).then((r) => r.text());
  await hit("/", { referer: "https://www.google.com/search?q=x" });
  await hit("/");
  await hit("/pricing", { referer: "https://stat.spawnapp.org/" });
  await hit("/app.js");
  await hit("/", { "user-agent": "Googlebot/2.1" });
  await F("nostat.spawnapp.org", "/", { headers: UA }).then((r) => r.text());
  await new Promise((res) => setTimeout(res, 300));
  const rows = (await db.prepare("SELECT slug, kind, k, n FROM app_stats ORDER BY kind, k").all()).results;
  const get = (kind, k) => (rows.find((x) => x.kind === kind && x.k === k) || {}).n || 0;
  assert.equal(get("v", ""), 3, "three human page views");
  assert.equal(get("p", "/"), 2); assert.equal(get("p", "/pricing"), 1);
  assert.equal(get("r", "google.com"), 1); assert.equal(get("r", ""), 1, "one direct entry; in-app navigation is not a referrer");
  assert.ok(rows.every((x) => x.slug === "stat"), "stats off → nothing counted");
  const dump = JSON.stringify((await db.prepare("SELECT * FROM app_stats").all()).results);
  assert.doesNotMatch(dump, /5\.6\.7\.8|Mozilla|search\?q/);
});
