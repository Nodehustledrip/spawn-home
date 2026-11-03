"use strict";
/* Spawn Elite: tier mapping, limits, AI allowance, domain limit, early access, webhook + plan switching.
 * Stripe is a local fake (STRIPE_API_BASE); nothing touches the network. */
delete process.env.GEMINI_API_KEY;
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const express = require("express");

process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_fake";
process.env.STRIPE_PRICE_MONTHLY = "price_pro_m"; process.env.STRIPE_PRICE_YEARLY = "price_pro_y";
process.env.STRIPE_PRICE_ELITE_MONTHLY = "price_elite_m"; process.env.STRIPE_PRICE_ELITE_YEARLY = "price_elite_y";

const auth = require("../auth");
const store = require("../buildstore");
const billing = require("../billing");
const gallery = require("../gallery");
const dom = require("../clouddomains");

/* --- fake users table + fake Stripe --- */
const users = new Map();
let setPlanCalls = [];
auth.enabled = () => true;
auth.setPlan = async (match, f) => {
  setPlanCalls.push([match, f]);
  const u = [...users.values()].find((x) => (match.userId && String(x.id) === String(match.userId)) || (match.customerId && x.stripe_customer_id === match.customerId));
  if (!u) return null;
  Object.assign(u, { plan: f.plan || u.plan, plan_status: f.status, current_period_end: f.periodEnd, stripe_customer_id: f.customerId || u.stripe_customer_id, stripe_subscription_id: f.subscriptionId || u.stripe_subscription_id, plan_price_id: f.priceId });
  return u;
};
let current = null;
auth.currentUser = async () => current;
store.getPool = () => ({ query: async (sql, p) => ({ rows: [...users.values()].filter((u) => u.stripe_customer_id === p[0]) }) });

const subs = new Map(); const calls = [];
let failUpgradePayment = false;
const fake = http.createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
    const f = Object.fromEntries(new URLSearchParams(body)); calls.push([req.method, req.url, f]);
    const send = (o, s = 200) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    let m;
    if (req.method === "POST" && req.url === "/v1/checkout/sessions") return send({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" });
    if ((m = req.url.match(/^\/v1\/subscriptions\/([\w]+)$/))) {
      const s = subs.get(m[1]); if (!s) return send({ error: { message: "no" } }, 404);
      if (req.method === "POST") {
        if (f["payment_behavior"] === "pending_if_incomplete" && (f["metadata[tier]"] || f["cancel_at_period_end"])) return send({ error: { message: "param not allowed with pending_if_incomplete" } }, 400);
        if (f["items[0][price]"]) {
          if (failUpgradePayment && f["payment_behavior"] === "pending_if_incomplete") return send(Object.assign({}, s, { pending_update: { subscription_items: [] } }));
          s.items.data[0].price = { id: f["items[0][price]"], recurring: { interval: /_y$/.test(f["items[0][price]"]) ? "year" : "month" } };
        }
        if (f["metadata[tier]"]) s.metadata = { tier: f["metadata[tier]"] };
      }
      return send(s);
    }
    if (req.url === "/v1/invoices/create_preview") return send({ amount_due: 1300, currency: "usd" });
    send({ error: { message: "unhandled " + req.url } }, 404);
  });
});
const mkSub = (id, cus, price, status = "active") => subs.set(id, { id, customer: cus, status, current_period_end: Math.floor(Date.now() / 1000) + 20 * 86400, items: { data: [{ id: "si_" + id, price: { id: price, recurring: { interval: "month" } } }] }, metadata: {} }).get(id);

let app, srv, base;
before(async () => {
  await new Promise((r) => fake.listen(0, r));
  process.env.STRIPE_API_BASE = "http://127.0.0.1:" + fake.address().port;
  app = express(); billing.mountWebhook(app); app.use(express.json()); billing.mount(app);
  srv = app.listen(0); await new Promise((r) => srv.once("listening", r));
  base = "http://127.0.0.1:" + srv.address().port;
});
after(() => { srv && srv.close(); fake.close(); });
const post = (p, b) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b || {}) }).then(async (r) => Object.assign(await r.json(), { status: r.status }));
const signed = (evt) => { const raw = JSON.stringify(evt); const t = Math.floor(Date.now() / 1000); const sig = crypto.createHmac("sha256", "whsec_fake").update(t + "." + raw).digest("hex"); return fetch(base + "/api/billing/webhook", { method: "POST", headers: { "content-type": "application/json", "stripe-signature": "t=" + t + ",v1=" + sig }, body: raw }); };

