"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto");
const cd = require("../clouddomains");

test("normalize + zone", () => {
  assert.equal(cd.normalizeHost("https://Shop.Example.com/x"), "shop.example.com");
  assert.equal(cd.normalizeHost("1.2.3.4"), null);
  assert.equal(cd.normalizeHost("bad_host.com"), null);
  assert.equal(cd.zoneOf("a.b.example.co.uk"), "example.co.uk");
  assert.equal(cd.zoneOf("www.example.com"), "example.com");
});

function fakeCf() {
  const zones = new Map(); const calls = [];
  let n = 0; const id = () => "id" + ++n;
  const cf = async (m, p, b) => {
    calls.push(m + " " + p);
    let x;
    if (m === "GET" && p.startsWith("/zones?name=")) return [...zones.values()].filter((z) => p.includes("name=" + z.name + "&"));
    if (m === "POST" && p === "/zones") { const z = { id: id(), name: b.name, status: "pending", name_servers: ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"], recs: [{ id: id(), type: "A", name: b.name, content: "1.1.1.1" }], routes: [] }; zones.set(z.id, z); return z; }
    if ((x = /^\/zones\/(\w+)$/.exec(p))) { const z = zones.get(x[1]); if (!z) throw Object.assign(new Error("nf"), { httpStatus: 404 }); if (m === "DELETE") { zones.delete(x[1]); return {}; } return z; }
    if ((x = /^\/zones\/(\w+)\/dns_records\?.*name=([^&]+)/.exec(p))) return zones.get(x[1]).recs.filter((r) => r.name === decodeURIComponent(x[2]));
    if ((x = /^\/zones\/(\w+)\/dns_records\/(\w+)$/.exec(p))) { const z = zones.get(x[1]); z.recs = z.recs.filter((r) => r.id !== x[2]); return {}; }
    if ((x = /^\/zones\/(\w+)\/dns_records$/.exec(p))) { const r = Object.assign({ id: id() }, b); zones.get(x[1]).recs.push(r); return r; }
    if ((x = /^\/zones\/(\w+)\/workers\/routes$/.exec(p))) { const z = zones.get(x[1]); if (m === "GET") return z.routes; const r = Object.assign({ id: id() }, b); z.routes.push(r); return r; }
    if ((x = /^\/zones\/(\w+)\/workers\/routes\/(\w+)$/.exec(p))) { const z = zones.get(x[1]); z.routes = z.routes.filter((r) => r.id !== x[2]); return {}; }
    if (p.endsWith("/activation_check")) return {};
    throw new Error("unexpected " + m + " " + p);
  };
  return { cf, zones, calls };
}

test("attach → pending → active → remove", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cd-"));
  const { localBackend } = require("../cloudpublish");
  const be = localBackend(dir);
  const f = fakeCf();
  const fail = (s, m) => Object.assign(new Error(m), { status: s });
  const env = (k, d) => ({ CF_ACCOUNT_ID: "acct" })[k] || d;
  const dom = cd.create({ env, apex: () => "spawnapp.org", fail, query: be.query, cf: f.cf });
  await assert.rejects(dom.attach("u:1", "shop", "x.spawnapp.org"), /already lives/);
  let d = await dom.attach("u:1", "shop", "www.Example.com");
  assert.deepEqual(d.hostnames.sort(), ["example.com", "www.example.com"]);
  assert.equal(d.status, "pending"); assert.equal(d.nameservers.length, 2); assert.match(d.dns.steps.join(" "), /ada.ns.cloudflare.com/);
  await assert.rejects(dom.attach("u:2", "other", "example.com"), /another Spawn account/);
  await assert.rejects(dom.attach("u:2", "other", "blog.example.com"), /another Spawn account/);
  assert.equal((await be.query("SELECT * FROM domains", [])).length, 0);
  [...f.zones.values()][0].status = "active";
  d = (await dom.check("shop"))[0];
  assert.equal(d.status, "active");
  const z = [...f.zones.values()][0];
  assert.equal(z.recs.filter((r) => r.name === "example.com").length, 1); assert.equal(z.recs.find((r) => r.name === "example.com").content, "100::");
  assert.deepEqual(z.routes.map((r) => r.pattern).sort(), ["example.com/*", "www.example.com/*"]);
  assert.equal((await be.query("SELECT * FROM domains WHERE status='active'", [])).length, 2);
  const r = await dom.remove("u:1", "shop", "www.example.com");
  assert.deepEqual(r.removed.sort(), ["example.com", "www.example.com"]);
  assert.equal(z.routes.length, 0); assert.equal(f.zones.size, 1, "active zone kept");
  assert.equal((await be.query("SELECT * FROM domains", [])).length, 0);
  // pending zone is deleted on remove
  await dom.attach("u:1", "shop", "other.io");
  await dom.remove("u:1", "shop", "other.io");
  assert.equal(f.zones.size, 1);
});
