// Stripe webhook signature verification (v1 scheme) using Web Crypto.
import { timingSafeEqual } from "./util.js";

export async function stripeSignature(payload, secret, t) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(t + "." + payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyStripeSignature(payload, header, secret, toleranceSec = 300) {
  if (!header || !secret) return false;
  const parts = {};
  const v1 = [];
  for (const kv of String(header).split(",")) {
    const i = kv.indexOf("=");
    if (i < 0) continue;
    const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim();
    if (k === "v1") v1.push(v);
    else parts[k] = v;
  }
  const t = Number(parts.t);
  if (!t || !v1.length || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = await stripeSignature(payload, secret, String(parts.t));
  return v1.some((s) => timingSafeEqual(s, expected));
}

// Minimal Stripe REST client for Workers (form-encoded, no SDK). The key comes from the app's encrypted secrets.
// STRIPE_API_BASE is a Worker var used only by tests; production always talks to api.stripe.com.
export function formEncode(obj, prefix, out) {
  out = out || [];
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") formEncode(v, key, out);
    else out.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(v)));
  }
  return out.join("&");
}

export class StripeError extends Error {
  constructor(status, type) { super("Stripe request failed (" + status + (type ? ", " + type : "") + ")"); this.status = status; }
}

export async function stripeApi(env, secretKey, method, path, params, idempotencyKey) {
  if (!secretKey) throw new StripeError(0, "not configured");
  const base = String(env.STRIPE_API_BASE || "https://api.stripe.com").replace(/\/$/, "");
  const headers = { Authorization: "Bearer " + secretKey, "Stripe-Version": "2025-03-31.basil" };
  let url = base + path, body;
  if (method === "GET") { const q = formEncode(params); if (q) url += "?" + q; }
  else { headers["Content-Type"] = "application/x-www-form-urlencoded"; body = formEncode(params); }
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const r = await fetch(url, { method, headers, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new StripeError(r.status, j && j.error && j.error.type);
  return j;
}
