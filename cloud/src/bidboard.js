// BidBoard runtime: port of the desktop Express + JSON-file server to D1 (files in D1 blobs).
// Payments: on-site Stripe Checkout created server-side (like spawnapp.org billing).
//   App secrets (encrypted): STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET. Price ids: app config or secrets STRIPE_PRICE_LEAD / STRIPE_PRICE_PRO.
//   Optional STRIPE_PORTAL_CONFIG (bpc_…) picks a Customer Portal configuration.
import { blobs } from "./blobs.js";
import { json, readJson, HttpError, randomHex, now, clientIp, rateLimit, validEmail, clip, appSecrets, b64ToBytes, SECURITY_HEADERS } from "./util.js";
import { verifyStripeSignature, stripeApi } from "./stripe.js";
import { currentAppUser } from "./auth.js";

const US_STATES = [
  ["AL","Alabama"],["AK","Alaska"],["AZ","Arizona"],["AR","Arkansas"],["CA","California"],["CO","Colorado"],["CT","Connecticut"],
  ["DE","Delaware"],["DC","District of Columbia"],["FL","Florida"],["GA","Georgia"],["HI","Hawaii"],["ID","Idaho"],["IL","Illinois"],
  ["IN","Indiana"],["IA","Iowa"],["KS","Kansas"],["KY","Kentucky"],["LA","Louisiana"],["ME","Maine"],["MD","Maryland"],
  ["MA","Massachusetts"],["MI","Michigan"],["MN","Minnesota"],["MS","Mississippi"],["MO","Missouri"],["MT","Montana"],
  ["NE","Nebraska"],["NV","Nevada"],["NH","New Hampshire"],["NJ","New Jersey"],["NM","New Mexico"],["NY","New York"],
  ["NC","North Carolina"],["ND","North Dakota"],["OH","Ohio"],["OK","Oklahoma"],["OR","Oregon"],["PA","Pennsylvania"],
  ["RI","Rhode Island"],["SC","South Carolina"],["SD","South Dakota"],["TN","Tennessee"],["TX","Texas"],["UT","Utah"],
  ["VT","Vermont"],["VA","Virginia"],["WA","Washington"],["WV","West Virginia"],["WI","Wisconsin"],["WY","Wyoming"],
].map(([code, name]) => ({ code, name }));
const CODES = new Set(US_STATES.map((s) => s.code));

export function normalizeState(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  if (CODES.has(s.toUpperCase())) return s.toUpperCase();
  const f = US_STATES.find((x) => x.name.toLowerCase() === s.toLowerCase());
  return f ? f.code : "";
}

const money = (c) => "$" + (c / 100).toFixed(2);

function settings(app, secrets) {
  const cfg = app.config || {};
  const sec = secrets || {};
  const pick = (k) => String(cfg[k] || sec[k] || "").trim() || null;
  const S = {
    leadFee: Number(cfg.LEAD_FEE_CENTS || 2500),
    proFee: Number(cfg.PRO_FEE_CENTS || 9900),
    priceLead: pick("STRIPE_PRICE_LEAD"),
    pricePro: pick("STRIPE_PRICE_PRO"),
    portalConfig: pick("STRIPE_PORTAL_CONFIG"),
    stripeKey: sec.STRIPE_SECRET_KEY || null,
    webhookSecret: sec.STRIPE_WEBHOOK_SECRET || null,
    serviceForge: cfg.SERVICEFORGE_URL || null,
  };
  S.paymentsLive = !!(S.stripeKey && S.webhookSecret && S.priceLead && /^price_/.test(S.priceLead));
  S.proLive = S.paymentsLive && !!S.pricePro && /^price_/.test(S.pricePro);
  return S;
}

