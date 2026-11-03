"use strict";

/**
 * On-site Build: create → preview → edit → download.
 * Postgres (buildstore.js) is the durable source of truth; data/builds/<id>/ is a
 * disk cache that the generators/editors work on and is re-hydrated on demand.
 * Ownership: a random owner token kept in the visitor's localStorage and sent as
 * X-Build-Owner (cookie session as fallback). Only a hash of it is stored.
 * No fake *.spawnapp.org public URLs — preview is /preview/<id>/ only.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const webgen = require("./webgen");
const webedit = require("./webedit");
const webfree = require("./webfree");
const buildai = require("./buildai");
const history = require("./buildhistory");
const versions = require("./buildversions");
const presets = require("./buildpresets");
const store = require("./buildstore");
const buildzip = require("./buildzip");
const auth = require("./auth");
const badge = require("./badge");

const BUILDS_DIR = process.env.BUILDS_DIR || path.join(__dirname, "data", "builds");
const COOKIE = "spawn_build_sid";
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // seconds
const OWNER_HEADER = "x-build-owner";
const OWNER_RE = /^[A-Za-z0-9_-]{24,64}$/;

/* Abuse limits — generous for real people, tight for scripts. */
/* Limits ladder: anonymous (no account) < free account (auth.js) < Pro (auth.js). */
const MAX_BUILDS_PER_OWNER = Number(process.env.BUILD_MAX_PER_OWNER || 2);
const ANON_EDITS_PER_DAY = Number(process.env.BUILD_ANON_EDITS_PER_DAY || 20);
/* Older anonymous sessions may hold more builds than today's cap — still list them. */
const ANON_LIST_MAX = 24;
const MAX_TOTAL_BUILDS = Number(process.env.BUILD_MAX_TOTAL || 2500);
const MAX_PUBLIC_BYTES = Number(process.env.BUILD_MAX_PUBLIC_BYTES || 600 * 1024);
const RATE = { windowMs: 60 * 1000, max: 20 }; // edits + misc writes per IP
const CREATE_RATE = { windowMs: 10 * 60 * 1000, max: 8 }; // creates per IP / 10 min
const CREATE_DAILY = { windowMs: 24 * 60 * 60 * 1000, max: 40 }; // creates per IP / day
const ZIP_RATE = { windowMs: 60 * 1000, max: 12 };

const POSTHOG_KEY =
  process.env.POSTHOG_KEY || "phc_nqATxCRsk9kKbZCNF3LHqdGzQYK97WzTn8n7Ntmi8QzJ";
const POSTHOG_HOST = process.env.POSTHOG_HOST || "https://us.i.posthog.com";

const buckets = new Map();
const editing = new Set();

/* Friendly page for a preview whose build no longer exists. Builds made without
 * an account live on temporary disk and are cleared when Spawn updates. */
function previewNotFound(res) {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "no-store");
  return res
    .status(404)
    .type("html")
    .send(
      '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<meta name="robots" content="noindex"><title>Build not found — Spawn</title><style>' +
        "body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0f;color:#ececf1;font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:24px;box-sizing:border-box}" +
        ".c{max-width:460px;text-align:center}.k{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#9a9aa8;margin:0 0 10px}" +
        "h1{font-size:26px;margin:0 0 12px;letter-spacing:-.01em}p{color:#b8b8c4;margin:0 0 22px}" +
        ".a{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}a{display:inline-block;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:600;font-size:15px}" +
        ".p{background:#fff;color:#0b0b0f}.s{border:1px solid #3a3a46;color:#ececf1}a:focus-visible{outline:2px solid #8b8bff;outline-offset:2px}" +
        '</style></head><body><main class="c"><p class="k">Build not found</p><h1>This build is no longer here</h1>' +
        "<p>Builds made without an account are temporary and are cleared when Spawn updates. Start a new one in seconds, or sign in free so your next builds are kept in your account.</p>" +
        '<div class="a"><a class="p" href="/build" target="_top">Start a new build</a><a class="s" href="/signin?next=/build" target="_top">Sign in free</a></div></main></body></html>'
    );
}

function ensureDir() {
  try {
    fs.mkdirSync(BUILDS_DIR, { recursive: true });
  } catch (_) {}
}

function hit(kind, key, rule) {
  const now = Date.now();
  const k = kind + ":" + key;
  let b = buckets.get(k);
  if (!b || now - b.start > rule.windowMs) {
    b = { start: now, count: 0, windowMs: rule.windowMs };
    buckets.set(k, b);
  }
  b.count += 1;
  return b.count <= rule.max;
}

function rateOk(ip) {
  return hit("w", ip, RATE);
}

/* Drop expired buckets so the map can't grow without bound. */
setInterval(function () {
  const now = Date.now();
  buckets.forEach(function (b, k) {
    if (now - b.start > b.windowMs) buckets.delete(k);
  });
}, 10 * 60 * 1000).unref();

function clientIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  return xf || req.ip || "unknown";
}

function parseCookies(req) {
  const out = {};
  const raw = String(req.headers.cookie || "");
  raw.split(";").forEach(function (part) {
    const i = part.indexOf("=");
    if (i === -1) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) {
      try {
        out[k] = decodeURIComponent(v);
      } catch (_) {}
    }
  });
  return out;
}