test("tier mapping: Elite prices → elite, Pro and unknown → pro", () => {
  assert.equal(billing.tierForPrice("price_elite_m"), "elite");
  assert.equal(billing.tierForPrice("price_elite_y"), "elite");
  assert.equal(billing.tierForPrice("price_pro_m"), "pro");
  assert.equal(billing.tierForPrice("price_legacy"), "pro");
  assert.equal(billing.priceFor("elite", "yearly"), "price_elite_y");
  assert.equal(billing.priceFor("pro", "monthly"), "price_pro_m");
});

test("limits per tier, Elite includes Pro, lapsed plans fall back to free", () => {
  const L = (u) => auth.limitsFor(u);
  assert.deepEqual([L({ plan: "elite", plan_status: "active" }).maxBuilds, L({ plan: "elite", plan_status: "active" }).editsPerDay], [100, 1000]);
  assert.deepEqual([L({ plan: "pro", plan_status: "active" }).maxBuilds, L({ plan: "pro", plan_status: "active" }).editsPerDay], [25, 300]);
  assert.deepEqual([L({ plan: "free" }).maxBuilds, L({ plan: "free" }).editsPerDay], [5, 30]);
  assert.equal(auth.isPro({ plan: "elite", plan_status: "active" }), true);
  assert.equal(auth.isElite({ plan: "pro", plan_status: "active" }), false);
  assert.equal(auth.tierOf({ plan: "elite", plan_status: "canceled" }), "free");
  assert.equal(auth.tierOf({ plan: "elite", plan_status: "active", current_period_end: new Date(Date.now() - 1000) }), "free");
  assert.equal(require("../badge").exempt({ plan: "elite", plan_status: "active" }), true, "no badge on Elite");
});

test("AI allowance: Elite skips the per-IP daily cap and gets its own per-user cap; site-wide cap unchanged", () => {
  const ai = require("../buildai");
  Object.assign(process.env, { AI_RPM_CAP: "1000", AI_IP_DAILY: "2", AI_OWNER_DAILY: "3", AI_ELITE_OWNER_DAILY: "4" });
  ai._resetLimits();
  assert.equal(ai._rateCheck("1.1.1.1", "u:pro"), null); assert.equal(ai._rateCheck("1.1.1.1", "u:pro"), null);
  assert.equal(ai._rateCheck("1.1.1.1", "u:pro"), "ip_daily_cap");
  ai.setOwnerTier("u:el", "elite");
  for (let i = 0; i < 4; i++) assert.equal(ai._rateCheck("2.2.2.2", "u:el"), null, "elite hit " + i);
  assert.equal(ai._rateCheck("2.2.2.2", "u:el"), "owner_daily_cap");
  ai.setOwnerTier("u:el", "pro");
  assert.equal(ai._rateCheck("2.2.2.2", "u:el"), "ip_daily_cap", "downgrade removes the Elite allowance");
  process.env.AI_DAILY_CAP = "0"; ai.setOwnerTier("u:el2", "elite");
  assert.equal(ai._rateCheck("3.3.3.3", "u:el2"), "daily_cap", "Elite still counts toward the site-wide cap");
  for (const k of ["AI_RPM_CAP", "AI_IP_DAILY", "AI_OWNER_DAILY", "AI_ELITE_OWNER_DAILY", "AI_DAILY_CAP"]) delete process.env[k];
  ai._resetLimits();
});

test("custom domain limit: 50 on Elite, 10 otherwise", () => {
  assert.equal(dom.domainLimitFor("elite"), 50);
  assert.equal(dom.domainLimitFor("pro"), 10);
});

test("early access: new premium templates are Elite-only for 30 days, then Pro", () => {
  const now = Date.now();
  const e = { access: "pro", elite_until: new Date(now + 5 * 86400000).toISOString() };
  const pro = { plan: "pro", plan_status: "active" }, el = { plan: "elite", plan_status: "active" };
  assert.equal(gallery.EARLY_DAYS, 30);
  assert.deepEqual(gallery.canRemix(e, el, auth.isPro, auth.isElite, now), { ok: true });
  assert.equal(gallery.canRemix(e, pro, auth.isPro, auth.isElite, now).reason, "elite");
  assert.equal(gallery.canRemix(e, { plan: "free" }, auth.isPro, auth.isElite, now).reason, "pro");
  assert.equal(gallery.canRemix(e, pro, auth.isPro, auth.isElite, now + 6 * 86400000).ok, true, "Pro after the window");
  assert.equal(gallery.canRemix({ access: "pro" }, pro, auth.isPro, auth.isElite, now).ok, true, "no window → Pro as before");
});

