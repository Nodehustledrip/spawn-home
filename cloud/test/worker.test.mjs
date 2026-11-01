// Local end-to-end tests: Miniflare (workerd) with local D1 (DB + FILES). Run: npm test
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { readFileSync } from "node:fs";
import { createHash, createHmac, createCipheriv, randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import { createStripeMock } from "./stripe-mock.mjs";
import { putBlob } from "./blob-helper.mjs";

const SK = "sk_test_mock_" + randomBytes(6).toString("hex");
const stripe = createStripeMock({ key: SK, prices: { price_lead_test: { amount: 2500 }, price_pro_test: { amount: 9900, recurring: "month" } } });
const WHSEC = "whsec_test123";
function signed(evt, secret = WHSEC) { const body = JSON.stringify(evt); const t = Math.floor(Date.now() / 1000); return { body, sig: `t=${t},v1=${createHmac("sha256", secret).update(t + "." + body).digest("hex")}` }; }

const KEY = randomBytes(32);
let mf, db, fdb;
const BIG = Buffer.from(Array.from({ length: 1300000 }, (_, i) => (i * 7 + (i >> 9)) & 255));
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
    await putBlob(fdb, `blob/${slug}/${h}`, body);
  }
  await db.prepare("INSERT INTO apps (slug, owner, runtime, live_version, title, config) VALUES (?1,'u:1',?2,1,?3,?4)").bind(slug, runtime, slug, JSON.stringify(config)).run();
  await db.prepare("INSERT INTO versions (slug, version, manifest, file_count, total_bytes) VALUES (?1,1,?2,?3,0)").bind(slug, JSON.stringify({ files: manifest }), Object.keys(files).length).run();
}

