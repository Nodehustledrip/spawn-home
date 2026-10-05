"use strict";

/**
 * Build AI — model-backed edits for on-site /build.
 * Server-side only: the API key never leaves this process and is never logged.
 * Returns null-ish results on any failure so callers can fall back to webedit rules.
 */
const fs = require("fs");
const path = require("path");

const MAX_HTML_CHARS = 24000;
const MAX_CSS_CHARS = 14000;
const MAX_OUT_FILE = 200 * 1024;
const TIMEOUT_MS = 60000;

/* Per-IP + global rate limits for model calls (cost guard). */
const IP_WINDOW_MS = 60 * 1000;
const IP_MAX = 6;
const GLOBAL_WINDOW_MS = 60 * 60 * 1000;
const GLOBAL_MAX = Number(process.env.BUILD_AI_HOURLY_MAX || 300);
const ipHits = new Map();
let globalHits = [];
/* Last provider failure (no secrets) so /ai-status can report degraded state honestly. */
let lastFailure = null;
const FAILURE_TTL_MS = 10 * 60 * 1000;

const ALLOWED_PATH = /^public\/[a-z0-9][a-z0-9_-]{0,40}\.(html|css)$/i;

function apiKey() {
  return String(process.env.OPENAI_API_KEY || process.env.AI_API_KEY || "").trim();
}

function model() {
  return String(process.env.OPENAI_MODEL || process.env.AI_MODEL || "gpt-4o-mini").trim();
}

function baseUrl() {
  const raw = String(process.env.OPENAI_BASE_URL || process.env.AI_BASE_URL || "").trim().replace(/\/$/, "");
  /* Build AI speaks the OpenAI chat-completions protocol only. */
  if (!raw || /anthropic/i.test(raw)) return "https://api.openai.com/v1";
  return raw;
}

function isConfigured() {
  const k = apiKey();
  if (!k) return false;
  if (/^sk-ant-/i.test(k)) return false; // Anthropic key — not usable for this OpenAI path
  if (/^claude/i.test(model())) return false;
  return true;
}

function status() {
  const configured = isConfigured();
  const recent = lastFailure && Date.now() - lastFailure.at < FAILURE_TTL_MS ? lastFailure : null;
  return {
    ok: true,
    configured: configured,
    degraded: !!(configured && recent),
    lastError: configured && recent ? recent.code : null,
    provider: configured ? "openai" : null,
    model: configured ? model() : null,
    message: configured ? "AI Build ready" : "Build uses offline rules (no AI key on this server)",
  };
}

function rateOk(ip) {
  const now = Date.now();
  globalHits = globalHits.filter(function (t) {
    return now - t < GLOBAL_WINDOW_MS;
  });
  if (globalHits.length >= GLOBAL_MAX) return false;
  let arr = (ipHits.get(ip) || []).filter(function (t) {
    return now - t < IP_WINDOW_MS;
  });
  if (arr.length >= IP_MAX) {
    ipHits.set(ip, arr);
    return false;
  }
  arr.push(now);
  ipHits.set(ip, arr);
  globalHits.push(now);
  if (ipHits.size > 5000) ipHits.clear();
  return true;
}

function readMaybe(root, rel) {
  try {
    return fs.readFileSync(path.join(root, rel), "utf8");
  } catch (_) {
    return null;
  }
}

function truncate(s, max) {
  if (s == null) return { text: "", truncated: false };
  if (s.length <= max) return { text: s, truncated: false };
  return { text: s.slice(0, max) + "\n<!-- …truncated… -->", truncated: true };
}

