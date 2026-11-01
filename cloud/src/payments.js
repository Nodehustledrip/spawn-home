// Payments for any Spawn app whose owner connected their own Stripe account on spawnapp.org (no Stripe Connect).
// Secrets written by the connect flow (encrypted per app): STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_CONNECT_META.
// Prices come only from the app's published pricing.json, never from the browser. Access is granted only from
// Stripe-confirmed state: a signed webhook, or a Checkout Session read back from Stripe with payment_status=paid.
import { json, readJson, HttpError, clientIp, rateLimit, validEmail, clip, appSecrets, now } from "./util.js";
import { stripeApi, verifyStripeSignature, StripeError } from "./stripe.js";
import { currentAppUser } from "./auth.js";
import { blobs } from "./blobs.js";

const NO_STORE = { "Cache-Control": "private, no-store" };
const GRANT = new Set(["paid", "active"]); // statuses that unlock
const SUB_OFF = new Set(["past_due", "unpaid", "canceled", "incomplete_expired"]);
const KINDS = new Set(["cart", "booking", "membership"]);
const REF = /^[A-Z]{2}-[A-Z0-9]{6}$/;

export async function stripeConfig(env, slug) {
  const s = await appSecrets(env, slug);
  const key = String(s.STRIPE_SECRET_KEY || ""), whsec = String(s.STRIPE_WEBHOOK_SECRET || "");
  let meta = {}; try { meta = JSON.parse(s.STRIPE_CONNECT_META || "{}"); } catch (_) {}
  const connected = /^(sk|rk)_(test|live)_/.test(key) && /^whsec_/.test(whsec);
  return { connected, key, whsec, mode: /_live_/.test(key) ? "live" : "test" , meta };
}

const catCache = new Map();
export async function loadCatalog(c) {
  const meta = c.app.files && c.app.files["pricing.json"];
  if (!meta) return null;
  const k = c.slug + ":" + meta.h;
  if (catCache.has(k)) return catCache.get(k);
  const obj = await blobs(c.env).get("blob/" + c.slug + "/" + meta.h);
  if (!obj) return null;
  let cat; try { cat = JSON.parse(await new Response(obj.body).text()); } catch (_) { return null; }
  if (!cat || typeof cat !== "object" || !cat.items || typeof cat.items !== "object") return null;
  catCache.set(k, cat);
  return cat;
}

const cents = (v) => (Number.isInteger(v) && v >= 0 && v <= 99999900 ? v : null);
function line(name, amount, currency, qty, recurring, price) {
  if (price && /^price_[A-Za-z0-9]+$/.test(price)) return { price, quantity: qty };
  const l = { price_data: { currency, unit_amount: amount, product_data: { name: clip(name, 120) || "Item" } }, quantity: qty };
  if (recurring) l.price_data.recurring = { interval: recurring };
  return l;
}

