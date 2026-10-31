// Local end-to-end tests: Miniflare (workerd) with local D1 + R2. Run: npm test
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { readFileSync } from "node:fs";
import { createHash, createHmac, createCipheriv, randomBytes } from "node:crypto";
import { execSync } from "node:child_process";

const KEY = randomBytes(32);
let mf, db, r2;
const sha = (b) => createHash("sha256").update(b).digest("hex");
function enc(slug, name, value) { // identical to what the Render publish API writes
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", KEY, iv);
  c.setAAD(Buffer.from(slug + ":" + name));
  const ct = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return Buffer.concat([iv, ct, c.getAuthTag()]).toString("base64");
}
const F = (host, path, init = {}) => mf.dispatchFetch("https://" + host + path, Object.assign({ redirect: "manual" }, init));
const J = async (res) => ({ status: res.status, body: await res.json(), res });
const post = (host, path, body, headers = {}) => F(host, path, { method: "POST", headers: Object.assign({ "content-type": "application/json", "cf-connecting-ip": "1.2.3." + Math.floor(Math.random() * 250) }, headers), body: JSON.stringify(body) });

async function publish(slug, runtime, files, config = {}) {
  const manifest = {};
  for (const [p, body] of Object.entries(files)) {
    const h = sha(body);
    manifest[p] = { h, s: Buffer.byteLength(body), t: p.endsWith(".html") ? "text/html" : "application/octet-stream" };
    await r2.put(`apps/${slug}/v1/${p}`, body);
  }
  await db.prepare("INSERT INTO apps (slug, owner, runtime, live_version, title, config) VALUES (?1,'u:1',?2,1,?3,?4)").bind(slug, runtime, slug, JSON.stringify(config)).run();
  await db.prepare("INSERT INTO versions (slug, version, manifest, file_count, total_bytes) VALUES (?1,1,?2,?3,0)").bind(slug, JSON.stringify({ files: manifest }), Object.keys(files).length).run();
}

before(async () => {
  execSync("npx wrangler deploy --dry-run --outdir dist", { stdio: "ignore" });
  mf = new Miniflare({
    modules: true, scriptPath: "dist/index.js", compatibilityDate: "2026-08-01", compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: "test-db" }, r2Buckets: { APPS: "test-r2" },
    bindings: { APEX_DOMAIN: "spawnapp.org", ALLOW_HOST_OVERRIDE: "0", SECRETS_KEY: KEY.toString("base64") },
  });
  db = await mf.getD1Database("DB");
  r2 = await mf.getR2Bucket("APPS");
  for (const f of ["migrations/0001_init.sql", "migrations/0002_bidboard.sql"]) {
    const sql = readFileSync(f, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    for (const s of sql.split(";").map((x) => x.trim()).filter(Boolean)) await db.prepare(s).run();
  }
  await publish("demo", "static", { "index.html": "<h1>Demo</h1>", "about.html": "<p>About</p>", "app.js": "console.log(1)", "404.html": "<h1>Custom 404</h1>" });
  await publish("shop", "spawn-backend", { "index.html": "<h1>Shop</h1>" }, { monetization: "stripe", checkoutUrl: "https://buy.stripe.com/test_x" });
  await publish("bb", "bidboard", { "index.html": "<h1>BidBoard</h1>", "job.html": "<p>job</p>", "styles.css": "body{}" },
    { STRIPE_PAYMENT_LINK_LEAD: "https://buy.stripe.com/test_lead", STRIPE_PAYMENT_LINK_PRO: "https://buy.stripe.com/test_pro" });
  await publish("bbdemo", "bidboard", { "index.html": "<h1>BB demo</h1>" });
  await db.prepare("INSERT INTO app_secrets (slug, name, blob) VALUES ('bb','STRIPE_WEBHOOK_SECRET',?1)").bind(enc("bb", "STRIPE_WEBHOOK_SECRET", "whsec_test123")).run();
  await db.prepare("INSERT INTO domains (hostname, slug, status) VALUES ('shop.example.com','shop','active')").run();
  await db.prepare("INSERT INTO bb_places (city, state, code, city_l) VALUES ('Austin','Texas','TX','austin'),('Aurora','Colorado','CO','aurora'),('Boston','Massachusetts','MA','boston')").run();
});
after(async () => mf && (await mf.dispose()));

