// Owner-connected Stripe payments for the premium templates, against a local Stripe mock (nothing real is created).
// Webhooks are signed with Stripe's scheme (t=..,v1=HMAC-SHA256(secret, "t.payload")) using a test secret.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { readFileSync } from "node:fs";
import { createHash, createHmac, createCipheriv, randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import { createStripeMock } from "./stripe-mock.mjs";
import { putBlob } from "./blob-helper.mjs";

const SK = "rk_test_mock_" + randomBytes(6).toString("hex");
const stripe = createStripeMock({ key: SK, prices: {} });
const WHSEC = "whsec_paytest_" + randomBytes(4).toString("hex");
const KEY = randomBytes(32);
let mf, db, fdb, n = 0;
const sha = (b) => createHash("sha256").update(b).digest("hex");
function enc(slug, name, value) {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", KEY, iv); c.setAAD(Buffer.from(slug + ":" + name));
  return Buffer.concat([iv, Buffer.concat([c.update(value, "utf8"), c.final()]), c.getAuthTag()]).toString("base64");
}
const F = (host, path, init = {}) => mf.dispatchFetch("https://" + host + path, Object.assign({ redirect: "manual" }, init));
const J = async (res) => ({ status: res.status, body: await res.json() });
const post = (host, path, body, headers = {}) => F(host, path, { method: "POST", headers: Object.assign({ "content-type": "application/json", "cf-connecting-ip": "9.9.9." + (++n % 250) }, headers), body: JSON.stringify(body) });
function sign(body, secret = WHSEC, t = Math.floor(Date.now() / 1000)) { return `t=${t},v1=${createHmac("sha256", secret).update(t + "." + body).digest("hex")}`; }
let ev = 0;
const hook = async (host, type, object, opts = {}) => {
  const body = JSON.stringify({ id: opts.id || "evt_test_" + (++ev), object: "event", type, data: { object } });
  return J(await F(host, "/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": opts.sig || sign(body, opts.secret, opts.t) }, body }));
};
const hookRaw = async (host, body, sig) => J(await F(host, "/api/stripe/webhook", { method: "POST", headers: sig ? { "stripe-signature": sig } : {}, body }));
const OWNER = "owner-key-" + randomBytes(6).toString("hex");

async function publish(slug, files) {
  const manifest = {};
  for (const [p, body] of Object.entries(files)) { const h = sha(body); manifest[p] = { h, s: Buffer.byteLength(body), t: p.endsWith(".html") ? "text/html" : p.endsWith(".json") ? "application/json" : "text/plain" }; await putBlob(fdb, `blob/${slug}/${h}`, body); }
  await db.prepare("INSERT INTO apps (slug, owner, runtime, live_version, title, config) VALUES (?1,'u:1','static',1,?1,'{}')").bind(slug).run();
  await db.prepare("INSERT INTO versions (slug, version, manifest, file_count, total_bytes) VALUES (?1,1,?2,?3,0)").bind(slug, JSON.stringify({ files: manifest }), Object.keys(files).length).run();
}
async function secrets(slug, kv) { for (const [k, v] of Object.entries(kv)) await db.prepare("INSERT INTO app_secrets (slug, name, blob) VALUES (?1,?2,?3)").bind(slug, k, enc(slug, k, v)).run(); }
const connected = { STRIPE_SECRET_KEY: SK, STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_CONNECT_META: JSON.stringify({ last4: SK.slice(-4), mode: "test" }), OWNER_KEY: OWNER };
const pricing = (t) => readFileSync("apps/" + t + "/pricing.json", "utf8");
const sess = (id) => stripe.sessions.get(id);
const idFromUrl = (u) => u.split("/").pop();

