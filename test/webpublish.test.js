"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");

let dir, server, base, cp, buildsDir;
const users = {
  free: { id: 11, email: "free@x.co", plan: "free" },
  pro: { id: 12, email: "pro@x.co", plan: "pro", plan_status: "active" },
  other: { id: 13, email: "other@x.co", plan: "free" },
};
const byId = Object.fromEntries(Object.values(users).map((u) => [String(u.id), u]));

function makeBuild(id, owner, html) {
  const root = path.join(buildsDir, id);
  fs.mkdirSync(path.join(root, "public"), { recursive: true });
  fs.writeFileSync(path.join(root, "public", "index.html"), html);
  fs.writeFileSync(path.join(root, "public", "styles.css"), "body{color:red}");
  fs.writeFileSync(path.join(root, "server.js"), "// not published");
  owners[id] = owner;
}
const owners = {};

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "spawnweb-"));
  buildsDir = path.join(dir, "builds");
  Object.assign(process.env, { CLOUD_PUBLISH_ENABLED: "1", CLOUD_PUBLISH_LOCAL_DIR: path.join(dir, "cloud"), CLOUD_SECRETS_KEY: crypto.randomBytes(32).toString("base64") });
  cp = require("../cloudpublish");
  const fakeBuilds = {
    projectRoot: (id) => (/^[a-z0-9]{8,32}$/.test(id) ? path.join(buildsDir, id) : null),
    store: { init: async () => true, hydrate: async (id, root) => (fs.existsSync(root) ? "disk" : null), ownerOf: async (id) => owners[id] || null },
  };
  const fakeAuth = {
    currentUser: async (req) => users[req.headers["x-test-user"]] || null,
    userById: async (id) => byId[String(id)] || null,
    isPro: (u) => !!u && u.plan === "pro",
  };
  const app = express();
  cp.mount(app, { auth: fakeAuth, builds: fakeBuilds, tokenStore: cp.memoryTokenStore(), noPresetSync: true });
  await new Promise((r) => { server = app.listen(0, "127.0.0.1", r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server && server.close(); });

const post = async (p, user, body) => {
  const r = await fetch(base + p, { method: "POST", headers: Object.assign({ "content-type": "application/json" }, user ? { "x-test-user": user } : {}), body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

test("web publish: sign-in required, owner-only, free gets badge, Pro doesn't, names are owned", async () => {
  makeBuild("aaaaaaaa01", "u:11", "<html><body><h1>Free app</h1></body></html>");
  makeBuild("aaaaaaaa02", "u:12", "<html><body><h1>Pro app</h1></body></html>");

  let x = await post("/api/cloud/web/publish", null, { buildId: "aaaaaaaa01", slug: "free-app" });
  assert.equal(x.status, 401);
  x = await post("/api/cloud/web/publish", "other", { buildId: "aaaaaaaa01", slug: "free-app" });
  assert.equal(x.status, 403);

  x = await post("/api/cloud/web/publish", "free", { buildId: "aaaaaaaa01", slug: "free-app" });
  assert.equal(x.status, 200, JSON.stringify(x.body));
  assert.equal(x.body.badge, true);
  assert.equal(x.body.url, "https://free-app.spawnapp.org/");
  assert.equal(x.body.files, 2, "only public/ files");

  x = await post("/api/cloud/web/publish", "pro", { buildId: "aaaaaaaa02", slug: "pro-app" });
  assert.equal(x.status, 200); assert.equal(x.body.badge, false);

  x = await post("/api/cloud/web/publish", "pro", { buildId: "aaaaaaaa02", slug: "free-app" });
  assert.equal(x.status, 409, "name belongs to another account");

  x = await post("/api/cloud/web/publish", "free", { buildId: "aaaaaaaa01", slug: "free-app" });
  assert.equal(x.body.version, 2, "republish bumps version");

  // the stored index.html for the free app carries the badge; the Pro one does not
  const db = new (require("node:sqlite").DatabaseSync)(path.join(dir, "cloud", "d1.sqlite"));
  const html = (slug) => {
    const v = db.prepare("SELECT manifest FROM versions WHERE slug=? ORDER BY version DESC LIMIT 1").get(slug);
    const h = JSON.parse(v.manifest).files["index.html"].h;
    const rows = db.prepare("SELECT data FROM blob_chunks WHERE key=? ORDER BY idx").all(`blob/${slug}/${h}`);
    return Buffer.concat(rows.map((r) => Buffer.from(r.data, "base64"))).toString("utf8");
  };
  assert.match(html("free-app"), /Made with Spawn/);
  assert.doesNotMatch(html("pro-app"), /Made with Spawn/);

  const r = await fetch(base + "/api/cloud/web/name/free-app", { headers: { "x-test-user": "free" } });
  assert.deepEqual(Object.assign({}, await r.json(), { url: undefined }), { ok: true, available: true, yours: true, url: undefined });
});
