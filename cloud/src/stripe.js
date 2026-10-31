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