export function suggestJobCopy(description, trade, zip) {
  const desc = String(description || "").trim();
  const t = String(trade || "trade").trim();
  const z = String(zip || "").trim();
  const lower = desc.toLowerCase();
  let title = (t || "general") + " job";
  if (/\b(leak|drip|pipe|faucet|plumb)\b/.test(lower)) title = "Plumbing leak repair needed";
  else if (/\b(furnace|hvac|a\/?c|air\s*cond|heat(?:er|ing)?|cool(?:ing)?)\b/.test(lower)) title = "HVAC service request";
  else if (/\b(drain|clog|toilet)\b/.test(lower)) title = "Drain / plumbing issue";
  else if (/\bwater\s*heater\b|\bheater\b/.test(lower)) title = "Water heater service";
  else if (/\b(disposal|garbage)\b/.test(lower)) title = "Garbage disposal repair";
  else if (/\b(fence|fencing|gate)\b/.test(lower)) title = "Fence / gate repair";
  else if (/\b(clean|maid|janitor)\b/.test(lower)) title = "Cleaning help needed";
  else if (/\b(mov(?:e|ing)|truck|boxes)\b/.test(lower)) title = "Moving help needed";
  else if (/\b(tutor|homework|algebra|math|lesson)\b/.test(lower)) title = "Tutoring request";
  else if (/\b(wifi|wi-?fi|computer|laptop|network|it help)\b/.test(lower)) title = "Tech / IT help";
  else if (/\b(paint|painting|drywall)\b/.test(lower)) title = "Painting job";
  else if (/\b(logo|design|flyer|brand)\b/.test(lower)) title = "Creative / design request";
  else if (/\b(deliver|pickup|drop-?off)\b/.test(lower)) title = "Delivery request";
  else {
    const byTrade = { fencing: "Fence / gate repair", plumbing: "Plumbing job", hvac: "HVAC service request", cleaning: "Cleaning help needed",
      moving: "Moving help needed", tutoring: "Tutoring request", tech: "Tech / IT help", creative: "Creative / design request",
      delivery: "Delivery request", painting: "Painting job", childcare: "Babysitting / childcare", auto: "Mechanic / auto help" };
    if (byTrade[t]) title = byTrade[t];
    else if (desc) title = desc.slice(0, 60) + (desc.length > 60 ? "…" : "");
  }
  const urgency = /emergency|urgent|flood|no heat|no a\/?c|asap/.test(lower) ? "Urgent" : /this week|soon/.test(lower) ? "This week" : "Flexible";
  const helper = "Include access notes, preferred times, and whether this is urgent or flexible. Local pros near " + (z || "your city") + " will see a blurred preview until they unlock.";
  const cleaned = desc || "Need help with " + t + " near " + (z || "your area") + ". Please describe the work, timing, and any photos.";
  return { title, urgency, helper, description: cleaned };
}

function publicJob(j) {
  return {
    id: j.id, title: j.title, trade: j.trade, zip: j.zip, city: j.city, state: j.state || "", urgency: j.urgency,
    preview: String(j.description || "").slice(0, 120) + (j.description && j.description.length > 120 ? "…" : ""),
    hasPhoto: !!(j.photoKey || j.photoName), createdAt: j.createdAt, status: j.status || "open",
  };
}

async function allJobs(env, slug) {
  const { results } = await env.DB.prepare("SELECT data, photo_key FROM bb_jobs WHERE slug=?1 ORDER BY created_at DESC LIMIT 5000").bind(slug).all();
  return (results || []).map((r) => Object.assign(JSON.parse(r.data), { photoKey: r.photo_key || null }));
}
async function getJob(env, slug, id) {
  const r = await env.DB.prepare("SELECT data, photo_key FROM bb_jobs WHERE slug=?1 AND id=?2").bind(slug, id).first();
  return r ? Object.assign(JSON.parse(r.data), { photoKey: r.photo_key || null }) : null;
}
async function unlockValid(env, slug, jobId, token) {
  if (!token || !/^[a-f0-9]{16,48}$/.test(token)) return false;
  const r = await env.DB.prepare("SELECT 1 FROM bb_unlocks WHERE slug=?1 AND job_id=?2 AND token=?3 AND status IN ('demo_unlocked','paid')").bind(slug, jobId, token).first();
  return !!r;
}
function fullJob(j, token) {
  const out = Object.assign({}, j);
  delete out.photoKey;
  out.photoDataUrl = j.photoKey ? "api/jobs/" + encodeURIComponent(j.id) + "/photo" + (token ? "?token=" + encodeURIComponent(token) : "") : null;
  return out;
}

async function insertInterest(env, slug, kind, email, data) {
  await env.DB.prepare("INSERT INTO records (id, slug, kind, email, data, created_at) VALUES (?1,?2,?3,?4,?5,?6)")
    .bind(randomHex(6), slug, kind, email || null, JSON.stringify(data).slice(0, 16384), now())
    .run();
}