before(async () => {
  execSync("npx wrangler deploy --dry-run --outdir dist", { stdio: "ignore" });
  mf = new Miniflare({ modules: true, scriptPath: "dist/index.js", compatibilityDate: "2026-08-01", compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: "pay-db", FILES: "pay-files" }, bindings: { APEX_DOMAIN: "spawnapp.org", ALLOW_HOST_OVERRIDE: "0", SECRETS_KEY: KEY.toString("base64"), STRIPE_API_BASE: "https://stripe.mock" },
    outboundService: stripe.fetcher });
  db = await mf.getD1Database("DB"); fdb = await mf.getD1Database("FILES");
  for (const f of ["0001_init", "0002_bidboard", "0003_blobs", "0005_gallery", "0008_app_payments"]) for (const d of [db, fdb]) {
    const sql = readFileSync("migrations/" + f + ".sql", "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    for (const s of sql.split(";").map((x) => x.trim()).filter(Boolean)) await d.prepare(s).run();
  }
  await publish("glow", { "index.html": "<h1>Glow</h1>", "pricing.json": pricing("glow-booking") });
  await publish("shopx", { "index.html": "<h1>Shop</h1>", "pricing.json": pricing("shop-template") });
  await publish("club", { "index.html": "<h1>Club</h1>", "account.html": "<h1>Account</h1>", "members/index.html": "<h1>Library</h1>", "pricing.json": pricing("members-club") });
  await publish("plain", { "index.html": "<h1>Not connected</h1>", "pricing.json": pricing("glow-booking") });
  await publish("nocat", { "index.html": "<h1>No catalog</h1>" });
  for (const s of ["glow", "shopx", "club", "nocat"]) await secrets(s, connected);
});
after(async () => mf && (await mf.dispose()));

test("not connected: demo/Payment Link mode unchanged, checkout refused, webhooks rejected", async () => {
  let x = await J(await F("plain.spawnapp.org", "/api/pay/config")); assert.deepEqual([x.body.connected, x.body.catalog], [false, true]);
  x = await J(await post("plain.spawnapp.org", "/api/pay/checkout", { kind: "booking", item: "cut", option: "full" })); assert.equal(x.status, 409);
  x = await hookRaw("plain.spawnapp.org", "{}", sign("{}")); assert.equal(x.status, 400);
  x = await J(await F("nocat.spawnapp.org", "/api/pay/config")); assert.deepEqual([x.body.connected, x.body.catalog, x.body.mode], [true, false, "test"]);
  x = await J(await post("nocat.spawnapp.org", "/api/pay/checkout", { kind: "booking", item: "cut" })); assert.equal(x.status, 409);
  const r = await F("plain.spawnapp.org", "/"); assert.match(await r.text(), /Not connected/);
});

test("webhook security: unsigned, bad signature, wrong secret, stale timestamp, bad payload", async () => {
  const body = JSON.stringify({ id: "evt_x1", type: "checkout.session.completed", data: { object: {} } });
  assert.equal((await hookRaw("glow.spawnapp.org", body)).status, 400);
  assert.equal((await hookRaw("glow.spawnapp.org", body, "t=1,v1=deadbeef")).status, 400);
  assert.equal((await hookRaw("glow.spawnapp.org", body, sign(body, "whsec_wrong"))).status, 400);
  assert.equal((await hookRaw("glow.spawnapp.org", body, sign(body, WHSEC, Math.floor(Date.now() / 1000) - 3600))).status, 400);
  assert.equal((await hookRaw("glow.spawnapp.org", body, sign(body).replace(/v1=(.)/, (m, c) => "v1=" + (c === "0" ? "1" : "0")))).status, 400);
  assert.equal((await hookRaw("glow.spawnapp.org", "not json", sign("not json"))).status, 400);
  assert.equal((await hookRaw("glow.spawnapp.org", body, sign(body))).status, 200); // valid but unknown session -> ignored
});

