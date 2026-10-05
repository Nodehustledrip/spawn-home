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

/* ---------- Providers ----------
 * openai     — paid (OPENAI_API_KEY / AI_API_KEY). Skipped when FREE_AI=1 or when the
 *              account reports no credits (insufficient_quota / credit exhausted / 402).
 * groq       — free tier, no card (GROQ_API_KEY). OpenAI-compatible.
 * openrouter — free ":free" models (OPENROUTER_API_KEY). OpenAI-compatible.
 * When none is usable, /build edits run on offline rules (webedit.js) — still free.
 */
const QUOTA_COOLDOWN_MS = Number(process.env.BUILD_AI_QUOTA_COOLDOWN_MS || 6 * 60 * 60 * 1000);
const QUOTA_CODES = /insufficient_quota|credit|billing|quota|payment|http_402/i;
const quotaDead = {}; // provider id -> timestamp of "no credits" response

function env(name) {
  return String(process.env[name] || "").trim();
}

function freeOnly() {
  return /^(1|true|yes|on)$/i.test(env("FREE_AI"));
}

function openaiKey() {
  return env("OPENAI_API_KEY") || env("AI_API_KEY");
}

function openaiModel() {
  return env("OPENAI_MODEL") || env("AI_MODEL") || "gpt-4o-mini";
}

function openaiBase() {
  const raw = (env("OPENAI_BASE_URL") || env("AI_BASE_URL")).replace(/\/$/, "");
  /* Build AI speaks the OpenAI chat-completions protocol only. */
  if (!raw || /anthropic/i.test(raw)) return "https://api.openai.com/v1";
  return raw;
}

function openaiUsable() {
  const k = openaiKey();
  if (!k) return false;
  if (/^sk-ant-/i.test(k)) return false; // Anthropic key — not usable for this OpenAI path
  if (/^claude/i.test(openaiModel())) return false;
  return true;
}

/** All providers whose keys are present, in preference order (no secrets in the result except via key()). */
function configuredProviders() {
  const list = [];
  if (openaiUsable()) {
    list.push({
      id: "openai",
      label: "OpenAI",
      paid: true,
      base: openaiBase(),
      model: openaiModel(),
      key: openaiKey,
      maxHtml: MAX_HTML_CHARS,
      maxCss: MAX_CSS_CHARS,
      maxTokens: 8000,
      jsonMode: true,
    });
  }
  if (env("GROQ_API_KEY")) {
    list.push({
      id: "groq",
      label: "Groq",
      paid: false,
      base: "https://api.groq.com/openai/v1",
      model: env("GROQ_MODEL") || "llama-3.3-70b-versatile",
      key: function () {
        return env("GROQ_API_KEY");
      },
      /* Free tier is ~12k tokens/minute — keep prompts compact. */
      maxHtml: 14000,
      maxCss: 2500,
      maxTokens: 3500,
      jsonMode: true,
    });
  }
  if (env("OPENROUTER_API_KEY")) {
    list.push({
      id: "openrouter",
      label: "OpenRouter",
      paid: false,
      base: "https://openrouter.ai/api/v1",
      model: env("OPENROUTER_MODEL") || "meta-llama/llama-3.3-70b-instruct:free",
      key: function () {
        return env("OPENROUTER_API_KEY");
      },
      maxHtml: 16000,
      maxCss: 4000,
      maxTokens: 4000,
      jsonMode: false,
      extraHeaders: { "HTTP-Referer": "https://spawnapp.org/build", "X-Title": "Spawn Build" },
    });
  }
  return list;
}

function isQuotaDead(id) {
  const t = quotaDead[id];
  if (!t) return false;
  if (Date.now() - t > QUOTA_COOLDOWN_MS) {
    delete quotaDead[id];
    return false;
  }
  return true;
}

/** Providers that will actually be tried now (respects FREE_AI and no-credit state). */
function activeProviders() {
  return configuredProviders().filter(function (p) {
    if (p.paid && freeOnly()) return false;
    return !isQuotaDead(p.id);
  });
}

function isConfigured() {
  return activeProviders().length > 0;
}

/* Cheap probe so the badge is honest before the first edit: a 1-token call.
 * Returns 429 insufficient_quota (free) when the account has no credits. */
