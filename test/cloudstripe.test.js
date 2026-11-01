"use strict";
// Connect Stripe routes against an in-memory Stripe mock. No real Stripe call is ever made.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const express = require("express");

let dir, server, base, cp, buildsDir;
const users = { owner: { id: 31, email: "own@x.co", plan: "free" }, other: { id: 32, email: "oth@x.co", plan: "free" } };
const owners = {};
const KEY = "rk_test_" + crypto.randomBytes(12).toString("hex");
const calls = []; const hooks = new Map(); let wn = 0;
async function stripeFetch(url, init) {
  const u = new URL(url); const auth = init.headers.Authorization;
  calls.push({ method: init.method, path: u.pathname, auth });
  assert.equal(u.origin, "https://api.stripe.com");
  const J = (b, s = 200) => ({ ok: s < 300, status: s, json: async () => b });
  if (auth === "Bearer rk_test_nopermissionsxxxxxxxx") return J({ error: { type: "permission_error" } }, 403);
  if (auth !== "Bearer " + KEY) return J({ error: { type: "authentication_error" } }, 401);
  if (init.method === "GET" && u.pathname === "/v1/checkout/sessions") return J({ object: "list", data: [] });
  if (init.method === "POST" && u.pathname === "/v1/webhook_endpoints") {
    const f = Object.fromEntries(new URLSearchParams(init.body)); const id = "we_mock" + (++wn);
    hooks.set(id, f); return J({ id, object: "webhook_endpoint", url: f.url, secret: "whsec_mock" + crypto.randomBytes(8).toString("hex") });
  }
  const m = /^\/v1\/webhook_endpoints\/(we_\w+)$/.exec(u.pathname);
  if (init.method === "DELETE" && m) { const had = hooks.delete(m[1]); return had ? J({ id: m[1], deleted: true }) : J({ error: {} }, 404); }
  return J({ error: {} }, 404);
}
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "spawnstripe-")); buildsDir = path.join(dir, "builds");
  Object.assign(process.env, { CLOUD_PUBLISH_ENABLED: "1", CLOUD_PUBLISH_LOCAL_DIR: path.join(dir, "cloud"), CLOUD_SECRETS_KEY: crypto.randomBytes(32).toString("base64") });
  cp = require("../cloudpublish");
  const fakeBuilds = { projectRoot: (id) => path.join(buildsDir, id), store: { init: async () => true, hydrate: async (id, root) => (fs.existsSync(root) ? "disk" : null), ownerOf: async (id) => owners[id] || null } };
  const fakeAuth = { currentUser: async (req) => users[req.headers["x-test-user"]] || null, userById: async () => null, isPro: () => false };
  const app = express();
  cp.mount(app, { auth: fakeAuth, builds: fakeBuilds, tokenStore: cp.memoryTokenStore(), noPresetSync: true, stripeFetch });
  await new Promise((r) => { server = app.listen(0, "127.0.0.1", r); });
  base = `http://127.0.0.1:${server.address().port}`;
  const root = path.join(buildsDir, "cccccccc01"); fs.mkdirSync(path.join(root, "public"), { recursive: true });
  fs.writeFileSync(path.join(root, "public", "index.html"), "<html><body><h1>Studio</h1></body></html>"); owners.cccccccc01 = "u:31";
});
after(() => { server && server.close(); });
const call = async (method, p, user, body, type = "application/json") => {
  const r = await fetch(base + p, { method, headers: Object.assign({ "content-type": type }, user ? { "x-test-user": user } : {}), body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined });
  const t = r.headers.get("content-type") || ""; const text = await r.text();
  return { status: r.status, body: t.includes("json") ? JSON.parse(text) : text, raw: text };
};

