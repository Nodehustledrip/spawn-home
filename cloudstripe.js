"use strict";
/* Connect Stripe (card-free, no Stripe Connect): an app owner pastes their own secret or restricted key.
 * We verify it, create a webhook endpoint on THEIR Stripe account pointing at the app, and store the key and the
 * signing secret encrypted with the app's other secrets (the Worker decrypts them). The key is never sent back:
 * the browser only ever sees the last 4 characters and test/live mode. */

const KEY_RE = /^(sk|rk)_(test|live)_[A-Za-z0-9]{16,247}$/;
const EVENTS = [
  "checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed",
  "invoice.paid", "customer.subscription.updated", "customer.subscription.deleted", "charge.refunded",
];
const PERMISSIONS = [
  { resource: "Checkout Sessions", access: "Write", why: "start a checkout for each order, booking or membership" },
  { resource: "Webhook Endpoints", access: "Write", why: "add (and later remove) the webhook that tells your app a payment went through" },
  { resource: "Products and Prices", access: "Write", why: "prices are sent with each checkout from your pricing.json" },
  { resource: "Events, Customers, Subscriptions, Charges", access: "Read", why: "optional; useful if you also look at payments with this key" },
];

function form(obj, prefix, out) {
  out = out || [];
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null) continue;
    const key = prefix ? prefix + "[" + k + "]" : k;
    if (typeof v === "object") form(v, key, out); else out.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(v)));
  }
  return out.join("&");
}