test("booking deposit: server prices from pricing.json, browser amount ignored; unpaid -> async succeeded -> paid; replay is a no-op", async () => {
  let x = await J(await post("glow.spawnapp.org", "/api/pay/checkout", { kind: "booking", item: "cut", option: "deposit", amount: 1, price: 1, ref: "GS-ABC234", email: "ana@example.com", name: "Ana", returnPath: "/", details: { date: "2026-11-10", time: "10:00 am" } }));
  assert.equal(x.status, 200); assert.equal(x.body.amount, 2000); assert.equal(x.body.ref, "GS-ABC234");
  const s = sess(idFromUrl(x.body.url));
  assert.equal(s._form["line_items[0][price_data][unit_amount]"], "2000"); assert.equal(s._form["line_items[0][price_data][product_data][name]"], "Deposit — Cut & finish");
  assert.match(s.success_url, /^https:\/\/glow\.spawnapp\.org\/\?paid=1&ref=GS-ABC234&session_id=\{CHECKOUT_SESSION_ID\}$/);
  assert.equal(s.metadata.spawn_app, "glow"); assert.equal(s.customer_email, "ana@example.com");
  x = await J(await post("glow.spawnapp.org", "/api/pay/checkout", { kind: "booking", item: "cut", option: "full", ref: "GS-ABC999" })); assert.equal(x.body.amount, 6800);
  x = await J(await post("glow.spawnapp.org", "/api/pay/checkout", { kind: "booking", item: "consult", option: "full" })); assert.equal(x.status, 400, "free consult has nothing to pay");
  x = await J(await post("glow.spawnapp.org", "/api/pay/checkout", { kind: "booking", item: "nope" })); assert.equal(x.status, 400);
  // unpaid completion (bank debit pending) must not unlock
  x = await hook("glow.spawnapp.org", "checkout.session.completed", Object.assign({}, s, { status: "complete", payment_status: "unpaid" }));
  assert.equal(x.body.result, "processing");
  let st = await J(await F("glow.spawnapp.org", "/api/pay/status?ref=GS-ABC234&session_id=" + s.id));
  assert.equal(st.body.payment.unlocked, false); assert.equal(st.body.payment.status, "processing");
  x = await hook("glow.spawnapp.org", "checkout.session.async_payment_succeeded", Object.assign({}, s, { status: "complete", payment_status: "paid" }), { id: "evt_async_ok_1" });
  assert.equal(x.body.result, "paid");
  st = await J(await F("glow.spawnapp.org", "/api/pay/status?ref=GS-ABC234&session_id=" + s.id));
  assert.deepEqual([st.body.payment.unlocked, st.body.payment.status, st.body.payment.paid, st.body.payment.option], [true, "paid", 2000, "deposit"]);
  x = await hook("glow.spawnapp.org", "checkout.session.async_payment_succeeded", s, { id: "evt_async_ok_1" }); assert.equal(x.body.duplicate, true);
  // wrong session id for the ref -> 404 (session id acts as the receipt secret)
  x = await J(await F("glow.spawnapp.org", "/api/pay/status?ref=GS-ABC234&session_id=cs_test_other")); assert.equal(x.status, 404);
  // owner page lists it with amount + status, only with the owner key
  x = await J(await F("glow.spawnapp.org", "/api/owner/payments")); assert.equal(x.status, 401);
  x = await J(await F("glow.spawnapp.org", "/api/owner/payments", { headers: { authorization: "Bearer " + OWNER } }));
  const p = x.body.payments.find((q) => q.ref === "GS-ABC234"); assert.deepEqual([p.status, p.paid, p.option, p.details.date], ["paid", 2000, "deposit", "2026-11-10"]);
});