export async function handleBidboard(c) {
  const { env, slug, app, request, path, url } = c;
  const m = request.method;
  const ip = clientIp(request);
  const secrets = await appSecrets(env, slug);
  const S = settings(app, secrets);
  const paymentsLive = S.paymentsLive;
  let r;

  if (path === "/api/health" && m === "GET") return json({ ok: true, app: "BidBoard", region: "United States — local by city", product: "BidBoard" });

  if (path === "/api/config" && m === "GET") {
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM bb_jobs WHERE slug=?1 AND status='open'").bind(slug).first();
    return json({
      app: "BidBoard", tagline: "Paid jobs near you. Hire for anything.", region: "United States — search any city",
      leadFeeCents: S.leadFee, leadFeeLabel: money(S.leadFee), proFeeCents: S.proFee, proFeeLabel: money(S.proFee) + "/mo",
      openJobs: n ? n.n : 0, paymentsLive, proAvailable: S.proLive,
      connectPaymentsCta: "Payments aren't switched on for this board yet", serviceForgeUrl: S.serviceForge,
      crossSell: "Need marketing that fills your calendar? ServiceForge packs help local businesses get found — optional cross-promo with BidBoard.",
    });
  }

  if (path === "/api/stats" && m === "GET") {
    const jobs = await allJobs(env, slug);
    const u = await env.DB.prepare("SELECT COUNT(*) AS n FROM bb_unlocks WHERE slug=?1").bind(slug).first();
    const k = await env.DB.prepare("SELECT COUNT(*) AS n FROM bb_contractors WHERE slug=?1").bind(slug).first();
    const byTrade = {};
    for (const j of jobs) byTrade[j.trade || "general"] = (byTrade[j.trade || "general"] || 0) + 1;
    return json({ ok: true, openJobs: jobs.filter((j) => (j.status || "open") === "open").length, unlocks: u.n, contractors: k.n, byTrade, region: "Nationwide — filter by your city" });
  }

  if (path === "/api/jobs/suggest" && m === "POST") {
    const b = await readJson(request, 16384);
    return json({ ok: true, suggestion: suggestJobCopy(b.description, b.trade, b.zip) });
  }

  if (path === "/api/jobs" && m === "GET") {
    const q = url.searchParams;
    const trade = String(q.get("trade") || "").toLowerCase();
    const zip = String(q.get("zip") || "");
    const city = String(q.get("city") || "").trim().toLowerCase();
    const state = normalizeState(q.get("state") || "");
    const text = String(q.get("q") || "").toLowerCase();
    const urgency = String(q.get("urgency") || "").trim();
    let jobs = await allJobs(env, slug);
    if (trade) jobs = jobs.filter((j) => String(j.trade).toLowerCase() === trade);
    if (urgency) jobs = jobs.filter((j) => String(j.urgency || "") === urgency);
    if (state) jobs = jobs.filter((j) => normalizeState(j.state || "") === state);
    if (city) jobs = jobs.filter((j) => { const jc = String(j.city || "").toLowerCase(); return jc === city || jc.includes(city) || (jc && city.includes(jc)); });
    if (zip) {
      const z = zip.replace(/\D/g, "");
      if (z.length >= 5) jobs = jobs.filter((j) => String(j.zip) === z.slice(0, 5));
      else if (z.length >= 3) jobs = jobs.filter((j) => String(j.zip).startsWith(z.slice(0, 3)));
    }
    if (text) jobs = jobs.filter((j) => [j.title, j.description, j.trade, j.city, j.state].some((v) => String(v || "").toLowerCase().includes(text)));
    jobs = jobs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(publicJob);
    return json({ ok: true, jobs, leadFeeLabel: money(S.leadFee), count: jobs.length });
  }

  if ((r = /^\/api\/jobs\/([a-f0-9]{6,32})\/photo$/.exec(path)) && m === "GET") {
    const job = await getJob(env, slug, r[1]);
    if (!job || !job.photoKey) return json({ ok: false, error: "No photo" }, 404);
    const token = url.searchParams.get("token") || "";
    if (paymentsLive && !(await unlockValid(env, slug, job.id, token))) return json({ ok: false, error: "Unlock this lead to see the photo." }, 403);
    const obj = await blobs(env).get(job.photoKey);
    if (!obj) return json({ ok: false, error: "No photo" }, 404);
    const h = new Headers(SECURITY_HEADERS);
    h.set("Content-Type", (obj.httpMetadata && obj.httpMetadata.contentType) || "image/jpeg");
    h.set("Cache-Control", "private, max-age=3600");
    return new Response(obj.body, { headers: h });
  }

  if ((r = /^\/api\/jobs\/([^/]+)$/.exec(path))) {
    const id = decodeURIComponent(r[1]);
    if (m === "GET") {
      const job = await getJob(env, slug, id);
      if (!job) return json({ ok: false, error: "Job not found" }, 404);
      const token = String(url.searchParams.get("token") || "");
      // ?unlocked=1 was a desktop testing shortcut; it is only honoured while payments are off (demo mode).
      const unlocked = (!paymentsLive && url.searchParams.get("unlocked") === "1") || (await unlockValid(env, slug, job.id, token));
      if (!unlocked) {
        return json({
          ok: true, locked: true,
          job: { id: job.id, title: job.title, trade: job.trade, zip: job.zip, city: job.city, state: job.state || "", urgency: job.urgency,
            preview: String(job.description || "").slice(0, 140) + "…", hasPhoto: !!(job.photoKey || job.photoName), createdAt: job.createdAt },
          leadFeeLabel: money(S.leadFee),
        });
      }
      return json({ ok: true, locked: false, job: fullJob(job, token), leadFeeLabel: money(S.leadFee) });
    }
    if (m === "DELETE") {
      await rateLimit(env, `bbdel:${slug}:${ip}`, 20, 600);
      let b = {};
      try { b = await readJson(request, 4096); } catch (_) {}
      const email = String(b.email || url.searchParams.get("email") || "").trim().toLowerCase();
      const phone = String(b.phone || url.searchParams.get("phone") || "").trim();
      if (!email && !phone) {
        return json({ ok: false, error: "email or phone required to delete your own post", honesty: "Posters delete by matching the email or phone used when posting. There is no separate owner login for posts." }, 400);
      }
      const job = await getJob(env, slug, id);
      if (!job) return json({ ok: false, error: "Job not found" }, 404);
      const emailOk = email && String(job.email || "").trim().toLowerCase() === email;
      const pn = phone.replace(/\D/g, "");
      const phoneOk = pn && String(job.phone || "").replace(/\D/g, "") === pn;
      if (!emailOk && !phoneOk) return json({ ok: false, error: "Email/phone does not match this post", honesty: "Only the contact used on the original post can delete it." }, 403);
      await env.DB.prepare("DELETE FROM bb_jobs WHERE slug=?1 AND id=?2").bind(slug, id).run();
      if (job.photoKey) await blobs(env).delete(job.photoKey);
      return json({ ok: true, deleted: job.id, title: job.title, message: "Deleted your job post.", honesty: "Matched via " + (emailOk ? "email" : "phone") + " on the original post." });
    }
  }

  if (path === "/api/jobs" && m === "POST") {
    await rateLimit(env, `bbpost:${slug}:${ip}`, 10, 600);
    const b = await readJson(request, 8 * 1024 * 1024);
    const description = clip(b.description, 5000);
    const trade = clip(b.trade || "general", 40).toLowerCase();
    const zip = String(b.zip || "").trim().replace(/\D/g, "").slice(0, 5);
    const name = clip(b.name, 120), phone = clip(b.phone, 40), email = clip(b.email, 254), city = clip(b.city, 80);
    const state = normalizeState(b.state || "");
    if (!description) return json({ ok: false, error: "description required" }, 400);
    if (!city) return json({ ok: false, error: "city required" }, 400);
    if (!state) return json({ ok: false, error: "valid 2-letter US state required" }, 400);
    if (zip && !/^\d{5}$/.test(zip)) return json({ ok: false, error: "zip must be 5 digits when provided" }, 400);
    if (!name || !phone) return json({ ok: false, error: "name and phone required" }, 400);
    const sug = suggestJobCopy(description, trade, zip);
    const id = randomHex(6);
    let photoKey = null;
    const du = /^data:(image\/(?:png|jpe?g|webp|gif));base64,(.+)$/i.exec(String(b.photoDataUrl || ""));
    if (du) {
      const bytes = b64ToBytes(du[2]);
      if (bytes.length > 5 * 1024 * 1024) return json({ ok: false, error: "Photo must be under 5 MB." }, 413);
      photoKey = "data/" + slug + "/photos/" + id;
      await blobs(env).put(photoKey, bytes, { httpMetadata: { contentType: du[1].toLowerCase() } });
    }
    const job = { id, title: clip(b.title || sug.title, 140), description, trade, zip, city, state, urgency: clip(b.urgency || sug.urgency, 40),
      name, phone, email, photoName: photoKey ? clip(b.photoName || "photo", 120) : null, status: "open", createdAt: now() };
    await env.DB.prepare("INSERT INTO bb_jobs (id, slug, status, trade, state, city, zip, urgency, email, phone, photo_key, data, created_at) VALUES (?1,?2,'open',?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)")
      .bind(id, slug, trade, state, city, zip, job.urgency, email.toLowerCase(), phone, photoKey, JSON.stringify(job), job.createdAt)
      .run();
    return json({ ok: true, job: { id, title: job.title, zip, trade } });
  }

  if (path === "/api/contractors") {
    if (m === "GET") {
      const { results } = await env.DB.prepare("SELECT data, plan FROM bb_contractors WHERE slug=?1 ORDER BY created_at DESC LIMIT 2000").bind(slug).all();
      const list = (results || []).map((x) => { const c2 = JSON.parse(x.data); return { id: c2.id, name: c2.name, company: c2.company, trade: c2.trade, zip: c2.zip, city: c2.city || "", state: c2.state || "", plan: x.plan, createdAt: c2.createdAt }; });
      return json({ ok: true, contractors: list, count: list.length });
    }
    if (m === "POST" || m === "PUT") {
      await rateLimit(env, `bbpro:${slug}:${ip}`, 20, 600);
      return saveContractor(env, slug, await readJson(request, 16384));
    }
  }

  if (path === "/api/leads/unlock" && m === "POST") {
    await rateLimit(env, `bbunl:${slug}:${ip}`, 20, 600);
    const b = await readJson(request, 8192);
    const email = clip(b.contractorEmail, 254).toLowerCase();
    if (!validEmail(email)) return json({ ok: false, error: "Valid contractor email required to unlock" }, 400);
    const job = await getJob(env, slug, String(b.jobId || ""));
    if (!job) return json({ ok: false, error: "Job not found" }, 404);
    const id = randomHex(6);
    const token = randomHex(12);
    // Contractor Pro (active subscription, signed in as that contractor) unlocks leads without a per-lead charge.
    let proIncluded = false;
    if (paymentsLive) {
      const me = await currentAppUser(c);
      if (me && me.email === email) {
        const k = await env.DB.prepare("SELECT plan FROM bb_contractors WHERE slug=?1 AND email=?2").bind(slug, email).first();
        proIncluded = !!(k && k.plan === "pro");
      }
    }
    const status = !paymentsLive ? "demo_unlocked" : proIncluded ? "paid" : "pending_payment";
    let checkoutUrl = null, sessionId = null;
    if (paymentsLive && !proIncluded) {
      const k = await env.DB.prepare("SELECT stripe_customer FROM bb_contractors WHERE slug=?1 AND email=?2").bind(slug, email).first();
      try {
        const s = await stripeApi(env, S.stripeKey, "POST", "/v1/checkout/sessions", {
          mode: "payment",
          line_items: { 0: { price: S.priceLead, quantity: 1 } },
          client_reference_id: "lead-" + id,
          customer: (k && k.stripe_customer) || undefined,
          customer_email: k && k.stripe_customer ? undefined : email,
          success_url: url.origin + "/paid?session_id={CHECKOUT_SESSION_ID}",
          cancel_url: url.origin + "/job.html?id=" + encodeURIComponent(job.id),
          metadata: { app: "bidboard", slug, kind: "lead", unlock_id: id, job_id: job.id },
          payment_intent_data: { metadata: { app: "bidboard", slug, unlock_id: id, job_id: job.id }, description: "BidBoard lead: " + clip(job.title, 80) },
        }, "bb-lead-" + slug + "-" + id);
        checkoutUrl = s.url; sessionId = s.id;
      } catch (e) {
        console.error("[bidboard] lead checkout failed", e.message);
        return json({ ok: false, error: "Checkout is unavailable right now — try again in a minute." }, 502);
      }
    }
    const rec = { contractorName: clip(b.contractorName, 120) || "Contractor", contractorTrade: clip(b.contractorTrade || job.trade, 40), company: clip(b.company, 120), proIncluded };
    await env.DB.prepare("INSERT INTO bb_unlocks (id, slug, job_id, token, email, status, amount_cents, stripe_session, data, created_at, paid_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)")
      .bind(id, slug, job.id, token, email, status, proIncluded ? 0 : S.leadFee, sessionId, JSON.stringify(rec), now(), proIncluded ? now() : null)
      .run();
    await insertInterest(env, slug, "lead_unlock", email, { jobId: job.id, amountCents: S.leadFee, unlockId: id });
    const reveal = status !== "pending_payment";
    const jobOut = Object.assign(
      { id: job.id, title: job.title, description: job.description, trade: job.trade, zip: job.zip, city: job.city, state: job.state || "", urgency: job.urgency, createdAt: job.createdAt,
        photoDataUrl: fullJob(job, token).photoDataUrl },
      reveal ? { name: job.name, phone: job.phone, email: job.email } : {}
    );
    return json({
      ok: true,
      paymentsLive: paymentsLive && !proIncluded,
      demoMode: !paymentsLive,
      checkoutUrl,
      connectPaymentsCta: paymentsLive ? null : "Payments aren't switched on for this board yet",
      buttonHint: proIncluded ? "Included with Contractor Pro" : paymentsLive ? "Unlock lead — " + money(S.leadFee) : "Preview unlock",
      unlock: { id, token, status, amountCents: proIncluded ? 0 : S.leadFee, checkoutUrl },
      leadFeeLabel: money(S.leadFee),
      honesty: proIncluded
        ? "Included with your Contractor Pro plan."
        : paymentsLive
          ? "Pay securely with Stripe to reveal the contact. Contact details stay hidden until payment is confirmed."
          : "Payments aren't switched on for this board yet, so this unlock is a free preview.",
      message: proIncluded
        ? "Unlocked with Contractor Pro."
        : checkoutUrl
          ? "Opening secure checkout. Contact details appear here as soon as payment is confirmed."
          : "Preview unlock — contact details revealed.",
      job: jobOut,
    });
  }

  if (path === "/api/lead" && m === "POST") {
    await rateLimit(env, `w:${slug}:${ip}`, 30, 600);
    const b = await readJson(request, 16384);
    const email = clip(b.email, 254).toLowerCase();
    if (!email) return json({ ok: false, error: "email required" }, 400);
    await insertInterest(env, slug, "contact", email, { name: clip(b.name, 120), message: clip(b.message, 4000), meta: b });
    return json({ ok: true, message: "Thanks — we got your message." });
  }

  if (path === "/api/pro/status" && m === "GET") {
    const me = await currentAppUser(c);
    const k = me ? await env.DB.prepare("SELECT plan, stripe_customer FROM bb_contractors WHERE slug=?1 AND email=?2").bind(slug, me.email).first() : null;
    return json({ ok: true, signedIn: !!me, email: me ? me.email : null, plan: k ? k.plan : null, pro: !!(k && k.plan === "pro"),
      canManageBilling: !!(k && k.stripe_customer && paymentsLive), proAvailable: S.proLive, proFeeLabel: money(S.proFee) + "/mo" });
  }

  if (path === "/api/pro/checkout" && m === "POST") {
    await rateLimit(env, `bbck:${slug}:${ip}`, 20, 600);
    if (!S.proLive) return json({ ok: false, error: "Contractor Pro sign-up isn't open on this board." }, 503);
    const me = await currentAppUser(c);
    if (!me) return json({ ok: false, error: "Sign in to start Contractor Pro.", signin: "/login.html?next=" + encodeURIComponent("/contractors.html#pro") }, 401);
    let k = await env.DB.prepare("SELECT id, plan, stripe_customer FROM bb_contractors WHERE slug=?1 AND email=?2").bind(slug, me.email).first();
    if (k && k.plan === "pro") return json({ ok: false, error: "You're already on Contractor Pro.", pro: true }, 409);
    if (!k) {
      const t = now(), rec = { id: randomHex(6), name: me.name || me.email.split("@")[0], email: me.email, plan: "pay_per_lead", createdAt: t };
      await env.DB.prepare("INSERT INTO bb_contractors (id, slug, email, plan, data, created_at) VALUES (?1,?2,?3,'pay_per_lead',?4,?5)").bind(rec.id, slug, me.email, JSON.stringify(rec), t).run();
      k = { id: rec.id, stripe_customer: null };
    }
    const meta = { app: "bidboard", slug, kind: "pro", contractor_id: k.id, email: me.email };
    try {
      const s = await stripeApi(env, S.stripeKey, "POST", "/v1/checkout/sessions", {
        mode: "subscription",
        line_items: { 0: { price: S.pricePro, quantity: 1 } },
        client_reference_id: "pro-" + k.id,
        customer: k.stripe_customer || undefined,
        customer_email: k.stripe_customer ? undefined : me.email,
        success_url: url.origin + "/paid?session_id={CHECKOUT_SESSION_ID}",
        cancel_url: url.origin + "/contractors.html#pro",
        metadata: meta,
        subscription_data: { metadata: meta },
      });
      await insertInterest(env, slug, "pro_checkout", me.email, { contractorId: k.id });
      return json({ ok: true, url: s.url, checkoutUrl: s.url, proFeeLabel: money(S.proFee) + "/mo", message: "Opening secure checkout for Contractor Pro." });
    } catch (e) {
      console.error("[bidboard] pro checkout failed", e.message);
      return json({ ok: false, error: "Checkout is unavailable right now — try again in a minute." }, 502);
    }
  }

  if (path === "/api/billing/portal" && m === "POST") {
    await rateLimit(env, `bbck:${slug}:${ip}`, 20, 600);
    if (!paymentsLive) return json({ ok: false, error: "Billing isn't switched on for this board." }, 503);
    const me = await currentAppUser(c);
    if (!me) return json({ ok: false, error: "Sign in first.", signin: "/login.html?next=" + encodeURIComponent("/contractors.html#pro") }, 401);
    const k = await env.DB.prepare("SELECT stripe_customer FROM bb_contractors WHERE slug=?1 AND email=?2").bind(slug, me.email).first();
    if (!k || !k.stripe_customer) return json({ ok: false, error: "No billing account yet." }, 400);
    try {
      const s = await stripeApi(env, S.stripeKey, "POST", "/v1/billing_portal/sessions", {
        customer: k.stripe_customer, return_url: url.origin + "/contractors.html", configuration: S.portalConfig || undefined,
      });
      return json({ ok: true, url: s.url });
    } catch (e) {
      console.error("[bidboard] portal failed", e.message);
      return json({ ok: false, error: "Billing is unavailable right now — try again in a minute." }, 502);
    }
  }

  if (path === "/api/places/states" && m === "GET") return json({ ok: true, states: US_STATES });
  if (path === "/api/places/search" && m === "GET") {
    const q = String(url.searchParams.get("q") || "").trim().toLowerCase().slice(0, 60);
    const st = normalizeState(url.searchParams.get("state") || "");
    const lim = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 40);
    let rows = [];
    if (!q) {
      const res = st
        ? await env.DB.prepare("SELECT city, state, code FROM bb_places WHERE code=?1 ORDER BY rowid LIMIT ?2").bind(st, lim).all()
        : await env.DB.prepare("SELECT city, state, code FROM bb_places ORDER BY rowid LIMIT ?1").bind(lim).all();
      rows = res.results || [];
    } else {
      const like = q.replace(/[%_]/g, "") ;
      const starts = await env.DB.prepare(
        "SELECT city, state, code FROM bb_places WHERE (city_l LIKE ?1 OR lower(code)=?2 OR lower(state) LIKE ?1) AND (?3 = '' OR code = ?3) ORDER BY rowid LIMIT ?4"
      ).bind(like + "%", like, st, lim).all();
      rows = starts.results || [];
      if (rows.length < lim) {
        const cont = await env.DB.prepare(
          "SELECT city, state, code FROM bb_places WHERE (city_l LIKE ?1 OR lower(state) LIKE ?1 OR (city_l || ' ' || lower(code)) LIKE ?1) AND NOT (city_l LIKE ?2 OR lower(code)=?3 OR lower(state) LIKE ?2) AND (?4 = '' OR code = ?4) ORDER BY rowid LIMIT ?5"
        ).bind("%" + like + "%", like + "%", like, st, lim - rows.length).all();
        rows = rows.concat(cont.results || []);
      }
    }
    const results = rows.map((p) => ({ city: p.city, state: p.state, stateCode: p.code, label: p.city + ", " + p.code }));
    return json({ ok: true, results, count: results.length });
  }

  if (path === "/api/stripe/webhook" && m === "POST") return stripeWebhook(c, S);
  if (path === "/paid" && m === "GET") return paidReturn(c, S);
  if (/^\/api\/export\//.test(path)) return json({ ok: false, error: "Exports are available to the app owner in Spawn." }, 403);
  return null;
}

