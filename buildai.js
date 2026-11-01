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
const QUOTA_CODES = /insufficient_quota|credit|billing|quota|payment|http_402|resource_exhausted|http_429/i;
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
  if (env("GEMINI_API_KEY")) {
    /* Google AI Studio free tier (no billing). Native generateContent protocol. */
    list.push({
      id: "gemini",
      label: "Cloud AI",
      kind: "gemini",
      paid: false,
      base: "https://generativelanguage.googleapis.com/v1beta",
      model: env("GEMINI_MODEL") || "gemini-3-flash-preview",
      fallbackModel: env("GEMINI_FALLBACK_MODEL") || "",
      key: function () {
        return env("GEMINI_API_KEY");
      },
      maxHtml: 40000,
      maxCss: 24000,
      maxTokens: 24000,
      jsonMode: true,
    });
  }
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

const FREE_QUOTA_COOLDOWN_MS = Number(process.env.AI_QUOTA_COOLDOWN_MS || 15 * 60 * 1000);
function isQuotaDead(id) {
  const t = quotaDead[id];
  if (!t) return false;
  const p = configuredProviders().find(function (x) { return x.id === id; });
  const ttl = p && !p.paid ? FREE_QUOTA_COOLDOWN_MS : QUOTA_COOLDOWN_MS;
  if (Date.now() - t > ttl) {
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
    if (ej && ej.error && (ej.error.status || ej.error.code || ej.error.type))
      code = String((typeof ej.error.code === "string" && ej.error.code) || ej.error.status || ej.error.type || ej.error.code).slice(0, 60);
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
  const remaining = dailyRemaining();
  const capped = !!lead && remaining <= 0;
  let mode = "offline";
  if (lead && !capped) mode = lead.paid ? "ai" : "free-cloud";
  const label =
    mode === "ai"
      ? "AI Build ready"
      : mode === "free-cloud"
      ? "Free Build (" + lead.label + ")"
      : capped
      ? "Free Build (offline — daily AI limit reached)"
      : all.length
      ? "Free Build (offline — cloud AI paused)"
      : "Free Build (offline)";
  return {
    ok: true,
    configured: !!lead,
    online: mode !== "offline",
    mode: mode,
    free: mode !== "ai",
    label: label,
    degraded: !!(lead && recent && recent.provider === lead.id),
    lastError: recent ? recent.code : null,
    provider: lead ? lead.id : null,
    model: lead ? lead.model : null,
    generate: !!lead && !capped,
    dailyCap: lead ? caps().daily : null,
    dailyRemaining: lead ? remaining : null,
    capped: capped,
    paidSkipped: paidSkipped,
    paidSkipReason: paidSkipped ? (freeOnly() ? "free_only" : "no_credits") : null,
    message:
      mode === "ai"
        ? "AI Build ready"
        : mode === "free-cloud"
        ? "Free Build — cloud AI on a free tier, no API credits needed"
        : capped
        ? "Today's free AI budget is used up — edits run on offline rules until it resets"
        : all.length
        ? "Cloud AI hit its free-tier limit — offline rules for now; it retries automatically"
        : "Free Build — offline rules, no API credits needed",
  };
}

/* Free-tier budget guards (all env-configurable, sized under the free quota):
 *   AI_DAILY_CAP    — model calls per rolling 24h, whole server (default 200)
 *   AI_RPM_CAP      — model calls per minute, whole server (default 8)
 *   AI_IP_DAILY     — model calls per IP per 24h (default 25)
 *   AI_OWNER_DAILY  — model calls per build owner per 24h (default 40)
 * In-memory (single instance); a restart resets counters, which only errs toward the
 * provider's own 429 — that is handled as a graceful fallback too. */
function num(name, dflt) {
  const n = Number(env(name));
  return Number.isFinite(n) && n >= 0 && env(name) !== "" ? n : dflt;
}
const DAY_MS = 24 * 60 * 60 * 1000;
let dayHits = [];
const ipDay = new Map();
const ownerDay = new Map();
function caps() {
  return {
    daily: num("AI_DAILY_CAP", 200),
    rpm: num("AI_RPM_CAP", 8),
    ipDaily: num("AI_IP_DAILY", 25),
    ownerDaily: num("AI_OWNER_DAILY", 40),
  };
}
function pruned(map, key, windowMs, now) {
  const arr = (map.get(key) || []).filter(function (t) {
    return now - t < windowMs;
  });
  map.set(key, arr);
  return arr;
}
function dailyRemaining() {
  const now = Date.now();
  dayHits = dayHits.filter(function (t) {
    return now - t < DAY_MS;
  });
  return Math.max(0, caps().daily - dayHits.length);
}

/** Returns null when allowed (and records the hit), else a reason string. */
function rateCheck(ip, owner) {
  const now = Date.now();
  const c = caps();
  if (dailyRemaining() <= 0) return "daily_cap";
  globalHits = globalHits.filter(function (t) {
    return now - t < 60 * 1000;
  });
  if (globalHits.length >= Math.min(c.rpm, GLOBAL_MAX)) return "rate_limited";
  const ipMin = pruned(ipHits, ip, IP_WINDOW_MS, now);
  if (ipMin.length >= IP_MAX) return "rate_limited";
  const ipD = pruned(ipDay, ip, DAY_MS, now);
  if (ipD.length >= c.ipDaily) return "ip_daily_cap";
  const ownD = owner ? pruned(ownerDay, owner, DAY_MS, now) : null;
  if (ownD && ownD.length >= c.ownerDaily) return "owner_daily_cap";
  ipMin.push(now);
  ipD.push(now);
  if (ownD) ownD.push(now);
  globalHits.push(now);
  dayHits.push(now);
  if (ipHits.size > 5000) ipHits.clear();
  if (ipDay.size > 5000) ipDay.clear();
  if (ownerDay.size > 5000) ownerDay.clear();
  return null;
}
function rateOk(ip, owner) {
  return rateCheck(ip || "unknown", owner) === null;
}
function _resetLimits() {
  dayHits = [];
  globalHits = [];
  ipHits.clear();
  ipDay.clear();
  ownerDay.clear();
  Object.keys(quotaDead).forEach(function (k) { delete quotaDead[k]; });
  lastFailure = null;
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
  "Do exactly what the user asked — their words override any default. Apply it with premium quality (bold, modern, mobile-friendly), matching the existing design system and CSS variables.",
  "Keep content true to the business: no lorem ipsum, no invented testimonials, reviews, client names, awards or statistics presented as real (label any sample numbers clearly as examples).",
  "Never mention or brand the site with Replit, Grok, Gemini, Google, OpenAI, ChatGPT, Spawn, or any AI/tool vendor.",
  "Interactive hooks (reuse, never write JS). Always wired: [data-theme-toggle], #leadForm/#leadMsg when present. If the page has <script data-ui-runtime>, also wired: theme button [data-theme-toggle]; contact form #leadForm (fields name, email, phone, message) with status #leadMsg; mobile menu button [data-nav-toggle] toggling .is-open on [data-nav-menu]; [data-reveal] fades in on scroll; native <details> for FAQs.",
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
  "- Visitor-facing copy must never mention bots, chatbots, AI, automation tools, website builders, or that the site was generated. Say 'a real person' / 'our team' instead of contrasting with bots.",
  "- Galleries: never use 'Project 1'-style placeholders or hotlinked/stock image URLs. Use captioned tiles that fit the business, with CSS gradient/pattern art or small inline SVG, matching the existing design.",
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
  /* First complete top-level object (models sometimes append stray tail text). */
  const start = s.indexOf("{");
  if (start !== -1) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let k = start; k < s.length; k++) {
      const ch = s[k];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try {
          return JSON.parse(s.slice(start, k + 1));
        } catch (_) {
          break;
        }
      }
    }
  }
  const i = s.indexOf("{");
  const j = s.lastIndexOf("}");
  if (i !== -1 && j > i) return JSON.parse(s.slice(i, j + 1));
  throw new Error("Model did not return JSON");
}

