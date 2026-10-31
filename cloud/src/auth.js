// Per-app end-user accounts: email + password, sessions in D1, HttpOnly cookie scoped to the app host.
import { json, readJson, HttpError, randomHex, sha256Hex, clientIp, rateLimit, validEmail, clip, timingSafeEqual, now } from "./util.js";

const COOKIE = "af_session";
const SESSION_DAYS = 30;
const PBKDF2_ITER = 100000;

function cookies(req) {
  const out = {};
  for (const p of String(req.headers.get("cookie") || "").split(";")) {
    const i = p.indexOf("=");
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  }
  return out;
}

async function pbkdf2(password, saltHex) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITER }, key, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verify(user, password) {
  if (user.algo === "pbkdf2") return timingSafeEqual(await pbkdf2(password, user.salt), user.hash);
  if (user.algo === "scrypt") {
    // Accounts imported from the desktop app (Node scrypt, N=16384 r=8 p=1, 32-byte key).
    const { scryptSync } = await import("node:crypto");
    const h = scryptSync(String(password), user.salt, 32).toString("hex");
    return timingSafeEqual(h, user.hash);
  }
  return false;
}

export async function currentAppUser(c) {
  const sid = cookies(c.request)[COOKIE];
  if (!sid || !/^[a-f0-9]{48}$/.test(sid)) return null;
  const row = await c.env.DB.prepare(
    "SELECT u.email, u.name FROM app_sessions s JOIN app_users u ON u.slug = s.slug AND u.email = s.email WHERE s.id_hash=?1 AND s.slug=?2 AND s.expires_at > ?3"
  )
    .bind(await sha256Hex("s:" + sid), c.slug, Date.now())
    .first();
  return row || null;
}

async function startSession(c, email, name) {
  const sid = randomHex(24);
  await c.env.DB.prepare("INSERT INTO app_sessions (id_hash, slug, email, expires_at) VALUES (?1,?2,?3,?4)")
    .bind(await sha256Hex("s:" + sid), c.slug, email, Date.now() + SESSION_DAYS * 86400000)
    .run();
  return json({ ok: true, user: { email, name } }, 200, {
    "Set-Cookie": `${COOKIE}=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`,
  });
}

export async function handleAuth(c) {
  const { request, path, env, slug } = c;
  const m = request.method;
  const ip = clientIp(request);
  if (path === "/api/auth/me" && m === "GET") {
    const u = await currentAppUser(c);
    return json({ ok: true, user: u ? { email: u.email, name: u.name } : null });
  }
  if (path === "/api/auth/logout" && m === "POST") {
    const sid = cookies(request)[COOKIE];
    if (sid) await env.DB.prepare("DELETE FROM app_sessions WHERE id_hash=?1").bind(await sha256Hex("s:" + sid)).run();
    return json({ ok: true }, 200, { "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });
  }
  if ((path === "/api/auth/signup" || path === "/api/auth/login") && m === "POST") {
    await rateLimit(env, `auth:${slug}:${ip}`, 10, 600);
    const b = await readJson(request, 4096);
    const email = clip(b.email, 254).toLowerCase();
    const password = String(b.password || "");
    if (!validEmail(email) || !password) throw new HttpError(400, "email and password required");
    if (path === "/api/auth/signup") {
      if (password.length < 8) throw new HttpError(400, "Use at least 8 characters for your password.");
      const exists = await env.DB.prepare("SELECT 1 FROM app_users WHERE slug=?1 AND email=?2").bind(slug, email).first();
      if (exists) throw new HttpError(409, "email already registered");
      const salt = randomHex(16);
      const name = clip(b.name, 80) || email.split("@")[0];
      await env.DB.prepare("INSERT INTO app_users (slug, email, name, algo, salt, hash, created_at) VALUES (?1,?2,?3,'pbkdf2',?4,?5,?6)")
        .bind(slug, email, name, salt, await pbkdf2(password, salt), now())
        .run();
      return startSession(c, email, name);
    }
    const u = await env.DB.prepare("SELECT email, name, algo, salt, hash FROM app_users WHERE slug=?1 AND email=?2").bind(slug, email).first();
    if (!u || !(await verify(u, password))) throw new HttpError(401, "invalid credentials");
    return startSession(c, u.email, u.name);
  }
  if (path === "/api/auth/magic") {
    return json({ ok: false, error: "Email sign-in links aren't available for this app. Sign in with your email and password." }, 501);
  }
  return null;
}