let probeAt = 0;
let probing = null;
const PROBE_TTL_MS = 30 * 60 * 1000;
async function probePaid() {
  const p = configuredProviders().find(function (x) {
    return x.paid;
  });
  if (!p || freeOnly() || isQuotaDead(p.id)) return;
  if (Date.now() - probeAt < PROBE_TTL_MS) return;
  if (probing) return probing;
  probeAt = Date.now();
  probing = (async function () {
    const ctrl = new AbortController();
    const timer = setTimeout(function () {
      ctrl.abort();
    }, 6000);
    try {
      const res = await fetch(p.base + "/chat/completions", {
        method: "POST",
        headers: { Authorization: "Bearer " + p.key(), "Content-Type": "application/json" },
        body: JSON.stringify({ model: p.model, max_tokens: 1, messages: [{ role: "user", content: "ok" }] }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const code = await errorCode(res);
        if (res.status === 402 || QUOTA_CODES.test(code)) {
          quotaDead[p.id] = Date.now();
          lastFailure = { at: Date.now(), code: code, provider: p.id };
        }
      }
    } catch (_) {
      /* network hiccup — leave state unchanged */
    } finally {
      clearTimeout(timer);
      probing = null;
    }
  })();
  return probing;
}

async function errorCode(res) {
  let code = "http_" + res.status;
  try {
    const ej = JSON.parse(await res.text());
    if (ej && ej.error && (ej.error.code || ej.error.type)) code = String(ej.error.code || ej.error.type).slice(0, 60);
  } catch (_) {}
  return code;
}

async function status() {
  try {
    await probePaid();
  } catch (_) {}
  const all = configuredProviders();
  const active = activeProviders();
  const lead = active[0] || null;
  const recent = lastFailure && Date.now() - lastFailure.at < FAILURE_TTL_MS ? lastFailure : null;
  const paidSkipped = all.some(function (p) {
    return p.paid && (freeOnly() || isQuotaDead(p.id));
  });
  let mode = "offline";
  if (lead) mode = lead.paid ? "ai" : "free-cloud";
  const label =
    mode === "ai" ? "AI Build ready" : mode === "free-cloud" ? "Free Build (" + lead.label + ")" : "Free Build (offline)";
  return {
    ok: true,
    configured: !!lead,
    mode: mode,
    free: mode !== "ai",
    label: label,
    degraded: !!(lead && recent && recent.provider === lead.id),
    lastError: recent ? recent.code : null,
    provider: lead ? lead.id : null,
    model: lead ? lead.model : null,
    paidSkipped: paidSkipped,
    paidSkipReason: paidSkipped ? (freeOnly() ? "free_only" : "no_credits") : null,
    message:
      mode === "ai"
        ? "AI Build ready"
        : mode === "free-cloud"
        ? "Free Build — " + lead.label + " free tier, no API credits needed"
        : "Free Build — offline rules, no API credits needed",
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

function buildUserPrompt(root, message, limits) {
  limits = limits || {};
  const html = truncate(readMaybe(root, "public/index.html"), limits.maxHtml || MAX_HTML_CHARS);
  const css = truncate(readMaybe(root, "public/styles.css"), limits.maxCss || MAX_CSS_CHARS);
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

function extractJson(content) {
  try {
    return JSON.parse(content);
  } catch (_) {}
  const s = String(content || "");
  const i = s.indexOf("{");
  const j = s.lastIndexOf("}");
  if (i !== -1 && j > i) return JSON.parse(s.slice(i, j + 1));
  throw new Error("Model did not return JSON");
}

async function callProvider(p, userText) {
  const ctrl = new AbortController();
  const timer = setTimeout(function () {
    ctrl.abort();
  }, TIMEOUT_MS);
  try {
    const body = {
      model: p.model,
      temperature: 0.2,
      max_tokens: p.maxTokens,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userText },
      ],
    };
    if (p.jsonMode) body.response_format = { type: "json_object" };
    const res = await fetch(p.base + "/chat/completions", {
      method: "POST",
      headers: Object.assign(
        { Authorization: "Bearer " + p.key(), "Content-Type": "application/json" },
        p.extraHeaders || {}
      ),
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const code = await errorCode(res);
      const e = new Error(p.id + " HTTP " + res.status + " (" + code + ")");
      e.httpStatus = res.status;
      e.code = code;
      throw e;
    }
    const data = JSON.parse(await res.text());
    const content =
      data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error("Empty model response");
    return extractJson(content);
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
 * Try a model edit, walking providers in order (paid → free cloud).
 * Resolves to:
 *   { ok:true, mode:"ai"|"free-cloud", provider, reply, changes } — files written
 *   { ok:false, reason, reply? }                                  — caller falls back to offline rules
 */
async function applyAiEdit(root, message, ip) {
  const providers = activeProviders();
  if (!providers.length) return { ok: false, reason: "not_configured" };
  if (!rateOk(ip || "unknown")) return { ok: false, reason: "rate_limited" };
  let lastReason = "model_error";
  for (const p of providers) {
    const prompt = buildUserPrompt(root, message, p);
    let out;
    try {
      out = await callProvider(p, prompt.text);
    } catch (err) {
      const code = (err && err.code) || (err && err.name === "AbortError" ? "timeout" : "model_error");
      console.error("[build-ai] " + p.id + " call failed:", (err && err.message) || "error");
      lastFailure = { at: Date.now(), code: code, provider: p.id };
      if (p.paid && (err.httpStatus === 402 || QUOTA_CODES.test(code))) quotaDead[p.id] = Date.now();
      lastReason = "model_error";
      continue;
    }
    if (lastFailure && lastFailure.provider === p.id) lastFailure = null;
    const plan_ = plan(root, out, prompt.truncated);
    const reply = String((out && out.reply) || "").slice(0, 600).trim();
    if (!Object.keys(plan_.writes).length) {
      return { ok: false, reason: "no_changes", reply: reply, skipped: plan_.skipped, provider: p.id };
    }
    commit(root, plan_.writes);
    return {
      ok: true,
      mode: p.paid ? "ai" : "free-cloud",
      provider: p.id,
      reply:
        (reply || "Applied your change.") +
        (plan_.skipped.length ? " (Skipped " + plan_.skipped.length + " unsafe/invalid edit(s).)" : ""),
      changes: plan_.changes,
      files: Object.keys(plan_.writes),
    };
  }
  return { ok: false, reason: lastReason };
}

module.exports = { applyAiEdit, status, isConfigured, activeProviders, _plan: plan };
