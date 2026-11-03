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
const ELITE_PRICES = {
  monthly: function () { return process.env.STRIPE_PRICE_ELITE_MONTHLY || "price_1UXWkiAykqdxWjUJ4zQyJCKT"; },
  yearly: function () { return process.env.STRIPE_PRICE_ELITE_YEARLY || "price_1UXWklAykqdxWjUJNqTufc5Q"; },
};
function priceFor(tier, interval) {
  return (tier === "elite" ? ELITE_PRICES : PRICES)[interval === "yearly" ? "yearly" : "monthly"]();
}
/** Paid tier for a Stripe price id. Unknown prices stay "pro" (every subscription before Elite was Pro). */
function tierForPrice(priceId) {
  if (priceId && (priceId === ELITE_PRICES.monthly() || priceId === ELITE_PRICES.yearly())) return "elite";
  return "pro";
}
function priceOf(sub) {
  const it = sub && sub.items && sub.items.data && sub.items.data[0];
  return it ? idOf(it.price) || (it.plan && it.plan.id) || null : null;
}
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
  const priceId = priceOf(sub);
  const fields = {
    plan: pro ? tierForPrice(priceId) : "free",
    status: status,
    periodEnd: pro ? periodEndOf(sub) : null,
    customerId: customerId,
    subscriptionId: sub.id,
    priceId: pro ? priceId : null,
  };
  /* A different subscription ending (e.g. an old Pro sub after moving to a new Elite one) must not
   * downgrade the account that is now on another active subscription. */
  if (!pro && customerId) {
    const cur = await store.getPool().query("SELECT id, stripe_subscription_id, plan_status FROM users WHERE stripe_customer_id=$1", [customerId]);
    const u = cur.rows[0];
    if (u && u.stripe_subscription_id && u.stripe_subscription_id !== sub.id && PRO_STATUSES.indexOf(u.plan_status) !== -1) {
      console.log("[billing] ignoring ended subscription", sub.id, "— user", u.id, "is on", u.stripe_subscription_id);
      return u;
    }
  }
  let row = null;
  if (customerId) row = await auth.setPlan({ customerId: customerId }, fields);
  const uid = hintUserId || (sub.metadata && sub.metadata.user_id);
  if (!row && uid && /^\d+$/.test(String(uid))) row = await auth.setPlan({ userId: String(uid) }, fields);
  if (!row) console.warn("[billing] no user for subscription", sub.id);
  else console.log("[billing] user", row.id, "plan", row.plan, "status", row.plan_status);
  if (row) { try { await require("./cloudelite").onTierChange(row.id, auth.tierOf(row)); } catch (e) { console.warn("[billing] elite tier sync failed", e && e.message); } }
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
    const tier = (req.body && req.body.tier) === "elite" ? "elite" : "pro";
    const current = auth.tierOf(user);
    if (current === tier) return res.status(409).json({ ok: false, error: "You're already on " + (tier === "elite" ? "Elite" : "Pro") + ".", tier: current, pro: true });
    if (current !== "free") {
      /* Already subscribed: switch the existing subscription instead of opening a second one (no double billing). */
      return res.status(409).json({ ok: false, error: "You already have a subscription — switch plans instead.", tier: current, change: "/api/billing/change" });
    }
    const params = {
      mode: "subscription",
      line_items: { 0: { price: priceFor(tier, interval), quantity: 1 } },
      client_reference_id: String(user.id),
      success_url: siteUrl() + "/pricing?welcome=1&tier=" + tier + "&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: siteUrl() + "/pricing",
      allow_promotion_codes: "true",
      metadata: { user_id: String(user.id), tier: tier },
      subscription_data: { metadata: { user_id: String(user.id), tier: tier } },
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

  /* What switching would cost now (Stripe's own proration preview). Read-only. */
  app.get("/api/billing/change/preview", async function (req, res) {
    if (!enabled()) return notFound(res);
    res.setHeader("Cache-Control", "no-store");
    const user = await auth.currentUser(req);
    if (!user) return res.status(401).json({ ok: false, error: "Sign in first." });
    const tier = req.query.tier === "pro" ? "pro" : "elite";
    if (auth.tierOf(user) === "free" || !user.stripe_subscription_id) return res.status(400).json({ ok: false, checkout: true });
    try {
      const sub = await stripe("GET", "/v1/subscriptions/" + encodeURIComponent(user.stripe_subscription_id));
      const item = sub.items.data[0];
      const interval = item.price && item.price.recurring && item.price.recurring.interval === "year" ? "yearly" : "monthly";
      const inv = await stripe("POST", "/v1/invoices/create_preview", {
        customer: sub.customer && (sub.customer.id || sub.customer), subscription: sub.id,
        subscription_details: { items: { 0: { id: item.id, price: priceFor(tier, interval) } }, proration_behavior: "always_invoice" },
      });
      return res.json({ ok: true, tier, interval, amountDue: inv.amount_due, currency: inv.currency });
    } catch (err) {
      console.error("[billing] preview failed", err && err.message);
      return res.json({ ok: true, tier, amountDue: null });
    }
  });

  /* Pro <-> Elite on the SAME subscription: swap the price with proration. Upgrades invoice the prorated
   * difference right away (and only apply if that payment succeeds); downgrades credit the unused time. */
  app.post("/api/billing/change", async function (req, res) {
    if (!enabled()) return notFound(res);
    res.setHeader("Cache-Control", "no-store");
    const user = await auth.currentUser(req);
    if (!user) return res.status(401).json({ ok: false, error: "Sign in first." });
    const tier = (req.body && req.body.tier) === "elite" ? "elite" : (req.body && req.body.tier) === "pro" ? "pro" : null;
    if (!tier) return res.status(400).json({ ok: false, error: "Pick a plan." });
    const current = auth.tierOf(user);
    if (current === "free" || !user.stripe_subscription_id) return res.status(400).json({ ok: false, error: "No active subscription — start one from the pricing page.", checkout: true });
    try {
      const sub = await stripe("GET", "/v1/subscriptions/" + encodeURIComponent(user.stripe_subscription_id));
      const item = sub.items && sub.items.data && sub.items.data[0];
      if (!item) throw new Error("subscription has no items");
      const curPrice = idOf(item.price);
      const curInterval = item.price && item.price.recurring && item.price.recurring.interval === "year" ? "yearly" : "monthly";
      const interval = req.body && (req.body.interval === "yearly" || req.body.interval === "monthly") ? req.body.interval : curInterval;
      const target = priceFor(tier, interval);
      if (target === curPrice) return res.status(409).json({ ok: false, error: "You're already on that plan.", tier: current });
      const upgrade = tier === "elite" && current !== "elite";
      // pending_if_incomplete only accepts a few params (no metadata / cancel_at_period_end), so those follow separately.
      let updated = await stripe("POST", "/v1/subscriptions/" + encodeURIComponent(sub.id), upgrade
        ? { items: { 0: { id: item.id, price: target } }, proration_behavior: "always_invoice", payment_behavior: "pending_if_incomplete" }
        : { items: { 0: { id: item.id, price: target } }, proration_behavior: "create_prorations", cancel_at_period_end: "false", metadata: { user_id: String(user.id), tier: tier } });
      if (upgrade && !updated.pending_update) {
        try { updated = await stripe("POST", "/v1/subscriptions/" + encodeURIComponent(sub.id), { cancel_at_period_end: "false", metadata: { user_id: String(user.id), tier: tier } }); }
        catch (e) { console.warn("[billing] change: metadata update failed", e && e.message); }
      }
      const row = await applySubscription(updated.pending_update ? sub : updated, String(user.id));
      if (updated.pending_update) return res.status(402).json({ ok: false, error: "The prorated payment didn't go through, so your plan didn't change. Update your card in Manage billing and try again." });
      return res.json({ ok: true, tier: (row && row.plan) || tier });
    } catch (err) {
      console.error("[billing] change failed", err && err.message);
      return res.status(502).json({ ok: false, error: "Couldn't switch plans right now — try again in a minute." });
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

module.exports = { enabled, mount, mountWebhook, verifySignature, handleEvent, encode, tierForPrice, priceFor };