function setSessionCookie(res, sid) {
  const secure = process.env.NODE_ENV === "production" || !!process.env.RENDER;
  const parts = [
    COOKIE + "=" + encodeURIComponent(sid),
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=" + COOKIE_MAX_AGE,
  ];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function hashOwner(kind, value) {
  return kind + "_" + crypto.createHash("sha256").update("spawn-build:" + kind + ":" + value).digest("hex").slice(0, 40);
}

/** Owner key for this request: localStorage token header, else cookie session. */
function ownerKey(req, res) {
  const tok = String(req.headers[OWNER_HEADER] || "").trim();
  if (OWNER_RE.test(tok)) return hashOwner("t", tok);
  const cookies = parseCookies(req);
  let sid = cookies[COOKIE];
  if (!sid || !/^[a-zA-Z0-9_-]{16,64}$/.test(sid)) {
    sid = crypto.randomBytes(18).toString("base64url");
    setSessionCookie(res, sid);
  }
  return hashOwner("s", sid);
}

/** Anonymous owner keys this request can prove (header token and/or cookie), without minting a cookie. */
function anonKeys(req) {
  const out = [];
  const tok = String(req.headers[OWNER_HEADER] || "").trim();
  if (OWNER_RE.test(tok)) out.push(hashOwner("t", tok));
  const sid = parseCookies(req)[COOKIE];
  if (sid && /^[a-zA-Z0-9_-]{16,64}$/.test(sid)) out.push(hashOwner("s", sid));
  return out;
}

/**
 * Who owns builds for this request. Signed in (auth enabled) → "u:<id>" with that
 * account's plan limits; otherwise the anonymous session key exactly as before.
 */
async function resolveOwner(req, res) {
  const user = await auth.currentUser(req);
  if (user) {
    const lim = auth.limitsFor(user);
    const key = auth.ownerFor(user);
    if (buildai.setOwnerTier) buildai.setOwnerTier(key, lim.plan);
    return { key: key, user: user, maxBuilds: lim.maxBuilds, limits: lim };
  }
  return { key: ownerKey(req, res), user: null, maxBuilds: MAX_BUILDS_PER_OWNER };
}

function projectRoot(id) {
  if (!/^[a-z0-9]{8,32}$/i.test(id)) return null;
  const root = path.join(BUILDS_DIR, id);
  if (!root.startsWith(BUILDS_DIR)) return null;
  return root;
}

function readMeta(id) {
  const root = projectRoot(id);
  if (!root || !fs.existsSync(root)) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "forge.json"), "utf8"));
  } catch (_) {
    return { name: id, slug: id };
  }
}

function touchMeta(root) {
  try {
    const p = path.join(root, "forge.json");
    const meta = JSON.parse(fs.readFileSync(p, "utf8"));
    meta.updatedAt = new Date().toISOString();
    fs.writeFileSync(p, JSON.stringify(meta, null, 2) + "\n", "utf8");
  } catch (_) {}
}

/**
 * Resolve a build for this request: validates the id, re-hydrates the disk
 * cache from Postgres if needed, and checks ownership.
 * Returns { id, root, owner, source } or sends an error response and returns null.
 */
/** Admin override: WAITLIST_ADMIN_TOKEN header, or the signed-in site owner account. */
function isAdminReq(req, user) {
  const tok = process.env.WAITLIST_ADMIN_TOKEN || "";
  const h = req.headers && req.headers["x-waitlist-token"];
  if (tok && typeof h === "string" && h.length > 0 && h === tok) return true;
  try { return !!user && require("./badge").isOwner(user); } catch (_) { return false; }
}

async function loadOwned(req, res, opts) {
  const id = String(req.params.id || "");
  const root = projectRoot(id);
  if (!root) {
    res.status(404).json({ ok: false, error: "Build not found" });
    return null;
  }
  const who = await resolveOwner(req, res);
  const me = who.key;
  const source = await store.hydrate(id, root);
  if (!source) {
    res.status(404).json({ ok: false, error: "Build not found" });
    return null;
  }
  const owner = await store.ownerOf(id, root);
  if (opts && opts.admin && isAdminReq(req, who.user)) {
    return { id: id, root: root, owner: owner, source: source, user: who.user, admin: true };
  }
  if (!owner || owner !== me) {
    res.status(403).json({ ok: false, error: "This build belongs to another browser. Open it from the browser you made it in." });
    return null;
  }
  return { id: id, root: root, owner: owner, source: source, user: who.user };
}

/* Previews carry the "Made with Spawn" badge unless the build belongs to a Pro (or owner) account. */
async function previewBadgeExempt(id, root) {
  try {
    const owner = await store.ownerOf(id, root);
    const m = /^u:(.+)$/.exec(String(owner || ""));
    if (!m) return false;
    return badge.exempt(await auth.userById(m[1]));
  } catch (_) {
    return false;
  }
}

/* Daily edit allowance (anon 20 / free / Pro via auth.js). Every AI action — chat edits and
 * click-to-edit rewrites — counts as an edit. Returns false after sending a 429. */
function editGate(req, res, b, ip) {
    if (!b.user && ANON_EDITS_PER_DAY && !hit("ead", ip, { windowMs: 24 * 60 * 60 * 1000, max: ANON_EDITS_PER_DAY })) {
      res.status(429).json({
        ok: false,
        limit: "edits",
        signin: auth.enabled() ? true : undefined,
        error: "You've used today's " + ANON_EDITS_PER_DAY + " edits without an account. Sign in with your email (free) for " + auth.limitsFor({ plan: "free" }).editsPerDay + " a day, or go Pro for " + auth.limitsFor({ plan: "pro", plan_status: "active" }).editsPerDay + ".",
      });
      return false;
    }
    if (b.user && !auth.editAllowed(b.user)) {
      res.status(429).json({
        ok: false,
        limit: "edits",
        upgrade: auth.tierOf(b.user) === "elite" ? undefined : "/pricing",
        offer: auth.tierOf(b.user) === "pro" ? "elite" : auth.tierOf(b.user) === "free" ? "pro" : undefined,
        error: auth.tierOf(b.user) === "elite"
          ? "You've reached today's Elite edit limit. It resets within 24 hours."
          : auth.isPro(b.user)
          ? "You've reached today's Pro edit limit. It resets within 24 hours — Elite allows up to " + auth.limitsFor({ plan: "elite", plan_status: "active" }).editsPerDay + " edits a day."
          : "You've reached today's edit limit on the Free plan. It resets within 24 hours — Pro allows " + auth.limitsFor({ plan: "pro", plan_status: "active" }).editsPerDay + " edits a day.",
      });
      return false;
    }
    return true;
}

