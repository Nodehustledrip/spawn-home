"use strict";

/**
 * On-site subscriptions via Stripe Checkout + Billing Portal.
 *
 * DORMANT unless accounts are enabled (see auth.js) AND both STRIPE_SECRET_KEY
 * and STRIPE_WEBHOOK_SECRET are set. While dormant every /api/billing/* route
 * returns 404 and /api/auth/config reports { billing: false }, so /pricing shows
 * an honest disabled state.
 *
 * Stripe calls use the REST API directly (no SDK). STRIPE_API_BASE overrides
 * the API host for local tests.
 */
const crypto = require("crypto");
const express = require("express");
const auth = require("./auth");
const store = require("./buildstore");

const SITE = "https://spawnapp.org";
const PRICES = {
  monthly: function () { return process.env.STRIPE_PRICE_MONTHLY || "price_1UWjMhAykqdxWjUJVQWtVOe5"; },
  yearly: function () { return process.env.STRIPE_PRICE_YEARLY || "price_1UWjMmAykqdxWjUJsjZ0XHs0"; },
};
const PRO_STATUSES = ["active", "trialing", "past_due"];

function siteUrl() {
  return (process.env.APP_URL || SITE).replace(/\/$/, "");
}

function enabled() {
  return !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET) && auth.enabled();
}

/* ---- Stripe REST ---- */

function encode(obj, prefix, out) {
  out = out || [];
  Object.keys(obj).forEach(function (k) {
    const v = obj[k];
    if (v === undefined || v === null) return;
    const key = prefix ? prefix + "[" + k + "]" : k;
    if (typeof v === "object") encode(v, key, out);
    else out.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(v)));
  });
  return out.join("&");
}

async function stripe(method, path, params) {
  const base = (process.env.STRIPE_API_BASE || "https://api.stripe.com").replace(/\/$/, "");
  const opts = {
    method: method,
    headers: { Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY },
    signal: AbortSignal.timeout(15000),
  };
  let url = base + path;
  if (params && method === "GET") url += "?" + encode(params);
  else if (params) {
    opts.headers["Content-Type"] = "application/x-www-form-urlencoded";
    opts.body = encode(params);
  }
  const r = await fetch(url, opts);
  const data = await r.json().catch(function () { return {}; });
  if (!r.ok) {
    const e = new Error("stripe " + r.status + " " + ((data.error && data.error.message) || "").slice(0, 200));
    e.status = r.status;
    throw e;
  }
  return data;
}

/** Verify a Stripe-Signature header (t=...,v1=...) against the raw body. */
function verifySignature(raw, header, secret, toleranceSec) {
  if (!header || !secret || !Buffer.isBuffer(raw)) return false;
  let t = null;
  const sigs = [];
  String(header).split(",").forEach(function (part) {
    const i = part.indexOf("=");
    if (i === -1) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") t = v;
    else if (k === "v1") sigs.push(v);
  });
  if (!t || !/^\d+$/.test(t) || !sigs.length) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(t)) > (toleranceSec || 300)) return false;
  const expected = crypto.createHmac("sha256", secret).update(t + "." + raw.toString("utf8")).digest("hex");
  const exp = Buffer.from(expected, "hex");
  return sigs.some(function (s) {
    const b = Buffer.from(s, "hex");
    return b.length === exp.length && crypto.timingSafeEqual(b, exp);
  });
}

/* ---- entitlement sync ---- */

function periodEndOf(sub) {
  let t = sub.current_period_end;
  if (!t && sub.items && sub.items.data && sub.items.data[0]) t = sub.items.data[0].current_period_end;
  return t ? new Date(t * 1000) : null;
}

function idOf(v) {
  return v && typeof v === "object" ? v.id : v || null;
}

async function applySubscription(sub, hintUserId) {
  const status = sub.status || "canceled";
  const pro = PRO_STATUSES.indexOf(status) !== -1;
  const customerId = idOf(sub.customer);
  const fields = {
    plan: pro ? "pro" : "free",
    status: status,
    periodEnd: pro ? periodEndOf(sub) : null,
    customerId: customerId,
    subscriptionId: sub.id,
  };
  let row = null;
  if (customerId) row = await auth.setPlan({ customerId: customerId }, fields);
  const uid = hintUserId || (sub.metadata && sub.metadata.user_id);
  if (!row && uid && /^\d+$/.test(String(uid))) row = await auth.setPlan({ userId: String(uid) }, fields);
  if (!row) console.warn("[billing] no user for subscription", sub.id);
  else console.log("[billing] user", row.id, "plan", row.plan, "status", row.plan_status);
  return row;
}

/** Latest state from Stripe (handles out-of-order events); falls back to event copy. */
async function freshSubscription(subOrId) {
  const id = idOf(subOrId);
  try {
    return await stripe("GET", "/v1/subscriptions/" + encodeURIComponent(id));
  } catch (err) {
    if (subOrId && typeof subOrId === "object") return subOrId;
    throw err;
  }
}

