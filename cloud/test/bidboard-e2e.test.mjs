// BidBoard on Spawn Cloud, end to end with the real bundle + imported desktop data (box copy). Skips if the data isn't present.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { createHash, createHmac, randomBytes, createCipheriv } from "node:crypto";
import { createStripeMock } from "./stripe-mock.mjs";
import { putBlob } from "./blob-helper.mjs";
const SK = "sk_test_mock_" + randomBytes(6).toString("hex");
const stripe = createStripeMock({ key: SK, prices: { price_lead_e2e: { amount: 2500 }, price_pro_e2e: { amount: 9900 } } });

const DATA = process.env.BIDBOARD_DATA || "/workspace/app-forge/generated/bidboard/data";
const has = fs.existsSync(path.join(DATA, "jobs.json"));
const KEY = randomBytes(32);
let mf, db, out;
const H = "https://bidboard.spawnapp.org";
const enc = (slug, name, value) => { const iv = randomBytes(12); const c = createCipheriv("aes-256-gcm", KEY, iv); c.setAAD(Buffer.from(slug + ":" + name)); const ct = Buffer.concat([c.update(value), c.final()]); return Buffer.concat([iv, ct, c.getAuthTag()]).toString("base64"); };
async function runSql(file) { for (const s of fs.readFileSync(file, "utf8").split(/;\n/).map((x) => x.replace(/^--.*$/gm, "").trim()).filter(Boolean)) await db.prepare(s).run(); }

before(async () => {
  if (!has) return;
  out = fs.mkdtempSync(path.join(os.tmpdir(), "bbimp-"));
  execFileSync("node", ["scripts/import-desktop-data.js", "--app", "bidboard", "--data", DATA, "--out", out]);
  execFileSync("node", ["scripts/import-desktop-data.js", "--places", path.join(DATA, "us-places.json"), "--out", out]);
  mf = new Miniflare({ modules: true, scriptPath: "dist/index.js", compatibilityDate: "2026-08-01", compatibilityFlags: ["nodejs_compat"], d1Databases: { DB: "bbe2e" }, bindings: { APEX_DOMAIN: "spawnapp.org", SECRETS_KEY: KEY.toString("base64"), STRIPE_API_BASE: "https://stripe.mock" }, outboundService: stripe.fetcher });
  db = await mf.getD1Database("DB"); // no FILES binding: blobs fall back to DB
  for (const f of fs.readdirSync("migrations").sort()) await runSql(path.join("migrations", f));
  await runSql(path.join(out, "places.sql"));
  await runSql(path.join(out, "bidboard.sql"));
  // publish the prepared bundle as v1
  const files = {};
  (function walk(d, rel) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name), r = rel ? rel + "/" + e.name : e.name; if (e.isDirectory()) walk(p, r); else files[r] = fs.readFileSync(p); } })("apps/bidboard", "");
  const manifest = {};
  for (const [r, b] of Object.entries(files)) { manifest[r] = { h: createHash("sha256").update(b).digest("hex"), s: b.length, t: r.endsWith(".html") ? "text/html; charset=utf-8" : r.endsWith(".js") ? "text/javascript" : "application/octet-stream" }; await putBlob(db, "blob/bidboard/" + manifest[r].h, b); }
  await db.prepare("INSERT INTO apps (slug, owner, runtime, live_version, title, config) VALUES ('bidboard','u:1','bidboard',1,'BidBoard',?1)").bind(JSON.stringify({ LEAD_FEE_CENTS: 2500, PRO_FEE_CENTS: 9900, STRIPE_PRICE_LEAD: "price_lead_e2e", STRIPE_PRICE_PRO: "price_pro_e2e" })).run();
  await db.prepare("INSERT INTO versions (slug, version, manifest, file_count, total_bytes) VALUES ('bidboard',1,?1,?2,0)").bind(JSON.stringify({ files: manifest }), Object.keys(files).length).run();
  for (const [n, v] of [["STRIPE_WEBHOOK_SECRET", "whsec_e2e"], ["STRIPE_SECRET_KEY", SK]]) await db.prepare("INSERT INTO app_secrets (slug,name,blob) VALUES ('bidboard',?1,?2)").bind(n, enc("bidboard", n, v)).run();
});
after(async () => mf && (await mf.dispose()));

