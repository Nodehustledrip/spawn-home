"use strict";

/**
 * On-site Build: create → preview → edit.
 * Projects live under data/builds/<id>/; session cookie owns the list.
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

const BUILDS_DIR = process.env.BUILDS_DIR || path.join(__dirname, "data", "builds");
const INDEX_FILE = path.join(BUILDS_DIR, "_sessions.json");
const COOKIE = "spawn_build_sid";
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // seconds
const MAX_BUILDS_PER_SESSION = 12;

const POSTHOG_KEY =
  process.env.POSTHOG_KEY || "phc_nqATxCRsk9kKbZCNF3LHqdGzQYK97WzTn8n7Ntmi8QzJ";
const POSTHOG_HOST = process.env.POSTHOG_HOST || "https://us.i.posthog.com";

const RATE = { windowMs: 60 * 1000, max: 20 };
const rateBuckets = new Map();
const editing = new Set();

function ensureDir() {
  try {
    fs.mkdirSync(BUILDS_DIR, { recursive: true });
  } catch (_) {}
}

function rateOk(ip) {
  const now = Date.now();
  let b = rateBuckets.get(ip);
  if (!b || now - b.start > RATE.windowMs) {
    b = { start: now, count: 0 };
    rateBuckets.set(ip, b);
  }
  b.count += 1;
  return b.count <= RATE.max;
}

function clientIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  return xf || req.ip || "unknown";
}

function readSessions() {
  ensureDir();
  try {
    const raw = fs.readFileSync(INDEX_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writeSessions(map) {
  ensureDir();
  const tmp = INDEX_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(map, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, INDEX_FILE);
}

function parseCookies(req) {
  const out = {};
  const raw = String(req.headers.cookie || "");
  raw.split(";").forEach(function (part) {
    const i = part.indexOf("=");
    if (i === -1) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
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

function getOrCreateSession(req, res) {
  const cookies = parseCookies(req);
  let sid = cookies[COOKIE];
  if (!sid || !/^[a-zA-Z0-9_-]{16,64}$/.test(sid)) {
    sid = crypto.randomBytes(18).toString("base64url");
    setSessionCookie(res, sid);
  }
  return sid;
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

function sessionOwns(sid, id) {
  const map = readSessions();
  const list = (map[sid] && map[sid].builds) || [];
  return list.indexOf(id) !== -1;
}

function addToSession(sid, id) {
  const map = readSessions();
  if (!map[sid]) map[sid] = { builds: [], createdAt: new Date().toISOString() };
  const list = map[sid].builds || [];
  if (list.indexOf(id) === -1) list.unshift(id);
  map[sid].builds = list.slice(0, MAX_BUILDS_PER_SESSION);
  map[sid].updatedAt = new Date().toISOString();
  writeSessions(map);
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
  };
}

function mount(app) {
  ensureDir();

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

  app.get("/api/builds", function (req, res) {
    const sid = getOrCreateSession(req, res);
    const map = readSessions();
    const ids = ((map[sid] && map[sid].builds) || []).filter(function (id) {
      const root = projectRoot(id);
      return root && fs.existsSync(root);
    });
    const builds = ids.map(function (id) {
      return summarizeBuild(id);
    });
    res.json({
      ok: true,
      builds: builds,
      limits: {
        previewOnly: true,
        publicUrl: false,
        customDomain: false,
        note:
          "On-site Build creates, edits, and previews. A lasting public URL or custom domain still needs Spawn desktop (Ship → Open to the internet).",
      },
    });
  });

  app.post("/api/builds", function (req, res) {
    const ip = clientIp(req);
    if (!rateOk(ip)) {
      return res.status(429).json({ ok: false, error: "Too many requests. Try again shortly." });
    }
    const sid = getOrCreateSession(req, res);
    const map = readSessions();
    const existing = ((map[sid] && map[sid].builds) || []).length;
    if (existing >= MAX_BUILDS_PER_SESSION) {
      return res.status(400).json({
        ok: false,
        error: "Session limit reached (" + MAX_BUILDS_PER_SESSION + " builds). Open an existing one or clear older builds on desktop.",
      });
    }

    const body = req.body || {};
    if (body.company || body.website || body.url) {
      return res.json({ ok: true, honeypot: true });
    }

    try {
      const result = webgen.createBuild(
        {
          name: body.name,
          template: body.template,
          description: body.description || "",
          accent: body.accent || "#5eead4",
        },
        BUILDS_DIR
      );
      addToSession(sid, result.id);
      dualWriteBuild("build_created", {
        sessionId: sid,
        id: result.id,
        name: result.name,
        template: result.template,
        source: "web",
        createdAt: new Date().toISOString(),
      });
      console.log("[builds] created", result.id, result.name, result.template);
      return res.status(201).json({
        ok: true,
        build: summarizeBuild(result.id, { name: result.name, template: result.template, createdAt: new Date().toISOString() }),
      });
    } catch (err) {
      const status = err.status || 500;
      console.error("[builds] create failed", err && err.message);
      return res.status(status).json({ ok: false, error: err.message || "Could not create build" });
    }
  });

  app.get("/api/builds/:id", function (req, res) {
    const sid = getOrCreateSession(req, res);
    const id = String(req.params.id || "");
    const root = projectRoot(id);
    if (!root || !fs.existsSync(root)) {
      return res.status(404).json({ ok: false, error: "Build not found" });
    }
    if (!sessionOwns(sid, id)) {
      return res.status(403).json({ ok: false, error: "This build belongs to another session" });
    }
    const meta = readMeta(id);
    const files = [];
    try {
      const pub = path.join(root, "public");
      if (fs.existsSync(pub)) {
        fs.readdirSync(pub).forEach(function (f) {
          files.push("public/" + f);
        });
      }
    } catch (_) {}
    return res.json({
      ok: true,
      build: summarizeBuild(id, meta),
      files: files,
      limits: {
        previewOnly: true,
        note: "Preview at /preview/" + id + "/ — lasting public URL needs Spawn desktop.",
      },
    });
  });

  app.post("/api/builds/:id/edit", function (req, res) {
    const ip = clientIp(req);
    if (!rateOk(ip)) {
      return res.status(429).json({ ok: false, error: "Too many requests. Try again shortly." });
    }
    const sid = getOrCreateSession(req, res);
    const id = String(req.params.id || "");
    const root = projectRoot(id);
    if (!root || !fs.existsSync(root)) {
      return res.status(404).json({ ok: false, error: "Build not found" });
    }
    if (!sessionOwns(sid, id)) {
      return res.status(403).json({ ok: false, error: "This build belongs to another session" });
    }
    const message = String((req.body && (req.body.message || req.body.text)) || "").trim();
    if (!message) return res.status(400).json({ ok: false, error: "Message required" });
    if (message.length > 2000) return res.status(400).json({ ok: false, error: "Message too long" });
    /* Prefer a model when one is usable (paid with credits, or free Groq/OpenRouter);
     * body.ai === false forces offline rules. Offline rules are always free. */
    const wantAi = !(req.body && req.body.ai === false) && buildai.isConfigured();
    if (editing.has(id)) {
      return res.status(409).json({ ok: false, error: "An edit is already running for this build — one moment." });
    }
    editing.add(id);
    (async function () {
      if (/^\s*(undo|revert|go back|undo (?:that|last(?: change| edit)?))\s*[.!]?\s*$/i.test(message)) {
        const restored = history.restore(root);
        return res.json({
          ok: true,
          reply: restored ? "Undid the last edit." : "Nothing to undo yet.",
          changes: restored ? [{ action: "undo", detail: "Restored previous version" }] : [],
          mode: "offline",
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
      if (ai && ai.ok) {
        out = ai;
      } else {
        out = webedit.applyEdit(root, message);
        const real = (out.changes || []).filter(function (c) {
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
      dualWriteBuild("build_edited", {
        sessionId: sid,
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
        previewPath: "/preview/" + id + "/",
        build: summarizeBuild(id),
      });
    })().catch(function (err) {
      const status = err.status || 500;
      if (!res.headersSent) res.status(status).json({ ok: false, error: err.message || "Edit failed" });
    }).finally(function () {
      editing.delete(id);
    });
  });

  /* Demo lead endpoint used by generated preview forms (absolute /api/lead) */
  app.post("/api/lead", function (req, res) {
    console.log("[lead-demo]", {
      at: new Date().toISOString(),
      keys: Object.keys(req.body || {}),
    });
    return res.json({ ok: true, demo: true });
  });

  /* Live preview — static files only; no claim of public app hosting */
  app.use("/preview/:id", function (req, res, next) {
    const id = String(req.params.id || "");
    const root = projectRoot(id);
    if (!root || !fs.existsSync(root)) {
      return res.status(404).type("text").send("Preview not found");
    }
    const pub = path.join(root, "public");
    if (!fs.existsSync(pub)) {
      return res.status(404).type("text").send("No public assets");
    }
    /* Soft X-Robots so previews are not indexed as real apps */
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    express.static(pub, {
      index: ["index.html"],
      fallthrough: true,
      etag: true,
    })(req, res, function () {
      /* Try index for bare /preview/:id/ */
      if (req.path === "/" || req.path === "") {
        return res.sendFile(path.join(pub, "index.html"));
      }
      return res.status(404).type("text").send("Not found in preview");
    });
  });
}

module.exports = { mount, BUILDS_DIR, projectRoot };
