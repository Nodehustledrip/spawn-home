// Shared helpers for the Spawn Cloud Worker.
export const SECURITY_HEADERS = {
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(self)",
  "Cross-Origin-Opener-Policy": "same-origin",
};

export function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, SECURITY_HEADERS, extra),
  });
}

export function withSecurity(resp) {
  const r = new Response(resp.body, resp);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!r.headers.has(k)) r.headers.set(k, v);
  return r;
}

export const now = () => new Date().toISOString();

export function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(input) {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const d = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function readJson(req, maxBytes = 65536) {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > maxBytes) throw new HttpError(413, "Request body too large");
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "Request body too large");
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? v : {};
  } catch (_) {
    throw new HttpError(400, "Invalid JSON");
  }
}

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra || {};
  }
}

export function clientIp(req) {
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "local";
}

/** Fixed-window limiter in D1 (writes only; reads are cached at the edge). */
export async function rateLimit(env, key, max, windowSec) {
  const t = Math.floor(Date.now() / 1000);
  const reset = t + windowSec;
  const row = await env.DB.prepare(
    "INSERT INTO rate (k, n, reset_at) VALUES (?1, 1, ?2) " +
      "ON CONFLICT(k) DO UPDATE SET n = CASE WHEN rate.reset_at <= ?3 THEN 1 ELSE rate.n + 1 END, " +
      "reset_at = CASE WHEN rate.reset_at <= ?3 THEN ?2 ELSE rate.reset_at END RETURNING n, reset_at"
  )
    .bind(key, reset, t)
    .first();
  if (row && row.n > max) {
    throw new HttpError(429, "Too many requests. Please wait a moment and try again.", { "Retry-After": String(Math.max(1, row.reset_at - t)) });
  }
}

const EMAIL_RE = /^[^\s@<>()",;:]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
export const validEmail = (e) => EMAIL_RE.test(String(e || ""));

export function clip(v, n) {
  return String(v == null ? "" : v).trim().slice(0, n);
}

/* ---------- encrypted per-app secrets ---------- */
let keyPromise = null;
function secretKey(env) {
  if (!env.SECRETS_KEY) return null;
  if (!keyPromise) {
    keyPromise = crypto.subtle.importKey("raw", b64ToBytes(env.SECRETS_KEY), { name: "AES-GCM" }, false, ["decrypt", "encrypt"]);
  }
  return keyPromise;
}

const secretCache = new Map(); // slug -> {at, map}
export async function appSecrets(env, slug) {
  const hit = secretCache.get(slug);
  if (hit && Date.now() - hit.at < 30000) return hit.map;
  const map = {};
  const key = await secretKey(env);
  if (key) {
    const { results } = await env.DB.prepare("SELECT name, blob FROM app_secrets WHERE slug = ?1").bind(slug).all();
    for (const r of results || []) {
      try {
        const raw = b64ToBytes(r.blob);
        const iv = raw.slice(0, 12);
        const pt = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(slug + ":" + r.name) },
          key,
          raw.slice(12)
        );
        map[r.name] = new TextDecoder().decode(pt);
      } catch (_) {
        /* unreadable secret (wrong key) — treat as unset */
      }
    }
  }
  secretCache.set(slug, { at: Date.now(), map });
  return map;
}

/** Test/import helper: encrypt in the same format the publish API writes. */
export async function encryptSecret(env, slug, name, value) {
  const key = await secretKey(env);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(slug + ":" + name) }, key, new TextEncoder().encode(value))
  );
  const all = new Uint8Array(12 + ct.length);
  all.set(iv);
  all.set(ct, 12);
  return btoa(String.fromCharCode(...all));
}

export const MIME = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8", json: "application/json; charset=utf-8",
  webmanifest: "application/manifest+json", txt: "text/plain; charset=utf-8", xml: "application/xml; charset=utf-8",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  avif: "image/avif", ico: "image/x-icon", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  mp3: "audio/mpeg", wav: "audio/wav", mp4: "video/mp4", webm: "video/webm", pdf: "application/pdf",
  map: "application/json; charset=utf-8", csv: "text/csv; charset=utf-8", md: "text/markdown; charset=utf-8", wasm: "application/wasm",
};
export function mimeFor(p) {
  const m = /\.([a-z0-9]+)$/i.exec(p);
  return (m && MIME[m[1].toLowerCase()]) || "application/octet-stream";
}