test("imported BidBoard: pages, data, places, payment flow", { skip: !has && "no desktop data on this machine" }, async () => {
  const jobs = JSON.parse(fs.readFileSync(path.join(DATA, "jobs.json"), "utf8"));
  let r = await mf.dispatchFetch(H + "/"); assert.equal(r.status, 200); assert.match(await r.text(), /BidBoard/);
  r = await mf.dispatchFetch(H + "/jobs"); assert.equal(r.status, 200); await r.text();
  r = await mf.dispatchFetch(H + "/hosted/bidboard/jobs.html", { redirect: "manual" }); assert.equal(r.status, 301);
  r = await mf.dispatchFetch(H + "/admin.html"); assert.equal(r.status, 404); await r.text();
  r = await mf.dispatchFetch(H + "/ai.js"); assert.equal(r.status, 404); await r.text();
  let j = await (await mf.dispatchFetch(H + "/api/jobs")).json(); assert.equal(j.count, jobs.length);
  j = await (await mf.dispatchFetch(H + "/api/places/search?q=austin&state=TX")).json(); assert.ok(j.results.some((p) => p.label === "Austin, TX"));
  j = await (await mf.dispatchFetch(H + "/api/places/search?q=spring")).json(); assert.ok(j.count >= 10);
  // an imported demo unlock token still opens its job
  const unl = JSON.parse(fs.readFileSync(path.join(DATA, "unlocks.json"), "utf8")).find((u) => u.status === "demo_unlocked");
  if (unl) { j = await (await mf.dispatchFetch(`${H}/api/jobs/${unl.jobId}?token=${unl.token}`)).json(); assert.equal(j.locked, false); }
  // new paid unlock → Stripe webhook → /paid redirect → job open
  const job = jobs[0];
  j = await (await mf.dispatchFetch(H + "/api/leads/unlock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId: job.id, contractorEmail: "pro@example.com" }) })).json();
  assert.equal(j.unlock.status, "pending_payment"); assert.ok(j.checkoutUrl.startsWith("https://checkout.stripe.com/c/pay/cs_test_mock"));
  const sid = j.checkoutUrl.split("/").pop(); const done = Object.assign({}, stripe.complete(sid)); delete done._form;
  const evt = JSON.stringify({ id: "evt_e2e", type: "checkout.session.completed", data: { object: done } });
  const t = Math.floor(Date.now() / 1000);
  r = await mf.dispatchFetch(H + "/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": `t=${t},v1=${createHmac("sha256", "whsec_e2e").update(t + "." + evt).digest("hex")}` }, body: evt }); assert.equal(r.status, 200); await r.text();
  r = await mf.dispatchFetch(H + "/paid?session_id=" + sid, { redirect: "manual" }); assert.equal(r.status, 302);
  const loc = new URL(r.headers.get("location"));
  j = await (await mf.dispatchFetch(H + "/api/jobs/" + loc.searchParams.get("id") + "?token=" + loc.searchParams.get("token"))).json(); assert.equal(j.locked, false); assert.equal(j.job.phone, job.phone);
  // job.js in the bundle sends checkout in the same tab and has no builder wording
  const js = await (await mf.dispatchFetch(H + "/job.js")).text(); assert.match(js, /location\.href = payUrl/); assert.doesNotMatch(js, /Spawn Account|Payment Link|MVP/);
  for (const f of ["index.html", "contractors.html", "contractors.js", "job.js", "jobs.html", "login.html"]) {
    const t = await (await mf.dispatchFetch(H + "/" + f)).text();
    assert.doesNotMatch(t, /buy\.stripe\.com|Payment Link|[Mm]ock checkout|[Pp]laceholder subscription|Whop|for MVP|[Cc]oming soon|Record Pro interest/, f);
  }
  const ct = await (await mf.dispatchFetch(H + "/contractors.js")).text(); assert.match(ct, /api\/billing\/portal/); assert.match(ct, /api\/pro\/checkout/);
});
