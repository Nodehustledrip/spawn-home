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
const buildai = require("./buildai");
const history = require("./buildhistory");
const store = require("./buildstore");
const buildzip = require("./buildzip");

const BUILDS_DIR = process.env.BUILDS_DIR || path.join(__dirname, "data", "builds");
const COOKIE = "spawn_build_sid";
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // seconds
const OWNER_HEADER = "x-build-owner";
const OWNER_RE = /^[A-Za-z0-9_-]{24,64}$/;

/* Abuse limits — generous for real people, tight for scripts. */
const MAX_BUILDS_PER_OWNER = Number(process.env.BUILD_MAX_PER_OWNER || 24);
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
async function loadOwned(req, res) {
  const id = String(req.params.id || "");
  const root = projectRoot(id);
  if (!root) {
    res.status(404).json({ ok: false, error: "Build not found" });
    return null;
  }
  const me = ownerKey(req, res);
  const source = await store.hydrate(id, root);
  if (!source) {
    res.status(404).json({ ok: false, error: "Build not found" });
    return null;
  }
  const owner = await store.ownerOf(id, root);
  if (!owner || owner !== me) {
    res.status(403).json({ ok: false, error: "This build belongs to another browser. Open it from the browser you made it in." });
    return null;
  }
  return { id: id, root: root, owner: owner, source: source };
}

function wrap(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(function (err) {
      const status = err.status || 500;
      console.error("[builds]", req.method, req.path, "failed:", (err && err.message) || err);
      if (res.headersSent) return;
      res.status(status).json({ ok: false, error: status < 500 ? err.message : "Something went wrong — try again." });
    });
  };
}

function dualWriteBuild(event, props) {
  if (!POSTHOG_KEY) return;
  const body = JSON.stringify({
    api_key: POSTHOG_KEY,
    event: event,
    distinct_id: props.sessionId || props.id || "anon",
    properties: Object.assign({ $lib: "spawn-home-builds" }, props || {}),
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
  "On-site Build creates, edits, previews, and exports a zip. A lasting public URL or custom domain still needs Spawn desktop (Ship → Open to the internet).";

function mount(app) {
  ensureDir();
  store.init().catch(function (err) {
    console.error("[builds] store init failed", err && err.message);
  });

  app.get("/api/builds/templates", function (_req, res) {
    res.json({ ok: true, templates: webgen.listTemplates() });
  });

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
    const me = ownerKey(req, res);
    const builds = await store.listByOwner(me, BUILDS_DIR, MAX_BUILDS_PER_OWNER);
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
        maxBuilds: MAX_BUILDS_PER_OWNER,
        note: LIMITS_NOTE,
      },
    });
  }));

  app.post("/api/builds", wrap(async function (req, res) {
    const ip = clientIp(req);
    if (!hit("c", ip, CREATE_RATE) || !hit("cd", ip, CREATE_DAILY)) {
      return res.status(429).json({ ok: false, error: "You're creating builds quickly — give it a few minutes, or keep editing an existing one." });
    }
    await store.init();
    const me = ownerKey(req, res);

    const body = req.body || {};
    if (body.company || body.website || body.url) {
      return res.json({ ok: true, honeypot: true });
    }
    const name = String(body.name || "").replace(/\s+/g, " ").trim().slice(0, 64);
    const description = String(body.description || "").replace(/\s+/g, " ").trim().slice(0, 240);
    if (!name) return res.status(400).json({ ok: false, error: "App name is required" });

    const mine = await store.countByOwner(me, BUILDS_DIR);
    if (mine >= MAX_BUILDS_PER_OWNER) {
      return res.status(400).json({
        ok: false,
        error: "You have " + mine + " builds — the most this browser can keep. Delete one from My builds to make room.",
      });
    }
    const total = await store.countAll(BUILDS_DIR);
    if (total.count >= MAX_TOTAL_BUILDS) {
      console.error("[builds] global build cap reached", total.count);
      return res.status(503).json({ ok: false, error: "On-site Build is at capacity right now — try again later." });
    }

    const accent = /^#[0-9a-f]{3,8}$/i.test(String(body.accent || "")) ? body.accent : "#5eead4";
    const result = webgen.createBuild(
      { name: name, template: body.template, description: description, accent: accent },
      BUILDS_DIR
    );
    try {
      await store.save(result.id, me, result.path);
    } catch (err) {
      fs.rmSync(result.path, { recursive: true, force: true });
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
    return res.status(201).json({ ok: true, build: summarizeBuild(result.id) });
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
      limits: { previewOnly: true, note: "Preview at /preview/" + b.id + "/ — lasting public URL needs Spawn desktop." },
    });
  }));

  app.delete("/api/builds/:id", wrap(async function (req, res) {
    if (!rateOk(clientIp(req))) {
      return res.status(429).json({ ok: false, error: "Too many requests. Try again shortly." });
    }
    await store.init();
    const b = await loadOwned(req, res);
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
          touchMeta(root);
          await store.save(id, b.owner, root, { edited: true });
        }
        return res.json({
          ok: true,
          reply: restored ? "Undid the last edit." : "Nothing to undo yet.",
          changes: restored ? [{ action: "undo", detail: "Restored previous version" }] : [],
          mode: "offline",
          saved: store.mode(),
          previewPath: "/preview/" + id + "/",
          build: summarizeBuild(id),
        });
      }
      history.snapshot(root);
      let ai = null;
      if (wantAi) {
        try {
          ai = await buildai.applyAiEdit(root, message, ip);
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
        else if (ai && ai.reason === "rate_limited") {
          out.reply = (out.reply || "") + " (Cloud model is busy — used free offline rules.)";
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
        saved: store.mode(),
        previewPath: "/preview/" + id + "/",
        build: summarizeBuild(id),
      });
    } finally {
      editing.delete(id);
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
    if (!root) return res.status(404).type("text").send("Preview not found");
    store
      .init()
      .then(function () {
        return store.hydrate(id, root);
      })
      .then(function (source) {
        if (!source) return res.status(404).type("text").send("Preview not found");
        const pub = path.join(root, "public");
        if (!fs.existsSync(pub)) return res.status(404).type("text").send("No public assets");
        /* Soft X-Robots so previews are not indexed as real apps */
        res.setHeader("X-Robots-Tag", "noindex, nofollow");
        res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
        res.setHeader("X-Build-Source", source === "postgres" ? "postgres" : store.mode() + "-cache");
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

module.exports = { mount, BUILDS_DIR, projectRoot, store };