test("connect Stripe: owner-only, verifies key, creates webhook, stores encrypted, never returns the key; disconnect removes the webhook", async () => {
  let x = await call("POST", "/api/cloud/web/publish", "owner", { buildId: "cccccccc01", slug: "studio-pay", title: "Studio Pay" }); assert.equal(x.status, 200, x.raw);
  x = await call("GET", "/api/cloud/apps/studio-pay/stripe"); assert.equal(x.status, 401);
  x = await call("POST", "/api/cloud/apps/studio-pay/stripe", null, { key: KEY }); assert.equal(x.status, 401);
  x = await call("POST", "/api/cloud/apps/studio-pay/stripe", "other", { key: KEY }); assert.ok([403, 404, 409].includes(x.status), String(x.status));
  x = await call("GET", "/api/cloud/apps/studio-pay/stripe", "owner"); assert.equal(x.body.stripe.connected, false); assert.ok(x.body.permissions.length >= 3);
  assert.equal(calls.length, 0);
  for (const bad of ["pk_test_abcdefghijklmnopqrst", "sk_test_short", "", "whsec_abc"]) assert.equal((await call("POST", "/api/cloud/apps/studio-pay/stripe", "owner", { key: bad })).status, 400);
  x = await call("POST", "/api/cloud/apps/studio-pay/stripe", "owner", { key: "rk_test_wrongwrongwrongwrong" }); assert.equal(x.status, 400); assert.match(x.body.error, /didn't accept/);
  x = await call("POST", "/api/cloud/apps/studio-pay/stripe", "owner", { key: "rk_test_nopermissionsxxxxxxxx" }); assert.equal(x.status, 400); assert.match(x.body.error, /Checkout Sessions: Write/);
  x = await call("POST", "/api/cloud/apps/studio-pay/stripe", "owner", "key=" + KEY, "application/x-www-form-urlencoded"); assert.equal(x.status, 415);
  x = await call("POST", "/api/cloud/apps/studio-pay/stripe", "owner", { key: KEY }); assert.equal(x.status, 200, x.raw);
  assert.deepEqual([x.body.stripe.connected, x.body.stripe.mode, x.body.stripe.last4, x.body.stripe.keyType], [true, "test", KEY.slice(-4), "restricted"]);
  assert.ok(!x.raw.includes(KEY) && !/whsec_/.test(x.raw), "no key or signing secret in the response");
  const wh = [...hooks.values()][0]; assert.equal(wh.url, "https://studio-pay.spawnapp.org/api/stripe/webhook");
  const evs = Object.entries(wh).filter(([k]) => k.startsWith("enabled_events")).map(([, v]) => v).sort();
  assert.deepEqual(evs, ["charge.refunded", "checkout.session.async_payment_failed", "checkout.session.async_payment_succeeded", "checkout.session.completed", "customer.subscription.deleted", "customer.subscription.updated", "invoice.paid"]);
  x = await call("GET", "/api/cloud/apps/studio-pay/stripe", "owner"); assert.equal(x.body.stripe.connected, true); assert.ok(!x.raw.includes(KEY));
  // stored encrypted: the raw table holds no plaintext
  const be = cp.localBackend(path.join(dir, "cloud"));
  const rows = await be.query("SELECT name, blob FROM app_secrets WHERE slug=?1", ["studio-pay"]);
  assert.deepEqual(rows.map((r) => r.name).sort(), ["STRIPE_CONNECT_META", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]);
  for (const r of rows) assert.ok(!String(r.blob).includes("rk_test") && !String(r.blob).includes("whsec"));
  // reconnect replaces the old webhook
  x = await call("POST", "/api/cloud/apps/studio-pay/stripe", "owner", { key: KEY }); assert.equal(x.status, 200); assert.equal(hooks.size, 1);
  x = await call("DELETE", "/api/cloud/apps/studio-pay/stripe", "other"); assert.ok([403, 404, 409].includes(x.status));
  x = await call("DELETE", "/api/cloud/apps/studio-pay/stripe", "owner"); assert.equal(x.body.webhookRemoved, true); assert.equal(hooks.size, 0);
  assert.equal((await be.query("SELECT name FROM app_secrets WHERE slug=?1", ["studio-pay"])).length, 0);
  assert.ok(calls.every((c) => c.path.startsWith("/v1/")));
});

test("/cloud/payments page renders and its script parses", async () => {
  const x = await call("GET", "/cloud/payments", "owner"); assert.equal(x.status, 200); assert.match(x.raw, /Connect Stripe/); assert.match(x.raw, /restricted key/);
  for (const m of x.raw.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(m[1]);
});