test("async payment failed marks the booking failed; amount tampering in a signed event never unlocks; other apps' sessions ignored", async () => {
  let x = await J(await post("glow.spawnapp.org", "/api/pay/checkout", { kind: "booking", item: "facial", option: "full" }));
  const s = sess(idFromUrl(x.body.url));
  x = await hook("glow.spawnapp.org", "checkout.session.async_payment_failed", Object.assign({}, s, { payment_status: "unpaid" })); assert.equal(x.body.result, "failed");
  x = await J(await post("glow.spawnapp.org", "/api/pay/checkout", { kind: "booking", item: "color", option: "full" }));
  const t = sess(idFromUrl(x.body.url)); assert.equal(t.amount_total, 14500);
  x = await hook("glow.spawnapp.org", "checkout.session.completed", Object.assign({}, t, { status: "complete", payment_status: "paid", amount_total: 100 })); assert.equal(x.body.result, "mismatch");
  x = await hook("glow.spawnapp.org", "checkout.session.completed", Object.assign({}, t, { status: "complete", payment_status: "paid", currency: "eur" })); assert.equal(x.body.result, "mismatch", "wrong currency also stays locked");
  let st = await J(await F("glow.spawnapp.org", "/api/pay/status?ref=" + t.client_reference_id + "&session_id=" + t.id)); assert.equal(st.body.payment.unlocked, false);
  x = await hook("glow.spawnapp.org", "checkout.session.completed", Object.assign({}, t, { metadata: { spawn_app: "shopx", spawn_ref: t.metadata.spawn_ref }, payment_status: "paid" })); assert.equal(x.body.result, "ignored");
});

test("shop order: whole cart priced server-side with variants + shipping; refunds", async () => {
  let x = await J(await post("shopx.spawnapp.org", "/api/pay/checkout", { kind: "cart", ref: "FF-QWE234", email: "b@example.com", items: [{ id: "bowl", variant: "Large · 24 cm", qty: 1, price: 0.01 }, { id: "mug", variant: "Moss", qty: 2 }] }));
  assert.equal(x.status, 200); assert.equal(x.body.amount, 3600 + 5600); // 92 >= 75: free shipping
  const s = sess(idFromUrl(x.body.url)); assert.equal(s._form["shipping_address_collection[allowed_countries][0]"], "US");
  x = await J(await post("shopx.spawnapp.org", "/api/pay/checkout", { kind: "cart", items: [{ id: "mug", variant: "Oat", qty: 1 }] })); assert.equal(x.body.amount, 2800 + 800, "flat shipping under $75");
  const small = sess(idFromUrl(x.body.url));
  for (const bad of [[], [{ id: "mug", variant: "Gold", qty: 1 }], [{ id: "mug", variant: "Oat", qty: 0 }], [{ id: "mug", variant: "Oat", qty: 99 }], [{ id: "ghost", qty: 1 }]])
    assert.equal((await J(await post("shopx.spawnapp.org", "/api/pay/checkout", { kind: "cart", items: bad }))).status, 400);
  x = await hook("shopx.spawnapp.org", "checkout.session.completed", Object.assign({}, s, { status: "complete", payment_status: "paid" })); assert.equal(x.body.result, "paid");
  x = await J(await F("shopx.spawnapp.org", "/api/owner/payments?kind=cart", { headers: { authorization: "Bearer " + OWNER } }));
  let p = x.body.payments.find((q) => q.ref === "FF-QWE234"); assert.equal(p.status, "paid"); assert.deepEqual(p.lines.map((l) => [l.name, l.qty]), [["Low serving bowl — Large · 24 cm", 1], ["Everyday mug — Moss", 2]]);
  x = await hook("shopx.spawnapp.org", "charge.refunded", { id: "ch_1", object: "charge", payment_intent: s.payment_intent, amount: 9200, amount_refunded: 3600 }); assert.equal(x.body.result, "partial");
  x = await hook("shopx.spawnapp.org", "charge.refunded", { id: "ch_1", object: "charge", payment_intent: s.payment_intent, amount: 9200, amount_refunded: 9200 }); assert.equal(x.body.result, "refunded");
  x = await J(await F("shopx.spawnapp.org", "/api/pay/status?ref=FF-QWE234&session_id=" + s.id)); assert.deepEqual([x.body.payment.status, x.body.payment.unlocked], ["refunded", false]);
  // a late webhook: the status page asks Stripe directly and unlocks only because Stripe says paid
  stripe.complete(small.id);
  x = await J(await F("shopx.spawnapp.org", "/api/pay/status?ref=" + small.client_reference_id + "&session_id=" + small.id)); assert.equal(x.body.payment.status, "paid");
});