/** Build Checkout line items + expected total purely from the published catalog. */
export function priceOrder(cat, kind, b) {
  const currency = /^[a-z]{3}$/.test(String(cat.currency || "")) ? cat.currency : "usd";
  const items = cat.items;
  const out = { currency, lines: [], summary: [], total: 0, mode: "payment", exact: true };
  const add = (name, amount, qty, recurring, price) => {
    if (cents(amount) == null) throw new HttpError(400, "This item has no valid price yet.");
    out.lines.push(line(name, amount, currency, qty, recurring, price)); out.summary.push({ name, amount, qty });
    out.total += amount * qty; if (price) out.exact = false;
  };
  if (kind === "cart") {
    const list = Array.isArray(b.items) ? b.items : [];
    if (!list.length || list.length > 30) throw new HttpError(400, "Your cart is empty.");
    for (const x of list) {
      const it = items[String(x && x.id)]; if (!it || it.interval) throw new HttpError(400, "One of the items isn't available.");
      const qty = x.qty == null ? 1 : Number(x.qty); if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw new HttpError(400, "Pick a quantity between 1 and 20.");
      let amount = it.amount, name = it.name, price = it.price;
      if (it.variants && typeof it.variants === "object") {
        const v = String(x.variant || ""); if (!(v in it.variants)) throw new HttpError(400, "Pick an option for " + (it.name || "that item") + ".");
        const vv = it.variants[v]; amount = typeof vv === "object" ? vv.amount : vv; price = typeof vv === "object" ? vv.price : null; name = it.name + " — " + v;
      }
      add(name, amount, qty, null, price);
    }
    const sh = cat.shipping || {}; const goods = out.total;
    if (cents(sh.flat) && !(cents(sh.freeOver) && goods >= sh.freeOver)) add(sh.name || "Shipping", sh.flat, 1, null, null);
  } else if (kind === "booking") {
    const it = items[String(b.item)]; if (!it || it.interval) throw new HttpError(400, "Pick a service.");
    const opt = b.option === "full" ? "full" : "deposit";
    if (opt === "deposit") {
      const dep = cents(it.deposit) != null ? it.deposit : cat.deposit;
      if (!cents(dep)) throw new HttpError(400, "Deposits aren't set up for this service.");
      add("Deposit — " + it.name, Math.min(dep, it.amount || dep), 1, null, null);
    } else add(it.name, it.amount, 1, null, it.price);
    out.option = opt;
  } else if (kind === "membership") {
    const it = items[String(b.item)]; if (!it || !it.interval) throw new HttpError(400, "Pick a membership plan.");
    if (!["day", "week", "month", "year"].includes(it.interval)) throw new HttpError(400, "That plan isn't set up yet.");
    add(it.name, it.amount, 1, it.interval, it.price); out.mode = "subscription";
  }
  if (out.total < 50) throw new HttpError(400, "There's nothing to pay for this one.");
  return out;
}

function newRef(prefix) {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", r = crypto.getRandomValues(new Uint8Array(6));
  return prefix + "-" + [...r].map((x) => a[x % a.length]).join("");
}
function backPath(p) { p = String(p || "/"); return /^\/(?!\/)[A-Za-z0-9\-._~/]*$/.test(p) && p.length < 200 ? p : "/"; }

async function getPay(env, slug, where, v) {
  return env.DB.prepare("SELECT * FROM app_payments WHERE slug=?1 AND " + where + "=?2 ORDER BY created_at DESC LIMIT 1").bind(slug, v).first();
}
async function setPay(env, slug, ref, fields) {
  const keys = Object.keys(fields); if (!keys.length) return;
  const sets = keys.map((k, i) => k + "=?" + (i + 3)).join(", ");
  await env.DB.prepare("UPDATE app_payments SET " + sets + ", updated_at=?" + (keys.length + 3) + " WHERE slug=?1 AND ref=?2")
    .bind(slug, ref, ...keys.map((k) => fields[k]), now()).run();
}

