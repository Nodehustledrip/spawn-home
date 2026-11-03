// Elite perks served at the edge (free plan, no paid features):
//  - Password-protected sites: a branded password page; the password is checked against a PBKDF2-SHA256 hash
//    written by spawnapp.org, and a signed, HttpOnly cookie (HMAC over slug + version + expiry) admits the visitor.
//  - Visitor stats: aggregate daily counts (views, top pages, referrer hosts) in D1. No IPs or personal data stored.
import { b64ToBytes, timingSafeEqual, clientIp, SECURITY_HEADERS, sha256Hex } from "./util.js";

export const UNLOCK_PATH = "/__spawn/unlock";
const COOKIE_DAYS = 30;
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (h) => new Uint8Array((String(h).match(/../g) || []).map((x) => parseInt(x, 16)));

export async function loadElite(env, slug) {
  try {
    const p = await env.DB.prepare("SELECT pw_hash, pw_salt, iterations, ver FROM app_protect WHERE slug=?1").bind(slug).first();
    const f = await env.DB.prepare("SELECT stats FROM app_features WHERE slug=?1").bind(slug).first();
    return { protect: p || null, stats: !!(f && f.stats) };
  } catch (_) { return { protect: null, stats: false }; } // not migrated yet
}

export async function pbkdf2Hex(password, saltHex, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(String(password)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromHex(saltHex), iterations }, key, 256);
  return hex(bits);
}