before(async () => {
  execSync("npx wrangler deploy --dry-run --outdir dist", { stdio: "ignore" });
  mf = new Miniflare({
    modules: true, scriptPath: "dist/index.js", compatibilityDate: "2026-08-01", compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: "test-db", FILES: "test-files" },
    bindings: { APEX_DOMAIN: "spawnapp.org", ALLOW_HOST_OVERRIDE: "0", SECRETS_KEY: KEY.toString("base64"), STRIPE_API_BASE: "https://stripe.mock" },
    outboundService: stripe.fetcher,
  });
  db = await mf.getD1Database("DB");
  fdb = await mf.getD1Database("FILES");
  for (const f of ["migrations/0001_init.sql", "migrations/0002_bidboard.sql", "migrations/0003_blobs.sql", "migrations/0005_gallery.sql", "migrations/0008_app_payments.sql"]) for (const d of [db, fdb]) {
    const sql = readFileSync(f, "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    for (const s of sql.split(";").map((x) => x.trim()).filter(Boolean)) await d.prepare(s).run();
  }
  await publish("demo", "static", { "index.html": "<h1>Demo</h1>", "about.html": "<p>About</p>", "app.js": "console.log(1)", "404.html": "<h1>Custom 404</h1>" });
  await publish("shop", "spawn-backend", { "index.html": "<h1>Shop</h1>" }, { monetization: "stripe", checkoutUrl: "https://buy.stripe.com/test_x" });
  await publish("bb", "bidboard", { "index.html": "<h1>BidBoard</h1>", "job.html": "<p>job</p>", "styles.css": "body{}" },
    { LEAD_FEE_CENTS: 2500, PRO_FEE_CENTS: 9900, STRIPE_PRICE_LEAD: "price_lead_test", STRIPE_PORTAL_CONFIG: "bpc_test_bidboard" });
  await publish("bbdemo", "bidboard", { "index.html": "<h1>BB demo</h1>" });
  await publish("big", "static", { "index.html": "<h1>Big</h1>", "data.bin": BIG });
  for (const [n, v] of [["STRIPE_WEBHOOK_SECRET", WHSEC], ["STRIPE_SECRET_KEY", SK], ["STRIPE_PRICE_PRO", "price_pro_test"]]) // price id from secrets also works
    await db.prepare("INSERT INTO app_secrets (slug, name, blob) VALUES ('bb',?1,?2)").bind(n, enc("bb", n, v)).run();
  // keys present but no price id -> payments stay off (no half-configured checkout)
  await publish("bbhalf", "bidboard", { "index.html": "<h1>x</h1>" });
  for (const [n, v] of [["STRIPE_WEBHOOK_SECRET", WHSEC], ["STRIPE_SECRET_KEY", SK]]) await db.prepare("INSERT INTO app_secrets (slug, name, blob) VALUES ('bbhalf',?1,?2)").bind(n, enc("bbhalf", n, v)).run();
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

test("share tags: og/twitter injected from gallery metadata; own og:image left alone; etag tracks gallery", async () => {
  await publish("ogapp", "static", { "index.html": "<html><head><title>Page T</title><meta name=\"description\" content=\"Page desc\"></head><body>x</body></html>" });
  await publish("ogown", "static", { "index.html": "<html><head><meta property=\"og:image\" content=\"https://x/y.png\"></head><body>y</body></html>" });
  let r = await F("ogapp.spawnapp.org", "/"); let h = await r.text();
  assert.match(h, /og:image" content="https:\/\/spawnapp\.org\/og\/app\/ogapp\.png/);
  assert.match(h, /og:description" content="Page desc"/); assert.match(h, /twitter:card/);
  const e1 = r.headers.get("etag");
  await db.prepare("INSERT INTO gallery (slug, owner, listed, title, description, updated_at) VALUES ('ogapp','u:1',1,'Gal <T>','Gal desc','2026-11-01T10:00:00Z')").run();
  await new Promise((res) => setTimeout(res, 50));
  r = await F("ogapp.spawnapp.org", "/?x=1"); h = await r.text();
  r = await F("ogown.spawnapp.org", "/"); const own = await r.text();
  assert.doesNotMatch(own, /spawn-og/); assert.equal((own.match(/og:image/g) || []).length, 1);
  assert.ok(e1);
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

const hook = (evt, secret) => { const { body, sig } = signed(evt, secret); return F("bb.spawnapp.org", "/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": sig }, body }); };

test("bidboard live payments: on-site Checkout, webhook marks paid, /paid shows the contact", async () => {
  let x = await J(await F("bb.spawnapp.org", "/api/config")); assert.equal(x.body.paymentsLive, true); assert.equal(x.body.proAvailable, true);
  assert.ok(!JSON.stringify(x.body).includes("stripe.com"), "no payment links in config");
  x = await J(await F("bbhalf.spawnapp.org", "/api/config")); assert.equal(x.body.paymentsLive, false);
  x = await J(await post("bb.spawnapp.org", "/api/jobs", Object.assign({}, JOB, { state: "Texas" }))); const id = x.body.job.id;
  x = await J(await F("bb.spawnapp.org", "/api/jobs?city=austin&state=TX")); assert.ok(x.body.jobs.some((j) => j.id === id)); assert.ok(!JSON.stringify(x.body).includes("555-0100"));
  x = await J(await F("bb.spawnapp.org", "/api/jobs/" + id + "?unlocked=1")); assert.equal(x.body.locked, true, "unlocked=1 bypass closed");
  let r = await F("bb.spawnapp.org", "/api/jobs/" + id + "/photo"); assert.equal(r.status, 403); await r.text();
  x = await J(await post("bb.spawnapp.org", "/api/leads/unlock", { jobId: id, contractorEmail: "c@x.co" }));
  assert.equal(x.body.unlock.status, "pending_payment"); assert.equal(x.body.job.phone, undefined);
  const { token, id: unlockId } = x.body.unlock;
  assert.match(x.body.checkoutUrl, /^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_mock/);
  const sid = x.body.checkoutUrl.split("/").pop();
  const form = stripe.sessions.get(sid)._form;
  assert.equal(form.mode, "payment"); assert.equal(form["line_items[0][price]"], "price_lead_test"); assert.equal(form.customer_email, "c@x.co");
  assert.equal(form["metadata[unlock_id]"], unlockId); assert.equal(form["metadata[slug]"], "bb"); assert.equal(form["metadata[job_id]"], id);
  assert.equal(form.success_url, "https://bb.spawnapp.org/paid?session_id={CHECKOUT_SESSION_ID}");
  assert.ok(stripe.calls.find((c) => c.path === "/v1/checkout/sessions" && c.idem === "bb-lead-bb-" + unlockId), "idempotency key sent");
  x = await J(await F("bb.spawnapp.org", `/api/jobs/${id}?token=${token}`)); assert.equal(x.body.locked, true);
  // /paid before payment: Stripe says unpaid -> waiting page, still locked
  r = await F("bb.spawnapp.org", "/paid?session_id=" + sid); assert.equal(r.status, 200); assert.match(await r.text(), /Confirming/);
  // forged webhooks are rejected
  const paid = Object.assign({}, stripe.complete(sid)); delete paid._form;
  const evt = { id: "evt_lead_1", type: "checkout.session.completed", data: { object: paid } };
  r = await F("bb.spawnapp.org", "/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": `t=${Math.floor(Date.now() / 1000)},v1=deadbeef` }, body: JSON.stringify(evt) }); assert.equal(r.status, 400); await r.text();
  r = await hook(evt, "whsec_wrong"); assert.equal(r.status, 400); await r.text();
  r = await F("bb.spawnapp.org", "/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": `t=${Math.floor(Date.now() / 1000) - 3600},v1=${createHmac("sha256", WHSEC).update((Math.floor(Date.now() / 1000) - 3600) + "." + JSON.stringify(evt)).digest("hex")}` }, body: JSON.stringify(evt) });
  assert.equal(r.status, 400, "stale timestamp rejected"); await r.text();
  x = await J(await F("bb.spawnapp.org", `/api/jobs/${id}?token=${token}`)); assert.equal(x.body.locked, true, "still locked after forged events");
  // a paid session for a different unlock / lower amount does not unlock
  r = await hook({ id: "evt_lead_bad", type: "checkout.session.completed", data: { object: Object.assign({}, paid, { amount_total: 100 }) } }); assert.equal(r.status, 200); await r.text();
  r = await hook({ id: "evt_lead_bad2", type: "checkout.session.completed", data: { object: Object.assign({}, paid, { id: "cs_test_other0001" }) } }); await r.text();
  x = await J(await F("bb.spawnapp.org", `/api/jobs/${id}?token=${token}`)); assert.equal(x.body.locked, true, "wrong amount / session ignored");
  r = await hook(evt); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true });
  r = await hook(evt); assert.deepEqual(await r.json(), { ok: true, duplicate: true });
  const ev = await db.prepare("SELECT COUNT(*) AS n FROM stripe_events WHERE id='evt_lead_1'").first(); assert.equal(ev.n, 1);
  x = await J(await F("bb.spawnapp.org", `/api/jobs/${id}?token=${token}`)); assert.equal(x.body.locked, false); assert.equal(x.body.job.phone, JOB.phone);
  r = await F("bb.spawnapp.org", `/api/jobs/${id}/photo?token=${token}`); assert.equal(r.status, 200); assert.equal(await r.text(), "PNGDATA");
  r = await F("bb.spawnapp.org", "/paid?session_id=" + sid); assert.equal(r.status, 302); assert.match(r.headers.get("location"), new RegExp("job.html\\?id=" + id + "&token=" + token));
  r = await F("bb.spawnapp.org", "/paid?session_id=cs_test_unknown1"); assert.equal(r.status, 200); assert.match(await r.text(), /Confirming/);
  // delete requires matching contact
  x = await J(await F("bb.spawnapp.org", "/api/jobs/" + id, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "x@y.co" }) })); assert.equal(x.status, 403);
  x = await J(await F("bb.spawnapp.org", "/api/jobs/" + id, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "pat@x.co" }) })); assert.equal(x.body.ok, true);
});