async function saveContractor(env, slug, body) {
  const name = clip(body.name, 120), email = clip(body.email, 254).toLowerCase(), phone = clip(body.phone, 40), company = clip(body.company, 120);
  const trade = clip(body.trade || "general", 40).toLowerCase(), zip = String(body.zip || "").trim().replace(/\D/g, "").slice(0, 5);
  const license = clip(body.license, 80), city = clip(body.city, 80), state = normalizeState(body.state || "");
  if (!name || !email) return json({ ok: false, error: "name and email required" }, 400);
  if (!validEmail(email)) return json({ ok: false, error: "valid email required" }, 400);
  if (!city) return json({ ok: false, error: "city required" }, 400);
  if (!state) return json({ ok: false, error: "valid 2-letter US state required" }, 400);
  if (zip && !/^\d{5}$/.test(zip)) return json({ ok: false, error: "zip must be 5 digits when provided" }, 400);
  const cur = await env.DB.prepare("SELECT data FROM bb_contractors WHERE slug=?1 AND email=?2").bind(slug, email).first();
  const t = now();
  if (cur) {
    const e = JSON.parse(cur.data);
    Object.assign(e, { name: name || e.name, phone: phone || e.phone, company: company || e.company, trade: trade || e.trade, zip: zip || e.zip, license: license || e.license, city, state, updatedAt: t });
    await env.DB.prepare("UPDATE bb_contractors SET data=?3, updated_at=?4 WHERE slug=?1 AND email=?2").bind(slug, email, JSON.stringify(e), t).run();
    return json({ ok: true, contractor: { id: e.id, name: e.name, email: e.email, trade: e.trade, city: e.city, state: e.state, zip: e.zip },
      message: "Profile updated. Jobs near " + city + ", " + state + " will be easier to find.", returning: true });
  }
  const k = { id: randomHex(6), name, email, phone, company, trade, zip, city, state, license, plan: "pay_per_lead", createdAt: t };
  await env.DB.prepare("INSERT INTO bb_contractors (id, slug, email, plan, data, created_at) VALUES (?1,?2,?3,'pay_per_lead',?4,?5)").bind(k.id, slug, email, JSON.stringify(k), t).run();
  return json({ ok: true, contractor: { id: k.id, name, email, trade, city, state, zip },
    message: "Contractor profile saved for " + city + ", " + state + ". Browse local jobs and unlock with your email." });
}

