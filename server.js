"use strict";
const express = require("express");
const path = require("path");
const fs = require("fs");
const app = express();
const ai = require("./ai");
const PORT = process.env.PORT || 3000;

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const WAITLIST_FILE = path.join(DATA_DIR, "waitlist.json");

/* Same project write key as public/analytics.js — durable dual-write for ephemeral disk */
const POSTHOG_KEY =
  process.env.POSTHOG_KEY || "phc_nqATxCRsk9kKbZCNF3LHqdGzQYK97WzTn8n7Ntmi8QzJ";
const POSTHOG_HOST = process.env.POSTHOG_HOST || "https://us.i.posthog.com";
const WAITLIST_ADMIN_TOKEN = process.env.WAITLIST_ADMIN_TOKEN || "";

function ensureDataDir() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (_) { /* ignore */ }
}

function readWaitlist() {
  ensureDataDir();
  try {
    const raw = fs.readFileSync(WAITLIST_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function writeWaitlist(entries) {
  ensureDataDir();
  const tmp = WAITLIST_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, WAITLIST_FILE);
}

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

/** Fire-and-forget durable copy via PostHog Capture API (survives redeploys). */
function dualWritePostHog(entry) {
  if (!POSTHOG_KEY || !entry || !entry.email) return;
  const body = JSON.stringify({
    api_key: POSTHOG_KEY,
    event: "waitlist_signup",
    distinct_id: entry.email,
    properties: {
      email: entry.email,
      source: entry.source || "web",
      createdAt: entry.createdAt || new Date().toISOString(),
      $lib: "spawn-home-server",
    },
  });
  fetch(POSTHOG_HOST.replace(/\/$/, "") + "/capture/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body,
  })
    .then(function (r) {
      if (!r.ok) {
        console.error("[waitlist] posthog capture status", r.status);
      } else {
        console.log("[waitlist] posthog dual-write ok", entry.email);
      }
    })
    .catch(function (err) {
      console.error("[waitlist] posthog dual-write failed", err && err.message);
    });
}

function checkWaitlistAdmin(req) {
  if (!WAITLIST_ADMIN_TOKEN) return false;
  const header = req.headers["x-waitlist-token"];
  const query = req.query && req.query.token;
  const provided =
    (typeof header === "string" && header) ||
    (typeof query === "string" && query) ||
    "";
  return provided.length > 0 && provided === WAITLIST_ADMIN_TOKEN;
}

/** Simple in-memory rate limit: max N posts per IP per window. */
const RATE_LIMIT = { windowMs: 60 * 1000, max: 8 };
const rateBuckets = new Map();

function rateLimit(ip) {
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.start > RATE_LIMIT.windowMs) {
    bucket = { start: now, count: 0 };
    rateBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT.max;
}

app.use(express.json({ limit: "16kb" }));
app.use(function (_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "img-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "script-src 'self' 'unsafe-inline' https://*.posthog.com https://us-assets.i.posthog.com https://browser.sentry-cdn.com",
      "connect-src 'self' https://*.posthog.com https://us.i.posthog.com https://*.ingest.us.sentry.io https://*.ingest.sentry.io",
      "worker-src 'self' blob: data:",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'self'",
    ].join("; ")
  );
  next();
});

const PUBLIC_DIR = path.join(__dirname, "public");

/* Clean marketing URLs: /how → how.html; /how.html → 301 /how */
const CLEAN_PAGES = ["how", "product", "access", "privacy", "faq", "changelog", "tour", "showcase", "why"];
const CLEAN_SET = new Set(CLEAN_PAGES);

/* Trailing slash → canonical (must run before page routes; Express non-strict
   routing would otherwise treat /how/ as /how and skip a separate slash route). */
app.use(function (req, res, next) {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  const pathOnly = (req.path || "").split("?")[0];
  const m = pathOnly.match(/^\/(how|product|access|privacy|faq|changelog|tour|showcase|why)\/$/);
  if (m && CLEAN_SET.has(m[1])) {
    return res.redirect(301, "/" + m[1]);
  }
  next();
});

CLEAN_PAGES.forEach(function (slug) {
  const file = path.join(PUBLIC_DIR, slug + ".html");
  app.get("/" + slug, function (_req, res) {
    res.sendFile(file);
  });
  app.get("/" + slug + ".html", function (_req, res) {
    res.redirect(301, "/" + slug);
  });
});

app.use(express.static(PUBLIC_DIR));
ai.mount(app);

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, app: "Spawn Home", waitlist: true })
);

app.get("/api/waitlist", function (req, res) {
  if (!checkWaitlistAdmin(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  let entries = [];
  try {
    entries = readWaitlist();
  } catch (err) {
    console.error("[waitlist] export read failed", err && err.message);
  }
  return res.json({
    ok: true,
    count: entries.length,
    emails: entries,
    note:
      "Local JSON is best-effort cache (ephemeral on free Render). Durable copy is PostHog event waitlist_signup (distinct_id=email).",
  });
});

app.post("/api/waitlist", function (req, res) {
  const ip =
    (req.headers["x-forwarded-for"] &&
      String(req.headers["x-forwarded-for"]).split(",")[0].trim()) ||
    req.ip ||
    "unknown";

  if (!rateLimit(ip)) {
    return res.status(429).json({ ok: false, error: "Too many requests. Try again shortly." });
  }

  const body = req.body || {};
  /* Honeypot: bots fill hidden company field */
  if (body.company || body.website || body.url) {
    return res.json({ ok: true, duplicate: false });
  }

  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) {
    return res.status(400).json({ ok: false, error: "Enter a valid email." });
  }

  let entries;
  try {
    entries = readWaitlist();
  } catch (err) {
    console.error("[waitlist] read failed", err && err.message);
    return res.status(500).json({ ok: false, error: "Could not save. Try again." });
  }

  const exists = entries.some(function (e) {
    return e && normalizeEmail(e.email) === email;
  });
  if (exists) {
    console.log("[waitlist] duplicate", email);
    return res.json({ ok: true, duplicate: true });
  }

  const entry = {
    email: email,
    createdAt: new Date().toISOString(),
    ip: ip,
    source: typeof body.source === "string" ? body.source.slice(0, 64) : "web",
  };
  entries.push(entry);

  try {
    writeWaitlist(entries);
  } catch (err) {
    console.error("[waitlist] write failed", err && err.message);
    return res.status(500).json({ ok: false, error: "Could not save. Try again." });
  }

  /* Durable dual-write (non-blocking); local JSON remains fast-path cache */
  dualWritePostHog(entry);

  console.log("[waitlist] new signup", email, "total=", entries.length);
  return res.status(201).json({ ok: true, duplicate: false });
});

app.listen(PORT, "0.0.0.0", () =>
  console.log("Spawn Home listening on " + PORT)
);