const GEN_SCHEMA = {
  type: "OBJECT",
  properties: { reply: { type: "STRING" }, html: { type: "STRING" }, css: { type: "STRING" } },
  required: ["reply", "html", "css"],
  propertyOrdering: ["reply", "html", "css"],
};
const EDIT_SCHEMA = {
  type: "OBJECT",
  properties: {
    reply: { type: "STRING" },
    patches: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { path: { type: "STRING" }, find: { type: "STRING" }, replace: { type: "STRING" } },
        required: ["path", "find", "replace"],
      },
    },
    files: {
      type: "ARRAY",
      items: { type: "OBJECT", properties: { path: { type: "STRING" }, content: { type: "STRING" } }, required: ["path", "content"] },
    },
  },
  required: ["reply", "patches", "files"],
  propertyOrdering: ["reply", "patches", "files"],
};

function geminiBody(system, userText, maxTokens, model, temperature) {
  const gen = {
    temperature: temperature == null ? 0.4 : temperature,
    maxOutputTokens: maxTokens,
    responseMimeType: "application/json",
    responseSchema: system === GEN_SYSTEM ? GEN_SCHEMA : EDIT_SCHEMA,
  };
  if (/^gemini-3/i.test(model)) gen.thinkingConfig = { thinkingLevel: env("GEMINI_THINKING") || "low" };
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: gen,
  };
}