const PRO_ON = new Set(["active", "trialing"]);

// A lead Checkout Session counts only if it is the exact session created for that unlock, fully paid, in USD, for at least the fee.
async function markUnlockPaid(env, slug, o) {
  const md = o.metadata || {};
  if (o.mode !== "payment" || md.slug !== slug || !md.unlock_id) return null;
  if (!(o.payment_status === "paid" || o.payment_status === "no_payment_required")) return null;
  const u = await env.DB.prepare("SELECT id, job_id, token, status, amount_cents, stripe_session FROM bb_unlocks WHERE slug=?1 AND id=?2").bind(slug, String(md.unlock_id)).first();
  if (!u || u.stripe_session !== o.id) return null;
  if (Number(o.amount_total || 0) < Number(u.amount_cents) || String(o.currency || "").toLowerCase() !== "usd") {
    console.warn("[bidboard] amount mismatch for unlock", u.id);
    return null;
  }
  if (u.status !== "paid") await env.DB.prepare("UPDATE bb_unlocks SET status='paid', paid_at=?3 WHERE slug=?1 AND id=?2").bind(slug, u.id, now()).run();
  return u;
}

async function setPro(env, slug, where, on, customer, subscription) {
  // where: { contractorId } | { subscription } | { customer }
  const plan = on ? "pro" : "pay_per_lead";
  let q, v;
  if (where.contractorId) { q = "id=?2"; v = where.contractorId; }
  else if (where.subscription) { q = "stripe_subscription=?2"; v = where.subscription; }
  else if (where.customer) { q = "stripe_customer=?2"; v = where.customer; }
  else return 0;
  const r = await env.DB.prepare(`UPDATE bb_contractors SET plan=?3, stripe_customer=COALESCE(?4, stripe_customer), stripe_subscription=COALESCE(?5, stripe_subscription), updated_at=?6 WHERE slug=?1 AND ${q}`)
    .bind(slug, v, plan, customer || null, subscription || null, now()).run();
  return (r.meta && r.meta.changes) || 0;
}