test("checkout: tier=elite uses the Elite price; existing subscribers are sent to switch, not a second checkout", async () => {
  users.clear(); users.set(1, { id: 1, email: "a@x.co", plan: "free" }); current = users.get(1);
  let r = await post("/api/billing/checkout", { tier: "elite", interval: "yearly" });
  assert.equal(r.ok, true);
  const c = calls.filter((x) => x[1] === "/v1/checkout/sessions").pop()[2];
  assert.equal(c["line_items[0][price]"], "price_elite_y"); assert.equal(c["metadata[tier]"], "elite"); assert.match(c.success_url, /tier=elite/);
  Object.assign(current, { plan: "pro", plan_status: "active", stripe_subscription_id: "sub_p" });
  r = await post("/api/billing/checkout", { tier: "elite" }); assert.equal(r.status, 409); assert.equal(r.change, "/api/billing/change");
});

test("webhook: Elite subscription → plan elite; old Pro sub ending doesn't downgrade; cancel → free", async () => {
  users.clear(); users.set(7, { id: 7, email: "e@x.co", plan: "pro", plan_status: "active", stripe_customer_id: "cus_7", stripe_subscription_id: "sub_old" });
  mkSub("sub_el", "cus_7", "price_elite_m");
  let r = await signed({ type: "customer.subscription.created", data: { object: { id: "sub_el", customer: "cus_7" } } }); assert.equal(r.status, 200);
  assert.equal(users.get(7).plan, "elite"); assert.equal(users.get(7).plan_price_id, "price_elite_m"); assert.equal(users.get(7).stripe_subscription_id, "sub_el");
  r = await signed({ type: "customer.subscription.deleted", data: { object: { id: "sub_old", customer: "cus_7", status: "canceled", items: { data: [{ price: { id: "price_pro_m" } }] } } } });
  assert.equal(users.get(7).plan, "elite", "stale sub ignored");
  r = await signed({ type: "customer.subscription.deleted", data: { object: { id: "sub_el", customer: "cus_7", status: "canceled", items: { data: [{ price: { id: "price_elite_m" } }] } } } });
  assert.equal(auth.tierOf(users.get(7)), "free");
});

test("switch Pro → Elite swaps the price on the same subscription (prorated), and back down to Pro", async () => {
  users.clear(); users.set(9, { id: 9, email: "p@x.co", plan: "pro", plan_status: "active", stripe_customer_id: "cus_9", stripe_subscription_id: "sub_9" }); current = users.get(9);
  mkSub("sub_9", "cus_9", "price_pro_m"); calls.length = 0;
  let r = await fetch(base + "/api/billing/change/preview?tier=elite").then((x) => x.json()); assert.equal(r.amountDue, 1300);
  r = await post("/api/billing/change", { tier: "elite" });
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.tier, "elite"); assert.equal(users.get(9).plan, "elite");
  const up = calls.find((x) => x[0] === "POST" && x[2]["items[0][price]"]);
  assert.equal(up[2]["items[0][price]"], "price_elite_m"); assert.equal(up[2].proration_behavior, "always_invoice"); assert.equal(up[2].payment_behavior, "pending_if_incomplete");
  assert.equal(calls.filter((x) => x[1] === "/v1/checkout/sessions").length, 0, "no second checkout");
  r = await post("/api/billing/change", { tier: "elite" }); assert.equal(r.status, 409);
  r = await post("/api/billing/change", { tier: "pro" }); assert.equal(r.ok, true); assert.equal(users.get(9).plan, "pro");
  assert.equal(calls.filter((x) => x[2]["items[0][price]"]).pop()[2].proration_behavior, "create_prorations");
  failUpgradePayment = true;
  r = await post("/api/billing/change", { tier: "elite" }); assert.equal(r.status, 402); assert.equal(users.get(9).plan, "pro", "failed proration payment → no upgrade");
  failUpgradePayment = false;
});