test("static: index, clean urls, etag/304, headers, 404", async () => {
  let r = await F("demo.spawnapp.org", "/");
  assert.equal(r.status, 200); assert.match(await r.text(), /Demo/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.match(r.headers.get("cache-control"), /max-age=0/);
  const etag = r.headers.get("etag"); assert.ok(etag);
  r = await F("demo.spawnapp.org", "/", { headers: { "if-none-match": etag } }); assert.equal(r.status, 304);
  r = await F("demo.spawnapp.org", "/about"); assert.equal(r.status, 200); assert.match(await r.text(), /About/);
  r = await F("demo.spawnapp.org", "/app.js"); assert.match(r.headers.get("cache-control"), /max-age=3600/); await r.text();
  r = await F("demo.spawnapp.org", "/nope"); assert.equal(r.status, 404); assert.match(await r.text(), /Custom 404/);
  r = await F("demo.spawnapp.org", "/../../etc/passwd"); assert.equal(r.status, 404); await r.text();
  r = await F("demo.spawnapp.org", "/hosted/demo/about.html"); assert.equal(r.status, 301); assert.match(r.headers.get("location"), /\/about\.html$/);
  r = await F("ghost.spawnapp.org", "/"); assert.equal(r.status, 404); assert.match(await r.text(), /No app|isn't published/);
  r = await F("api.spawnapp.org", "/"); assert.equal(r.status, 404); await r.text();
  r = await F("demo.spawnapp.org", "/", { method: "POST" }); assert.equal(r.status, 405); await r.text();
});

test("custom domain + unpublish", async () => {
  let r = await F("shop.example.com", "/"); assert.equal(r.status, 200); assert.match(await r.text(), /Shop/);
  r = await F("unknown.example.com", "/"); assert.equal(r.status, 404); await r.text();
});

test("shared backend: health, config, lead, subscribe, db, posts, storage, rate limit", async () => {
  let x = await J(await F("shop.spawnapp.org", "/api/health")); assert.equal(x.body.ok, true);
  x = await J(await F("shop.spawnapp.org", "/api/config")); assert.equal(x.body.checkoutUrl, "https://buy.stripe.com/test_x");
  x = await J(await post("shop.spawnapp.org", "/api/lead", { email: "a@b.co", name: "A" })); assert.equal(x.body.ok, true);
  x = await J(await post("shop.spawnapp.org", "/api/subscribe", { email: "a@b.co" })); assert.equal(x.body.ok, true);
  x = await J(await post("shop.spawnapp.org", "/api/subscribe", { email: "a@b.co" })); assert.equal(x.body.ok, true);
  x = await J(await F("shop.spawnapp.org", "/api/subscribe")); assert.equal(x.body.count, 1);
  x = await J(await post("shop.spawnapp.org", "/api/db/notes", { text: "hi" })); assert.equal(x.status < 300, true);
  const id = (x.body.row || x.body.item || x.body).id; assert.ok(id);
  x = await J(await F("shop.spawnapp.org", "/api/db/notes")); assert.ok(JSON.stringify(x.body).includes("hi"));
  x = await J(await F("demo.spawnapp.org", "/api/db/notes")); assert.ok(!JSON.stringify(x.body).includes("hi"), "apps are isolated");
  const up = await J(await post("shop.spawnapp.org", "/api/storage/upload", { name: "n.txt", contentBase64: Buffer.from("hello").toString("base64"), contentType: "text/plain" }));
  assert.equal(up.body.ok, true, JSON.stringify(up.body)); const del = up.body.file.deleteKey; assert.ok(del);
  const name = up.body.file.name;
  let r = await F("shop.spawnapp.org", "/storage/" + name); assert.equal(await r.text(), "hello");
  r = await F("shop.spawnapp.org", "/api/storage/" + name, { method: "DELETE" }); assert.equal(r.status, 403); await r.text();
  r = await F("shop.spawnapp.org", "/api/storage/" + name, { method: "DELETE", headers: { "x-delete-key": del } }); assert.equal(r.status, 200); await r.text();
  let limited = false;
  for (let i = 0; i < 40 && !limited; i++) { const q = await F("shop.spawnapp.org", "/api/lead", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "9.9.9.9" }, body: JSON.stringify({ email: "r@b.co" }) }); limited = q.status === 429; await q.text(); }
  assert.ok(limited, "rate limit kicks in");
  x = await J(await F("shop.spawnapp.org", "/api/ai/status")); assert.equal(x.body.configured, false);
});