async function activateProFromSession(env, slug, o) {
  const md = o.metadata || {};
  if (o.mode !== "subscription" || md.slug !== slug || !md.contractor_id) return false;
  if (o.status !== "complete" || !(o.payment_status === "paid" || o.payment_status === "no_payment_required")) return false;
  return (await setPro(env, slug, { contractorId: String(md.contractor_id) }, true, o.customer, typeof o.subscription === "string" ? o.subscription : o.subscription && o.subscription.id)) > 0;
}

async function handleStripeEvent(env, slug, evt) {
  const o = (evt.data && evt.data.object) || {};
  switch (evt.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      if (o.mode === "payment") await markUnlockPaid(env, slug, o);
      else if (o.mode === "subscription") await activateProFromSession(env, slug, o);
      return;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const md = o.metadata || {};
      if (md.slug && md.slug !== slug) return;
      const on = evt.type !== "customer.subscription.deleted" && PRO_ON.has(o.status);
      const n = await setPro(env, slug, { subscription: o.id }, on, o.customer, o.id);
      if (!n && md.contractor_id) await setPro(env, slug, { contractorId: String(md.contractor_id) }, on, o.customer, o.id);
      return;
    }
    case "invoice.payment_failed": {
      const sub = o.subscription || (o.parent && o.parent.subscription_details && o.parent.subscription_details.subscription) || null;
      const subId = typeof sub === "string" ? sub : sub && sub.id;
      if (subId) await setPro(env, slug, { subscription: subId }, false);
      return;
    }
    default:
      return;
  }
}

