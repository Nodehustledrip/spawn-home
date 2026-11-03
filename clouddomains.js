/*
 * Spawn Cloud custom domains — card-free.
 * Each customer domain is added as a free Cloudflare zone in the Spawn account; the customer switches the
 * domain's nameservers at their registrar (two values we show). Once the zone is active we point the host at the
 * spawn-cloud Worker (proxied AAAA 100:: + Worker route) and list it in D1 `domains`, which the Worker already serves.
 * Universal SSL on the free zone covers the apex and www. Nothing billable: no Cloudflare for SaaS, no paid plans.
 * Customers buy their domain themselves at any registrar; Spawn never sells or charges for domains.
 */
"use strict";
const MULTI = new Set(["co.uk", "org.uk", "me.uk", "ac.uk", "com.au", "net.au", "org.au", "co.nz", "net.nz", "org.nz", "co.jp", "co.in", "com.br", "com.mx", "co.za", "com.sg", "com.tr", "com.cn", "com.hk", "co.kr", "com.ar", "co.il", "com.my", "com.ph", "com.pk", "com.ng", "co.id"]);
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

function normalizeHost(input) {
  let h = String(input || "").trim().toLowerCase();
  h = h.replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0].replace(/:\d+$/, "").replace(/\.$/, "");
  if (!h || h.length > 253 || /^[\d.]+$/.test(h) || h.includes("*")) return null;
  const parts = h.split(".");
  if (parts.length < 2 || !parts.every((p) => LABEL.test(p)) || !/^[a-z]{2,}$|^xn--/.test(parts[parts.length - 1])) return null;
  return h;
}
function zoneOf(host) {
  const p = host.split(".");
  const n = MULTI.has(p.slice(-2).join(".")) ? 3 : 2;
  return p.length < n ? null : p.slice(-n).join(".");
}