async function createCheckout(c, S) {
  const { env, slug, request, url } = c;
  await rateLimit(env, `pay:${slug}:${clientIp(request)}`, 20, 600);
  const b = await readJson(request, 8192);
  const kind = String(b.kind || ""); if (!KINDS.has(kind)) throw new HttpError(400, "Unknown checkout type.");
  const cat = await loadCatalog(c); if (!cat) throw new HttpError(409, "This app has no pricing.json yet, so it can't take card payments.");
  const order = priceOrder(cat, kind, b); // ignores any amount sent by the browser
  let email = clip(b.email, 254).toLowerCase(), name = clip(b.name, 120);
  if (kind === "membership") {
    const u = await currentAppUser(c); if (!u) throw new HttpError(401, "Create an account or sign in first.");
    email = String(u.email).toLowerCase(); name = name || u.name || "";
  }
  if (email && !validEmail(email)) throw new HttpError(400, "Enter a valid email.");
  let ref = String(b.ref || "").toUpperCase();
  const prefix = kind === "cart" ? "OR" : kind === "booking" ? "BK" : "MB";
  if (!REF.test(ref)) ref = newRef(prefix);
  const prev = await getPay(env, slug, "ref", ref);
  if (prev && prev.status !== "pending") ref = newRef(prefix);
  const back = backPath(b.returnPath), origin = url.origin;
  const params = {
    mode: order.mode, line_items: order.lines, client_reference_id: ref,
    success_url: origin + back + "?paid=1&ref=" + ref + "&session_id={CHECKOUT_SESSION_ID}",
    cancel_url: origin + back + "?canceled=1&ref=" + ref,
    metadata: { spawn_app: slug, spawn_ref: ref, spawn_kind: kind },
  };
  if (email) params.customer_email = email;
  if (order.mode === "subscription") params.subscription_data = { metadata: { spawn_app: slug, spawn_ref: ref } };
  else params.payment_intent_data = { metadata: { spawn_app: slug, spawn_ref: ref } };
  if (kind === "cart" && cat.shipping && Array.isArray(cat.shipping.countries)) params.shipping_address_collection = { allowed_countries: cat.shipping.countries.slice(0, 50) };
  let s;
  try { s = await stripeApi(env, S.key, "POST", "/v1/checkout/sessions", params, "spawn-" + slug + "-" + ref + "-" + Date.now()); }
  catch (e) { if (e instanceof StripeError) throw new HttpError(502, "Stripe didn't accept this checkout. The owner may need to check their Stripe connection."); throw e; }
  const t = now();
  const details = JSON.stringify({ option: order.option || null, info: typeof b.details === "object" && b.details ? Object.fromEntries(Object.entries(b.details).slice(0, 12).map(([k, v]) => [clip(k, 40), clip(v, 200)])) : {} });
  const expected = Number.isInteger(s.amount_total) ? s.amount_total : order.total;
  await env.DB.prepare(`INSERT INTO app_payments (slug, ref, kind, item, email, name, status, amount, currency, lines, details, session_id, created_at, updated_at)
    VALUES (?1,?2,?3,?4,?5,?6,'pending',?7,?8,?9,?10,?11,?12,?12)
    ON CONFLICT(slug, ref) DO UPDATE SET status='pending', amount=excluded.amount, lines=excluded.lines, details=excluded.details, session_id=excluded.session_id, email=excluded.email, updated_at=excluded.updated_at`)
    .bind(slug, ref, kind, kind === "cart" ? null : String(b.item), email || null, name || null, expected, order.currency, JSON.stringify(order.summary), details, s.id, t).run();
  return json({ ok: true, url: s.url, ref, amount: expected, currency: order.currency }, 200, NO_STORE);
}

/** Apply a Checkout Session that Stripe reports (webhook or read-back). Unlocks only when Stripe says paid and the amount matches. */
async function applySession(env, slug, o, how) {
  const md = o.metadata || {};
  if (md.spawn_app !== slug || !md.spawn_ref) return "ignored";
  const p = await getPay(env, slug, "ref", String(md.spawn_ref));
  if (!p || p.session_id !== o.id) return "ignored";
  if (how === "failed") { if (p.status === "pending" || p.status === "processing") await setPay(env, slug, p.ref, { status: "failed" }); return "failed"; }
  const paid = o.payment_status === "paid" || how === "async_ok";
  if (!paid) { if (p.status === "pending") await setPay(env, slug, p.ref, { status: "processing" }); return "processing"; }
  if (Number(o.amount_total) !== Number(p.amount) || String(o.currency || "").toLowerCase() !== p.currency) {
    console.warn("[payments] amount mismatch", slug, p.ref);
    await setPay(env, slug, p.ref, { status: "amount_mismatch" }); return "mismatch";
  }
  if (GRANT.has(p.status) || p.status === "refunded" || p.status === "canceled") return "already";
  await setPay(env, slug, p.ref, {
    status: p.kind === "membership" ? "active" : "paid", paid_amount: Number(o.amount_total),
    payment_intent: o.payment_intent || null, subscription_id: o.subscription || null, customer_id: o.customer || null,
    email: p.email || (o.customer_details && o.customer_details.email ? String(o.customer_details.email).toLowerCase() : null),
  });
  return "paid";
}

