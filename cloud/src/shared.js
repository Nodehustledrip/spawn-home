// Shared per-app backend. Every query is scoped by the app's slug.
import { json, readJson, HttpError, randomHex, sha256Hex, now, clientIp, rateLimit, validEmail, clip, appSecrets, b64ToBytes, mimeFor, SECURITY_HEADERS, timingSafeEqual } from "./util.js";
import { aiChat, aiStatus } from "./ai.js";
import { handleAuth } from "./auth.js";

const MAX_ROW_BYTES = 32 * 1024;
const MAX_ROWS_PER_TABLE = 5000;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_FILES_PER_APP = 500;

export async function handleShared(c) {
  const { request, path, slug, app, env } = c;
  const m = request.method;
  const ip = clientIp(request);
  let r;

  if (path === "/api/health" && m === "GET") return json({ ok: true, app: app.title || slug, hosting: "spawn-cloud" });
  if (path === "/api/config" && m === "GET") return json(Object.assign({ ok: true }, app.config || {}));

  if (path.startsWith("/api/auth/")) return handleAuth(c);

  if (path === "/api/lead" && m === "POST") {
    await rateLimit(env, `w:${slug}:${ip}`, 30, 600);
    const b = await readJson(request, 16384);
    const email = clip(b.email, 254).toLowerCase();
    if (!email && !b.title) throw new HttpError(400, "email or title required");
    if (email && !validEmail(email)) throw new HttpError(400, "Enter a valid email address.");
    await insertRecord(env, slug, "lead", email, b);
    return json({ ok: true, message: "Thanks — we got your message." });
  }

  if (path === "/api/interest" && m === "POST") {
    await rateLimit(env, `w:${slug}:${ip}`, 30, 600);
    const b = await readJson(request, 16384);
    const email = clip(b.email, 254).toLowerCase();
    if (!validEmail(email)) throw new HttpError(400, "email required");
    await insertRecord(env, slug, "interest", email, b);
    return json({ ok: true, message: "Interest recorded. We'll follow up." });
  }

  if (path === "/api/subscribe") {
    if (m === "GET") {
      r = await env.DB.prepare("SELECT COUNT(*) AS n FROM records WHERE slug=?1 AND kind='subscriber'").bind(slug).first();
      return json({ ok: true, count: r ? r.n : 0 });
    }
    if (m === "POST") {
      await rateLimit(env, `w:${slug}:${ip}`, 30, 600);
      const b = await readJson(request, 4096);
      const email = clip(b.email, 254).toLowerCase();
      if (!validEmail(email)) throw new HttpError(400, "email required");
      await env.DB.prepare("INSERT OR IGNORE INTO records (id, slug, kind, email, data, created_at) VALUES (?1,?2,'subscriber',?3,?4,?5)")
        .bind(randomHex(8), slug, email, JSON.stringify({ email, at: now() }), now())
        .run();
      return json({ ok: true });
    }
  }

  // Blog posts: read-only, published with the app (rows table 'posts').
  if (path === "/api/posts" && m === "GET") {
    const { results } = await env.DB.prepare("SELECT data FROM rows WHERE slug=?1 AND tbl='posts' ORDER BY created_at DESC LIMIT 200").bind(slug).all();
    return json({ ok: true, posts: (results || []).map((x) => JSON.parse(x.data)) });
  }
  if ((r = /^\/api\/posts\/([^/]+)$/.exec(path)) && m === "GET") {
    const row = await env.DB.prepare("SELECT data FROM rows WHERE slug=?1 AND tbl='posts' AND id=?2").bind(slug, decodeURIComponent(r[1])).first();
    if (!row) return json({ ok: false }, 404);
    return json({ ok: true, post: JSON.parse(row.data) });
  }

  if ((r = /^\/api\/db\/([^/]+)(?:\/([^/]+))?$/.exec(path))) return handleDb(c, safeTable(r[1]), r[2] ? decodeURIComponent(r[2]) : null, ip);

  if (path === "/api/storage" && m === "GET") {
    const { results } = await env.DB.prepare("SELECT name, size, created_at FROM files WHERE slug=?1 ORDER BY created_at DESC LIMIT 500").bind(slug).all();
    return json({ ok: true, files: (results || []).map((f) => ({ name: f.name, size: f.size, url: "/storage/" + encodeURIComponent(f.name), mtime: f.created_at })) });
  }
  if (path === "/api/storage/upload" && m === "POST") {
    await rateLimit(env, `up:${slug}:${ip}`, 20, 600);
    const b = await readJson(request, Math.ceil(MAX_UPLOAD_BYTES * 1.4) + 4096);
    if (!b.contentBase64) throw new HttpError(400, "contentBase64 required");
    let bytes;
    try { bytes = b64ToBytes(String(b.contentBase64).replace(/^data:[^,]*,/, "")); } catch (_) { throw new HttpError(400, "contentBase64 is not valid base64"); }
    if (bytes.length > MAX_UPLOAD_BYTES) throw new HttpError(413, "File is larger than 5 MB.");
    const cnt = await env.DB.prepare("SELECT COUNT(*) AS n FROM files WHERE slug=?1").bind(slug).first();
    if (cnt && cnt.n >= MAX_FILES_PER_APP) throw new HttpError(507, "This app has reached its file limit.");
    const base = String(b.name || "upload.bin").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "upload.bin";
    const name = Date.now() + "-" + randomHex(4) + "-" + base;
    const delToken = randomHex(16);
    await env.APPS.put("data/" + slug + "/uploads/" + name, bytes, { httpMetadata: { contentType: mimeFor(name) } });
    await env.DB.prepare("INSERT INTO files (slug, name, size, type, delete_key, created_at) VALUES (?1,?2,?3,?4,?5,?6)")
      .bind(slug, name, bytes.length, mimeFor(name), await sha256Hex(delToken), now())
      .run();
    return json({ ok: true, file: { name, size: bytes.length, url: "/storage/" + encodeURIComponent(name), deleteKey: delToken } });
  }
  if ((r = /^\/api\/storage\/([^/]+)$/.exec(path)) && m === "DELETE") {
    const name = decodeURIComponent(r[1]);
    const key = request.headers.get("x-delete-key") || c.url.searchParams.get("key") || "";
    const row = await env.DB.prepare("SELECT delete_key FROM files WHERE slug=?1 AND name=?2").bind(slug, name).first();
    if (!row) return json({ ok: false, error: "not found" }, 404);
    if (!key || !timingSafeEqual(await sha256Hex(key), row.delete_key)) throw new HttpError(403, "Only the uploader can delete this file.");
    await env.APPS.delete("data/" + slug + "/uploads/" + name);
    await env.DB.prepare("DELETE FROM files WHERE slug=?1 AND name=?2").bind(slug, name).run();
    return json({ ok: true });
  }
  if ((r = /^\/storage\/([^/]+)$/.exec(path)) && (m === "GET" || m === "HEAD")) {
    const name = decodeURIComponent(r[1]);
    if (!/^[A-Za-z0-9._-]+$/.test(name)) return json({ ok: false }, 404);
    const obj = await env.APPS.get("data/" + slug + "/uploads/" + name);
    if (!obj) return new Response("Not found", { status: 404, headers: SECURITY_HEADERS });
    const type = mimeFor(name);
    const h = new Headers(SECURITY_HEADERS);
    h.set("Content-Type", type);
    h.set("Cache-Control", "public, max-age=3600");
    h.set("Content-Security-Policy", "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
    if (/html|svg|javascript|xml/.test(type)) h.set("Content-Disposition", "attachment");
    return new Response(m === "HEAD" ? null : obj.body, { headers: h });
  }

  if (path === "/api/ai/status" && m === "GET") return aiStatus(c);
  if (path === "/api/ai/chat" && m === "POST") {
    await rateLimit(env, `ai:${slug}:${ip}`, 20, 60);
    return aiChat(c, await readJson(request, 16384));
  }
  return null;
}

function safeTable(t) {
  const s = String(t || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 48);
  if (!s || s === "posts") throw new HttpError(400, "invalid table");
  return s;
}

async function insertRecord(env, slug, kind, email, body) {
  const data = JSON.stringify(body).slice(0, 16384);
  await env.DB.prepare("INSERT INTO records (id, slug, kind, email, data, created_at) VALUES (?1,?2,?3,?4,?5,?6)")
    .bind(randomHex(8), slug, kind, email || null, data, now())
    .run();
}

async function handleDb(c, tbl, id, ip) {
  const { env, slug, request } = c;
  const m = request.method;
  if (m === "GET" && !id) {
    const { results } = await env.DB.prepare("SELECT data FROM rows WHERE slug=?1 AND tbl=?2 ORDER BY created_at LIMIT 1000").bind(slug, tbl).all();
    return json({ ok: true, rows: (results || []).map((x) => JSON.parse(x.data)) });
  }
  if (m === "GET") {
    const row = await env.DB.prepare("SELECT data FROM rows WHERE slug=?1 AND tbl=?2 AND id=?3").bind(slug, tbl, id).first();
    if (!row) return json({ ok: false, error: "not found" }, 404);
    return json({ ok: true, row: JSON.parse(row.data) });
  }
  await rateLimit(env, `db:${slug}:${ip}`, 60, 600);
  if (m === "POST" && !id) {
    const body = await readJson(request, MAX_ROW_BYTES);
    const cnt = await env.DB.prepare("SELECT COUNT(*) AS n FROM rows WHERE slug=?1 AND tbl=?2").bind(slug, tbl).first();
    if (cnt && cnt.n >= MAX_ROWS_PER_TABLE) throw new HttpError(507, "This table is full.");
    const t = now();
    const row = Object.assign({}, body, { id: clip(body.id, 64) || randomHex(8), createdAt: t, updatedAt: t });
    await env.DB.prepare("INSERT INTO rows (slug, tbl, id, data, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?5)")
      .bind(slug, tbl, row.id, JSON.stringify(row), t)
      .run();
    return json({ ok: true, row });
  }
  if (m === "PUT" && id) {
    const body = await readJson(request, MAX_ROW_BYTES);
    const cur = await env.DB.prepare("SELECT data FROM rows WHERE slug=?1 AND tbl=?2 AND id=?3").bind(slug, tbl, id).first();
    if (!cur) return json({ ok: false, error: "not found" }, 404);
    const t = now();
    const row = Object.assign({}, JSON.parse(cur.data), body, { id, updatedAt: t });
    await env.DB.prepare("UPDATE rows SET data=?4, updated_at=?5 WHERE slug=?1 AND tbl=?2 AND id=?3").bind(slug, tbl, id, JSON.stringify(row), t).run();
    return json({ ok: true, row });
  }
  if (m === "DELETE" && id) {
    const res = await env.DB.prepare("DELETE FROM rows WHERE slug=?1 AND tbl=?2 AND id=?3").bind(slug, tbl, id).run();
    if (!res.meta || !res.meta.changes) return json({ ok: false, error: "not found" }, 404);
    return json({ ok: true });
  }
  return json({ ok: false, error: "Method not allowed" }, 405);
}

export { appSecrets };