async function geminiOnce(p, model, system, userText, maxTokens, timeoutMs, temperature) {
  const ctrl = new AbortController();
  const timer = setTimeout(function () {
    ctrl.abort();
  }, timeoutMs || TIMEOUT_MS);
  try {
    const res = await fetch(p.base + "/models/" + encodeURIComponent(model) + ":generateContent", {
      method: "POST",
      headers: { "x-goog-api-key": p.key(), "Content-Type": "application/json" },
      body: JSON.stringify(geminiBody(system, userText, maxTokens, model, temperature)),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const code = await errorCode(res);
      const e = new Error(p.id + " HTTP " + res.status + " (" + code + ")");
      e.httpStatus = res.status;
      e.code = res.status === 429 ? "resource_exhausted" : code;
      throw e;
    }
    const data = JSON.parse(await res.text());
    const cand = data && data.candidates && data.candidates[0];
    const parts = (cand && cand.content && cand.content.parts) || [];
    const content = parts
      .filter(function (x) {
        return x && typeof x.text === "string" && !x.thought;
      })
      .map(function (x) {
        return x.text;
      })
      .join("");
    if (!content) {
      const e = new Error("Empty model response (" + ((cand && cand.finishReason) || "none") + ")");
      e.code = "empty_" + String((cand && cand.finishReason) || "none").toLowerCase();
      throw e;
    }
    return extractJson(content);
  } finally {
    clearTimeout(timer);
  }
}

/* Primary model, then (on 5xx overload/timeout only) the optional fallback model. */
async function callGemini(p, system, userText, maxTokens, timeoutMs, temperature) {
  try {
    return await geminiOnce(p, p.model, system, userText, maxTokens, timeoutMs, temperature);
  } catch (err) {
    const transient = err && (err.httpStatus >= 500 || err.httpStatus === 429 || err.name === "AbortError");
    if (!transient || !p.fallbackModel || p.fallbackModel === p.model) throw err;
    console.error("[build-ai] primary model unavailable, trying fallback model");
    return geminiOnce(p, p.fallbackModel, system, userText, maxTokens, timeoutMs, temperature);
  }
}

async function callProvider(p, userText) {
  if (p.kind === "gemini") return callGemini(p, SYSTEM, userText, p.maxTokens, TIMEOUT_MS, 0.3);
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
    let next = content;
    if (/\.html$/i.test(rel) && before && before.indexOf(UI_RUNTIME) !== -1 && next.indexOf("data-ui-runtime") === -1) {
      next = next.replace(/<\/body>/i, UI_RUNTIME + "\n</body>");
    }
    if (riskyIncrease(before, next)) return skipped.push(rel + " (unsafe content)");
    working[rel] = next;
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
async function applyAiEdit(root, message, ip, owner) {
  const providers = activeProviders();
  if (!providers.length) return { ok: false, reason: configuredProviders().length ? "quota" : "not_configured" };
  const limited = rateCheck(ip || "unknown", owner);
  if (limited) return { ok: false, reason: limited };
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
      const quota = err && (err.httpStatus === 402 || err.httpStatus === 429 || QUOTA_CODES.test(code));
      if (quota) quotaDead[p.id] = Date.now();
      lastReason = quota ? "quota" : code === "timeout" ? "timeout" : "model_error";
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

/* ---------- Whole-site generation (create) ---------- */

/* Small, fixed runtime the generated markup relies on. Written by us, never by the model. */
const UI_RUNTIME = [
  "<script data-ui-runtime>",
  "(function(){",
  "  var root=document.documentElement;",
  "  var saved=null;try{saved=localStorage.getItem('af-theme');}catch(_){}",
  "  if(saved==='light'||saved==='dark') root.setAttribute('data-theme',saved);",
  "  else if(!root.getAttribute('data-theme')) root.setAttribute('data-theme',window.matchMedia&&window.matchMedia('(prefers-color-scheme:light)').matches?'light':'dark');",
  "  function sync(){var t=root.getAttribute('data-theme')==='light'?'light':'dark';document.querySelectorAll('[data-theme-toggle]').forEach(function(b){b.textContent=t==='light'?'Dark':'Light';b.setAttribute('aria-label','Switch to '+(t==='light'?'dark':'light')+' theme');});}",
  "  document.addEventListener('click',function(e){",
  "    var b=e.target.closest('[data-theme-toggle]');",
  "    if(b){var n=root.getAttribute('data-theme')==='light'?'dark':'light';root.setAttribute('data-theme',n);try{localStorage.setItem('af-theme',n);}catch(_){}sync();return;}",
  "    var t=e.target.closest('[data-nav-toggle]');",
  "    if(t){var m=document.querySelector('[data-nav-menu]');if(m){var o=m.classList.toggle('is-open');t.setAttribute('aria-expanded',o?'true':'false');}return;}",
  "    var a=e.target.closest('[data-nav-menu] a');",
  "    if(a){var mm=document.querySelector('[data-nav-menu]');if(mm)mm.classList.remove('is-open');}",
  "  });",
  "  sync();",
  "  var els=document.querySelectorAll('[data-reveal]');",
  "  if('IntersectionObserver' in window){var io=new IntersectionObserver(function(en){en.forEach(function(x){if(x.isIntersecting){x.target.classList.add('is-visible');io.unobserve(x.target);}});},{threshold:0.12});els.forEach(function(el){io.observe(el);});}",
  "  else els.forEach(function(el){el.classList.add('is-visible');});",
  "  setTimeout(function(){els.forEach(function(el){el.classList.add('is-visible');});},2500);",
  "  var f=document.getElementById('leadForm');",
  "  if(f){f.addEventListener('submit',function(e){",
  "    e.preventDefault();var fd=new FormData(f);var msg=document.getElementById('leadMsg');var btn=f.querySelector('[type=submit]');if(btn)btn.disabled=true;",
  "    fetch('/api/lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:fd.get('name'),phone:fd.get('phone'),email:fd.get('email'),message:fd.get('message')})})",
  "      .then(function(r){return r.json().catch(function(){return {};}).then(function(j){if(!r.ok||!j.ok)throw new Error(j.error||'Could not send — try again.');});})",
  "      .then(function(){if(msg)msg.textContent='Got it — we will reach out shortly.';f.reset();})",
  "      .catch(function(err){if(msg)msg.textContent=err.message;})",
  "      .then(function(){if(btn)btn.disabled=false;});",
  "  });}",
  "})();",
  "</script>",
].join("\n");

const GEN_SYSTEM = [
  "You are a senior product designer and front-end engineer. Write a complete, production-quality one-page website for the business or app the user describes.",
  "The result must be clearly and specifically about the user's prompt: their services, place, audience and tone. Never generic filler.",
  "Respond with ONLY a JSON object: {\"reply\":\"one sentence summary\",\"html\":\"full public/index.html\",\"css\":\"full public/styles.css\"}",
  "Design bar (premium): bold confident typography (system font stacks or a tasteful stack, no external font links), strong hero with a clear value proposition and primary call to action, rich sections (e.g. services/offer with specifics, how it works, service area or details, pricing or packages if natural, FAQ via <details>, contact). Generous spacing, modern cards, gradients or subtle patterns, inline SVG icons, hover/focus states, smooth transitions, CSS-only art instead of images.",
  "Mobile-first and responsive (looks great at 360px and 1440px). Accessible: semantic landmarks, labels, contrast, visible focus.",
  "Theming: style dark by default via :root variables and provide a light palette under :root[data-theme=\"light\"]. Both must look good.",
  "Required hooks (scripts are added for you — you must NOT write any JavaScript):",
  "- In the header: <button type=\"button\" data-theme-toggle>Light</button>.",
  "- Mobile menu: a <button type=\"button\" data-nav-toggle aria-expanded=\"false\" aria-label=\"Menu\"> and a nav element with data-nav-menu; CSS hides the menu on small screens unless it has class is-open.",
  "- Contact/quote form: <form id=\"leadForm\"> with inputs named name (required), email (type=email, required), phone (type=tel), message (textarea) with visible <label>s, a submit button, and <p id=\"leadMsg\" role=\"status\"></p> after it. Form has no action attribute.",
  "- Optionally add data-reveal to sections; CSS should make [data-reveal] start slightly translated/transparent and .is-visible fully shown (respect prefers-reduced-motion).",
  "HTML must be a full document: <!DOCTYPE html>, <html lang=\"en\">, meta charset, meta viewport, meta description, <title>, <link rel=\"stylesheet\" href=\"styles.css\">, and no <style> blocks, no <script>, no inline event handlers (onclick etc.), no javascript: URLs, no iframes/objects/embeds, no external images, fonts or CDNs.",
  "Honesty: no lorem ipsum, no fabricated testimonials, reviews, ratings, client logos, awards, years in business, license numbers or statistics. Do not invent phone numbers, emails or street addresses — point people to the form instead. If you show example prices, label them as starting points to confirm.",
  "Never mention or brand with Replit, Grok, Gemini, Google, OpenAI, ChatGPT, Spawn, or any AI/website-builder vendor, and do not say the site was generated. Footer: © current year + business name only.",
  "Keep html under 45000 characters and css under 30000 characters.",
].join("\n");

const REQUIRED_HOOKS = [/data-theme-toggle/, /id=["']leadForm["']/, /id=["']leadMsg["']/];

/** Validate + finalize model output for create. Returns {html, css} or throws. */
function finalizeSite(out) {
  let html = typeof (out && out.html) === "string" ? out.html.trim() : "";
  let css = typeof (out && out.css) === "string" ? out.css.trim() : "";
  if (!/<body[\s>]/i.test(html) || !/<\/body>/i.test(html)) throw Object.assign(new Error("invalid html"), { code: "invalid_html" });
  if (css.length < 400) throw Object.assign(new Error("css missing"), { code: "invalid_css" });
  if (html.length > MAX_OUT_FILE || css.length > MAX_OUT_FILE) throw Object.assign(new Error("too large"), { code: "too_large" });
  if (riskyIncrease("", html.replace(/<script[\s\S]*?<\/script>/gi, "")) || riskyIncrease("", css) || /<style\b|<\/style/i.test(css)) {
    throw Object.assign(new Error("unsafe output"), { code: "unsafe_output" });
  }
  if (/<script\b/i.test(html)) throw Object.assign(new Error("unsafe output"), { code: "unsafe_output" });
  /* Strip external resource loads the preview/publish sandbox can't rely on. */
  html = html.replace(/<link\b[^>]*href=["']https?:[^>]*>/gi, "");
  css = css.replace(/@import[^;]+;/gi, "");
  if (!/<link[^>]+href=["']styles\.css["']/i.test(html)) html = html.replace(/<\/head>/i, '  <link rel="stylesheet" href="styles.css" />\n</head>');
  for (const re of REQUIRED_HOOKS) {
    if (!re.test(html)) throw Object.assign(new Error("missing hooks"), { code: "missing_hooks" });
  }
  if (/lorem ipsum/i.test(html)) throw Object.assign(new Error("placeholder text"), { code: "placeholder" });
  html = html.replace(/<\/body>/i, UI_RUNTIME + "\n</body>");
  return { html: html + (html.endsWith("\n") ? "" : "\n"), css: css + "\n" };
}

/**
 * Replace a freshly scaffolded build's public/index.html + styles.css with a model-written site.
 * Resolves { ok:true, provider, model, reply } or { ok:false, reason } (scaffold left untouched).
 */
async function generateSite(root, info, ip, owner) {
  const p = activeProviders().find(function (x) {
    return x.kind === "gemini";
  });
  if (!p) return { ok: false, reason: configuredProviders().length ? "quota" : "not_configured" };
  const limited = rateCheck(ip || "unknown", owner);
  if (limited) return { ok: false, reason: limited };
  const name = String((info && info.name) || "").slice(0, 80);
  const desc = String((info && info.description) || "").slice(0, 600);
  const user =
    "Business / app name: " + name +
    "\nWhat it is (the user's own words): " + (desc || name) +
    "\nStarting layout preference: " + String((info && info.template) || "best fit") +
    "\nAccent colour to build the palette around: " + String((info && info.accent) || "#5eead4") +
    "\nCurrent year: " + new Date().getFullYear();
  try {
    const out = await callGemini(p, GEN_SYSTEM, user, 32000, num("AI_GENERATE_TIMEOUT_MS", 110000), 0.7);
    const site = finalizeSite(out);
    if (lastFailure && lastFailure.provider === p.id) lastFailure = null;
    const pub = path.join(root, "public");
    commit(root, { "public/index.html": site.html, "public/styles.css": site.css });
    if (!fs.existsSync(path.join(pub, "index.html"))) return { ok: false, reason: "write_failed" };
    return { ok: true, provider: p.id, model: p.model, reply: String((out && out.reply) || "").slice(0, 300) };
  } catch (err) {
    const code = (err && err.code) || (err && err.name === "AbortError" ? "timeout" : "model_error");
    console.error("[build-ai] generate failed:", code, String((err && err.message) || "").slice(0, 120));
    lastFailure = { at: Date.now(), code: code, provider: p.id };
    const quota = err && (err.httpStatus === 429 || QUOTA_CODES.test(code));
    if (quota) quotaDead[p.id] = Date.now();
    return { ok: false, reason: quota ? "quota" : code === "timeout" ? "timeout" : "model_error" };
  }
}

module.exports = {
  applyAiEdit,
  generateSite,
  status,
  isConfigured,
  activeProviders,
  _plan: plan,
  _finalizeSite: finalizeSite,
  _resetLimits: _resetLimits,
  _rateCheck: rateCheck,
  UI_RUNTIME,
};
