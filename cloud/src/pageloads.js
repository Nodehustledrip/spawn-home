// Free first-party daily HTML document-load counter for *.spawnapp.org (and custom domains).
// Writes are fire-and-forget via ctx.waitUntil; one UPSERT per counted request (D1 free tier).

const BOT_UA =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|headless|lighthouse|monitor|curl|wget|python|go-http|uptime|render|healthcheck|pingdom|statuscake|scrapy|httpclient|libwww|okhttp|axios|node-fetch|undici|spawn-home-keepalive|googleother|bytespider|semrush|ahrefs|yandex|baidu|duckduck|applebot|petalbot|gptbot|claudebot|anthropic|chatgpt|perplexity|bingpreview/i;

/** YYYY-MM-DD in America/Chicago. */
export function chicagoDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function isBot(ua) {
  const s = String(ua || "");
  return !s || BOT_UA.test(s);
}

/**
 * True when this response should count as one HTML document load.
 * Sec-Fetch-Dest: document, or GET whose response is text/html.
 * Skip HEAD, assets, JSON, redirects/3xx, 4xx/5xx.
 */
export function shouldCount(request, response) {
  if (request.method !== "GET") return false;
  const status = response.status | 0;
  if (status < 200 || status >= 300) return false;
  if (isBot(request.headers.get("user-agent"))) return false;
  const dest = (request.headers.get("sec-fetch-dest") || "").toLowerCase();
  if (dest && dest !== "document") return false;
  const ct = (response.headers.get("content-type") || "").toLowerCase();
  if (
    ct.includes("application/json") ||
    ct.includes("javascript") ||
    ct.includes("text/css") ||
    ct.includes("image/") ||
    ct.includes("font/") ||
    ct.includes("audio/") ||
    ct.includes("video/") ||
    ct.includes("octet-stream")
  ) {
    return false;
  }
  if (dest === "document") return true;
  return ct.includes("text/html");
}

export async function recordPageLoad(env, host) {
  if (!env || !env.DB || !host) return false;
  const day = chicagoDay();
  await env.DB.prepare(
    "INSERT INTO page_loads (day, host, count) VALUES (?1, ?2, 1) ON CONFLICT(day, host) DO UPDATE SET count = count + 1"
  )
    .bind(day, String(host).toLowerCase().slice(0, 253))
    .run();
  return true;
}

/** Schedule a count if the response qualifies; never blocks the response. */
export function maybeCount(ctx, env, request, response, host) {
  try {
    if (!shouldCount(request, response)) return false;
    ctx.waitUntil(recordPageLoad(env, host).catch(() => {}));
    return true;
  } catch (_) {
    return false;
  }
}
