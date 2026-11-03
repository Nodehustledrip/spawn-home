"use strict";
/* Never call a real model from tests. */
delete process.env.GEMINI_API_KEY;
/* End-to-end: accounts + builds + cloud tokens on the D1 backend, against a
 * fake Cloudflare D1 REST API backed by node:sqlite. */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spawnd1-"));
const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys=ON");
let mail = [];
let d1Calls = 0;
const realFetch = global.fetch;

function runOne(sql, params) {
  const st = db.prepare(sql);
  const p = (params || []).map((v) => (v === null ? null : v));
  if (st.columns().length) return st.all(...p);
  const r = st.run(...p);
  return Object.assign([], { changes: r.changes });
}

global.fetch = async function (url, init) {
  url = String(url);
  if (url.startsWith("https://api.cloudflare.com/") && url.endsWith("/query")) {
    d1Calls++;
    const body = JSON.parse(init.body);
    const stmts = body.batch || [{ sql: body.sql, params: body.params }];
    try {
      db.exec("BEGIN");
      const result = stmts.map((s) => {
        const rows = runOne(s.sql, s.params);
        return { results: [...rows], success: true, meta: { changes: rows.changes || 0 } };
      });
      db.exec("COMMIT");
      return new Response(JSON.stringify({ success: true, result }), { status: 200 });
    } catch (e) {
      db.exec("ROLLBACK");
      return new Response(JSON.stringify({ success: false, errors: [{ message: e.message }] }), { status: 400 });
    }
  }
  if (url.startsWith("https://resend.test/")) {
    mail.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: "x" }), { status: 200 });
  }
  return realFetch(url, init);
};

Object.assign(process.env, {
  STORAGE_BACKEND: "d1",
  CF_ACCOUNT_ID: "acct",
  CF_API_TOKEN: "tok",
  CF_D1_APP_DATABASE_ID: "db",
  RESEND_API_KEY: "re_test",
  RESEND_API_BASE: "https://resend.test",
  BUILDS_DIR: path.join(dir, "builds"),
  DATA_DIR: dir,
});
delete process.env.DATABASE_URL;

const express = require("express");
const builds = require("../builds");
const auth = require("../auth");
let server, base;

before(async () => {
  const app = express();
  app.use(express.json());
  builds.mount(app);
  await builds.store.init();
  await new Promise((r) => { server = app.listen(0, "127.0.0.1", r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server && server.close(); global.fetch = realFetch; });

async function call(method, p, { cookie, body } = {}) {
  const r = await realFetch(base + p, {
    method, redirect: "manual",
    headers: Object.assign({ "content-type": "application/json" }, cookie ? { cookie } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (_) {}
  return { status: r.status, json, headers: r.headers };
}

test("d1 backend: sign-in, session cache, plan change, builds, tokens, sign-out", async () => {
  assert.equal(builds.store.mode(), "d1");
  assert.equal(auth.enabled(), true);
  let r = await call("GET", "/api/auth/config");
  assert.equal(r.json.enabled, true);

  r = await call("POST", "/api/auth/request", { body: { email: "Person@Example.com" } });
  assert.equal(r.status, 200);
  await new Promise((res) => setTimeout(res, 50));
  const link = JSON.stringify(mail.at(-1)).match(/auth\/verify\?token=([A-Za-z0-9_-]+)/)[1];

  r = await call("GET", "/auth/verify?token=" + link);
  assert.equal(r.status, 302);
  assert.match(r.headers.get("location"), /signed_in=1/);
  const cookie = r.headers.get("set-cookie").split(";")[0];
  r = await call("GET", "/auth/verify?token=" + link);
  assert.match(r.headers.get("location"), /expired/, "magic links are single use");

  r = await call("GET", "/api/me", { cookie });
  assert.equal(r.json.signedIn, true);
  assert.equal(r.json.plan, "free");

  const before = d1Calls;
  await call("GET", "/api/me", { cookie });
  assert.equal(d1Calls, before, "second session lookup is served from cache");

  const uid = db.prepare("SELECT id FROM users").get().id;
  await auth.setPlan({ userId: String(uid) }, { plan: "pro", status: "active", periodEnd: Date.now() + 86400000, customerId: "cus_test", subscriptionId: "sub_test" });
  r = await call("GET", "/api/me", { cookie });
  assert.equal(r.json.plan, "pro", "plan change invalidates the session cache");
  assert.equal(r.json.hasBilling, true);
  assert.equal((await auth.userById(uid)).stripe_subscription_id, "sub_test");

  r = await call("POST", "/api/builds", { cookie, body: { name: "D1 Build", template: "local-service" } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.saved, "d1", "account builds report the durable store");
  assert.equal(r.json.temporary, false);
  const id = r.json.build.id;
  r = await call("GET", "/api/builds", { cookie });
  assert.ok(r.json.builds.some((b) => b.id === id));
  assert.ok(db.prepare("SELECT count(*) n FROM build_chunks WHERE id=?").get(id).n >= 1);

  // drop the disk cache and hydrate back from D1
  fs.rmSync(path.join(process.env.BUILDS_DIR, id), { recursive: true, force: true });
  r = await realFetch(base + "/preview/" + id + "/", { headers: { cookie } });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /<html/i);
  assert.equal(r.headers.get("x-build-source"), "d1");

  // publish tokens + device codes
  const ts = require("../cloudpublish").pgTokenStore(() => builds.store.getPool());
  const tid = await ts.create(uid, "laptop", "hash1", "x@y.z");
  assert.equal((await ts.byHash("hash1")).id, tid);
  assert.equal((await ts.list(uid)).length, 1);
  await ts.deviceCreate("dev1", "ABCD-EFGH", "cli");
  assert.equal(await ts.deviceTake("dev1"), "pending");
  assert.equal(await ts.deviceApprove("ABCD-EFGH", uid, "x@y.z"), true);
  assert.equal((await ts.deviceTake("dev1")).user_id, String(uid));
  assert.equal(await ts.deviceTake("dev1"), null);
  assert.equal(await ts.revoke(uid, tid), true);
  assert.equal(await ts.byHash("hash1"), null);

  r = await call("DELETE", "/api/builds/" + id, { cookie });
  assert.equal(r.json.ok, true);
  assert.equal(db.prepare("SELECT count(*) n FROM build_chunks WHERE id=?").get(id).n, 0);

  r = await call("POST", "/api/auth/logout", { cookie });
  r = await call("GET", "/api/me", { cookie });
  assert.equal(r.json.signedIn, false, "sign-out applies immediately");
});

test("anonymous builds honestly report temporary storage; missing preview explains why", async () => {
  let r = await call("POST", "/api/builds", { body: { name: "Anon Build", template: "local-service" } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.saved, "temporary");
  assert.equal(r.json.temporary, true);
  assert.equal(db.prepare("SELECT count(*) n FROM build_chunks WHERE id=?").get(r.json.build.id).n, 0, "anonymous builds are not written to D1");
  const p = await realFetch(base + "/preview/b-doesnotexist123/");
  assert.equal(p.status, 404);
  const html = await p.text();
  assert.match(html, /temporary/);
  assert.match(html, /Start a new build/);
  assert.match(html, /Sign in free/);
});