function mountStripe(r, h) {
  const { wrap, fail, anyUser, ownedApp, be, encryptSecret, apex, env } = h;
  const base = () => env("CLOUD_STRIPE_API_BASE", "https://api.stripe.com"); // test-only override (local mock)
  const doFetch = h.fetch || fetch;
  async function stripe(key, method, path, params) {
    const res = await doFetch(base() + path + (method === "GET" && params ? "?" + form(params) : ""), {
      method, headers: { Authorization: "Bearer " + key, "Stripe-Version": "2025-03-31.basil", ...(method === "GET" ? {} : { "Content-Type": "application/x-www-form-urlencoded" }) },
      body: method === "GET" ? undefined : form(params || {}),
    });
    let j = {}; try { j = await res.json(); } catch (_) {}
    if (!res.ok) { const e = new Error("stripe " + res.status); e.stripeStatus = res.status; e.stripeType = j && j.error && j.error.type; throw e; }
    return j;
  }
  async function getSecret(slug, name) { // decrypted only on the server, never sent out
    const row = (await be().query("SELECT blob FROM app_secrets WHERE slug=?1 AND name=?2", [slug, name]))[0];
    return row ? h.decryptSecret(slug, name, row.blob) : null;
  }
  async function put(slug, name, value) {
    await be().query("INSERT INTO app_secrets (slug, name, blob, updated_at) VALUES (?1,?2,?3,?4) ON CONFLICT(slug, name) DO UPDATE SET blob=excluded.blob, updated_at=excluded.updated_at",
      [slug, name, encryptSecret(slug, name, value), new Date().toISOString()]);
  }
  async function status(slug) {
    let meta = null; try { meta = JSON.parse((await getSecret(slug, "STRIPE_CONNECT_META")) || "null"); } catch (_) {}
    const has = (await be().query("SELECT name FROM app_secrets WHERE slug=?1 AND name IN ('STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET')", [slug])).length === 2;
    return has && meta ? { connected: true, last4: meta.last4, mode: meta.mode, keyType: meta.keyType, webhookUrl: meta.url, connectedAt: meta.at } : { connected: false };
  }
  const own = async (req) => { const u = await anyUser(req); const slug = String(req.params.slug || "").toLowerCase(); await ownedApp(u, slug, false); return slug; };

  r.get("/stripe/permissions", (req, res) => res.json({ ok: true, permissions: PERMISSIONS, events: EVENTS }));
  r.get("/apps/:slug/stripe", wrap(async (req, res) => { const slug = await own(req); res.json({ ok: true, stripe: await status(slug), permissions: PERMISSIONS }); }));

  r.post("/apps/:slug/stripe", wrap(async (req, res) => {
    const slug = await own(req);
    if (!req.is("application/json")) throw fail(415, "Send JSON.");
    const key = String((req.body && req.body.key) || "").trim();
    if (!KEY_RE.test(key)) throw fail(400, "That doesn't look like a Stripe secret key. Paste a restricted key (rk_test_… or rk_live_…) or a secret key (sk_…). Publishable keys (pk_…) won't work.");
    const mode = key.includes("_live_") ? "live" : "test";
    try { await stripe(key, "GET", "/v1/checkout/sessions", { limit: 1 }); }
    catch (e) {
      if (e.stripeStatus === 401) throw fail(400, "Stripe didn't accept that key. Check you copied all of it.");
      if (e.stripeStatus === 403) throw fail(400, "That key can't create checkouts. Give it Checkout Sessions: Write (and the other permissions listed), then try again.");
      throw fail(502, "Couldn't reach Stripe. Try again in a minute.");
    }
    const prev = await status(slug);
    const url = "https://" + slug + "." + apex() + "/api/stripe/webhook";
    let wh;
    try {
      wh = await stripe(key, "POST", "/v1/webhook_endpoints", { url, enabled_events: EVENTS, description: "Spawn app " + slug + " (added by spawnapp.org)", metadata: { spawn_app: slug }, api_version: "2025-03-31.basil" });
    } catch (e) {
      if (e.stripeStatus === 403) throw fail(400, "That key can't add webhooks. Give it Webhook Endpoints: Write, then try again.");
      throw fail(502, "Stripe didn't let us add the webhook. Try again in a minute.");
    }
    if (!wh || !/^whsec_/.test(String(wh.secret || "")) || !/^we_/.test(String(wh.id || ""))) throw fail(502, "Stripe didn't return a webhook signing secret.");
    // Replacing an earlier connection: remove its webhook from the old account (best effort).
    if (prev.connected) { try { const ok = await getSecret(slug, "STRIPE_SECRET_KEY"); const om = JSON.parse((await getSecret(slug, "STRIPE_CONNECT_META")) || "{}"); if (ok && om.webhookId) await stripe(ok, "DELETE", "/v1/webhook_endpoints/" + om.webhookId); } catch (_) {} }
    await put(slug, "STRIPE_SECRET_KEY", key);
    await put(slug, "STRIPE_WEBHOOK_SECRET", wh.secret);
    await put(slug, "STRIPE_CONNECT_META", JSON.stringify({ last4: key.slice(-4), mode, keyType: key.startsWith("rk_") ? "restricted" : "secret", webhookId: wh.id, url, at: new Date().toISOString() }));
    console.log("[cloud-stripe] " + slug + ": connected (" + mode + ")"); // never log the key
    res.json({ ok: true, stripe: await status(slug), note: "Connected. It can take up to a minute before checkouts switch on." });
  }));

  r.delete("/apps/:slug/stripe", wrap(async (req, res) => {
    const slug = await own(req);
    const key = await getSecret(slug, "STRIPE_SECRET_KEY"); let meta = {}; try { meta = JSON.parse((await getSecret(slug, "STRIPE_CONNECT_META")) || "{}"); } catch (_) {}
    let removed = false;
    if (key && meta.webhookId) { try { await stripe(key, "DELETE", "/v1/webhook_endpoints/" + meta.webhookId); removed = true; } catch (e) { removed = e.stripeStatus === 404; } }
    await be().query("DELETE FROM app_secrets WHERE slug=?1 AND name IN ('STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_CONNECT_META')", [slug]);
    console.log("[cloud-stripe] " + slug + ": disconnected");
    res.json({ ok: true, stripe: { connected: false }, webhookRemoved: removed, note: removed ? "Disconnected and removed the webhook from your Stripe account." : "Disconnected. If the webhook still shows in Stripe (Developers → Webhooks), you can delete it there." });
  }));
}

module.exports = { mountStripe, PERMISSIONS, EVENTS, KEY_RE };
