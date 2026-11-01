// Spawn Cloud — serves published Spawn apps from D1 at <slug>.spawnapp.org and custom domains,
// plus the shared per-app backend (/api/*) and app-specific runtimes (BidBoard).
import { blobs } from "./blobs.js";
import { json, withSecurity, HttpError, mimeFor, SECURITY_HEADERS } from "./util.js";
import { handleShared } from "./shared.js";
import { handleBidboard } from "./bidboard.js";

const RUNTIMES = { bidboard: handleBidboard };
const RESERVED = new Set(["www", "api", "app", "apps", "admin", "cloud", "static", "assets", "cdn", "mail", "status"]);
const APP_TTL_MS = 15000;
const appCache = new Map(); // slug -> { at, app }
const hostCache = new Map(); // custom hostname -> { at, slug }

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (err) {
      if (err instanceof HttpError) return json({ ok: false, error: err.message }, err.status, err.extra);
      console.error("[spawn-cloud] unhandled", err && err.stack ? err.stack : err);
      return json({ ok: false, error: "Something went wrong on our side. Please try again." }, 500);
    }
  },
};

export function _resetCaches() {
  appCache.clear();
  hostCache.clear();
}

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const apex = (env.APEX_DOMAIN || "spawnapp.org").toLowerCase();
  let host = url.hostname.toLowerCase();
  if (env.ALLOW_HOST_OVERRIDE === "1" && request.headers.get("x-spawn-host")) host = request.headers.get("x-spawn-host").toLowerCase();

  // The marketing site (apex + www) is served by the main origin, never by this Worker.
  if (host === apex || host === "www." + apex) return fetch(request);

  const slug = await slugForHost(env, host, apex);
  if (!slug) return notFoundPage(404, "No app lives at this address.");
  const app = await loadApp(env, slug);
  if (!app || app.status !== "active" || !app.live_version) {
    return notFoundPage(404, app && app.status === "disabled" ? "This app is unavailable." : "This app isn't published right now.");
  }

  // Bundles published from the desktop reference /hosted/<slug>/...; serve them from the root.
  let path = url.pathname;
  const legacy = "/hosted/" + slug;
  if (path === legacy || path.startsWith(legacy + "/")) {
    path = path.slice(legacy.length) || "/";
    const isPage = request.method === "GET" && (/\.html?$/.test(path) || path.endsWith("/"));
    if (isPage) return Response.redirect(new URL(path + url.search, url.origin).toString(), 301);
  }

  const ctxApp = { env, ctx, app, slug, url, path, request };
  if (path.startsWith("/api/") || path === "/api" || path.startsWith("/storage/")) {
    const rt = RUNTIMES[app.runtime];
    if (rt) {
      const r = await rt(ctxApp);
      if (r) return r;
    }
    const s = await handleShared(ctxApp);
    if (s) return s;
    return json({ ok: false, error: "Not found" }, 404);
  }
  if (app.runtime === "bidboard" && path === "/paid") {
    const r = await handleBidboard(ctxApp);
    if (r) return r;
  }
  if (request.method !== "GET" && request.method !== "HEAD") return json({ ok: false, error: "Method not allowed" }, 405, { Allow: "GET, HEAD" });
  return serveStatic(ctxApp);
}

async function slugForHost(env, host, apex) {
  if (host.endsWith("." + apex)) {
    const label = host.slice(0, -(apex.length + 1));
    if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(label) || RESERVED.has(label)) return null;
    return label;
  }
  const hit = hostCache.get(host);
  if (hit && Date.now() - hit.at < APP_TTL_MS) return hit.slug;
  const row = await env.DB.prepare("SELECT slug FROM domains WHERE hostname = ?1 AND status = 'active'").bind(host).first();
  const slug = row ? row.slug : null;
  hostCache.set(host, { at: Date.now(), slug });
  return slug;
}

async function loadApp(env, slug) {
  const hit = appCache.get(slug);
  if (hit && Date.now() - hit.at < APP_TTL_MS) return hit.app;
  const row = await env.DB.prepare(
    "SELECT a.slug, a.runtime, a.status, a.live_version, a.title, a.config, v.manifest FROM apps a " +
      "LEFT JOIN versions v ON v.slug = a.slug AND v.version = a.live_version WHERE a.slug = ?1"
  )
    .bind(slug)
    .first();
  let app = null;
  if (row) {
    let files = {};
    let config = {};
    try { files = (JSON.parse(row.manifest || "{}").files) || {}; } catch (_) {}
    try { config = JSON.parse(row.config || "{}"); } catch (_) {}
    app = { slug: row.slug, runtime: row.runtime, status: row.status, live_version: row.live_version, title: row.title, config, files };
  }
  appCache.set(slug, { at: Date.now(), app });
  return app;
}

function resolvePath(files, path) {
  let p;
  try { p = decodeURIComponent(path); } catch (_) { return null; }
  if (p.includes("\0") || p.split("/").some((s) => s === "..")) return null;
  p = p.replace(/^\/+/, "");
  const cands = p === "" ? ["index.html"] : p.endsWith("/") ? [p + "index.html"] : [p, p + ".html", p + "/index.html"];
  for (const c of cands) if (files[c]) return c;
  return null;
}

async function serveStatic({ env, ctx, app, slug, path, request }) {
  let file = resolvePath(app.files, path);
  let status = 200;
  if (!file) {
    if (app.files["200.html"]) file = "200.html"; // explicit SPA fallback
    else if (app.files["404.html"]) { file = "404.html"; status = 404; }
    else return notFoundPage(404, "That page doesn't exist.");
  }
  const meta = app.files[file];
  const etag = '"' + meta.h + '"';
  const isHtml = /\.html?$/.test(file);
  const headers = new Headers(SECURITY_HEADERS);
  headers.set("Content-Type", meta.t || mimeFor(file));
  headers.set("ETag", etag);
  headers.set("Cache-Control", isHtml || file === "sw.js" ? "public, max-age=0, must-revalidate" : "public, max-age=3600, stale-while-revalidate=86400");
  headers.set("X-Spawn-Version", String(app.live_version));
  if (status === 200 && request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });

  const key = "blob/" + slug + "/" + meta.h; // content-addressed: versions share unchanged files
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request("https://spawn-cloud.cache/" + key);
  if (cache && status === 200) {
    const hit = await cache.match(cacheKey);
    if (hit) {
      const r = new Response(request.method === "HEAD" ? null : hit.body, { status, headers });
      return r;
    }
  }
  const obj = await blobs(env).get(key);
  if (!obj) return notFoundPage(404, "That page doesn't exist.");
  if (request.method === "HEAD") return new Response(null, { status, headers });
  if (cache && status === 200 && meta.s <= 5 * 1024 * 1024) {
    const [a, b] = obj.body.tee();
    ctx.waitUntil(cache.put(cacheKey, new Response(b, { headers: { "Content-Type": headers.get("Content-Type"), "Cache-Control": "public, max-age=86400" } })));
    return new Response(a, { status, headers });
  }
  return new Response(obj.body, { status, headers });
}

export function notFoundPage(status, message) {
  const html =
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex"><title>Not found</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;' +
    "font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;background:#0b0d12;color:#e8eaf0}main{text-align:center;padding:32px}" +
    "h1{font-size:22px;margin:0 0 8px}p{color:#9aa3b2;margin:0 0 20px}a{color:#8ab4ff}</style></head><body><main><h1>" +
    message.replace(/[<>&]/g, "") +
    '</h1><p>Check the link, or ask the owner for the current address.</p><a href="https://spawnapp.org/">Built with Spawn</a></main></body></html>';
  return withSecurity(new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=30" } }));
}