async function handleEvent(env, slug, evt) {
  const o = (evt.data && evt.data.object) || {};
  switch (evt.type) {
    case "checkout.session.completed": return applySession(env, slug, o, "completed");
    case "checkout.session.async_payment_succeeded": return applySession(env, slug, o, "async_ok");
    case "checkout.session.async_payment_failed": return applySession(env, slug, o, "failed");
    case "invoice.paid": {
      const sub = o.subscription || (o.parent && o.parent.subscription_details && o.parent.subscription_details.subscription);
      if (!sub) return "ignored";
      const p = await getPay(env, slug, "subscription_id", String(sub)); if (!p) return "ignored";
      const end = o.lines && o.lines.data && o.lines.data[0] && o.lines.data[0].period ? o.lines.data[0].period.end : null;
      if (p.status === "canceled" || p.status === "refunded") return "ignored";
      await setPay(env, slug, p.ref, { status: "active", period_end: Number.isInteger(end) ? end : p.period_end, paid_amount: Number(p.paid_amount || 0) || Number(o.amount_paid || 0) });
      return "active";
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const p = await getPay(env, slug, "subscription_id", String(o.id)); if (!p) return "ignored";
      const st = evt.type === "customer.subscription.deleted" ? "canceled" : String(o.status || "");
      if (SUB_OFF.has(st)) { await setPay(env, slug, p.ref, { status: st }); return st; }
      if ((st === "active" || st === "trialing") && p.status !== "refunded") { await setPay(env, slug, p.ref, { status: "active", period_end: Number.isInteger(o.current_period_end) ? o.current_period_end : p.period_end }); return "active"; }
      return "ignored";
    }
    case "charge.refunded": {
      if (!o.payment_intent) return "ignored";
      const p = await getPay(env, slug, "payment_intent", String(o.payment_intent)); if (!p) return "ignored";
      const full = Number(o.amount_refunded || 0) >= Number(o.amount || p.paid_amount || 0);
      await setPay(env, slug, p.ref, { status: full ? "refunded" : "partially_refunded", refunded_amount: Number(o.amount_refunded || 0) });
      return full ? "refunded" : "partial";
    }
  }
  return "ignored";
}

async function webhook(c, S) {
  const { env, slug, request } = c;
  const payload = await request.text();
  if (!S.whsec) return json({ ok: false, error: "Stripe isn't connected for this app." }, 400);
  if (payload.length > 512 * 1024) return json({ ok: false, error: "too large" }, 413);
  if (!(await verifyStripeSignature(payload, request.headers.get("stripe-signature"), S.whsec))) return json({ ok: false, error: "bad signature" }, 400);
  let evt; try { evt = JSON.parse(payload); } catch { return json({ ok: false, error: "bad payload" }, 400); }
  if (!evt || !/^evt_/.test(String(evt.id || "")) || !evt.type) return json({ ok: false, error: "bad payload" }, 400);
  const key = "pay:" + slug + ":" + evt.id;
  if (await env.DB.prepare("SELECT 1 FROM stripe_events WHERE id=?1").bind(key).first()) return json({ ok: true, duplicate: true });
  let result;
  try { result = await handleEvent(env, slug, evt); }
  catch (e) { console.error("[payments] webhook failed", evt.type, e.message); return json({ ok: false }, 500); }
  await env.DB.prepare("INSERT OR IGNORE INTO stripe_events (id, slug, type) VALUES (?1,?2,?3)").bind(key, slug, evt.type).run();
  return json({ ok: true, result });
}

function publicView(p) {
  let d = {}; try { d = JSON.parse(p.details || "{}"); } catch (_) {}
  return { ref: p.ref, kind: p.kind, status: p.status, unlocked: GRANT.has(p.status), amount: p.amount, paid: p.paid_amount, currency: p.currency, option: d.option || null };
}