const SYSTEM = [
  "You are Spawn Build, an expert front-end engineer editing a small static website.",
  "The site lives in public/ (index.html + styles.css, maybe a few more .html/.css pages).",
  "Apply the user's requested change with high quality, matching the existing design system and CSS variables.",
  "Respond with ONLY a JSON object of this shape:",
  '{"reply":"one or two sentences describing what you changed",',
  ' "patches":[{"path":"public/index.html","find":"exact existing substring","replace":"new text"}],',
  ' "files":[{"path":"public/index.html","content":"full new file content"}]}',
  "Rules:",
  "- Prefer surgical patches. Each `find` must be an exact, unique substring copied from the current file.",
  "- Use `files` (full content) only for brand-new pages or when rewriting a whole small file. Never send full content for a file marked TRUNCATED.",
  "- Allowed paths: public/<name>.html and public/<name>.css only. No JavaScript files.",
  "- Do NOT add <script> tags, inline event handlers (onclick=…), javascript: URLs, iframes, objects, or embeds.",
  "- Keep existing scripts, forms, and links working. Keep HTML valid.",
  "- If the request is not a website change, or is unsafe, return empty patches/files and explain in reply.",
].join("\n");

function buildUserPrompt(root, message) {
  const html = truncate(readMaybe(root, "public/index.html"), MAX_HTML_CHARS);
  const css = truncate(readMaybe(root, "public/styles.css"), MAX_CSS_CHARS);
  let others = [];
  try {
    others = fs
      .readdirSync(path.join(root, "public"))
      .filter(function (f) {
        return f !== "index.html" && f !== "styles.css";
      })
      .slice(0, 20);
  } catch (_) {}
  return {
    truncated: { "public/index.html": html.truncated, "public/styles.css": css.truncated },
    text:
      "User request:\n" +
      String(message).slice(0, 2000) +
      "\n\nOther files in public/: " +
      (others.length ? others.join(", ") : "(none)") +
      "\n\n=== public/index.html" +
      (html.truncated ? " (TRUNCATED)" : "") +
      " ===\n" +
      html.text +
      "\n\n=== public/styles.css" +
      (css.truncated ? " (TRUNCATED)" : "") +
      " ===\n" +
      css.text,
  };
}

async function callOpenAI(userText) {
  const ctrl = new AbortController();
  const timer = setTimeout(function () {
    ctrl.abort();
  }, TIMEOUT_MS);
  try {
    const res = await fetch(baseUrl() + "/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model(),
        temperature: 0.2,
        max_tokens: 8000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userText },
        ],
      }),
      signal: ctrl.signal,
    });
    const raw = await res.text();
    if (!res.ok) {
      let code = "http_" + res.status;
      try {
        const ej = JSON.parse(raw);
        if (ej && ej.error && (ej.error.code || ej.error.type)) code = String(ej.error.code || ej.error.type).slice(0, 60);
      } catch (_) {}
      const e = new Error("Model HTTP " + res.status + " (" + code + ")");
      e.httpStatus = res.status;
      e.code = code;
      throw e;
    }
    const data = JSON.parse(raw);
    const content =
      data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error("Empty model response");
    return JSON.parse(content);
  } finally {
    clearTimeout(timer);
  }
}

const RISKY = [/<script\b/gi, /\son[a-z]+\s*=/gi, /javascript:/gi, /<(iframe|object|embed)\b/gi, /<base\b/gi];

function riskyIncrease(before, after) {
  before = before || "";
  for (const re of RISKY) {
    const a = (before.match(re) || []).length;
    const b = (after.match(re) || []).length;
    if (b > a) return true;
  }
  return false;
}

function countOccur(hay, needle) {
  if (!needle) return 0;
  let n = 0;
  let i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) {
    n += 1;
    i += needle.length;
  }
  return n;
}

/**
 * Validate the model JSON against the project and compute new file contents.
 * Nothing is written here; returns { writes: {rel: content}, changes, skipped }.
 */
