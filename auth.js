"use strict";

/**
 * Email magic-link sign-in + accounts.
 *
 * DORMANT unless DATABASE_URL and RESEND_API_KEY are both set and Postgres is
 * reachable (AUTH_ENABLED=0 forces it off). While dormant every auth endpoint
 * returns 404 and /api/auth/config reports { enabled: false }, so /build shows
 * no sign-in UI and behaves exactly like the session-only site.
 *
 * Entitlements live on users.plan / plan_status / current_period_end.
 * A future Stripe webhook only needs setPlan() below.
 */
const crypto = require("crypto");
const store = require("./buildstore");

const SESSION_COOKIE = "spawn_session";
const SESSION_DAYS = 30;
const TOKEN_MINUTES = 15;
const EMAIL_RE = /^[^\s@<>()",;:]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;

function num(name, def) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== "" && process.env[name] != null ? v : def;
}

/* Signed-in limits (env-configurable; 0 = no daily cap). Anonymous builds keep
 * the original BUILD_MAX_PER_OWNER / per-IP limits in builds.js. */
function limitsFor(user) {
  if (isPro(user)) {
    return {
      plan: "pro",
      maxBuilds: num("AUTH_PRO_MAX_BUILDS", 25),
      editsPerDay: num("AUTH_PRO_EDITS_PER_DAY", 300),
      editsPerMinute: num("AUTH_PRO_EDITS_PER_MIN", 60),
    };
  }
  return {
    plan: "free",
    maxBuilds: num("AUTH_FREE_MAX_BUILDS", 3),
    editsPerDay: num("AUTH_FREE_EDITS_PER_DAY", 30),
    editsPerMinute: num("AUTH_FREE_EDITS_PER_MIN", 20),
  };
}

function isPro(user) {
  if (!user || user.plan !== "pro") return false;
  if (user.plan_status && ["active", "trialing", "past_due"].indexOf(user.plan_status) === -1) return false;
  if (user.current_period_end && new Date(user.current_period_end).getTime() < Date.now()) return false;
  return true;
}

function configured() {
  const flag = String(process.env.AUTH_ENABLED || "").toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") return false;
  return !!(process.env.DATABASE_URL && process.env.RESEND_API_KEY);
}

/** Live check: keys present AND Postgres store is ready. */
function enabled() {
  return configured() && !!store.getPool();
}

function sha(v) {
  return crypto.createHash("sha256").update("spawn-auth:" + v).digest("hex");
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || "")
    .split(";")
    .forEach(function (part) {
      const i = part.indexOf("=");
      if (i === -1) return;
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      } catch (_) {}
    });
  return out;
}

function secureCookies() {
  return process.env.NODE_ENV === "production" || !!process.env.RENDER || process.env.AUTH_SECURE_COOKIE === "1";
}

function sessionCookie(value, maxAge) {
  const parts = [SESSION_COOKIE + "=" + encodeURIComponent(value), "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=" + maxAge];
  if (secureCookies()) parts.push("Secure");
  return parts.join("; ");
}

function appendCookie(res, c) {
  const prev = res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie", prev ? [].concat(prev, c) : c);
}

/** Signed-in user for this request (cached), or null. Never throws. */
async function currentUser(req) {
  if (req._spawnUser !== undefined) return req._spawnUser;
  req._spawnUser = null;
  if (!enabled()) return null;
  const sid = parseCookies(req)[SESSION_COOKIE];
  if (!sid || !/^[A-Za-z0-9_-]{32,64}$/.test(sid)) return null;
  try {
    const r = await store
      .getPool()
      .query(
        "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash=$1 AND s.expires_at > now()",
        [sha("s:" + sid)]
      );
    req._spawnUser = r.rows[0] || null;
  } catch (err) {
    console.error("[auth] session lookup failed", err && err.message);
  }
  return req._spawnUser;
}

function ownerFor(user) {
  return "u:" + user.id;
}

/** For a future Stripe webhook: find by user id or stripe customer id and set entitlement. */
async function setPlan(match, fields) {
  const pool = store.getPool();
  if (!pool) throw new Error("accounts not available");
  const where = match.userId ? "id=$1" : match.email ? "email=lower($1)" : "stripe_customer_id=$1";
  const key = match.userId || match.email || match.customerId;
  const r = await pool.query(
    "UPDATE users SET plan=COALESCE($2, plan), plan_status=$3, current_period_end=$4," +
      " stripe_customer_id=COALESCE($5, stripe_customer_id), stripe_subscription_id=COALESCE($6, stripe_subscription_id)" +
      " WHERE " + where + " RETURNING id, email, plan, plan_status, current_period_end",
    [
      key,
      fields.plan || null,
      fields.status || null,
      fields.periodEnd ? new Date(fields.periodEnd) : null,
      fields.customerId || null,
      fields.subscriptionId || null,
    ]
  );
  return r.rows[0] || null;
}

