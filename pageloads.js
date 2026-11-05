"use strict";

/**
 * Free first-party daily HTML document-load counter.
 * Batches in memory and UPSERTs into D1 every ~45s so writes stay cheap.
 * Never awaited on the request path; flush errors are swallowed.
 */

const crypto = require("crypto");

const FLUSH_MS = 45 * 1000;
const BOT_UA =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|headless|lighthouse|monitor|curl|wget|python|go-http|uptime|render|healthcheck|pingdom|statuscake|scrapy|httpclient|libwww|okhttp|axios|node-fetch|undici|spawn-home-keepalive|googleother|bytespider|semrush|ahrefs|yandex|baidu|duckduck|applebot|petalbot|gptbot|claudebot|anthropic|chatgpt|perplexity|bingpreview/i;

/** YYYY-MM-DD in America/Chicago. */
function chicagoDay(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date || new Date());
}

function chicagoDayOffset(daysAgo) {
  /* Walk back ~N days from now, then format in Chicago so DST boundaries stay correct. */
  const base = Date.now() - (daysAgo || 0) * 86400000;
  return chicagoDay(new Date(base));
}

function daysList(n) {
  const out = [];
  const nDays = Math.max(1, Math.min(90, Number(n) || 2));
  for (let i = 0; i < nDays; i++) out.push(chicagoDayOffset(i));
  return out;
}

function hostOf(req) {
  return String(req.headers.host || "")
    .toLowerCase()
    .split(":")[0]
    .slice(0, 253);
}

function isBot(ua) {
  const s = String(ua || "");
  return !s || BOT_UA.test(s);
}

/**
 * Count only successful HTML document loads.
 * Prefer Sec-Fetch-Dest: document; else a GET whose response Content-Type is text/html.
 * Skip HEAD, assets, API/JSON, redirects/3xx, and 4xx/5xx.
 */
function shouldCount(req, res) {
  if (req.method !== "GET") return false;
  const status = res.statusCode | 0;
  if (status < 200 || status >= 300) return false;
  if (isBot(req.headers["user-agent"])) return false;
  const dest = String(req.headers["sec-fetch-dest"] || "").toLowerCase();
  if (dest && dest !== "document") return false;
  const ct = String(res.getHeader("content-type") || "").toLowerCase();
  if (ct.includes("application/json") || ct.includes("javascript") || ct.includes("text/css") || ct.includes("image/") || ct.includes("font/") || ct.includes("audio/") || ct.includes("video/") || ct.includes("octet-stream")) {
    return false;
  }
  if (dest === "document") return true;
  return ct.includes("text/html");
}

function timingSafeEqualStr(a, b) {
  const aa = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (aa.length !== bb.length) {
    /* Still burn a compare so length mismatch isn't free. */
    const pad = Buffer.alloc(aa.length || 1);
    try { crypto.timingSafeEqual(aa.length ? aa : pad, pad); } catch (_) { /* ignore */ }
    return false;
  }
  return crypto.timingSafeEqual(aa, bb);
}