async function stripeWebhook(c, S) {
  const { env, slug, request } = c;
  if (!S.webhookSecret) return json({ ok: false, error: "Webhook not configured" }, 503);
  const payload = await request.text();
  if (payload.length > 512 * 1024) return json({ ok: false, error: "too large" }, 413);
  if (!(await verifyStripeSignature(payload, request.headers.get("stripe-signature"), S.webhookSecret))) return json({ ok: false, error: "bad signature" }, 400);
  let evt;
  try { evt = JSON.parse(payload); } catch { return json({ ok: false, error: "bad payload" }, 400); }
  if (!evt || !evt.id || !evt.type) return json({ ok: false, error: "bad payload" }, 400);
  const seen = await env.DB.prepare("SELECT 1 FROM stripe_events WHERE id=?1").bind(evt.id).first();
  if (seen) return json({ ok: true, duplicate: true });
  try {
    await handleStripeEvent(env, slug, evt);
  } catch (e) {
    console.error("[bidboard] webhook failed", evt.type, e.message);
    return json({ ok: false }, 500); // Stripe retries
  }
  await env.DB.prepare("INSERT OR IGNORE INTO stripe_events (id, slug, type) VALUES (?1,?2,?3)").bind(evt.id, slug, evt.type).run();
  return json({ ok: true });
}