/* ---- email ---- */

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function emailHtml(link) {
  const l = esc(link);
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in to Spawn</title></head>' +
    '<body style="margin:0;padding:0;background:#f4f2ee;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Inter,Helvetica,Arial,sans-serif;color:#1a1814;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ee;padding:40px 16px;"><tr><td align="center">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e6e1d8;border-radius:14px;">' +
    '<tr><td style="padding:32px 36px 8px 36px;">' +
    '<div style="font-size:15px;font-weight:600;letter-spacing:-0.01em;color:#1a1814;">Spawn</div></td></tr>' +
    '<tr><td style="padding:20px 36px 0 36px;">' +
    '<h1 style="margin:0 0 12px 0;font-size:22px;line-height:1.3;font-weight:600;letter-spacing:-0.02em;">Sign in to Spawn</h1>' +
    '<p style="margin:0 0 28px 0;font-size:15px;line-height:1.6;color:#4a463f;">Use the button below to sign in and get back to your builds. The link works once and expires in ' + TOKEN_MINUTES + ' minutes.</p>' +
    '<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:#1a1814;">' +
    '<a href="' + l + '" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">Sign in</a>' +
    '</td></tr></table>' +
    '<p style="margin:28px 0 0 0;font-size:13px;line-height:1.6;color:#7a756c;">Or paste this link into your browser:<br><a href="' + l + '" style="color:#8a5a2b;word-break:break-all;">' + l + '</a></p>' +
    '</td></tr>' +
    '<tr><td style="padding:28px 36px 32px 36px;"><div style="border-top:1px solid #eee9e0;padding-top:18px;font-size:12px;line-height:1.6;color:#9a958b;">If you didn’t ask to sign in, you can ignore this email — nothing will change.<br>Spawn · spawnapp.org</div></td></tr>' +
    '</table></td></tr></table></body></html>'
  );
}

function emailText(link) {
  return (
    "Sign in to Spawn\n\nOpen this link to sign in and get back to your builds:\n\n" + link +
    "\n\nThe link works once and expires in " + TOKEN_MINUTES + " minutes.\n" +
    "If you didn't ask to sign in, you can ignore this email.\n\nSpawn · spawnapp.org\n"
  );
}

async function sendEmail(to, link) {
  const base = (process.env.RESEND_API_BASE || "https://api.resend.com").replace(/\/$/, "");
  const r = await fetch(base + "/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || "Spawn <signin@spawnapp.org>",
      to: [to],
      subject: "Sign in to Spawn",
      html: emailHtml(link),
      text: emailText(link),
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error("resend " + r.status + " " + (await r.text()).slice(0, 200));
}

function baseUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.RENDER || process.env.NODE_ENV === "production") return "https://spawnapp.org";
  return req.protocol + "://" + req.get("host");
}

/* ---- rate limits ---- */
const buckets = new Map();
function hit(key, windowMs, max) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.start > windowMs) {
    b = { start: now, count: 0, windowMs: windowMs };
    buckets.set(key, b);
  }
  if (b.count >= max) return false; // rejected attempts don't consume quota
  b.count += 1;
  return true;
}
setInterval(function () {
  const now = Date.now();
  buckets.forEach(function (b, k) {
    if (now - b.start > b.windowMs) buckets.delete(k);
  });
}, 10 * 60 * 1000).unref();

/** Per-account daily edit cap. Returns true when allowed. */
function editAllowed(user) {
  const lim = limitsFor(user);
  if (!hit("epm:" + user.id, 60 * 1000, lim.editsPerMinute || 1e9)) return false;
  if (!lim.editsPerDay) return true;
  return hit("epd:" + user.id, 24 * 60 * 60 * 1000, lim.editsPerDay);
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || "unknown";
}

function notAvailable(res) {
  return res.status(404).json({ ok: false, error: "Not available" });
}

