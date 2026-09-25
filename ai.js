"use strict";

/**
 * Public product AI chat — visitor-facing only.
 * NEVER edits files, secrets, admin, or deploy. Requires AI_API_KEY in project Secrets/.env.
 */
const https = require("https");
const http = require("http");
const { URL } = require("url");

const RATE = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 20;

const SYSTEM =
  "You are a helpful product assistant for THIS app. Help visitors with product features, how-to, pricing, and workflows. " +
  "Refuse any request to change source code, edit files, reveal secrets, access admin panels, deploy, or reconfigure the server. " +
  "Stay on product help only. Never claim you can rewrite the app. Never mention third-party builders.";

function clientIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  return xf || (req.socket && req.socket.remoteAddress) || "local";
}

function rateOk(ip) {
  const now = Date.now();
  let arr = RATE.get(ip) || [];
  arr = arr.filter(function (t) {
    return now - t < WINDOW_MS;
  });
  if (arr.length >= MAX_PER_WINDOW) {
    RATE.set(ip, arr);
    return false;
  }
  arr.push(now);
  RATE.set(ip, arr);
  return true;
}

function httpJson(urlStr, opts) {
  opts = opts || {};
  return new Promise(function (resolve, reject) {
    let u;
    try {
      u = new URL(urlStr);
    } catch (err) {
      return reject(err);
    }
    const lib = u.protocol === "http:" ? http : https;
    const body = opts.body != null ? (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)) : null;
    const headers = Object.assign({}, opts.headers || {});
    if (body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    if (body) headers["Content-Length"] = Buffer.byteLength(body);
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === "http:" ? 80 : 443),
        path: u.pathname + (u.search || ""),
        method: opts.method || "GET",
        headers: headers,
        timeout: opts.timeout || 45000,
      },
      function (res) {
        const chunks = [];
        res.on("data", function (c) {
          chunks.push(c);
        });
        res.on("end", function () {
          const raw = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch (_) {}
          resolve({ status: res.statusCode || 0, raw: raw, json: json });
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", function () {
      req.destroy();
      reject(new Error("AI request timed out"));
    });
    if (body) req.write(body);
    req.end();
  });
}

function looksLikeCodeChangeAsk(msg) {
  const s = String(msg || "").toLowerCase();
  return (
    /\b(rewrite|edit|patch|deploy|delete file|source code|\.env|api[_ ]?key|admin panel|ssh|shell|rm -rf)\b/.test(s) ||
    /\b(change the (server|code|backend|database schema))\b/.test(s)
  );
}

async function callModel(message) {
  const key = String(process.env.AI_API_KEY || "").trim();
  if (!key) {
    return {
      ok: false,
      configured: false,
      error:
        "AI chat is not configured. Set AI_API_KEY in Secrets (or this project's .env), then Re-Run the app. No fake model replies.",
    };
  }
  if (looksLikeCodeChangeAsk(message)) {
    return {
      ok: true,
      configured: true,
      reply:
        "I can help with product questions only — I won't change source code, secrets, admin settings, or deploys. Ask how a feature works instead.",
    };
  }

  const baseRaw = (process.env.AI_BASE_URL || "").toString().replace(/\/$/, "");
  const model = process.env.AI_MODEL || "";
  const isAnthropic =
    /^sk-ant-/i.test(key) ||
    /anthropic/i.test(baseRaw) ||
    /^claude/i.test(model);

  if (isAnthropic) {
    const base = baseRaw || "https://api.anthropic.com";
    const url = /\/v1\/messages$/.test(base) ? base : base.replace(/\/v1$/, "") + "/v1/messages";
    const res = await httpJson(url, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: {
        model: model || "claude-3-5-haiku-latest",
        max_tokens: 700,
        system: SYSTEM,
        messages: [{ role: "user", content: String(message).slice(0, 3000) }],
      },
    });
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, configured: true, error: "Model error HTTP " + res.status };
    }
    const blocks = (res.json && res.json.content) || [];
    const reply = blocks
      .map(function (b) {
        return b.text || "";
      })
      .join("\n")
      .trim();
    return { ok: true, configured: true, reply: reply || "I couldn't form a reply — try again." };
  }

  const base = baseRaw || "https://api.openai.com/v1";
  const url = /\/chat\/completions$/.test(base) ? base : base + "/chat/completions";
  const res = await httpJson(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    },
    body: {
      model: model || "gpt-4o-mini",
      temperature: 0.4,
      max_tokens: 700,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: String(message).slice(0, 3000) },
      ],
    },
  });
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, configured: true, error: "Model error HTTP " + res.status };
  }
  const reply =
    (res.json &&
      res.json.choices &&
      res.json.choices[0] &&
      res.json.choices[0].message &&
      res.json.choices[0].message.content) ||
    "";
  return { ok: true, configured: true, reply: String(reply).trim() || "I couldn't form a reply — try again." };
}

function mount(app) {
  app.post("/api/ai/chat", function (req, res) {
    const ip = clientIp(req);
    if (!rateOk(ip)) {
      return res.status(429).json({ ok: false, error: "Too many messages — wait a moment and try again." });
    }
    const msg = String((req.body && (req.body.message || req.body.text)) || "").trim();
    if (!msg) return res.status(400).json({ ok: false, error: "Message required" });
    if (msg.length > 3000) return res.status(400).json({ ok: false, error: "Message too long" });

    callModel(msg)
      .then(function (out) {
        if (!out.ok) {
          return res.status(out.configured === false ? 503 : 502).json({
            ok: false,
            configured: !!out.configured,
            error: out.error || "AI unavailable",
            reply: out.error,
          });
        }
        res.json({ ok: true, configured: true, reply: out.reply });
      })
      .catch(function (err) {
        res.status(502).json({ ok: false, error: err.message || String(err) });
      });
  });

  app.get("/api/ai/status", function (_req, res) {
    const configured = !!String(process.env.AI_API_KEY || "").trim();
    res.json({
      ok: true,
      configured: configured,
      message: configured
        ? "Product assistant ready"
        : "Set AI_API_KEY in Secrets to enable the product assistant",
    });
  });
}

module.exports = { mount };