async function paidReturn(c, S) {
  const { env, slug, url, request } = c;
  const sid = String(url.searchParams.get("session_id") || "");
  const n = Math.min(Number(url.searchParams.get("n") || 0), 30);
  const toJob = (u) => Response.redirect(new URL("/job.html?id=" + encodeURIComponent(u.job_id) + "&token=" + u.token, url.origin).toString(), 302);
  if (/^cs_[A-Za-z0-9_]{8,200}$/.test(sid)) {
    const u = await env.DB.prepare("SELECT job_id, token FROM bb_unlocks WHERE slug=?1 AND stripe_session=?2 AND status='paid'").bind(slug, sid).first();
    if (u) return toJob(u);
    // Not confirmed by webhook yet: verify the session with Stripe directly.
    if (S.paymentsLive) {
      try {
        await rateLimit(env, `bbpaid:${slug}:${clientIp(request)}`, 60, 600);
        const o = await stripeApi(env, S.stripeKey, "GET", "/v1/checkout/sessions/" + encodeURIComponent(sid));
        if (o.mode === "payment") {
          const paid = await markUnlockPaid(env, slug, o);
          if (paid) return toJob(paid);
        } else if (o.mode === "subscription" && (await activateProFromSession(env, slug, o))) {
          return Response.redirect(new URL("/contractors.html?pro=welcome", url.origin).toString(), 302);
        }
      } catch (e) {
        if (e instanceof HttpError) throw e;
        console.warn("[bidboard] session lookup failed", e.message);
      }
    }
  }
  const waiting = n < 30 && /^cs_/.test(sid);
  const next = "/paid?session_id=" + encodeURIComponent(sid) + "&n=" + (n + 1);
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">' +
    (waiting ? '<meta http-equiv="refresh" content="2;url=' + next + '">' : "") +
    '<title>Confirming payment · BidBoard</title><link rel="stylesheet" href="/styles.css"></head><body><main class="wrap" style="max-width:520px;padding-top:64px"><div class="card"><h1>' +
    (waiting ? "Confirming your payment…" : "Payment received") + '</h1><p class="muted">' +
    (waiting ? "This usually takes a few seconds. The lead's contact details will open automatically." : "We're still confirming it with Stripe. Open the job again from the same browser in a minute, or check your email receipt.") +
    '</p><p><a href="/jobs.html">Back to jobs</a></p></div></main></body></html>';
  return new Response(html, { headers: Object.assign({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }, SECURITY_HEADERS) });
}