function mount(app, hooks) {
  hooks = hooks || {};

  app.get("/api/auth/config", function (_req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, enabled: enabled() });
  });

  app.post("/api/auth/request", async function (req, res) {
    if (!enabled()) return notAvailable(res);
    res.setHeader("Cache-Control", "no-store");
    const generic = { ok: true, message: "If that address can sign in, a link is on its way. Check your email." };
    const email = String((req.body && req.body.email) || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) {
      return res.status(400).json({ ok: false, error: "Enter a valid email address." });
    }
    const ip = clientIp(req);
    const ipOk = hit("rq-ip:" + ip, 15 * 60 * 1000, num("AUTH_REQ_PER_IP", 6));
    const emOk = hit("rq-em:" + email, 15 * 60 * 1000, num("AUTH_REQ_PER_EMAIL", 3));
    if (!ipOk) return res.status(429).json({ ok: false, error: "Too many sign-in requests. Try again in a few minutes." });
    if (!emOk) return res.json(generic); // silently drop; don't reveal anything
    try {
      const token = crypto.randomBytes(32).toString("base64url");
      await store
        .getPool()
        .query("INSERT INTO login_tokens (token_hash, email, expires_at) VALUES ($1,$2, now() + ($3 || ' minutes')::interval)", [
          sha("t:" + token),
          email,
          String(TOKEN_MINUTES),
        ]);
      await sendEmail(email, baseUrl(req) + "/auth/verify?token=" + token);
      console.log("[auth] sign-in link sent");
    } catch (err) {
      console.error("[auth] request failed", err && err.message);
    }
    return res.json(generic);
  });

  app.get("/auth/verify", async function (req, res) {
    if (!enabled()) return res.status(404).type("text").send("Not found");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    const token = String(req.query.token || "");
    if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) return res.redirect(302, "/build?signin=invalid");
    try {
      const pool = store.getPool();
      const t = await pool.query(
        "UPDATE login_tokens SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL AND expires_at > now() RETURNING email",
        [sha("t:" + token)]
      );
      if (!t.rows.length) return res.redirect(302, "/build?signin=expired");
      const email = t.rows[0].email;
      const u = await pool.query(
        "INSERT INTO users (email) VALUES ($1) ON CONFLICT (email) DO UPDATE SET email=EXCLUDED.email RETURNING id",
        [email]
      );
      const sid = crypto.randomBytes(32).toString("base64url");
      await pool.query(
        "INSERT INTO sessions (id_hash, user_id, expires_at) VALUES ($1,$2, now() + interval '" + SESSION_DAYS + " days')",
        [sha("s:" + sid), u.rows[0].id]
      );
      pool.query("DELETE FROM login_tokens WHERE expires_at < now() - interval '1 day'").catch(function () {});
      pool.query("DELETE FROM sessions WHERE expires_at < now()").catch(function () {});
      appendCookie(res, sessionCookie(sid, SESSION_DAYS * 24 * 60 * 60));
      return res.redirect(302, "/build?signed_in=1");
    } catch (err) {
      console.error("[auth] verify failed", err && err.message);
      return res.redirect(302, "/build?signin=error");
    }
  });

  app.post("/api/auth/logout", async function (req, res) {
    if (!enabled()) return notAvailable(res);
    const sid = parseCookies(req)[SESSION_COOKIE];
    if (sid) {
      try {
        await store.getPool().query("DELETE FROM sessions WHERE id_hash=$1", [sha("s:" + sid)]);
      } catch (_) {}
    }
    appendCookie(res, sessionCookie("", 0));
    return res.json({ ok: true });
  });

  app.get("/api/me", async function (req, res) {
    if (!enabled()) return notAvailable(res);
    res.setHeader("Cache-Control", "no-store");
    const user = await currentUser(req);
    if (!user) return res.json({ ok: true, signedIn: false });
    const lim = limitsFor(user);
    return res.json({ ok: true, signedIn: true, email: user.email, plan: lim.plan, limits: lim });
  });

  /* Move this browser's anonymous builds into the account (idempotent). */
  app.post("/api/auth/claim", async function (req, res) {
    if (!enabled()) return notAvailable(res);
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ ok: false, error: "Sign in first." });
    try {
      const out = await hooks.claim(req, res, user);
      return res.json({ ok: true, claimed: out });
    } catch (err) {
      console.error("[auth] claim failed", err && err.message);
      return res.status(500).json({ ok: false, error: "Could not move your builds — try again." });
    }
  });
}

module.exports = { mount, enabled, configured, currentUser, ownerFor, limitsFor, isPro, editAllowed, setPlan, emailHtml };