test("membership: sign-in required, pending until paid, active on payment, revoked on past_due/cancel, refund", async () => {
  let x = await J(await post("club.spawnapp.org", "/api/pay/checkout", { kind: "membership", item: "monthly" })); assert.equal(x.status, 401);
  let r = await post("club.spawnapp.org", "/api/auth/signup", { email: "m@example.com", password: "longpassword1" }); const ck = r.headers.get("set-cookie").split(";")[0]; await r.text();
  const me = async () => (await J(await F("club.spawnapp.org", "/api/members/me", { headers: { cookie: ck } }))).body.member;
  const gate = async () => { const g = await F("club.spawnapp.org", "/members/", { headers: { cookie: ck } }); await g.text(); return g.status; };
  assert.equal(await me(), false); assert.equal(await gate(), 302);
  x = await J(await post("club.spawnapp.org", "/api/pay/checkout", { kind: "membership", item: "monthly", email: "attacker@example.com", returnPath: "/account" }, { cookie: ck }));
  assert.equal(x.body.amount, 900);
  const s = sess(idFromUrl(x.body.url));
  assert.equal(s.mode, "subscription"); assert.equal(s.customer_email, "m@example.com", "email comes from the signed-in account");
  assert.equal(s._form["line_items[0][price_data][recurring][interval]"], "month"); assert.equal(s._form["subscription_data[metadata][spawn_app]"], "club");
  assert.equal((await J(await post("club.spawnapp.org", "/api/pay/checkout", { kind: "membership", item: "lifetime" }, { cookie: ck }))).status, 400);
  assert.equal(await me(), false, "checkout started is still pending");
  const done = Object.assign({}, s, { status: "complete", payment_status: "paid", subscription: "sub_test_1", customer: "cus_test_1" });
  x = await hook("club.spawnapp.org", "checkout.session.completed", done); assert.equal(x.body.result, "paid");
  assert.equal(await me(), true); assert.equal(await gate(), 200);
  x = await hook("club.spawnapp.org", "invoice.paid", { object: "invoice", amount_paid: 900, parent: { subscription_details: { subscription: "sub_test_1" } }, lines: { data: [{ period: { end: 1900000000 } }] } }); assert.equal(x.body.result, "active");
  x = await hook("club.spawnapp.org", "customer.subscription.updated", { id: "sub_test_1", object: "subscription", status: "past_due" }); assert.equal(x.body.result, "past_due");
  assert.equal(await me(), false); assert.equal(await gate(), 302);
  x = await hook("club.spawnapp.org", "customer.subscription.updated", { id: "sub_test_1", object: "subscription", status: "active" }); assert.equal(await me(), true);
  x = await hook("club.spawnapp.org", "customer.subscription.updated", { id: "sub_test_1", object: "subscription", status: "unpaid" }); assert.equal(await me(), false);
  x = await hook("club.spawnapp.org", "invoice.paid", { object: "invoice", amount_paid: 900, subscription: "sub_test_1", lines: { data: [] } }); assert.equal(await me(), true, "older API shape (invoice.subscription) also works");
  x = await hook("club.spawnapp.org", "customer.subscription.deleted", { id: "sub_test_1", object: "subscription", status: "canceled" }); assert.equal(x.body.result, "canceled");
  assert.equal(await me(), false);
  x = await hook("club.spawnapp.org", "invoice.paid", { object: "invoice", amount_paid: 900, subscription: "sub_test_1" }); assert.equal(await me(), false, "a cancelled membership doesn't come back from a stray invoice");
  x = await J(await F("club.spawnapp.org", "/api/owner/members", { headers: { authorization: "Bearer " + OWNER } }));
  const m = x.body.members.find((q) => q.email === "m@example.com"); assert.deepEqual([m.approved, m.payment.status], [false, "canceled"]);
});
