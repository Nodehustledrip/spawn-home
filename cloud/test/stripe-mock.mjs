// In-memory Stripe API mock for Miniflare's outboundService. Creates nothing real.
export function createStripeMock({ key, prices }) {
  const sessions = new Map(), portals = [], calls = [];
  let n = 0;
  const parse = (body) => { const o = {}; for (const [k, v] of new URLSearchParams(body)) o[k] = v; return o; };
  const meta = (f, prefix) => Object.fromEntries(Object.entries(f).filter(([k]) => k.startsWith(prefix + "[")).map(([k, v]) => [k.slice(prefix.length + 1, -1), v]));
  async function fetcher(req) {
    const url = new URL(req.url);
    if (url.hostname !== "stripe.mock") return new Response("blocked outbound " + url.hostname, { status: 599 });
    const auth = req.headers.get("authorization");
    calls.push({ method: req.method, path: url.pathname, idem: req.headers.get("idempotency-key") });
    if (auth !== "Bearer " + key) return Response.json({ error: { type: "authentication_error" } }, { status: 401 });
    if (req.method === "POST" && url.pathname === "/v1/checkout/sessions") {
      const f = parse(await req.text());
      let total = 0;
      for (let i = 0; f["line_items[" + i + "][quantity]"] !== undefined || f["line_items[" + i + "][price]"] !== undefined; i++) {
        const q = Number(f["line_items[" + i + "][quantity]"] || 1), pid = f["line_items[" + i + "][price]"];
        const ua = f["line_items[" + i + "][price_data][unit_amount]"];
        if (pid) { if (!prices[pid]) return Response.json({ error: { type: "invalid_request_error" } }, { status: 400 }); total += prices[pid].amount * q; }
        else if (ua !== undefined && /^\d+$/.test(ua)) total += Number(ua) * q;
        else return Response.json({ error: { type: "invalid_request_error" } }, { status: 400 });
      }
      const price = { amount: total };
      const id = "cs_test_mock" + String(++n).padStart(6, "0");
      const s = { id, object: "checkout.session", mode: f.mode, url: "https://checkout.stripe.com/c/pay/" + id, status: "open", payment_status: "unpaid",
        amount_total: price.amount, currency: "usd", client_reference_id: f.client_reference_id, customer: f.customer || null, customer_email: f.customer_email || null,
        metadata: meta(f, "metadata"), subscription: null, payment_intent: f.mode === "payment" ? "pi_mock" + String(n).padStart(6, "0") : null, success_url: f.success_url, cancel_url: f.cancel_url, _form: f };
      sessions.set(id, s);
      return Response.json(s);
    }
    const m = /^\/v1\/checkout\/sessions\/([^/]+)$/.exec(url.pathname);
    if (req.method === "GET" && m) { const s = sessions.get(decodeURIComponent(m[1])); return s ? Response.json(s) : Response.json({ error: { type: "invalid_request_error" } }, { status: 404 }); }
    if (req.method === "POST" && url.pathname === "/v1/billing_portal/sessions") {
      const f = parse(await req.text()); portals.push(f);
      return Response.json({ id: "bps_mock" + portals.length, url: "https://billing.stripe.com/p/session/mock" + portals.length, customer: f.customer, return_url: f.return_url, configuration: f.configuration || "bpc_default" });
    }
    return Response.json({ error: { type: "invalid_request_error" } }, { status: 404 });
  }
  function complete(id, extra = {}) {
    const s = sessions.get(id);
    Object.assign(s, { status: "complete", payment_status: "paid", customer: s.customer || "cus_mock" + id.slice(-4) }, s.mode === "subscription" ? { subscription: "sub_mock" + id.slice(-4) } : {}, extra);
    return s;
  }
  return { fetcher, sessions, portals, calls, complete };
}