let hmacKey = null, hmacFor = null;
async function signKey(env) {
  if (hmacKey && hmacFor === env.SECRETS_KEY) return hmacKey;
  if (!env.SECRETS_KEY) throw new Error("SECRETS_KEY missing");
  // Separate key from the secrets-encryption use: HMAC over a fixed label.
  const base = await crypto.subtle.importKey("raw", b64ToBytes(env.SECRETS_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const raw = await crypto.subtle.sign("HMAC", base, enc.encode("spawn-gate-cookie-v1"));
  hmacKey = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  hmacFor = env.SECRETS_KEY;
  return hmacKey;
}
async function sign(env, msg) { return hex(await crypto.subtle.sign("HMAC", await signKey(env), enc.encode(msg))); }

const cookieName = (slug) => "spawn_gate_" + slug.replace(/[^a-z0-9]/g, "_");
function readCookie(req, name) {
  const h = req.headers.get("cookie") || "";
  for (const part of h.split(";")) { const i = part.indexOf("="); if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim(); }
  return null;
}

export async function makeCookie(env, slug, ver, nowMs = Date.now()) {
  const exp = Math.floor(nowMs / 1000) + COOKIE_DAYS * 86400;
  return exp + "." + (await sign(env, slug + "|" + ver + "|" + exp));
}
export async function cookieOk(env, slug, protect, value, nowMs = Date.now()) {
  const m = /^(\d{9,12})\.([0-9a-f]{64})$/.exec(String(value || ""));
  if (!m || Number(m[1]) * 1000 < nowMs) return false;
  return timingSafeEqual(m[2], await sign(env, slug + "|" + protect.ver + "|" + m[1]));
}

function safeNext(v) {
  const s = String(v || "/");
  return s[0] === "/" && s[1] !== "/" && s[1] !== "\\" && !/[\u0000-\u001f]/.test(s) && s.length < 500 ? s : "/";
}

const tries = new Map(); // per-isolate attempt limiter keyed by a hash (no raw IPs kept)
async function tooMany(slug, req) {
  const k = await sha256Hex(slug + "|" + clientIp(req));
  const t = Date.now(), e = tries.get(k);
  if (!e || e.reset < t) { tries.set(k, { n: 1, reset: t + 10 * 60000 }); if (tries.size > 5000) tries.clear(); return false; }
  return ++e.n > 10;
}

/** Returns a Response when the visitor must be stopped (or was just admitted), else null to continue. */
export async function gate(c, protect) {
  const { env, slug, request, url, path, app } = c;
  if (path === UNLOCK_PATH && request.method === "POST") {
    const form = await request.formData().catch(() => null);
    const pw = form ? String(form.get("password") || "") : "";
    const next = safeNext(form && form.get("next"));
    if (await tooMany(slug, request)) return passwordPage(app, next, "Too many tries. Wait a few minutes and try again.", 429);
    const ok = pw && pw.length <= 200 && timingSafeEqual(await pbkdf2Hex(pw, protect.pw_salt, protect.iterations), protect.pw_hash);
    if (!ok) return passwordPage(app, next, "That password isn't right. Try again.", 401);
    const v = await makeCookie(env, slug, protect.ver);
    const headers = new Headers(SECURITY_HEADERS);
    headers.set("Location", new URL(next, url.origin).toString());
    headers.set("Set-Cookie", `${cookieName(slug)}=${v}; Path=/; Max-Age=${COOKIE_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`);
    headers.set("Cache-Control", "no-store");
    return new Response(null, { status: 303, headers });
  }
  if (await cookieOk(env, slug, protect, readCookie(request, cookieName(slug)))) return null;
  if (path.startsWith("/api/") || path === "/api") return new Response(JSON.stringify({ ok: false, error: "This app is password protected." }), { status: 401, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  return passwordPage(app, safeNext(path + url.search), "", 401);
}

const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
export function passwordPage(app, next, error, status) {
  const title = (app && (app.title || app.slug)) || "This app";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${esc(title)} · Password required</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;font:16px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;color:#ecebe6;
background:radial-gradient(1200px 600px at 50% -10%,rgba(124,92,255,.22),transparent 60%),radial-gradient(800px 500px at 100% 110%,rgba(212,165,116,.14),transparent 60%),#0b0b0e}
.card{width:100%;max-width:400px;padding:34px 30px 28px;border-radius:20px;background:rgba(20,20,26,.86);border:1px solid rgba(255,255,255,.09);box-shadow:0 30px 80px -30px rgba(0,0,0,.7);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
.lock{width:46px;height:46px;border-radius:14px;display:grid;place-items:center;background:linear-gradient(135deg,#7c5cff,#c084fc);margin-bottom:18px;box-shadow:0 10px 30px -10px rgba(124,92,255,.7)}
h1{font-size:21px;margin:0 0 6px;letter-spacing:-.01em}p{margin:0 0 20px;color:#a5a3ad;font-size:15px}
label{display:block;font-size:13px;color:#c9c7d1;margin-bottom:6px}input{width:100%;padding:13px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:#0d0d12;color:#fff;font:inherit;outline:none}
input:focus{border-color:#9b82ff;box-shadow:0 0 0 3px rgba(124,92,255,.25)}button{margin-top:14px;width:100%;padding:13px;border:0;border-radius:12px;font:600 15px/1 inherit;font-family:inherit;color:#0b0b0e;background:#f2f0eb;cursor:pointer}
button:hover{background:#fff}.err{margin:12px 0 0;color:#ff9aa2;font-size:14px}.foot{margin-top:22px;font-size:12px;color:#6f6d78;text-align:center}.foot a{color:#8f8d99;text-decoration:none}</style></head>
<body><main class="card"><div class="lock" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></div>
<h1>${esc(title)}</h1><p>This site is private. Enter the password the owner gave you.</p>
<form method="post" action="${UNLOCK_PATH}"><label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" required autofocus maxlength="200">
<input type="hidden" name="next" value="${esc(next || "/")}"><button type="submit">Continue</button>${error ? `<p class="err" role="alert">${esc(error)}</p>` : ""}</form>
<p class="foot"><a href="https://spawnapp.org/" target="_blank" rel="noopener">Hosted on Spawn</a></p></main></body></html>`;
  const headers = new Headers(SECURITY_HEADERS);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Robots-Tag", "noindex");
  return new Response(html, { status, headers });
}

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|headless|lighthouse|monitor|curl|wget|python|go-http/i;
/** Count one page view: total, path, referrer host. Aggregate daily rows only. */
export async function countView(env, slug, request, path, ownHosts) {
  const ua = request.headers.get("user-agent") || "";
  if (!ua || BOT.test(ua)) return false;
  if ((request.headers.get("purpose") || request.headers.get("sec-purpose") || "").includes("prefetch")) return false;
  const day = new Date().toISOString().slice(0, 10);
  const page = (path.replace(/\/index\.html?$/, "/").replace(/\.html?$/, "") || "/").slice(0, 120);
  let ref = ""; // "" = direct / no referrer; null = navigation inside the app (not an entry, not counted)
  try {
    const r = request.headers.get("referer");
    if (r) { const h = new URL(r).hostname.toLowerCase().replace(/^www\./, ""); ref = ownHosts.includes(h) ? null : h.slice(0, 100); }
  } catch (_) {}
  const sql = "INSERT INTO app_stats (slug, day, kind, k, n) VALUES (?1, ?2, ?3, ?4, 1) ON CONFLICT(slug, day, kind, k) DO UPDATE SET n = n + 1";
  const stmts = [env.DB.prepare(sql).bind(slug, day, "v", ""), env.DB.prepare(sql).bind(slug, day, "p", page)];
  if (ref !== null) stmts.push(env.DB.prepare(sql).bind(slug, day, "r", ref));
  await env.DB.batch(stmts);
  return true;
}