test("app auth: signup, me, login, logout; magic disabled", async () => {
  let r = await post("shop.spawnapp.org", "/api/auth/signup", { email: "u@x.co", password: "longpassword" });
  assert.equal(r.status, 200); const ck = r.headers.get("set-cookie").split(";")[0]; await r.text();
  let x = await J(await F("shop.spawnapp.org", "/api/auth/me", { headers: { cookie: ck } })); assert.equal(x.body.user.email, "u@x.co");
  x = await J(await post("shop.spawnapp.org", "/api/auth/login", { email: "u@x.co", password: "wrong" })); assert.equal(x.status, 401);
  x = await J(await post("shop.spawnapp.org", "/api/auth/login", { email: "u@x.co", password: "longpassword" })); assert.equal(x.status, 200);
  x = await J(await post("shop.spawnapp.org", "/api/auth/magic", { email: "u@x.co" })); assert.equal(x.status, 501);
  x = await J(await F("demo.spawnapp.org", "/api/auth/me", { headers: { cookie: ck } })); assert.equal(x.body.user, null, "sessions scoped per app");
  // imported scrypt account (desktop format) still signs in
  const { scryptSync } = await import("node:crypto");
  const salt = randomBytes(16).toString("hex");
  await db.prepare("INSERT INTO app_users (slug,email,name,algo,salt,hash,created_at) VALUES ('shop','old@x.co','Old','scrypt',?1,?2,'2026')").bind(salt, scryptSync("oldpass99", salt, 32).toString("hex")).run();
  x = await J(await post("shop.spawnapp.org", "/api/auth/login", { email: "old@x.co", password: "oldpass99" })); assert.equal(x.status, 200, JSON.stringify(x.body));
});

const JOB = { description: "Kitchen faucet leak under sink", trade: "plumbing", city: "Austin", state: "TX", zip: "78701", name: "Pat", phone: "512-555-0100", email: "pat@x.co",
  photoDataUrl: "data:image/png;base64," + Buffer.from("PNGDATA").toString("base64") };

test("bidboard demo mode (payments off): unlock reveals contact", async () => {
  let x = await J(await F("bbdemo.spawnapp.org", "/api/config")); assert.equal(x.body.paymentsLive, false);
  x = await J(await post("bbdemo.spawnapp.org", "/api/jobs", JOB)); assert.equal(x.body.ok, true, JSON.stringify(x.body));
  const id = x.body.job.id;
  x = await J(await post("bbdemo.spawnapp.org", "/api/leads/unlock", { jobId: id, contractorEmail: "c@x.co" }));
  assert.equal(x.body.unlock.status, "demo_unlocked"); assert.equal(x.body.job.phone, JOB.phone);
});

test("bidboard live payments: locked until signed webhook, then token reveals", async () => {
  let x = await J(await F("bb.spawnapp.org", "/api/config")); assert.equal(x.body.paymentsLive, true);
  x = await J(await post("bb.spawnapp.org", "/api/jobs", Object.assign({}, JOB, { state: "Texas" }))); const id = x.body.job.id;
  x = await J(await F("bb.spawnapp.org", "/api/jobs?city=austin&state=TX")); assert.ok(x.body.jobs.some((j) => j.id === id)); assert.ok(!JSON.stringify(x.body).includes("555-0100"));
  x = await J(await F("bb.spawnapp.org", "/api/jobs/" + id + "?unlocked=1")); assert.equal(x.body.locked, true, "unlocked=1 bypass closed");
  let r = await F("bb.spawnapp.org", "/api/jobs/" + id + "/photo"); assert.equal(r.status, 403); await r.text();
  x = await J(await post("bb.spawnapp.org", "/api/leads/unlock", { jobId: id, contractorEmail: "c@x.co" }));
  assert.equal(x.body.unlock.status, "pending_payment"); assert.equal(x.body.job.phone, undefined);
  const { token, id: unlockId } = x.body.unlock;
  assert.match(x.body.checkoutUrl, /client_reference_id=lead-/);
  x = await J(await F("bb.spawnapp.org", `/api/jobs/${id}?token=${token}`)); assert.equal(x.body.locked, true);
  const evt = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_test_abcdefgh", client_reference_id: "lead-" + unlockId, payment_status: "paid", amount_total: 2500, currency: "usd" } } });
  const t = Math.floor(Date.now() / 1000);
  r = await F("bb.spawnapp.org", "/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": `t=${t},v1=deadbeef` }, body: evt }); assert.equal(r.status, 400); await r.text();
  const sig = createHmac("sha256", "whsec_test123").update(t + "." + evt).digest("hex");
  r = await F("bb.spawnapp.org", "/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": `t=${t},v1=${sig}` }, body: evt }); assert.equal(r.status, 200); await r.text();
  r = await F("bb.spawnapp.org", "/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": `t=${t},v1=${sig}` }, body: evt }); assert.match(await r.text(), /duplicate/);
  x = await J(await F("bb.spawnapp.org", `/api/jobs/${id}?token=${token}`)); assert.equal(x.body.locked, false); assert.equal(x.body.job.phone, JOB.phone);
  r = await F("bb.spawnapp.org", `/api/jobs/${id}/photo?token=${token}`); assert.equal(r.status, 200); assert.equal(await r.text(), "PNGDATA");
  r = await F("bb.spawnapp.org", "/paid?session_id=cs_test_abcdefgh"); assert.equal(r.status, 302); assert.match(r.headers.get("location"), new RegExp("job.html\\?id=" + id + "&token=" + token));
  r = await F("bb.spawnapp.org", "/paid?session_id=cs_test_unknown1"); assert.equal(r.status, 200); assert.match(await r.text(), /Confirming/);
  // delete requires matching contact
  x = await J(await F("bb.spawnapp.org", "/api/jobs/" + id, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "x@y.co" }) })); assert.equal(x.status, 403);
  x = await J(await F("bb.spawnapp.org", "/api/jobs/" + id, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "pat@x.co" }) })); assert.equal(x.body.ok, true);
});