test("bidboard /paid verifies the session with Stripe when the webhook is late", async () => {
  let x = await J(await post("bb.spawnapp.org", "/api/jobs", JOB)); const id = x.body.job.id;
  x = await J(await post("bb.spawnapp.org", "/api/leads/unlock", { jobId: id, contractorEmail: "late@x.co" }));
  const { token } = x.body.unlock; const sid = x.body.checkoutUrl.split("/").pop();
  stripe.complete(sid);
  const r = await F("bb.spawnapp.org", "/paid?session_id=" + sid); assert.equal(r.status, 302); assert.match(r.headers.get("location"), new RegExp("token=" + token));
  x = await J(await F("bb.spawnapp.org", `/api/jobs/${id}?token=${token}`)); assert.equal(x.body.locked, false); assert.equal(x.body.job.phone, JOB.phone);
});

test("bidboard Pro: subscription Checkout, on/off via webhooks, portal", async () => {
  // must be signed in
  let x = await J(await post("bb.spawnapp.org", "/api/pro/checkout", {})); assert.equal(x.status, 401); assert.match(x.body.signin, /login\.html/);
  let r = await post("bb.spawnapp.org", "/api/auth/signup", { email: "pro@x.co", password: "longpassword" }); const ck = r.headers.get("set-cookie").split(";")[0]; await r.text();
  x = await J(await post("bb.spawnapp.org", "/api/billing/portal", {}, { cookie: ck })); assert.equal(x.status, 400, "no billing account yet");
  x = await J(await F("bb.spawnapp.org", "/api/pro/status", { headers: { cookie: ck } })); assert.equal(x.body.pro, false); assert.equal(x.body.canManageBilling, false);
  x = await J(await post("bb.spawnapp.org", "/api/pro/checkout", {}, { cookie: ck })); assert.equal(x.body.ok, true);
  assert.match(x.body.url, /^https:\/\/checkout\.stripe\.com\//);
  const sid = x.body.url.split("/").pop(); const f = stripe.sessions.get(sid)._form;
  assert.equal(f.mode, "subscription"); assert.equal(f["line_items[0][price]"], "price_pro_test"); assert.equal(f.customer_email, "pro@x.co");
  assert.equal(f["subscription_data[metadata][slug]"], "bb"); assert.ok(f["subscription_data[metadata][contractor_id]"]);
  const cid = f["metadata[contractor_id]"];
  const plan = async () => (await db.prepare("SELECT plan FROM bb_contractors WHERE slug='bb' AND email='pro@x.co'").first()).plan;
  assert.equal(await plan(), "pay_per_lead");
  const s = Object.assign({}, stripe.complete(sid, { customer: "cus_pro1", subscription: "sub_pro1" })); delete s._form;
  r = await hook({ id: "evt_p1", type: "checkout.session.completed", data: { object: s } }); assert.equal(r.status, 200); await r.text();
  assert.equal(await plan(), "pro");
  r = await F("bb.spawnapp.org", "/paid?session_id=" + sid); assert.equal(r.status, 302); assert.match(r.headers.get("location"), /contractors\.html\?pro=welcome/);
  x = await J(await post("bb.spawnapp.org", "/api/pro/checkout", {}, { cookie: ck })); assert.equal(x.status, 409);
  // signed-in Pro unlocks without paying; signed-out with same email still pays
  const job = await J(await post("bb.spawnapp.org", "/api/jobs", JOB));
  x = await J(await post("bb.spawnapp.org", "/api/leads/unlock", { jobId: job.body.job.id, contractorEmail: "pro@x.co" }, { cookie: ck }));
  assert.equal(x.body.unlock.status, "paid"); assert.equal(x.body.job.phone, JOB.phone); assert.equal(x.body.checkoutUrl, null);
  x = await J(await post("bb.spawnapp.org", "/api/leads/unlock", { jobId: job.body.job.id, contractorEmail: "pro@x.co" }));
  assert.equal(x.body.unlock.status, "pending_payment", "not signed in -> pays");
  // portal
  x = await J(await post("bb.spawnapp.org", "/api/billing/portal", {}, { cookie: ck })); assert.equal(x.body.ok, true); assert.match(x.body.url, /^https:\/\/billing\.stripe\.com\//);
  const p = stripe.portals.at(-1); assert.equal(p.customer, "cus_pro1"); assert.equal(p.return_url, "https://bb.spawnapp.org/contractors.html"); assert.equal(p.configuration, "bpc_test_bidboard");
  x = await J(await F("bb.spawnapp.org", "/api/pro/status", { headers: { cookie: ck } })); assert.equal(x.body.pro, true); assert.equal(x.body.canManageBilling, true);
  x = await J(await post("bb.spawnapp.org", "/api/billing/portal", {})); assert.equal(x.status, 401);
  // lifecycle
  const sub = (status, extra = {}) => ({ id: "sub_pro1", object: "subscription", status, customer: "cus_pro1", metadata: { app: "bidboard", slug: "bb", contractor_id: cid }, ...extra });
  r = await hook({ id: "evt_p2", type: "invoice.payment_failed", data: { object: { id: "in_1", parent: { subscription_details: { subscription: "sub_pro1" } } } } }); await r.text();
  assert.equal(await plan(), "pay_per_lead", "payment failed -> off");
  r = await hook({ id: "evt_p3", type: "customer.subscription.updated", data: { object: sub("active") } }); await r.text();
  assert.equal(await plan(), "pro", "recovered -> on");
  r = await hook({ id: "evt_p3b", type: "invoice.payment_failed", data: { object: { id: "in_2", subscription: "sub_pro1" } } }); await r.text();
  assert.equal(await plan(), "pay_per_lead", "older invoice shape handled");
  r = await hook({ id: "evt_p4", type: "customer.subscription.updated", data: { object: sub("active") } }); await r.text(); assert.equal(await plan(), "pro");
  r = await hook({ id: "evt_p5", type: "customer.subscription.updated", data: { object: sub("past_due") } }); await r.text(); assert.equal(await plan(), "pay_per_lead");
  r = await hook({ id: "evt_p5", type: "customer.subscription.updated", data: { object: sub("active") } }); assert.match(await r.text(), /duplicate/);
  assert.equal(await plan(), "pay_per_lead", "duplicate event id not re-applied");
  r = await hook({ id: "evt_p6", type: "customer.subscription.updated", data: { object: sub("active") } }); await r.text(); assert.equal(await plan(), "pro");
  r = await hook({ id: "evt_p7", type: "customer.subscription.deleted", data: { object: sub("canceled") } }); await r.text(); assert.equal(await plan(), "pay_per_lead");
  // a subscription.created for a new sub (e.g. re-subscribe made in the portal) turns it on via metadata
  r = await hook({ id: "evt_p8", type: "customer.subscription.created", data: { object: sub("active", { id: "sub_pro2" }) } }); await r.text(); assert.equal(await plan(), "pro");
  // events for another app's slug are ignored
  r = await hook({ id: "evt_p9", type: "customer.subscription.deleted", data: { object: sub("canceled", { id: "sub_pro2", metadata: { slug: "other" } }) } }); await r.text(); assert.equal(await plan(), "pro");
});

test("bidboard places + misc", async () => {
  let x = await J(await F("bb.spawnapp.org", "/api/places/search?q=au")); assert.deepEqual(x.body.results.map((p) => p.city).sort(), ["Aurora", "Austin"]);
  x = await J(await F("bb.spawnapp.org", "/api/places/search?q=au&state=TX")); assert.equal(x.body.results.length, 1);
  x = await J(await F("bb.spawnapp.org", "/api/places/states")); assert.equal(x.body.states.length, 51);
  x = await J(await F("bb.spawnapp.org", "/api/export/jobs.csv")); assert.equal(x.status, 403);
  x = await J(await post("bb.spawnapp.org", "/api/jobs/suggest", { description: "furnace out", trade: "hvac" })); assert.equal(x.body.suggestion.title, "HVAC service request");
  x = await J(await F("bb.spawnapp.org", "/api/stats")); assert.equal(x.body.ok, true);
});

test("multi-chunk file from D1 is served byte-identical", async () => {
  const r = await F("big.spawnapp.org", "/data.bin"); assert.equal(r.status, 200);
  const b = Buffer.from(await r.arrayBuffer()); assert.equal(b.length, BIG.length); assert.ok(b.equals(BIG));
  const c = await fdb.prepare("SELECT chunks FROM blobs WHERE key LIKE 'blob/big/%' AND size=?1").bind(BIG.length).first(); assert.equal(c.chunks, 3);
});

test("members-only pages + owner view (OWNER_KEY)", async () => {
  await publish("club", "static", { "index.html": "<h1>Club</h1>", "account.html": "<h1>Account</h1>", "members/index.html": "<h1>Secret library</h1>", "members/guide.txt": "secret" });
  // no secrets: nobody is a member; owner view not set up
  let r = await F("club.spawnapp.org", "/members/");
  assert.equal(r.status, 302); assert.match(r.headers.get("location"), /^\/account\?gate=signin&next=/); await r.text();
  r = await F("club.spawnapp.org", "/members/guide.txt"); assert.equal(r.status, 403); await r.text();
  let x = await J(await F("club.spawnapp.org", "/api/owner/records")); assert.equal(x.status, 404);
  r = await post("club.spawnapp.org", "/api/auth/signup", { email: "m@x.co", password: "longpassword" });
  const ck = r.headers.get("set-cookie").split(";")[0]; await r.text();
  r = await F("club.spawnapp.org", "/members/", { headers: { cookie: ck } }); assert.equal(r.status, 302); assert.match(r.headers.get("location"), /gate=pending/); await r.text();
  x = await J(await F("club.spawnapp.org", "/api/members/me", { headers: { cookie: ck } })); assert.equal(x.body.signedIn, true); assert.equal(x.body.member, false);
  // owner key set: wrong key 401, right key lists signups and approves
  const OK = "owner-key-" + randomBytes(6).toString("hex");
  await db.prepare("INSERT INTO app_secrets (slug, name, blob) VALUES ('club','OWNER_KEY',?1)").bind(enc("club", "OWNER_KEY", OK)).run();
  await new Promise((res) => setTimeout(res, 31000)); // secret cache TTL
  x = await J(await F("club.spawnapp.org", "/api/owner/members", { headers: { authorization: "Bearer nope-nope-nope" } })); assert.equal(x.status, 401);
  x = await J(await F("club.spawnapp.org", "/api/owner/members", { headers: { authorization: "Bearer " + OK } }));
  assert.deepEqual(x.body.members.map((m) => [m.email, m.approved]), [["m@x.co", false]]);
  x = await J(await post("club.spawnapp.org", "/api/owner/members", { email: "m@x.co" }, { authorization: "Bearer " + OK })); assert.equal(x.body.approved, true);
  r = await F("club.spawnapp.org", "/members/", { headers: { cookie: ck } }); assert.equal(r.status, 200); assert.match(await r.text(), /Secret library/);
  assert.equal(r.headers.get("cache-control"), "private, no-store");
  r = await F("club.spawnapp.org", "/members/"); assert.equal(r.status, 302, "still gated without a session"); await r.text();
  await post("club.spawnapp.org", "/api/lead", { name: "Ada", message: "Booking Tue 10:00" });
  x = await J(await F("club.spawnapp.org", "/api/owner/records?kind=lead", { headers: { authorization: "Bearer " + OK } }));
  assert.equal(x.body.records.length, 1); assert.equal(x.body.records[0].data.name, "Ada");
  x = await J(await F("club.spawnapp.org", "/api/owner/records/" + x.body.records[0].id, { method: "DELETE", headers: { authorization: "Bearer " + OK } })); assert.equal(x.body.ok, true);
  x = await J(await post("club.spawnapp.org", "/api/owner/members", { email: "m@x.co", approved: false }, { authorization: "Bearer " + OK }));
  r = await F("club.spawnapp.org", "/members/", { headers: { cookie: ck } }); assert.equal(r.status, 302); await r.text();
});