function domainLimitFor(tier) {
  const v = (k, d) => Number(process.env[k] || d);
  return tier === "elite" ? v("CLOUD_DOMAINS_PER_ELITE", 50) : v("CLOUD_DOMAINS_PER_USER", 10);
}
function cfClient(env) {
  const base = "https://api.cloudflare.com/client/v4";
  return async function cf(method, path, body) {
    const r = await fetch(base + path, { method, headers: { Authorization: "Bearer " + env("CF_API_TOKEN"), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) {
      const e = (j.errors || [])[0] || {};
      throw Object.assign(new Error("Cloudflare " + method + " " + path.split("?")[0] + " (" + r.status + "): " + String(e.message || "").slice(0, 200)), { cfCode: e.code, httpStatus: r.status });
    }
    return j.result;
  };
}

function create(opts) {
  const { env, query, apex, fail } = opts;
  const cf = opts.cf || cfClient(env);
  const acct = () => env("CF_ACCOUNT_ID");
  const worker = () => env("CLOUD_WORKER_NAME", "spawn-cloud");
  const ns = (row) => { try { return JSON.parse(row.nameservers || "[]"); } catch (_) { return []; } };

  function view(rows) {
    if (!rows.length) return null;
    const p = rows.find((r) => r.role === "primary") || rows[0];
    const hosts = rows.map((r) => r.hostname);
    const status = rows.every((r) => r.status === "active") ? "active" : rows.some((r) => r.status === "failed") ? "failed" : "pending";
    return {
      hostname: p.hostname, hostnames: hosts, zone: p.zone_name, status, error: rows.map((r) => r.error).filter(Boolean)[0] || null,
      nameservers: ns(p), checkedAt: p.checked_at, url: "https://" + p.hostname + "/",
      dns: instructions(p.zone_name, ns(p), status),
    };
  }
  function instructions(zone, nameservers, status) {
    if (status === "active") return { done: true, steps: ["Connected. Your app is served at this domain with HTTPS. Keep these nameservers at your registrar."] , nameservers };
    return {
      done: false, nameservers,
      steps: [
        "Sign in where you bought " + zone + " (GoDaddy, Namecheap, Porkbun, Google/Squarespace, etc.).",
        "Open the domain's Nameservers setting and choose custom nameservers.",
        "Replace every existing nameserver with exactly these two: " + nameservers.join(" and ") + ".",
        "Save. Most registrars apply it within an hour; it can take up to 24 hours. We check automatically and switch the domain on with HTTPS.",
      ],
      notes: [
        "Your existing DNS records (email, verification) were copied over automatically — review them on your domain's DNS once it's live.",
        "Both " + zone + " and www." + zone + " are connected when you attach the root domain.",
        "This domain's DNS is hosted for you on our edge network at no cost. To disconnect later, remove the domain here and set your registrar's nameservers back.",
      ],
    };
  }

  async function rowsFor(slug) { return query("SELECT * FROM custom_domains WHERE slug=?1 ORDER BY created_at, role", [slug]); }
  async function list(slug) {
    const rows = await rowsFor(slug); const byZone = new Map();
    for (const r of rows) { const k = r.role === "www" ? r.hostname.slice(4) : r.hostname; if (!byZone.has(k)) byZone.set(k, []); byZone.get(k).push(r); }
    return [...byZone.values()].map(view);
  }

  async function findZone(name) {
    const z = await cf("GET", "/zones?name=" + encodeURIComponent(name) + "&account.id=" + acct());
    return (z && z[0]) || null;
  }

  async function attach(owner, slug, input, opts) {
    const host = normalizeHost(input);
    if (!host) throw fail(400, "Enter a domain like example.com or shop.example.com.");
    const zone = zoneOf(host);
    if (!zone) throw fail(400, "Enter a full domain like example.com.");
    if (zone === apex() || host.endsWith("." + apex())) throw fail(400, "Your app already lives at " + slug + "." + apex() + ". Enter a domain you own.");
    const hosts = host === zone || host === "www." + zone ? [zone, "www." + zone] : [host];
    const roles = hosts.map((h) => (h.startsWith("www.") && h.slice(4) === zone ? "www" : "primary"));
    for (const h of hosts) {
      const ex = (await query("SELECT slug, owner FROM custom_domains WHERE hostname=?1", [h]))[0];
      if (ex && ex.owner !== owner) throw fail(409, h + " is already connected to another Spawn account.");
      if (ex && ex.slug !== slug) throw fail(409, h + " is connected to your app " + ex.slug + ". Remove it there first.");
      if (ex) return (await list(slug)).find((d) => d.hostnames.includes(host));
    }
    const zoneRows = await query("SELECT owner, zone_id, nameservers FROM custom_domains WHERE zone_name=?1 LIMIT 1", [zone]);
    if (zoneRows[0] && zoneRows[0].owner !== owner) throw fail(409, zone + " is already connected to another Spawn account.");
    const count = await query("SELECT COUNT(DISTINCT zone_name) AS n FROM custom_domains WHERE owner=?1", [owner]);
    if (Number((count[0] || {}).n || 0) >= Number((opts && opts.limit) || env("CLOUD_DOMAINS_PER_USER", "10")) && !zoneRows[0]) throw fail(429, "You've reached the custom domain limit for your account" + ((opts && opts.tier) === "pro" ? " — Elite allows up to " + domainLimitFor("elite") + "." : "."));
    let zoneId = zoneRows[0] && zoneRows[0].zone_id, nameservers = zoneRows[0] ? JSON.parse(zoneRows[0].nameservers || "[]") : null;
    if (!zoneId) {
      let z = await findZone(zone);
      if (z) throw fail(409, zone + " can't be connected right now. Contact support if you own it.");
      try { z = await cf("POST", "/zones", { name: zone, account: { id: acct() }, type: "full", jump_start: true }); }
      catch (e) {
        if (e.cfCode === 1061 || e.cfCode === 1097) throw fail(409, zone + " is already set up with another DNS account on our edge network. Remove it there first, then try again.");
        if (e.cfCode === 1049 || e.cfCode === 1002) throw fail(400, zone + " isn't a registered domain yet. Buy it at any registrar first, then connect it here.");
        if (e.cfCode === 1105 || e.cfCode === 1099) throw fail(429, "Too many domains are waiting to connect. Try again in a few hours.");
        throw e;
      }
      zoneId = z.id; nameservers = z.name_servers || [];
    }
    for (let i = 0; i < hosts.length; i++)
      await query("INSERT INTO custom_domains (hostname, slug, owner, zone_name, zone_id, role, status, nameservers) VALUES (?1,?2,?3,?4,?5,?6,'pending',?7)",
        [hosts[i], slug, owner, zone, zoneId, roles[i], JSON.stringify(nameservers)]);
    await check(slug, hosts).catch(() => {});
    return (await list(slug)).find((d) => d.hostnames.includes(host));
  }

  async function activateHost(row) {
    // Point the host at the Worker: replace any address record for exactly this name with a proxied AAAA 100::.
    const recs = await cf("GET", "/zones/" + row.zone_id + "/dns_records?per_page=100&name=" + encodeURIComponent(row.hostname));
    let recordId = null;
    for (const r of recs || []) {
      if (!["A", "AAAA", "CNAME"].includes(r.type)) continue;
      if (r.type === "AAAA" && r.content === "100::" && r.proxied) { recordId = r.id; continue; }
      await cf("DELETE", "/zones/" + row.zone_id + "/dns_records/" + r.id);
    }
    if (!recordId) recordId = (await cf("POST", "/zones/" + row.zone_id + "/dns_records", { type: "AAAA", name: row.hostname, content: "100::", proxied: true, ttl: 1, comment: "Spawn Cloud app " + row.slug })).id;
    const pattern = row.hostname + "/*";
    const routes = await cf("GET", "/zones/" + row.zone_id + "/workers/routes");
    let route = (routes || []).find((x) => x.pattern === pattern);
    if (route && route.script !== worker()) { await cf("DELETE", "/zones/" + row.zone_id + "/workers/routes/" + route.id); route = null; }
    if (!route) route = await cf("POST", "/zones/" + row.zone_id + "/workers/routes", { pattern, script: worker() });
    await query("INSERT INTO domains (hostname, slug, status, cf_id) VALUES (?1,?2,'active',?3) ON CONFLICT(hostname) DO UPDATE SET slug=excluded.slug, status='active', cf_id=excluded.cf_id", [row.hostname, row.slug, row.zone_id]);
    await query("UPDATE custom_domains SET status='active', record_id=?2, route_id=?3, error=NULL, checked_at=?4 WHERE hostname=?1", [row.hostname, recordId, route.id, new Date().toISOString()]);
  }

  const lastNudge = new Map();
  async function check(slug, onlyHosts) {
    const rows = (await rowsFor(slug)).filter((r) => r.status !== "active" && (!onlyHosts || onlyHosts.includes(r.hostname)));
    const zones = new Map();
    for (const r of rows) {
      let z = zones.get(r.zone_id);
      if (!z) { try { z = await cf("GET", "/zones/" + r.zone_id); } catch (e) { z = { status: "error", _e: e }; } zones.set(r.zone_id, z); }
      const now = new Date().toISOString();
      if (z.status === "active") {
        try { await activateHost(r); } catch (e) { console.warn("[cloud-domains] activate " + r.hostname + ": " + e.message); await query("UPDATE custom_domains SET error=?2, checked_at=?3 WHERE hostname=?1", [r.hostname, "Almost there — finishing setup. We'll retry shortly.", now]); }
      } else if (z.status === "error" && z._e && z._e.httpStatus === 404) {
        await query("UPDATE custom_domains SET status='failed', error=?2, checked_at=?3 WHERE hostname=?1", [r.hostname, "Setup expired before the nameservers changed. Remove the domain and add it again.", now]);
      } else {
        await query("UPDATE custom_domains SET checked_at=?2 WHERE hostname=?1", [r.hostname, now]);
        const t = lastNudge.get(r.zone_id) || 0;
        if (z.status === "pending" && Date.now() - t > 3600000) { lastNudge.set(r.zone_id, Date.now()); cf("PUT", "/zones/" + r.zone_id + "/activation_check").catch(() => {}); }
      }
    }
    return list(slug);
  }

  async function remove(owner, slug, input) {
    const host = normalizeHost(input);
    const rows = (await rowsFor(slug)).filter((r) => r.owner === owner);
    const target = rows.find((r) => r.hostname === host);
    if (!target) throw fail(404, "That domain isn't connected to this app.");
    const pair = [target.zone_name, "www." + target.zone_name];
    const doomed = pair.includes(target.hostname) ? rows.filter((r) => pair.includes(r.hostname)) : [target];
    for (const r of doomed) {
      await query("DELETE FROM domains WHERE hostname=?1", [r.hostname]);
      if (r.route_id) await cf("DELETE", "/zones/" + r.zone_id + "/workers/routes/" + r.route_id).catch(() => {});
      if (r.record_id) await cf("DELETE", "/zones/" + r.zone_id + "/dns_records/" + r.record_id).catch(() => {});
      await query("DELETE FROM custom_domains WHERE hostname=?1", [r.hostname]);
    }
    const left = await query("SELECT 1 AS x FROM custom_domains WHERE zone_name=?1 LIMIT 1", [target.zone_name]);
    let note = "Disconnected.";
    if (!left.length && target.zone_id) {
      const z = await cf("GET", "/zones/" + target.zone_id).catch(() => null);
      if (z && z.status !== "active") { await cf("DELETE", "/zones/" + target.zone_id).catch(() => {}); note = "Disconnected. Nothing changed at your registrar."; }
      else note = "Disconnected. Your domain's DNS keeps working; to move it fully, set your registrar's nameservers back to your previous provider.";
    }
    return { ok: true, removed: doomed.map((r) => r.hostname), note };
  }

  async function sweep() {
    const slugs = await query("SELECT DISTINCT slug FROM custom_domains WHERE status='pending' LIMIT 50", []);
    for (const s of slugs) await check(s.slug).catch((e) => console.warn("[cloud-domains] sweep " + s.slug + ": " + e.message));
  }

  return { attach, check, remove, list, sweep };
}

function registrarLinks(name) {
  const q = encodeURIComponent(String(name || "").toLowerCase().replace(/[^a-z0-9.-]/g, "").slice(0, 63));
  return [
    { name: "Porkbun", url: "https://porkbun.com/checkout/search?q=" + q },
    { name: "Namecheap", url: "https://www.namecheap.com/domains/registration/results/?domain=" + q },
  ];
}

module.exports = { create, domainLimitFor, normalizeHost, zoneOf, registrarLinks };