async function handleEvent(evt) {
  const obj = (evt.data && evt.data.object) || {};
  switch (evt.type) {
    case "checkout.session.completed": {
      if (obj.mode !== "subscription") return;
      const uid = obj.client_reference_id || (obj.metadata && obj.metadata.user_id);
      const customerId = idOf(obj.customer);
      if (uid && /^\d+$/.test(String(uid)) && customerId) {
        await store.getPool().query(
          "UPDATE users SET stripe_customer_id=$2 WHERE id=$1 AND (stripe_customer_id IS NULL OR stripe_customer_id=$2)",
          [String(uid), customerId]
        );
      }
      if (obj.subscription) await applySubscription(await freshSubscription(obj.subscription), uid);
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = evt.type === "customer.subscription.deleted" ? obj : await freshSubscription(obj);
      await applySubscription(sub, null);
      return;
    }
    case "invoice.payment_failed":
      console.warn("[billing] payment failed for customer", idOf(obj.customer));
      return;
    default:
      return;
  }
}

/* ---- routes ---- */

function notFound(res) {
  return res.status(404).json({ ok: false, error: "Not available" });
}

/** Must be mounted BEFORE express.json() so the webhook sees the raw body. */
function mountWebhook(app) {
  app.post("/api/billing/webhook", express.raw({ type: "*/*", limit: "512kb" }), async function (req, res) {
    if (!enabled()) return notFound(res);
    if (!verifySignature(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET)) {
      return res.status(400).json({ ok: false, error: "Bad signature" });
    }
    let evt;
    try {
      evt = JSON.parse(req.body.toString("utf8"));
    } catch (_) {
      return res.status(400).json({ ok: false, error: "Bad payload" });
    }
    const pool = store.getPool();
    try {
      const seen = await pool.query("SELECT 1 FROM stripe_events WHERE id=$1", [evt.id]);
      if (seen.rows.length) return res.json({ received: true, duplicate: true });
      await handleEvent(evt);
      await pool.query("INSERT INTO stripe_events (id, type) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING", [evt.id, evt.type]);
      return res.json({ received: true });
    } catch (err) {
      console.error("[billing] webhook failed", evt && evt.type, err && err.message);
      return res.status(500).json({ ok: false }); // Stripe retries
    }
  });
}

function mount(app) {
  app.post("/api/billing/checkout", async function (req, res) {
    if (!enabled()) return notFound(res);
    res.setHeader("Cache-Control", "no-store");
    const user = await auth.currentUser(req);
    if (!user) return res.status(401).json({ ok: false, error: "Sign in first.", signin: "/signin?next=/pricing" });
    const interval = (req.body && req.body.interval) === "yearly" ? "yearly" : "monthly";
    if (auth.isPro(user)) return res.status(409).json({ ok: false, error: "You're already on Pro.", pro: true });
    const params = {
      mode: "subscription",
      line_items: { 0: { price: PRICES[interval](), quantity: 1 } },
      client_reference_id: String(user.id),
      success_url: siteUrl() + "/pricing?welcome=1&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: siteUrl() + "/pricing",
      allow_promotion_codes: "true",
      metadata: { user_id: String(user.id) },
      subscription_data: { metadata: { user_id: String(user.id) } },
    };
    if (user.stripe_customer_id) params.customer = user.stripe_customer_id;
    else params.customer_email = user.email;
    try {
      const s = await stripe("POST", "/v1/checkout/sessions", params);
      return res.json({ ok: true, url: s.url });
    } catch (err) {
      console.error("[billing] checkout failed", err && err.message);
      return res.status(502).json({ ok: false, error: "Checkout is unavailable right now — try again in a minute." });
    }
  });

  app.post("/api/billing/portal", async function (req, res) {
    if (!enabled()) return notFound(res);
    res.setHeader("Cache-Control", "no-store");
    const user = await auth.currentUser(req);
    if (!user) return res.status(401).json({ ok: false, error: "Sign in first." });
    if (!user.stripe_customer_id) return res.status(400).json({ ok: false, error: "No billing account yet." });
    const ret = auth.safeNext(req.body && req.body.return) || "/build";
    try {
      const s = await stripe("POST", "/v1/billing_portal/sessions", {
        customer: user.stripe_customer_id,
        return_url: siteUrl() + ret,
      });
      return res.json({ ok: true, url: s.url });
    } catch (err) {
      console.error("[billing] portal failed", err && err.message);
      return res.status(502).json({ ok: false, error: "Billing is unavailable right now — try again in a minute." });
    }
  });

  /* Any other /api/billing/* → 404 JSON */
  app.all("/api/billing/*", function (_req, res) {
    return notFound(res);
  });
}

module.exports = { enabled, mount, mountWebhook, verifySignature, handleEvent, encode };