function create(opts) {
  const getPool = opts.getPool; /* () => d1 pool | null */
  const pending = new Map(); /* `${day}\0${host}` -> n */
  let timer = null;
  let flushing = false;

  function bump(host) {
    if (!host) return;
    const key = chicagoDay() + "\0" + host;
    pending.set(key, (pending.get(key) || 0) + 1);
  }

  async function flush() {
    if (flushing || pending.size === 0) return;
    const pool = typeof getPool === "function" ? getPool() : null;
    if (!pool || typeof pool.batch !== "function") return;
    flushing = true;
    const entries = Array.from(pending.entries());
    pending.clear();
    try {
      const stmts = entries.map(function (pair) {
        const parts = pair[0].split("\0");
        const day = parts[0];
        const host = parts[1];
        const n = pair[1];
        return {
          raw: true,
          sql:
            "INSERT INTO page_loads (day, host, count) VALUES (?1, ?2, ?3) " +
            "ON CONFLICT(day, host) DO UPDATE SET count = count + ?3",
          params: [day, host, n],
        };
      });
      await pool.batch(stmts);
    } catch (err) {
      /* Re-queue so a transient D1 blip doesn't drop the batch forever. */
      for (const [k, n] of entries) pending.set(k, (pending.get(k) || 0) + n);
      console.warn("[pageloads] flush failed", err && err.message);
    } finally {
      flushing = false;
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(function () {
      flush().catch(function () { /* ignore */ });
    }, FLUSH_MS);
    if (timer.unref) timer.unref();
    /* Best-effort flush on shutdown. */
    const stop = function () {
      flush().catch(function () { /* ignore */ });
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  }

  function middleware(req, res, next) {
    res.on("finish", function () {
      try {
        if (!shouldCount(req, res)) return;
        bump(hostOf(req));
      } catch (_) { /* never break responses */ }
    });
    next();
  }

  function checkAdmin(req) {
    const expected = process.env.PAGELOADS_ADMIN_KEY || "";
    if (!expected) return false;
    const header = req.headers["x-spawn-admin-key"];
    const provided = typeof header === "string" ? header : "";
    return timingSafeEqualStr(provided, expected);
  }

  async function queryLocal(days) {
    const pool = typeof getPool === "function" ? getPool() : null;
    if (!pool) return [];
    const ph = days.map(function (_, i) { return "$" + (i + 1); }).join(",");
    try {
      const r = await pool.query(
        "SELECT day, host, count FROM page_loads WHERE day IN (" + ph + ") ORDER BY day DESC, host ASC",
        days
      );
      return (r.rows || []).map(function (row) {
        return { day: row.day, host: row.host, count: Number(row.count) || 0, source: "spawn-app" };
      });
    } catch (err) {
      console.warn("[pageloads] local query failed", err && err.message);
      return [];
    }
  }

  /** Pull matching rows from spawn-cloud D1 via the Cloudflare REST API (already on Render). */
  async function queryCloud(days) {
    const acct = process.env.CF_ACCOUNT_ID;
    const token = process.env.CF_API_TOKEN;
    const dbId = process.env.CF_D1_DATABASE_ID;
    if (!acct || !token || !dbId) return [];
    const placeholders = days.map(function (_, i) { return "?" + (i + 1); }).join(",");
    const sql =
      "SELECT day, host, count FROM page_loads WHERE day IN (" + placeholders + ") ORDER BY day DESC, host ASC";
    try {
      const r = await fetch(
        "https://api.cloudflare.com/client/v4/accounts/" + acct + "/d1/database/" + dbId + "/query",
        {
          method: "POST",
          headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify({ sql: sql, params: days }),
          signal: AbortSignal.timeout(10000),
        }
      );
      const j = await r.json().catch(function () { return {}; });
      if (!r.ok || !j.success) return [];
      const rows = (j.result && j.result[0] && j.result[0].results) || [];
      return rows.map(function (row) {
        return { day: row.day, host: row.host, count: Number(row.count) || 0, source: "spawn-cloud" };
      });
    } catch (err) {
      console.warn("[pageloads] cloud query failed", err && err.message);
      return [];
    }
  }

  function mergeRows(rows) {
    const byDay = Object.create(null);
    let grand = 0;
    for (const row of rows) {
      const day = row.day;
      if (!byDay[day]) byDay[day] = { day: day, hosts: Object.create(null), total: 0 };
      const slot = byDay[day];
      slot.hosts[row.host] = (slot.hosts[row.host] || 0) + row.count;
      slot.total += row.count;
      grand += row.count;
    }
    const days = Object.keys(byDay).sort().reverse().map(function (d) {
      const slot = byDay[d];
      const hosts = Object.keys(slot.hosts)
        .sort()
        .map(function (h) { return { host: h, count: slot.hosts[h] }; });
      return { day: slot.day, total: slot.total, hosts: hosts };
    });
    return { days: days, grandTotal: grand };
  }

  function mount(app) {
    start();
    /* Early so finish fires for every route, including static + clean pages. */
    app.use(middleware);

    app.get("/api/admin/pageloads", async function (req, res) {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Pragma", "no-cache");
      if (!checkAdmin(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });
      const n = Math.max(1, Math.min(90, parseInt(String(req.query.days || "2"), 10) || 2));
      const dayKeys = daysList(n);
      const [localRows, cloudRows] = await Promise.all([queryLocal(dayKeys), queryCloud(dayKeys)]);
      const merged = mergeRows(localRows.concat(cloudRows));
      return res.json({
        ok: true,
        timezone: "America/Chicago",
        daysRequested: n,
        today: dayKeys[0],
        yesterday: dayKeys[1] || null,
        grandTotal: merged.grandTotal,
        days: merged.days,
        sources: { "spawn-app": localRows.length, "spawn-cloud": cloudRows.length },
      });
    });
  }

  return {
    mount: mount,
    middleware: middleware,
    flush: flush,
    bump: bump,
    shouldCount: shouldCount,
    isBot: isBot,
    chicagoDay: chicagoDay,
    daysList: daysList,
    timingSafeEqualStr: timingSafeEqualStr,
    checkAdmin: checkAdmin,
    mergeRows: mergeRows,
    _pending: pending,
    BOT_UA: BOT_UA,
  };
}

module.exports = {
  create: create,
  chicagoDay: chicagoDay,
  daysList: daysList,
  shouldCount: shouldCount,
  isBot: isBot,
  timingSafeEqualStr: timingSafeEqualStr,
  BOT_UA: BOT_UA,
};
