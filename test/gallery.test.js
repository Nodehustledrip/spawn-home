"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");

let dir, server, base, cp, gallery, buildsDir;
const users = { free: { id: 21, email: "f@x.co", plan: "free" }, pro: { id: 22, email: "p@x.co", plan: "pro", plan_status: "active" }, other: { id: 23, email: "o@x.co", plan: "free" } };
const byId = Object.fromEntries(Object.values(users).map((u) => [String(u.id), u]));
const owners = {};
function makeBuild(id, owner, files) {
  const root = path.join(buildsDir, id);
  for (const [p, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, "public", p)), { recursive: true }); fs.writeFileSync(path.join(root, "public", p), c); }
  fs.writeFileSync(path.join(root, "server.js"), "// secret server");
  owners[id] = owner;
}
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "spawngal-"));
  buildsDir = path.join(dir, "builds");
  Object.assign(process.env, { CLOUD_PUBLISH_ENABLED: "1", CLOUD_PUBLISH_LOCAL_DIR: path.join(dir, "cloud"), CLOUD_SECRETS_KEY: crypto.randomBytes(32).toString("base64") });
  cp = require("../cloudpublish");
  gallery = require("../gallery");
  const fakeBuilds = {
    projectRoot: (id) => (/^[a-z0-9]{8,32}$/.test(id) ? path.join(buildsDir, id) : null),
    store: { init: async () => true, hydrate: async (id, root) => (fs.existsSync(root) ? "disk" : null), ownerOf: async (id) => owners[id] || null },
  };
  const fakeAuth = { currentUser: async (req) => users[req.headers["x-test-user"]] || null, userById: async (id) => byId[String(id)] || null, isPro: (u) => !!u && u.plan === "pro" };
  const app = express();
  cp.mount(app, { auth: fakeAuth, builds: fakeBuilds, tokenStore: cp.memoryTokenStore(), noPresetSync: true });
  gallery.mount(app, { cloud: cp, isAdmin: (req) => req.headers["x-admin"] === "yes" });
  await new Promise((r) => { server = app.listen(0, "127.0.0.1", r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server && server.close(); });
const call = async (method, p, user, body, extra) => {
  const r = await fetch(base + p, { method, headers: Object.assign({ "content-type": "application/json" }, user ? { "x-test-user": user } : {}, extra || {}), body: body ? JSON.stringify(body) : undefined });
  const t = r.headers.get("content-type") || "";
  return { status: r.status, body: t.includes("json") ? await r.json() : await r.text(), type: t };
};

test("content checks + category guess", () => {
  assert.equal(gallery.checkTitle("Cedar Lawn Care"), null);
  assert.ok(gallery.checkTitle("visit www.spam.biz"));
  assert.ok(gallery.checkTitle("x"));
  assert.ok(gallery.checkTitle("free porn"));
  assert.equal(gallery.guessCategory("Cedar Lawn Care mowing"), "local");
  assert.equal(gallery.guessCategory("Paid jobs near you — hire"), "marketplace");
  assert.match(gallery.stripForRemix('<p>a</p><a href="x" data-spawn-badge>Made</a></body>'), /^<p>a<\/p><\/body>$/);
});

test("free web publish lists by default; Pro doesn't; opt-out honored; page, api, thumb, og", async () => {
  makeBuild("bbbbbbbb01", "u:21", { "index.html": '<html><head><meta name="description" content="Mowing and fall cleanup in Cedar Rapids."><style>:root{--accent:#22aa66}</style></head><body><h1>Cedar</h1></body></html>', "styles.css": "body{}", "img/logo.svg": "<svg/>" });
  makeBuild("bbbbbbbb02", "u:22", { "index.html": "<html><body>Pro</body></html>" });
  makeBuild("bbbbbbbb03", "u:21", { "index.html": "<html><body>Private</body></html>" });
  let x = await call("POST", "/api/cloud/web/publish", "free", { buildId: "bbbbbbbb01", slug: "cedar-lawn", title: "Cedar Lawn Care" });
  assert.equal(x.status, 200, JSON.stringify(x.body));
  assert.equal(x.body.gallery.listed, true); assert.equal(x.body.gallery.remixable, true); assert.equal(x.body.gallery.category, "local");
  x = await call("POST", "/api/cloud/web/publish", "pro", { buildId: "bbbbbbbb02", slug: "pro-thing", title: "Pro Thing" });
  assert.equal(x.body.gallery.listed, false);
  x = await call("POST", "/api/cloud/web/publish", "free", { buildId: "bbbbbbbb03", slug: "private-one", title: "Private One", gallery: false });
  assert.equal(x.body.gallery.listed, false);

  x = await call("GET", "/api/gallery");
  assert.deepEqual(x.body.entries.map((e) => e.slug), ["cedar-lawn"]);
  assert.equal(x.body.entries[0].description, "Mowing and fall cleanup in Cedar Rapids.");
  assert.equal(x.body.entries[0].accent, "#22aa66");
  x = await call("GET", "/gallery");
  assert.equal(x.status, 200); assert.match(x.body, /Cedar Lawn Care/); assert.match(x.body, /\/build\?remix=cedar-lawn/); assert.match(x.body, /og:image" content="https:\/\/spawnapp.org\/og\/gallery.png/);
  assert.doesNotMatch(x.body, /Private One|Pro Thing|GL_CARDS/);
  let r = await fetch(base + "/gallery/thumb/cedar-lawn.png"); assert.equal(r.status, 200); assert.equal(r.headers.get("content-type"), "image/png");
  r = await fetch(base + "/gallery/thumb/private-one.png"); assert.equal(r.status, 404);
  r = await fetch(base + "/og/app/private-one.png"); assert.equal(r.status, 200); // share card for any published app
});

test("owner toggle, title checks, admin hide/unhide, report, remix source", async () => {
  let x = await call("PUT", "/api/cloud/apps/cedar-lawn/gallery", "other", { listed: false });
  assert.ok([403, 409].includes(x.status));
  x = await call("PUT", "/api/cloud/apps/cedar-lawn/gallery", "free", { title: "buy at www.x.biz" });
  assert.equal(x.status, 400);
  x = await call("PUT", "/api/cloud/apps/private-one/gallery", "free", { listed: true, category: "tool" });
  assert.equal(x.body.gallery.listed, true);
  x = await call("GET", "/api/cloud/apps/private-one/gallery", "free"); assert.equal(x.body.gallery.category, "tool");
  x = await call("POST", "/api/admin/gallery/private-one", null, { hidden: true }); assert.equal(x.status, 401);
  x = await call("POST", "/api/admin/gallery/private-one", null, { hidden: true }, { "x-admin": "yes" }); assert.equal(x.body.entry.hidden, 1);
  x = await call("GET", "/api/gallery"); assert.deepEqual(x.body.entries.map((e) => e.slug), ["cedar-lawn"]);
  assert.equal(x.body.entries[0].starter, false);
  await call("PUT", "/api/cloud/apps/cedar-lawn/gallery", "free", { starter: true }); // owners can't self-label
  x = await call("GET", "/api/gallery"); assert.equal(x.body.entries[0].starter, false);
  x = await call("POST", "/api/admin/gallery/cedar-lawn", null, { starter: true }, { "x-admin": "yes" }); assert.equal(x.body.entry.starter, 1);
  x = await call("GET", "/api/gallery"); assert.equal(x.body.entries[0].starter, true);
  assert.match(await (await fetch(base + "/gallery")).text(), /Spawn starter/);
  x = await call("POST", "/api/gallery/cedar-lawn/report", null, { reason: "spam" }); assert.equal(x.body.ok, true);
  x = await call("POST", "/api/gallery/cedar-lawn/report", null, { reason: "nope" }); assert.equal(x.status, 400);
  x = await call("GET", "/api/admin/gallery/reports", null, null, { "x-admin": "yes" }); assert.equal(x.body.reports.length, 1);

  const src = await gallery.store.remixSource("cedar-lawn");
  assert.deepEqual(Object.keys(src.files).sort(), ["img/logo.svg", "index.html", "styles.css"]);
  assert.match(src.files["index.html"].toString(), /data-spawn-badge/); // badge stripped at copy time by stripForRemix
  assert.doesNotMatch(gallery.stripForRemix(src.files["index.html"].toString()), /data-spawn-badge/);
  await call("PUT", "/api/cloud/apps/cedar-lawn/gallery", "free", { remixable: false });
  await assert.rejects(gallery.store.remixSource("cedar-lawn"), /hasn't allowed remixes/);
  await assert.rejects(gallery.store.remixSource("private-one"), /isn't in the gallery/);

  x = await call("DELETE", "/api/admin/cloud-apps/private-one", null, null, { "x-admin": "yes" }); assert.equal(x.body.ok, true);
  x = await call("GET", "/api/cloud/my-apps", "free"); assert.deepEqual(x.body.apps.map((a) => a.slug), ["cedar-lawn"]);
});

test("premium templates: admin-only flag, Pro access rule, shelf on /gallery", async () => {
  await call("PUT", "/api/cloud/apps/cedar-lawn/gallery", "free", { remixable: true, premium: true }); // owners can't self-mark premium
  let x = await call("GET", "/api/gallery"); assert.equal(x.body.entries[0].premium, false);
  x = await call("POST", "/api/admin/gallery/cedar-lawn", null, { premium: true }, { "x-admin": "yes" });
  assert.equal(x.body.entry.premium, 1); assert.equal(x.body.entry.access, "pro"); assert.equal(x.body.entry.price_cents, null);
  x = await call("GET", "/api/gallery"); assert.equal(x.body.entries[0].premium, true); assert.equal(x.body.entries[0].access, "pro");
  const src = await gallery.store.remixSource("cedar-lawn");
  assert.equal(src.premium, true); assert.equal(src.access, "pro");
  assert.deepEqual(gallery.canRemix(src, null, (u) => u.plan === "pro"), { ok: false, reason: "signin" });
  assert.deepEqual(gallery.canRemix(src, users.free, (u) => u.plan === "pro"), { ok: false, reason: "pro" });
  assert.deepEqual(gallery.canRemix(src, users.pro, (u) => u.plan === "pro"), { ok: true });
  assert.deepEqual(gallery.canRemix({ access: "open" }, null, () => false), { ok: true });
  const html = await (await fetch(base + "/gallery")).text();
  assert.match(html, /Included with Pro/); assert.match(html, /data-gl-premium="cedar-lawn"/); assert.match(html, /pricing\?ref=premium-template/);
  assert.doesNotMatch(html, /<!--GL_PREMIUM/);
  x = await call("POST", "/api/admin/gallery/cedar-lawn", null, { premium: false, access: "open" }, { "x-admin": "yes" });
  assert.equal(x.body.entry.premium, 0); assert.equal(x.body.entry.access, "open");
});