function wrap(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(function (err) {
      const status = err.status || 500;
      console.error("[builds]", req.method, req.path, "failed:", (err && err.message) || err);
      if (res.headersSent) {
        try { res.end(); } catch (_) {}
        return;
      }
      res.status(status).json({ ok: false, error: status < 500 ? err.message : "Something went wrong — try again." });
    });
  };
}

/** Analytics never gets email addresses: drop email-ish keys, redact email-shaped strings. */
function scrubEmails(o) {
  const re = /[^\s@"'<>]+@[^\s@"'<>]+\.[a-z]{2,}/gi;
  Object.keys(o).forEach(function (k) {
    if (/e-?mail/i.test(k)) delete o[k];
    else if (typeof o[k] === "string") o[k] = o[k].replace(re, "[redacted]");
  });
  return o;
}

function dualWriteBuild(event, props) {
  if (!POSTHOG_KEY) return;
  const body = JSON.stringify({
    api_key: POSTHOG_KEY,
    event: event,
    distinct_id: props.sessionId || props.id || "anon",
    properties: scrubEmails(Object.assign({ $lib: "spawn-home-builds" }, props || {})),
  });
  fetch(POSTHOG_HOST.replace(/\/$/, "") + "/capture/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body,
  }).catch(function (err) {
    console.error("[builds] posthog dual-write failed", err && err.message);
  });
}

function summarizeBuild(id, meta) {
  meta = meta || readMeta(id) || {};
  return {
    id: id,
    name: meta.name || id,
    template: meta.template || null,
    createdAt: meta.createdAt || null,
    updatedAt: meta.updatedAt || meta.createdAt || null,
    previewPath: "/preview/" + id + "/",
    zipPath: "/api/builds/" + id + "/zip",
  };
}

const LIMITS_NOTE =
  "On-site Build creates, edits, previews, and exports a zip. Sign in (free) to publish to Spawn Cloud at <name>.spawnapp.org — live 24/7.";


/* Builds made before 2026-10-06 shipped `.grid.2{…}` — an invalid selector browsers drop, so every
 * multi-column grid collapsed to one column. Repair the cached stylesheet in place (idempotent). */