test("bidboard pro subscription lifecycle + included unlock", async () => {
  let x = await J(await post("bb.spawnapp.org", "/api/contractors", { name: "Cee", email: "pro@x.co", city: "Austin", state: "TX" })); assert.equal(x.body.ok, true);
  x = await J(await post("bb.spawnapp.org", "/api/pro/checkout", { email: "pro@x.co" })); assert.match(x.body.checkoutUrl, /client_reference_id=pro-/);
  const send = async (o, type, id) => { const evt = JSON.stringify({ id, type, data: { object: o } }); const t = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", "whsec_test123").update(t + "." + evt).digest("hex");
    const r = await F("bb.spawnapp.org", "/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": `t=${t},v1=${sig}` }, body: evt }); assert.equal(r.status, 200); await r.text(); };
  await send({ id: "cs_p", client_reference_id: "pro-abc", payment_status: "paid", customer: "cus_1", subscription: "sub_1", customer_details: { email: "pro@x.co" } }, "checkout.session.completed", "evt_p1");
  let row = await db.prepare("SELECT plan FROM bb_contractors WHERE slug='bb' AND email='pro@x.co'").first(); assert.equal(row.plan, "pro");
  // signed-in pro unlocks without paying
  let r = await post("bb.spawnapp.org", "/api/auth/signup", { email: "pro@x.co", password: "longpassword" }); const ck = r.headers.get("set-cookie").split(";")[0]; await r.text();
  const job = await J(await post("bb.spawnapp.org", "/api/jobs", JOB));
  x = await J(await post("bb.spawnapp.org", "/api/leads/unlock", { jobId: job.body.job.id, contractorEmail: "pro@x.co" }, { cookie: ck }));
  assert.equal(x.body.unlock.status, "paid"); assert.equal(x.body.job.phone, JOB.phone);
  x = await J(await post("bb.spawnapp.org", "/api/leads/unlock", { jobId: job.body.job.id, contractorEmail: "pro@x.co" }));
  assert.equal(x.body.unlock.status, "pending_payment", "not signed in -> pays");
  await send({ id: "sub_1", status: "canceled" }, "customer.subscription.deleted", "evt_p2");
  row = await db.prepare("SELECT plan FROM bb_contractors WHERE slug='bb' AND email='pro@x.co'").first(); assert.equal(row.plan, "pay_per_lead");
});

test("bidboard places + misc", async () => {
  let x = await J(await F("bb.spawnapp.org", "/api/places/search?q=au")); assert.deepEqual(x.body.results.map((p) => p.city).sort(), ["Aurora", "Austin"]);
  x = await J(await F("bb.spawnapp.org", "/api/places/search?q=au&state=TX")); assert.equal(x.body.results.length, 1);
  x = await J(await F("bb.spawnapp.org", "/api/places/states")); assert.equal(x.body.states.length, 51);
  x = await J(await F("bb.spawnapp.org", "/api/export/jobs.csv")); assert.equal(x.status, 403);
  x = await J(await post("bb.spawnapp.org", "/api/jobs/suggest", { description: "furnace out", trade: "hvac" })); assert.equal(x.body.suggestion.title, "HVAC service request");
  x = await J(await F("bb.spawnapp.org", "/api/stats")); assert.equal(x.body.ok, true);
});
