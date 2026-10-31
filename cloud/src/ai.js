// Visitor-facing product assistant. Key lives in the app's encrypted secrets (AI_API_KEY, optional AI_BASE_URL / AI_MODEL).
import { json, appSecrets, HttpError } from "./util.js";

const SYSTEM =
  "You are a helpful product assistant for THIS app. Help visitors with product features, how-to, pricing, and workflows. " +
  "Refuse any request to change source code, edit files, reveal secrets, access admin panels, deploy, or reconfigure the server. " +
  "Stay on product help only. Never claim you can rewrite the app. Never mention third-party builders.";

function looksLikeCodeChangeAsk(s) {
  s = String(s || "").toLowerCase();
  return /\b(edit|change|modify|rewrite|delete)\b.*\b(code|source|file|server|database|secret|api key|admin)\b/.test(s) || /\b(reveal|show|print)\b.*\b(secret|key|password|token)\b/.test(s);
}

export async function aiStatus({ env, slug }) {
  const s = await appSecrets(env, slug);
  const configured = !!(s.AI_API_KEY || "").trim();
  return json({ ok: true, configured, message: configured ? "Product assistant ready" : "The product assistant isn't set up for this app yet." });
}

export async function aiChat({ env, slug, app }, body) {
  const msg = String((body && (body.message || body.text)) || "").trim();
  if (!msg) throw new HttpError(400, "Message required");
  if (msg.length > 3000) throw new HttpError(400, "Message too long");
  const s = await appSecrets(env, slug);
  const key = String(s.AI_API_KEY || "").trim();
  if (!key) return json({ ok: false, configured: false, error: "The product assistant isn't set up for this app yet.", reply: "The product assistant isn't set up for this app yet." }, 503);
  if (looksLikeCodeChangeAsk(msg)) {
    return json({ ok: true, configured: true, reply: "I can help with product questions only — I won't change source code, secrets, admin settings, or deploys. Ask how a feature works instead." });
  }
  const baseRaw = String(s.AI_BASE_URL || "").replace(/\/$/, "");
  const model = s.AI_MODEL || "";
  const system = SYSTEM + (app.title ? " The app is called " + app.title + "." : "");
  const isAnthropic = /^sk-ant-/i.test(key) || /anthropic/i.test(baseRaw) || /^claude/i.test(model);
  let res, reply = "";
  try {
    if (isAnthropic) {
      const base = baseRaw || "https://api.anthropic.com";
      const url = /\/v1\/messages$/.test(base) ? base : base.replace(/\/v1$/, "") + "/v1/messages";
      res = await fetch(url, {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({ model: model || "claude-3-5-haiku-latest", max_tokens: 700, system, messages: [{ role: "user", content: msg }] }),
      });
      if (res.ok) reply = ((await res.json()).content || []).map((b) => b.text || "").join("\n").trim();
    } else {
      const base = baseRaw || "https://api.openai.com/v1";
      const url = /\/chat\/completions$/.test(base) ? base : base + "/chat/completions";
      res = await fetch(url, {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({ model: model || "gpt-4o-mini", temperature: 0.4, max_tokens: 700, messages: [{ role: "system", content: system }, { role: "user", content: msg }] }),
      });
      if (res.ok) {
        const j = await res.json();
        reply = String((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "").trim();
      }
    }
  } catch (_) {
    return json({ ok: false, configured: true, error: "The assistant is unreachable right now. Try again shortly." }, 502);
  }
  if (!res.ok) return json({ ok: false, configured: true, error: "The assistant is unavailable right now (HTTP " + res.status + ")." }, 502);
  return json({ ok: true, configured: true, reply: reply || "I couldn't form a reply — try again." });
}