function fixLegacyCss(root) {
  try {
    const p = path.join(root, "public", "styles.css");
    const css = fs.readFileSync(p, "utf8");
    if (!/\.grid\.[234]\{/.test(css)) return false;
    fs.writeFileSync(p, css.replace(/\.grid\.([234])\{/g, '.grid[class~="$1"]{'));
    return true;
  } catch (_) {
    return false;
  }
}

/* Builds made before 2026-10-07: reword bot copy and swap untouched "Project N" gallery
 * placeholders for business-fit tiles. Idempotent; only rewrites a page when something changed. */
function fixLegacyCopy(root) {
  let changed = false;
  try {
    const pub = path.join(root, "public");
    let meta = {};
    try {
      meta = JSON.parse(fs.readFileSync(path.join(root, "forge.json"), "utf8")) || {};
    } catch (_) {}
    fs.readdirSync(pub).forEach(function (f) {
      if (!/\.html$/i.test(f)) return;
      const p = path.join(pub, f);
      const html = fs.readFileSync(p, "utf8");
      if (!/not a bot|>Project 1<\/p>/.test(html)) return;
      const next = webfree.repairLegacyHtml(html, meta);
      if (next !== html) {
        fs.writeFileSync(p, next);
        changed = true;
      }
    });
  } catch (_) {}
  return changed;
}

function fixLegacy(root) {
  const a = fixLegacyCss(root);
  const b = fixLegacyCopy(root);
  return a || b;
}

async function claimInto(req, _res, user) {
  await store.init();
  const to = auth.ownerFor(user);
  const lim = auth.limitsFor(user);
  const have = await store.countByOwner(to, BUILDS_DIR);
  const ids = await store.claim(anonKeys(req), to, BUILDS_DIR, Math.max(0, lim.maxBuilds - have));
  if (ids.length) console.log("[builds] claimed", ids.length, "build(s) into account");
  return ids.length;
}

function mount(app) {
  ensureDir();
  auth.mount(app, { claim: claimInto, billingEnabled: function () { return require("./billing").enabled(); } });
  store.init().catch(function (err) {
    console.error("[builds] store init failed", err && err.message);
  });

  app.get("/api/builds/templates", function (_req, res) {
    res.json({ ok: true, templates: webgen.listTemplates() });
  });

  function aiFallbackNote(reason, kind) {
    const tail = kind === "create" ? "so this starts from a template — describe changes in Build chat." : "used free offline rules instead.";
    switch (reason) {
      case "daily_cap":
        return "Today's free AI budget is used up, " + tail;
      case "ip_daily_cap":
      case "owner_daily_cap":
        return "You've used today's free AI requests, " + tail;
      case "rate_limited":
        return "Cloud AI is busy right now, " + tail;
      case "quota":
        return "Cloud AI hit its free-tier limit, " + tail;
      case "timeout":
        return "Cloud AI took too long, " + tail;
      default:
        return "Cloud AI couldn't finish that, " + tail;
    }
  }

  app.get("/api/builds/ai-status", function (_req, res) {
    res.setHeader("Cache-Control", "no-store");
    buildai
      .status()
      .then(function (s) {
        res.json(s);
      })
      .catch(function () {
        res.json({ ok: true, configured: false, mode: "offline", free: true, label: "Free Build (offline)" });
      });
  });

  app.get("/api/builds/storage", wrap(async function (_req, res) {
    res.setHeader("Cache-Control", "no-store");
    await store.init();
    const h = await store.health();
    res.json({ ok: true, storage: h.mode, durable: !!h.durable });
  }));

  /* "My builds": only builds owned by this browser's owner token. */
  app.get("/api/builds", wrap(async function (req, res) {
    res.setHeader("Cache-Control", "no-store");
    await store.init();
    const who = await resolveOwner(req, res);
    const builds = await store.listByOwner(who.key, BUILDS_DIR, who.user ? who.maxBuilds : Math.max(who.maxBuilds, ANON_LIST_MAX));
    builds.forEach(function (b) {
      b.zipPath = "/api/builds/" + b.id + "/zip";
    });
    res.json({
      ok: true,
      builds: builds,
      storage: store.mode(),
      limits: {
        previewOnly: true,
        publicUrl: false,
        customDomain: false,
        maxBuilds: who.maxBuilds,
        account: !!who.user,
        plan: who.user ? who.limits.plan : undefined,
        note: LIMITS_NOTE,
      },
    });
  }));

  /* Shared by create and remix: rate limits, anonymous/free/Pro build caps (with the sign-in or upgrade prompt), global cap. */
  async function createGate(req, res) {
    const ip = clientIp(req);
    if (!hit("c", ip, CREATE_RATE) || !hit("cd", ip, CREATE_DAILY)) {
      res.status(429).json({ ok: false, error: "You're creating builds quickly — give it a few minutes, or keep editing an existing one." });
      return null;
    }
    await store.init();
    const who = await resolveOwner(req, res);
    const me = who.key;
    const mine = await store.countByOwner(me, BUILDS_DIR);
    if (mine >= who.maxBuilds) {
      res.status(400).json({
        ok: false,
        limit: "builds",
        upgrade: who.user && who.limits.plan !== "elite" ? "/pricing" : undefined,
        offer: who.user ? (who.limits.plan === "pro" ? "elite" : who.limits.plan === "free" ? "pro" : undefined) : undefined,
        error: who.user
          ? who.limits.plan === "elite"
            ? "You have " + mine + " saved builds — the most Elite keeps. Delete one from Your builds to make room."
            : who.limits.plan === "pro"
            ? "You have " + mine + " saved builds — the most Pro keeps. Delete one to make room, or keep up to " + auth.limitsFor({ plan: "elite", plan_status: "active" }).maxBuilds + " with Elite."
            : "You have " + mine + " saved builds — the most the Free plan keeps. Delete one to make room, or keep up to " + auth.limitsFor({ plan: "pro", plan_status: "active" }).maxBuilds + " with Pro."
          : "You've made " + mine + " builds without an account — the most a browser keeps. Sign in with your email (free, no password) to save up to " + auth.limitsFor({ plan: "free" }).maxBuilds + " builds to your account.",
        signin: !who.user && auth.enabled() ? true : undefined,
      });
      return null;
    }
    const total = await store.countAll(BUILDS_DIR);
    if (total.count >= MAX_TOTAL_BUILDS) {
      console.error("[builds] global build cap reached", total.count);
      res.status(503).json({ ok: false, error: "On-site Build is at capacity right now — try again later." });
      return null;
    }
    return { ip, who, me };
  }

  /* Remix a gallery app: copy its published static files (never secrets, data or server code) into a new build
   * owned by the visitor. Credit lives in forge.json only, never on the visible site. */
  app.post("/api/builds/remix", wrap(async function (req, res) {
    const slug = String((req.body && req.body.slug) || "").toLowerCase().trim();
    if (!/^[a-z0-9-]{2,40}$/.test(slug)) return res.status(400).json({ ok: false, error: "Pick an app from the gallery to remix." });
    const gallery = require("./gallery");
    const cloud = require("./cloudpublish");
    if (!cloud.enabled() || !cloud.backend()) return res.status(503).json({ ok: false, error: "Remix isn't available right now." });
    const gstore = gallery.store || (gallery.store = gallery.createStore(() => cloud.backend()));
    let src;
    try { src = await gstore.remixSource(slug); } catch (err) {
      if (err.status) return res.status(err.status).json({ ok: false, error: err.message });
      throw err;
    }
    /* Premium templates are included with Pro: enforced here, not only in the gallery UI. */
    if (src.access === "pro" || src.premium) {
      const viewer = await auth.currentUser(req);
      const gate = gallery.canRemix(src, viewer, auth.isPro, auth.isElite);
      if (!gate.ok) {
        dualWriteBuild("premium_remix_blocked", { sessionId: "premium-gate", source_slug: slug, reason: gate.reason });
        return res.status(gate.reason === "signin" ? 401 : 403).json({
          ok: false, premium: true, reason: gate.reason, upgrade: "/pricing?ref=premium-template",
          signin: gate.reason === "signin" ? true : undefined,
          offer: gate.reason === "elite" ? "elite" : undefined,
          until: gate.until || undefined,
          error: gate.reason === "elite"
            ? "This new premium template is in Elite early access until " + String(gate.until).slice(0, 10) + ". Upgrade to Elite to remix it now — it opens to Pro after that."
            : gate.reason === "signin"
            ? "Premium templates are included with Spawn Pro. Sign in with a Pro account to remix this one."
            : "Premium templates are included with Spawn Pro. Upgrade to remix this one.",
        });
      }
    }
    const g = await createGate(req, res);
    if (!g) return;
    const name = String(src.title || slug).replace(/\s+/g, " ").trim().slice(0, 56) || slug;
    const result = webgen.createBuild({ name: name, template: "landing-paywall", description: "Remix of " + name, accent: "#5eead4" }, BUILDS_DIR);
    const pub = path.join(result.path, "public");
    try {
      fs.rmSync(pub, { recursive: true, force: true });
      for (const [rel, buf] of Object.entries(src.files)) {
        const dest = path.join(pub, rel);
        if (!dest.startsWith(pub + path.sep)) continue;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, /\.html?$/i.test(rel) ? Buffer.from(gallery.stripForRemix(buf.toString("utf8")), "utf8") : buf);
      }
      const mp = path.join(result.path, "forge.json");
      const meta = JSON.parse(fs.readFileSync(mp, "utf8"));
      meta.template = "remix";
      meta.description = "";
      meta.remixedFrom = { slug: slug, title: src.title, premium: !!src.premium || src.access === "pro" || undefined, url: "https://" + slug + "." + (process.env.CLOUD_APEX || "spawnapp.org") + "/", at: new Date().toISOString() };
      fs.writeFileSync(mp, JSON.stringify(meta, null, 2) + "\n", "utf8");
      await store.save(result.id, g.me, result.path);
    } catch (err) {
      fs.rmSync(result.path, { recursive: true, force: true });
      throw err;
    }
    try { await gstore.bumpRemix(slug); } catch (_) {}
    dualWriteBuild("remix_created", { sessionId: g.me, id: result.id, source_slug: slug, files: Object.keys(src.files).length, storage: store.mode() });
    if (src.premium) dualWriteBuild("premium_remix_created", { sessionId: g.me, id: result.id, source_slug: slug });
    console.log("[builds] remixed", slug, "->", result.id);
    return res.status(201).json({ ok: true, build: summarizeBuild(result.id), saved: store.savedFor(g.me), temporary: store.savedFor(g.me) === "temporary", remixedFrom: { slug: slug, title: src.title }, files: Object.keys(src.files).length });
  }));

  app.post("/api/builds", wrap(async function (req, res) {
    const g = await createGate(req, res);
    if (!g) return;
    const ip = g.ip;
    const who = g.who;
    const me = g.me;

    const body = req.body || {};
    if (body.company || body.website || body.url) {
      return res.json({ ok: true, honeypot: true });
    }
    const name = String(body.name || "").replace(/\s+/g, " ").trim().slice(0, 64);
    const description = String(body.description || "").replace(/\s+/g, " ").trim().slice(0, 240);
    if (!name) return res.status(400).json({ ok: false, error: "App name is required" });

    const accent = /^#[0-9a-f]{3,8}$/i.test(String(body.accent || "")) ? body.accent : "#5eead4";
    const result = webgen.createBuild(
      { name: name, template: body.template, description: description, accent: accent },
      BUILDS_DIR
    );
    /* Live build preview: body.stream → NDJSON events ({type:start|delta|reset|done}) so the
     * client can render sections as the model writes them. The finished build is produced by
     * the exact same path as a non-streamed create. */
    const streaming = body.stream === true;
    let onText = null;
    if (streaming) {
      res.status(200);
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-store, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      const emit = function (o) {
        try {
          res.write(JSON.stringify(o) + "\n");
          if (typeof res.flush === "function") res.flush();
        } catch (_) {}
      };
      res._spawnEmit = emit;
      emit({ type: "start", id: result.id, previewPath: "/preview/" + result.id + "/", ai: !(body.ai === false) && buildai.isConfigured() });
      let pending = "";
      let last = 0;
      onText = function (t, info) {
        if (t === null) {
          pending = "";
          emit({ type: "reset", streamed: !!(info && info.streamed) });
          return;
        }
        pending += t;
        const now = Date.now();
        if (now - last >= 120) {
          emit({ type: "delta", text: pending });
          pending = "";
          last = now;
        }
      };
      onText.flush = function () {
        if (pending) emit({ type: "delta", text: pending });
        pending = "";
      };
    }
    /* Cloud AI writes a site that matches the prompt; on any limit/failure the
     * template scaffold stays and the response says so honestly. */
    let gen = null;
    if (!(body.ai === false) && buildai.isConfigured()) {
      const t0 = Date.now();
      try {
        gen = await buildai.generateSite(
          result.path,
          { name: name, description: description, template: result.template || body.template, accent: accent },
          ip,
          me,
          onText
        );
        if (onText) onText.flush();
      } catch (err) {
        console.error("[builds] ai generate crashed:", (err && err.message) || "error");
        gen = { ok: false, reason: "crash" };
      }
      console.log("[builds] generate", gen.ok ? "ok" : "fallback:" + gen.reason, Date.now() - t0 + "ms");
    }
    versions.record(result.path, gen && gen.ok ? "Created — " + (description || name) : "Created from template", "create");
    try {
      await store.save(result.id, me, result.path);
    } catch (err) {
      fs.rmSync(result.path, { recursive: true, force: true });
      if (streaming) {
        res._spawnEmit({ type: "done", status: err.status || 500, data: { ok: false, error: err.status === 413 ? err.message : "Could not save the build." } });
        return res.end();
      }
      throw err;
    }
    dualWriteBuild("build_created", {
      sessionId: me,
      id: result.id,
      name: result.name,
      template: result.template,
      storage: store.mode(),
      source: "web",
      createdAt: new Date().toISOString(),
    });
    console.log("[builds] created", result.id, result.template, "store=" + store.mode());
    const payload = {
      ok: true,
      build: summarizeBuild(result.id),
      saved: store.savedFor(me),
      temporary: store.savedFor(me) === "temporary",
      generated: gen ? (gen.ok ? "ai" : "template") : "template",
      aiFallback: gen && !gen.ok ? gen.reason : undefined,
      note: gen
        ? gen.ok
          ? "Written for your description — refine it in Build chat."
          : aiFallbackNote(gen.reason, "create")
        : undefined,
    };
    if (streaming) {
      if (gen && gen.ok) dualWriteBuild("build_stream_completed", { sessionId: me, id: result.id });
      res._spawnEmit({ type: "done", status: 201, data: payload });
      return res.end();
    }
    return res.status(201).json(payload);
  }));

  app.get("/api/builds/:id", wrap(async function (req, res) {
    res.setHeader("Cache-Control", "no-store");
    await store.init();
    const b = await loadOwned(req, res);
    if (!b) return;
    const files = [];
    try {
      fs.readdirSync(path.join(b.root, "public")).forEach(function (f) {
        files.push("public/" + f);
      });
    } catch (_) {}
    return res.json({
      ok: true,
      build: summarizeBuild(b.id),
      files: files,
      storage: store.mode(),
      saved: store.savedFor(b.owner),
      temporary: store.savedFor(b.owner) === "temporary",
      limits: { previewOnly: true, note: "Preview at /preview/" + b.id + "/ — lasting public URL needs Spawn desktop." },
    });
  }));

  app.delete("/api/builds/:id", wrap(async function (req, res) {
    if (!rateOk(clientIp(req))) {
      return res.status(429).json({ ok: false, error: "Too many requests. Try again shortly." });
    }
    await store.init();
    const b = await loadOwned(req, res, { admin: true });
    if (!b) return;
    if (editing.has(b.id)) return res.status(409).json({ ok: false, error: "An edit is running — try again in a moment." });
    await store.remove(b.id, b.root);
    console.log("[builds] deleted", b.id);
    return res.json({ ok: true, deleted: b.id });
  }));

  /* Self-contained static export: <slug>/index.html + assets, opens from disk. */
  app.get("/api/builds/:id/zip", wrap(async function (req, res) {
    if (!hit("z", clientIp(req), ZIP_RATE)) {
      return res.status(429).json({ ok: false, error: "Too many downloads. Try again shortly." });
    }
    await store.init();
    const b = await loadOwned(req, res);
    if (!b) return;
    fixLegacy(b.root);
    const out = buildzip.exportSite(b.root, readMeta(b.id) || {});
    dualWriteBuild("build_zip_downloaded", { sessionId: b.owner, id: b.id, bytes: out.buffer.length });
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="' + out.filename + '"');
    res.setHeader("Content-Length", String(out.buffer.length));
    res.setHeader("Cache-Control", "no-store");
    return res.end(out.buffer);
  }));

  app.post("/api/builds/:id/edit", wrap(async function (req, res) {
    const ip = clientIp(req);
    if (!rateOk(ip)) {
      return res.status(429).json({ ok: false, error: "Too many requests. Try again shortly." });
    }
    await store.init();
    const message = String((req.body && (req.body.message || req.body.text)) || "").trim();
    if (!message) return res.status(400).json({ ok: false, error: "Message required" });
    if (message.length > 2000) return res.status(400).json({ ok: false, error: "Message too long" });
    const b = await loadOwned(req, res);
    if (!b) return;
    if (!editGate(req, res, b, ip)) return;
    const id = b.id;
    const root = b.root;
    /* Prefer a model when one is usable (paid with credits, or free Groq/OpenRouter);
     * body.ai === false forces offline rules. Offline rules are always free. */
    const wantAi = !(req.body && req.body.ai === false) && buildai.isConfigured();
    if (editing.has(id)) {
      return res.status(409).json({ ok: false, error: "An edit is already running for this build — one moment." });
    }
    editing.add(id);
    try {
      if (/^\s*(undo|revert|go back|undo (?:that|last(?: change| edit)?))\s*[.!]?\s*$/i.test(message)) {
        const restored = history.restore(root);
        if (restored) {
          versions.record(root, "Undo", "undo");
          touchMeta(root);
          await store.save(id, b.owner, root, { edited: true });
        }
        return res.json({
          ok: true,
          reply: restored ? "Undid the last edit." : "Nothing to undo yet.",
          changes: restored ? [{ action: "undo", detail: "Restored previous version" }] : [],
          mode: "offline",
          saved: store.savedFor(b.owner),
          temporary: store.savedFor(b.owner) === "temporary",
          previewPath: "/preview/" + id + "/",
          build: summarizeBuild(id),
        });
      }
      fixLegacy(root);
      history.snapshot(root);
      let ai = null;
      if (wantAi) {
        try {
          ai = await buildai.applyAiEdit(root, message, ip, b.owner);
        } catch (err) {
          console.error("[builds] ai edit crashed:", (err && err.message) || "error");
          ai = { ok: false, reason: "crash" };
        }
      }
      let out;
      let real = [];
      if (ai && ai.ok) {
        out = ai;
        real = out.changes && out.changes.length ? out.changes : [{ action: "ai" }];
      } else {
        out = webedit.applyEdit(root, message);
        real = (out.changes || []).filter(function (c) {
          return c.action !== "skip";
        });
        if (ai && !real.length && ai.reply) out.reply = ai.reply;
        else if (ai && ai.reason !== "no_changes" && ai.reason !== "not_configured") {
          out.reply = (out.reply || "") + " (" + aiFallbackNote(ai.reason, "edit") + ")";
        }
        out.mode = "offline";
        if (ai) out.aiFallback = ai.reason;
        if (!real.length) history.discard(root);
      }
      if (store.publicBytes(root) > MAX_PUBLIC_BYTES) {
        history.restore(root);
        return res.status(413).json({ ok: false, error: "That change would make the site too large for on-site Build. Try a smaller edit." });
      }
      if (real.length) {
        versions.record(root, message, "edit");
        touchMeta(root);
        await store.save(id, b.owner, root, { edited: true });
      }
      dualWriteBuild("build_edited", {
        sessionId: b.owner,
        id: id,
        mode: out.mode || "offline",
        provider: out.provider || null,
        aiFallback: out.aiFallback || null,
        changeCount: (out.changes || []).length,
      });
      return res.json({
        ok: true,
        reply: out.reply,
        changes: out.changes || [],
        mode: out.mode || "offline",
        provider: out.provider || undefined,
        aiFallback: out.aiFallback || undefined,
        saved: store.savedFor(b.owner),
          temporary: store.savedFor(b.owner) === "temporary",
        previewPath: "/preview/" + id + "/",
        build: summarizeBuild(id),
      });
    } finally {
      editing.delete(id);
    }
  }));

  /* ---------- Studio: source, apply, click-to-edit, versions, presets ---------- */
  function studioReply(res, b, extra) {
    return res.json(Object.assign({
      ok: true,
      previewPath: "/preview/" + b.id + "/",
      saved: store.savedFor(b.owner),
      temporary: store.savedFor(b.owner) === "temporary",
      versions: versions.list(b.root),
      build: summarizeBuild(b.id),
    }, extra || {}));
  }
  function readPub(root, f) {
    try { return fs.readFileSync(path.join(root, "public", f), "utf8"); } catch (_) { return ""; }
  }
  /** Write new public files as one undoable, versioned change. */
  async function commitChange(b, writes, label, kind) {
    history.snapshot(b.root);
    Object.keys(writes).forEach(function (f) { fs.writeFileSync(path.join(b.root, "public", f), writes[f]); });
    if (store.publicBytes(b.root) > MAX_PUBLIC_BYTES) {
      history.restore(b.root);
      throw Object.assign(new Error("That change would make the site too large for on-site Build."), { status: 413 });
    }
    const v = versions.record(b.root, label, kind);
    touchMeta(b.root);
    await store.save(b.id, b.owner, b.root, { edited: true });
    return v;
  }

  /* Raw site source (no preview badge) for the editor. */
  app.get("/api/builds/:id/source", wrap(async function (req, res) {
    res.setHeader("Cache-Control", "no-store");
    await store.init();
    const b = await loadOwned(req, res);
    if (!b) return;
    const css = readPub(b.root, "styles.css");
    return res.json({ ok: true, html: readPub(b.root, "index.html"), css: css, preset: presets.current(css), presets: presets.list() });
  }));

  /* Direct edits from the preview (inline text, image upload, an accepted element rewrite).
   * No model call. Same safety checks as AI output: no new scripts, handlers, frames or base. */
  app.post("/api/builds/:id/apply", wrap(async function (req, res) {
    const ip = clientIp(req);
    if (!rateOk(ip)) return res.status(429).json({ ok: false, error: "Too many requests. Try again shortly." });
    await store.init();
    const body = req.body || {};
    const html = typeof body.html === "string" ? body.html : "";
    if (!/<body[\s>]/i.test(html) || !/<\/body>/i.test(html) || html.length > 400 * 1024) {
      return res.status(400).json({ ok: false, error: "That page couldn't be saved." });
    }
    const b = await loadOwned(req, res);
    if (!b) return;
    if (editing.has(b.id)) return res.status(409).json({ ok: false, error: "An edit is already running — one moment." });
    const before = readPub(b.root, "index.html");
    const clean = html.split(badge.BADGE_HTML).join("");
    if (buildai.riskyIncrease(before, clean) || /<style\b/i.test(clean) && !/<style\b/i.test(before)) {
      return res.status(400).json({ ok: false, error: "That change includes code that isn't allowed in a build." });
    }
    if (clean === before) return studioReply(res, b, { changed: false });
    editing.add(b.id);
    try {
      const kind = /^(text|image|element)$/.test(String(body.kind)) ? String(body.kind) : "edit";
      const v = await commitChange(b, { "index.html": clean }, body.label || "Edited in preview", kind);
      dualWriteBuild("build_preview_edit_applied", { sessionId: b.owner, id: b.id, kind: kind });
      return studioReply(res, b, { changed: true, version: v });
    } finally {
      editing.delete(b.id);
    }
  }));

  /* Click to edit: the model rewrites ONE element. Nothing is saved here — the client splices
   * the replacement into the page and saves through /apply, so the preview updates in place. */
  app.post("/api/builds/:id/element", wrap(async function (req, res) {
    const ip = clientIp(req);
    if (!rateOk(ip)) return res.status(429).json({ ok: false, error: "Too many requests. Try again shortly." });
    await store.init();
    const body = req.body || {};
    const outer = String(body.outer || "");
    const prompt = String(body.prompt || "").trim();
    if (!prompt || prompt.length > 500) return res.status(400).json({ ok: false, error: "Describe the change in a few words." });
    if (!outer || outer.length > 16000) return res.status(400).json({ ok: false, error: "That element is too large to edit on its own — pick a smaller part, or use Build chat." });
    const b = await loadOwned(req, res);
    if (!b) return;
    if (!buildai.isConfigured()) return res.status(503).json({ ok: false, error: "Element rewrites need the cloud writer, which is offline right now. You can still edit text directly." });
    if (!editGate(req, res, b, ip)) return;
    let out;
    try {
      out = await buildai.editElement(outer, String(body.context || "").slice(0, 4000), prompt, ip, b.owner);
    } catch (_) {
      out = { ok: false, reason: "crash" };
    }
    dualWriteBuild("build_element_edit", { sessionId: b.owner, id: b.id, ok: !!out.ok, reason: out.ok ? null : out.reason, tag: (/^\s*<([a-z0-9-]+)/i.exec(outer) || [])[1] || null });
    if (!out.ok) {
      const msg = out.reason === "daily_cap" || out.reason === "quota" || out.reason === "rpm" || out.reason === "ip_daily" || out.reason === "owner_daily"
        ? "The writer is at its limit for now. " + aiFallbackNote(out.reason, "edit").replace(/used free offline rules instead\.?/, "Try again later, or edit the text directly.")
        : "Couldn't rewrite that element — try different wording, or edit the text directly.";
      return res.status(out.reason === "tag_changed" || out.reason === "unsafe_output" ? 422 : 503).json({ ok: false, reason: out.reason, error: msg });
    }
    return res.json({ ok: true, html: out.html, reply: out.reply, mode: "ai" });
  }));

  app.get("/api/builds/:id/versions", wrap(async function (req, res) {
    res.setHeader("Cache-Control", "no-store");
    await store.init();
    const b = await loadOwned(req, res);
    if (!b) return;
    let list = versions.list(b.root);
    if (!list.length && readPub(b.root, "index.html")) {
      /* Builds from before the timeline: start it from what's live now. */
      versions.record(b.root, "Current version", "create");
      list = versions.list(b.root);
    }
    return res.json({ ok: true, versions: list });
  }));

  app.get("/api/builds/:id/versions/:n", wrap(async function (req, res) {
    res.setHeader("Cache-Control", "private, max-age=300");
    await store.init();
    const b = await loadOwned(req, res);
    if (!b) return;
    const v = versions.get(b.root, req.params.n);
    if (!v) return res.status(404).json({ ok: false, error: "That version is no longer kept." });
    return res.json({ ok: true, version: v.meta, html: v.files["index.html"] || "", css: v.files["styles.css"] || "" });
  }));

  app.post("/api/builds/:id/versions/:n/restore", wrap(async function (req, res) {
    if (!rateOk(clientIp(req))) return res.status(429).json({ ok: false, error: "Too many requests. Try again shortly." });
    await store.init();
    const b = await loadOwned(req, res);
    if (!b) return;
    if (editing.has(b.id)) return res.status(409).json({ ok: false, error: "An edit is already running — one moment." });
    const v = versions.get(b.root, req.params.n);
    if (!v) return res.status(404).json({ ok: false, error: "That version is no longer kept." });
    editing.add(b.id);
    try {
      const rec = await commitChange(b, v.files, "Restored v" + v.meta.n + " · " + v.meta.label, "restore");
      dualWriteBuild("build_version_restored", { sessionId: b.owner, id: b.id, from: v.meta.n });
      return studioReply(res, b, { restored: v.meta.n, version: rec });
    } finally {
      editing.delete(b.id);
    }
  }));

  /* One-tap restyle: deterministic theme layer, no model call, saved as a version. */
  app.post("/api/builds/:id/preset", wrap(async function (req, res) {
    if (!rateOk(clientIp(req))) return res.status(429).json({ ok: false, error: "Too many requests. Try again shortly." });
    await store.init();
    const id = String((req.body && req.body.preset) || "");
    if (id !== "original" && !presets.PRESETS[id]) return res.status(400).json({ ok: false, error: "Unknown style." });
    const b = await loadOwned(req, res);
    if (!b) return;
    if (editing.has(b.id)) return res.status(409).json({ ok: false, error: "An edit is already running — one moment." });
    const css = readPub(b.root, "styles.css");
    if (!css) return res.status(400).json({ ok: false, error: "This build has no stylesheet to restyle." });
    const next = presets.apply(css, id);
    if (next === css) return studioReply(res, b, { preset: presets.current(css), changed: false });
    editing.add(b.id);
    try {
      const label = id === "original" ? "Original style" : presets.PRESETS[id].label + " style";
      const v = await commitChange(b, { "styles.css": next }, label, "preset");
      dualWriteBuild("build_preset_applied", { sessionId: b.owner, id: b.id, preset: id });
      return studioReply(res, b, { preset: id === "original" ? null : id, changed: true, version: v });
    } finally {
      editing.delete(b.id);
    }
  }));

  /* Demo lead endpoint used by generated preview forms (absolute /api/lead) */
  app.post("/api/lead", function (req, res) {
    console.log("[lead-demo]", {
      at: new Date().toISOString(),
      keys: Object.keys(req.body || {}),
    });
    return res.json({ ok: true, demo: true });
  });

  /* Live preview — static files only; no claim of public app hosting.
   * Re-hydrates from Postgres when the disk cache was wiped by a redeploy. */
  app.use("/preview/:id", function (req, res, next) {
    const id = String(req.params.id || "");
    const root = projectRoot(id);
    if (!root) return previewNotFound(res);
    store
      .init()
      .then(function () {
        return store.hydrate(id, root);
      })
      .then(function (source) {
        if (!source) return previewNotFound(res);
        fixLegacyCss(root);
        if (req.path === "/" || req.path === "" || /\.html$/i.test(req.path)) fixLegacyCopy(root);
        const pub = path.join(root, "public");
        if (!fs.existsSync(pub)) return res.status(404).type("text").send("No public assets");
        /* Soft X-Robots so previews are not indexed as real apps */
        res.setHeader("X-Robots-Tag", "noindex, nofollow");
        res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
        res.setHeader("X-Build-Source", source === "postgres" || source === "d1" ? source : store.mode() + "-cache");
        const isHtml = req.path === "/" || req.path === "" || /\.html?$/i.test(req.path);
        if (isHtml && (req.method === "GET" || req.method === "HEAD")) {
          const rel = req.path === "/" || req.path === "" ? "index.html" : decodeURIComponent(req.path).replace(/^\/+/, "");
          const file = path.join(pub, rel);
          if (file.startsWith(pub + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
            return previewBadgeExempt(id, root).then(function (skip) {
              const html = fs.readFileSync(file, "utf8");
              res.type("html").send(skip ? html : badge.inject(html));
            });
          }
        }
        express.static(pub, {
          index: ["index.html"],
          fallthrough: true,
          etag: true,
        })(req, res, function () {
          if (req.path === "/" || req.path === "") {
            return res.sendFile(path.join(pub, "index.html"));
          }
          return res.status(404).type("text").send("Not found in preview");
        });
      })
      .catch(function (err) {
        console.error("[builds] preview failed", id, err && err.message);
        if (!res.headersSent) res.status(503).type("text").send("Preview temporarily unavailable — refresh in a moment.");
      });
  });
}

module.exports = { isAdminReq, scrubEmails, fixLegacyCss, fixLegacyCopy, mount, BUILDS_DIR, projectRoot, store };