async function payStatus(c, S) {
  const { env, slug, url } = c;
  const ref = String(url.searchParams.get("ref") || "").toUpperCase(), sid = String(url.searchParams.get("session_id") || "");
  if (!REF.test(ref) || !/^cs_[A-Za-z0-9_]+$/.test(sid)) throw new HttpError(400, "Missing payment reference.");
  let p = await getPay(env, slug, "ref", ref);
  if (!p || p.session_id !== sid) throw new HttpError(404, "We couldn't find that payment.");
  if ((p.status === "pending" || p.status === "processing") && S.connected) { // webhook may be late: ask Stripe directly
    await rateLimit(env, `paystat:${slug}:${clientIp(c.request)}`, 30, 600);
    try { const s = await stripeApi(env, S.key, "GET", "/v1/checkout/sessions/" + encodeURIComponent(sid)); if (s && s.status === "complete") await applySession(env, slug, s, "completed"); } catch (_) {}
    p = await getPay(env, slug, "ref", ref);
  }
  return json({ ok: true, payment: publicView(p) }, 200, NO_STORE);
}

/** Paid, active membership for this email (used by members.js). */
export async function paidMember(env, slug, email) {
  if (!email) return false;
  const r = await env.DB.prepare("SELECT 1 FROM app_payments WHERE slug=?1 AND kind='membership' AND email=?2 AND status IN ('active','paid') LIMIT 1").bind(slug, String(email).toLowerCase()).first();
  return !!r;
}
export async function memberPayments(env, slug) {
  const { results } = await env.DB.prepare("SELECT email, status, item, updated_at FROM app_payments WHERE slug=?1 AND kind='membership' ORDER BY updated_at DESC").bind(slug).all();
  const m = new Map(); for (const r of results || []) if (!m.has(r.email)) m.set(r.email, r);
  return m;
}
export async function ownerPayments(env, slug, kind) {
  const q = kind ? env.DB.prepare("SELECT * FROM app_payments WHERE slug=?1 AND kind=?2 ORDER BY created_at DESC LIMIT 500").bind(slug, kind)
    : env.DB.prepare("SELECT * FROM app_payments WHERE slug=?1 ORDER BY created_at DESC LIMIT 500").bind(slug);
  const { results } = await q.all();
  return (results || []).filter((p) => p.status !== "pending" || Date.parse(p.created_at) > Date.now() - 86400000).map((p) => {
    let d = {}, l = []; try { d = JSON.parse(p.details || "{}"); l = JSON.parse(p.lines || "[]"); } catch (_) {}
    return { ref: p.ref, kind: p.kind, item: p.item, email: p.email, name: p.name, status: p.status, amount: p.amount, paid: p.paid_amount, refunded: p.refunded_amount,
      currency: p.currency, option: d.option || null, details: d.info || {}, lines: l, createdAt: p.created_at, updatedAt: p.updated_at };
  });
}

export async function handlePayments(c) {
  const { path, request } = c; const m = request.method;
  if (path === "/api/pay/config" && m === "GET") {
    const S = await stripeConfig(c.env, c.slug);
    return json({ ok: true, connected: S.connected, mode: S.connected ? S.mode : null, catalog: !!(c.app.files && c.app.files["pricing.json"]) }, 200, { "Cache-Control": "no-store" });
  }
  if (path === "/api/stripe/webhook" && m === "POST") return webhook(c, await stripeConfig(c.env, c.slug));
  if (path === "/api/pay/checkout" && m === "POST") {
    const S = await stripeConfig(c.env, c.slug);
    if (!S.connected) throw new HttpError(409, "Card payments aren't connected for this app yet.");
    return createCheckout(c, S);
  }
  if (path === "/api/pay/status" && m === "GET") return payStatus(c, await stripeConfig(c.env, c.slug));
  return null;
}