function plan(root, out, truncatedMap) {
  const working = {};
  const changes = [];
  const skipped = [];

  function current(rel) {
    if (Object.prototype.hasOwnProperty.call(working, rel)) return working[rel];
    return readMaybe(root, rel);
  }

  const files = Array.isArray(out && out.files) ? out.files.slice(0, 6) : [];
  const patches = Array.isArray(out && out.patches) ? out.patches.slice(0, 40) : [];

  files.forEach(function (f) {
    const rel = String((f && f.path) || "").replace(/^\/+/, "");
    const content = typeof (f && f.content) === "string" ? f.content : null;
    if (!ALLOWED_PATH.test(rel) || content == null) return skipped.push(rel || "(no path)");
    if (truncatedMap[rel]) return skipped.push(rel + " (truncated: full rewrite refused)");
    if (content.length > MAX_OUT_FILE || !content.trim()) return skipped.push(rel);
    if (/\.html$/i.test(rel) && !/<body[\s>]/i.test(content)) return skipped.push(rel + " (invalid html)");
    const before = current(rel);
    if (riskyIncrease(before, content)) return skipped.push(rel + " (unsafe content)");
    working[rel] = content;
    changes.push({ action: before == null ? "create" : "rewrite", file: rel, detail: (before == null ? "created " : "rewrote ") + rel });
  });

  patches.forEach(function (p) {
    const rel = String((p && p.path) || "").replace(/^\/+/, "");
    const find = typeof (p && p.find) === "string" ? p.find : "";
    const repl = typeof (p && p.replace) === "string" ? p.replace : null;
    if (!ALLOWED_PATH.test(rel) || !find || repl == null) return skipped.push(rel || "(no path)");
    const before = current(rel);
    if (before == null) return skipped.push(rel + " (missing)");
    if (countOccur(before, find) !== 1) return skipped.push(rel + " (patch anchor not unique/found)");
    const next = before.replace(find, function () {
      return repl;
    });
    if (next.length > MAX_OUT_FILE) return skipped.push(rel + " (too large)");
    if (riskyIncrease(before, next)) return skipped.push(rel + " (unsafe content)");
    working[rel] = next;
    changes.push({ action: "patch", file: rel, detail: "patched " + rel });
  });

  /* Drop no-op writes */
  Object.keys(working).forEach(function (rel) {
    if (working[rel] === readMaybe(root, rel)) delete working[rel];
  });

  return { writes: working, changes: changes, skipped: skipped };
}

function commit(root, writes) {
  Object.keys(writes).forEach(function (rel) {
    const full = path.join(root, rel);
    if (!full.startsWith(path.join(root, "public") + path.sep)) return;
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const tmp = full + ".tmp";
    fs.writeFileSync(tmp, writes[rel], "utf8");
    fs.renameSync(tmp, full);
  });
  try {
    const metaPath = path.join(root, "forge.json");
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      meta.updatedAt = new Date().toISOString();
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
    }
  } catch (_) {}
}

/**
 * Try an AI edit. Resolves to:
 *   { ok:true, mode:"ai", reply, changes }        — files written
 *   { ok:false, reason, reply? }                   — caller should fall back to offline rules
 */
async function applyAiEdit(root, message, ip) {
  if (!isConfigured()) return { ok: false, reason: "not_configured" };
  if (!rateOk(ip || "unknown")) return { ok: false, reason: "rate_limited" };
  const prompt = buildUserPrompt(root, message);
  let out;
  try {
    out = await callOpenAI(prompt.text);
  } catch (err) {
    console.error("[build-ai] model call failed:", (err && err.message) || "error");
    lastFailure = { at: Date.now(), code: (err && err.code) || (err && err.name === "AbortError" ? "timeout" : "model_error") };
    return { ok: false, reason: "model_error" };
  }
  lastFailure = null;
  const p = plan(root, out, prompt.truncated);
  const reply = String((out && out.reply) || "").slice(0, 600).trim();
  if (!Object.keys(p.writes).length) {
    return { ok: false, reason: "no_changes", reply: reply, skipped: p.skipped };
  }
  commit(root, p.writes);
  return {
    ok: true,
    mode: "ai",
    reply: (reply || "Applied your change.") + (p.skipped.length ? " (Skipped " + p.skipped.length + " unsafe/invalid edit(s).)" : ""),
    changes: p.changes,
    files: Object.keys(p.writes),
  };
}

module.exports = { applyAiEdit, status, isConfigured, _plan: plan };
