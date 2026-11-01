"use strict";
/**
 * Public gallery of Spawn Cloud apps (spawnapp.org/gallery) + share cards + remix sources.
 * Metadata lives in the spawn-cloud D1 database (table `gallery`, joined with `apps`); screenshots
 * (optional, admin-uploaded) live in the files database as blobs under thumb/<slug>/<sha>.
 * Every app always has a generated 1200×630 card (title, description, category, accent) used as the
 * og:image and as the thumbnail fallback — no headless browser needed on the server.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const CATEGORIES = [
  ["local", "Local business"],
  ["landing", "Landing page"],
  ["store", "Store & payments"],
  ["marketplace", "Marketplace"],
  ["membership", "Membership"],
  ["tool", "Tool & dashboard"],
  ["content", "Blog & content"],
  ["portfolio", "Portfolio"],
  ["game", "Game"],
  ["other", "Other"],
];
const CAT_IDS = new Set(CATEGORIES.map((c) => c[0]));
const catLabel = (id) => (CATEGORIES.find((c) => c[0] === id) || CATEGORIES[CATEGORIES.length - 1])[1];

const GUESS = [
  ["game", /\b(game|arcade|puzzle|high ?score|play now)\b/i],
  ["marketplace", /\b(marketplace|bids?|jobs? board|hire|listings?|vendors?|gigs?)\b/i],
  ["membership", /\b(members?(hip)?|subscription|course|community|patreon)\b/i],
  ["store", /\b(shop|store|checkout|merch|products?|pricing|buy|cart|order)\b/i],
  ["local", /\b(lawn|plumb\w*|cleaning|salon|barber|bakery|cafe|coffee|restaurant|repair|roof\w*|landscap\w*|dental|clinic|gym|studio|in [A-Z][a-z]+,)\b/i],
  ["tool", /\b(dashboard|tracker|calculator|tool|planner|crm|analytics|generator)\b/i],
  ["content", /\b(blog|newsletter|podcast|magazine|journal|recipes?)\b/i],
  ["portfolio", /\b(portfolio|photograph\w*|designer|résumé|resume|my work)\b/i],
  ["landing", /\b(launch|waitlist|landing|app|startup|saas)\b/i],
];
function guessCategory(text) {
  const t = String(text || "");
  for (const [id, re] of GUESS) if (re.test(t)) return id;
  return "other";
}

/* Basic content checks: no slurs/explicit/spam words, no links or emails in titles. */
const BLOCK = /\b(fuck|shit|cunt|bitch|nigg\w*|fag\w*|retard\w*|porn\w*|xxx|nudes?|hentai|escort|casino|viagra|cialis|onlyfans|crypto ?giveaway|kill yourself|kys)\b/i;
function checkTitle(t) {
  t = String(t || "").replace(/\s+/g, " ").trim();
  if (t.length < 2) return "Add a title (2+ characters).";
  if (t.length > 80) return "Keep the title under 80 characters.";
  if (/:\/\/|www\.|@[a-z0-9-]+\.[a-z]/i.test(t)) return "Titles can't contain links or emails.";
  if (/[<>]/.test(t)) return "Titles can't contain < or >.";
  if (BLOCK.test(t)) return "That title isn't allowed in the gallery.";
  if (!/[a-z0-9]/i.test(t)) return "Titles need letters or numbers.";
  return null;
}
function checkText(t) {
  t = String(t || "");
  if (BLOCK.test(t)) return "That description isn't allowed in the gallery.";
  if ((t.match(/https?:\/\//g) || []).length > 1) return "Descriptions can include at most one link.";
  return null;
}
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "\u2014", ndash: "\u2013", hellip: "\u2026", rsquo: "\u2019", lsquo: "\u2018", rdquo: "\u201d", ldquo: "\u201c", middot: "\u00b7", copy: "\u00a9" };
/** Decode HTML entities once (text pulled from published HTML is stored raw; it is escaped exactly once at render). */
function decodeEntities(s) {
  return String(s || "").replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    const v = NAMED[e.toLowerCase()]; return v === undefined ? m : v;
  });
}
const ACCESS = new Set(["open", "pro"]); // later: "purchase" (uses price_cents)
/** Can this viewer remix the entry? Premium templates are included with Pro. */
function canRemix(entry, user, isPro) {
  const access = entry && (entry.access || (entry.premium ? "pro" : "open"));
  if (access !== "pro") return { ok: true };
  if (!user) return { ok: false, reason: "signin" };
  if (!isPro(user)) return { ok: false, reason: "pro" };
  return { ok: true };
}
const clean = (s, n) => String(s || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, n);

function metaFromHtml(html) {
  html = String(html || "");
  const pick = (re) => { const m = re.exec(html); return m ? decodeEntities(m[1]) : ""; };
  return {
    description: clean(pick(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) || pick(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i), 200),
    title: clean(pick(/<title[^>]*>([^<]*)<\/title>/i), 80),
    accent: (/--(?:accent|brand|primary)\s*:\s*(#[0-9a-f]{6}|#[0-9a-f]{3})\b/i.exec(html) || [])[1] || null,
  };
}

const PALETTE = ["#d4a574", "#5eead4", "#8ab4ff", "#f59e9e", "#a78bfa", "#86efac", "#fbbf24", "#67e8f9"];
function accentFor(slug, accent) {
  if (/^#[0-9a-f]{6}$/i.test(accent || "")) return accent.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(accent || "")) return ("#" + accent.slice(1).split("").map((c) => c + c).join("")).toLowerCase();
  const h = crypto.createHash("sha256").update(String(slug)).digest();
  return PALETTE[h[0] % PALETTE.length];
}

/* ---------------- store ---------------- */
function createStore(getBackend) {
  let ready = null;
  const be = () => {
    const b = getBackend();
    if (!b) throw Object.assign(new Error("Spawn Cloud isn't available right now."), { status: 503 });
    return b;
  };
  const q = async (sql, p) => {
    if (!ready) {
      const ddl = fs.readFileSync(path.join(__dirname, "cloud", "migrations", "0005_gallery.sql"), "utf8")
        .replace(/--[^\n]*/g, "").split(";").map((s) => s.trim()).filter(Boolean);
      ready = (async () => {
        for (const s of ddl) await be().query(s, []);
        /* 0006: starter flag (ALTER is not idempotent, so ignore "duplicate column") */
        const cols = await be().query("SELECT name FROM pragma_table_info('gallery')", []).catch(() => []);
        if (!cols.some((c) => c.name === "starter")) try { await be().query("ALTER TABLE gallery ADD COLUMN starter INTEGER NOT NULL DEFAULT 0", []); }
        catch (e) { if (!/duplicate column/i.test(String(e && e.message))) throw e; }
        /* 0007: premium templates (included with Pro); price_cents reserved for a later one-off price */
        for (const [col, ddl] of [["premium", "premium INTEGER NOT NULL DEFAULT 0"], ["access", "access TEXT NOT NULL DEFAULT 'open'"], ["price_cents", "price_cents INTEGER"]]) {
          if (cols.some((c) => c.name === col)) continue;
          try { await be().query("ALTER TABLE gallery ADD COLUMN " + ddl, []); }
          catch (e) { if (!/duplicate column/i.test(String(e && e.message))) throw e; }
        }
      })().catch((e) => { ready = null; throw e; });
    }
    await ready;
    return be().query(sql, p || []);
  };
  const now = () => new Date().toISOString();
  const store = {
    q,
    async get(slug) {
      const r = await q("SELECT g.*, a.title AS app_title, a.status AS app_status, a.runtime, a.live_version, a.owner AS app_owner, a.updated_at AS app_updated FROM apps a LEFT JOIN gallery g ON g.slug=a.slug WHERE a.slug=?1", [slug]);
      return r[0] || null;
    },
    /** Insert or update an entry. Only provided fields change. */
    async upsert(slug, owner, f) {
      const cur = (await q("SELECT * FROM gallery WHERE slug=?1", [slug]))[0];
      const row = Object.assign({ listed: 0, remixable: 1, hidden: 0, starter: 0, premium: 0, access: "open", price_cents: null, title: null, description: null, category: "other", accent: null, thumb_key: null, listed_at: null }, cur || {});
      for (const k of ["title", "description", "category", "accent", "thumb_key"]) if (f[k] !== undefined) row[k] = f[k];
      for (const k of ["listed", "remixable", "hidden", "starter", "premium"]) if (f[k] !== undefined) row[k] = f[k] ? 1 : 0;
      if (f.access !== undefined) row.access = ACCESS.has(f.access) ? f.access : "open";
      if (f.price_cents !== undefined) row.price_cents = f.price_cents == null ? null : Math.max(0, Math.round(Number(f.price_cents) || 0));
      if (row.premium && row.access === "open") row.access = "pro";
      if (row.listed && !row.listed_at) row.listed_at = now();
      if (!CAT_IDS.has(row.category)) row.category = "other";
      if (cur) {
        await q("UPDATE gallery SET listed=?2, remixable=?3, hidden=?4, title=?5, description=?6, category=?7, accent=?8, thumb_key=?9, listed_at=?10, updated_at=?11, starter=?12, premium=?13, access=?14, price_cents=?15 WHERE slug=?1",
          [slug, row.listed, row.remixable, row.hidden, row.title, row.description, row.category, row.accent, row.thumb_key, row.listed_at, now(), row.starter ? 1 : 0, row.premium ? 1 : 0, row.access || "open", row.price_cents == null ? null : row.price_cents]);
      } else {
        await q("INSERT INTO gallery (slug, owner, listed, remixable, hidden, title, description, category, accent, thumb_key, listed_at, starter, premium, access, price_cents) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
          [slug, owner, row.listed, row.remixable, row.hidden, row.title, row.description, row.category, row.accent, row.thumb_key, row.listed_at, row.starter ? 1 : 0, row.premium ? 1 : 0, row.access || "open", row.price_cents == null ? null : row.price_cents]);
      }
      return (await q("SELECT * FROM gallery WHERE slug=?1", [slug]))[0];
    },
    async list() {
      return q("SELECT g.slug, g.title, g.description, g.category, g.accent, g.remixable, g.starter, g.premium, g.access, g.price_cents, g.thumb_key, g.listed_at, g.updated_at, g.remix_count, a.title AS app_title, a.updated_at AS app_updated, a.runtime " +
        "FROM gallery g JOIN apps a ON a.slug=g.slug WHERE g.listed=1 AND g.hidden=0 AND a.status='active' AND a.live_version IS NOT NULL ORDER BY g.listed_at DESC LIMIT 300", []);
    },
    async report(slug, reason, note, reporter) {
      const recent = await q("SELECT COUNT(*) AS n FROM gallery_reports WHERE slug=?1 AND reporter=?2", [slug, reporter]);
      if (Number((recent[0] || {}).n) > 0) return false;
      await q("INSERT INTO gallery_reports (id, slug, reason, note, reporter) VALUES (?1,?2,?3,?4,?5)", [crypto.randomBytes(8).toString("hex"), slug, reason, note || null, reporter]);
      return true;
    },
    async reports() { return q("SELECT slug, reason, note, created_at FROM gallery_reports ORDER BY created_at DESC LIMIT 200", []); },
    /** Defaults for a new entry from the live index.html: title, meta description, accent, category. */
    async autoFields(slug) {
      const g = await store.get(slug);
      const out = { title: g && g.app_title ? clean(decodeEntities(g.app_title), 80) : slug, description: "", accent: null };
      try {
        const v = (await q("SELECT manifest FROM versions WHERE slug=?1 AND version=?2", [slug, g.live_version]))[0];
        const f = v && JSON.parse(v.manifest).files["index.html"];
        const buf = f && (await be().get("blob/" + slug + "/" + f.h));
        if (buf) { const m = metaFromHtml(buf.toString("utf8")); out.description = checkText(m.description) ? "" : m.description; out.accent = m.accent; }
      } catch (_) {}
      out.category = guessCategory(out.title + " " + out.description);
      return out;
    },
    async bumpRemix(slug) { await q("UPDATE gallery SET remix_count=remix_count+1 WHERE slug=?1", [slug]); },
    async putThumb(slug, buf, type) {
      const h = crypto.createHash("sha256").update(buf).digest("hex");
      const key = "thumb/" + slug + "/" + h;
      if (!(await be().head(key))) await be().put(key, buf, type);
      const old = (await q("SELECT thumb_key FROM gallery WHERE slug=?1", [slug]))[0];
      if (old && old.thumb_key && old.thumb_key !== key) { try { await be().del(old.thumb_key); } catch (_) {} }
      return key;
    },
    async getBlob(key) { return be().get(key); },
    async remove(slug) {
      const g = (await q("SELECT thumb_key FROM gallery WHERE slug=?1", [slug]))[0];
      if (g && g.thumb_key) { try { await be().del(g.thumb_key); } catch (_) {} }
      await q("DELETE FROM gallery WHERE slug=?1", [slug]);
      await q("DELETE FROM gallery_reports WHERE slug=?1", [slug]);
    },
    /** Static files of the live version for a remix: never secrets, data or server code. */
    async remixSource(slug) {
      const g = await store.get(slug);
      if (!g || !g.listed || g.hidden || g.app_status !== "active" || !g.live_version) throw Object.assign(new Error("That app isn't in the gallery."), { status: 404 });
      if (!g.remixable) throw Object.assign(new Error("The owner of this app hasn't allowed remixes."), { status: 403 });
      const v = (await q("SELECT manifest FROM versions WHERE slug=?1 AND version=?2", [slug, g.live_version]))[0];
      if (!v) throw Object.assign(new Error("That app has no published files."), { status: 404 });
      const files = {};
      let total = 0;
      for (const [p, f] of Object.entries(JSON.parse(v.manifest).files || {})) {
        if (!REMIX_OK.test(p) || REMIX_BLOCK.test(p)) continue;
        const buf = await be().get("blob/" + slug + "/" + f.h);
        if (!buf) continue;
        total += buf.length;
        if (total > 4 * 1024 * 1024) break;
        files[p] = buf;
        if (Object.keys(files).length >= 200) break;
      }
      if (!files["index.html"]) throw Object.assign(new Error("That app has no index.html to remix."), { status: 400 });
      return { title: g.title || g.app_title || slug, files, premium: !!g.premium, access: g.access || "open" };
    },
  };
  return store;
}
const REMIX_OK = /^[a-z0-9][a-z0-9._/-]{0,200}\.(html|css|js|svg|png|jpe?g|gif|webp|avif|ico|woff2?|txt|webmanifest)$/i;
const REMIX_BLOCK = /(^|\/)(\.|_forge_|data\/|node_modules\/|server\.js|sw\.js|.*\.map$)/i;

/** Remove things a remix must not inherit: the Spawn badge and our injected share tags. */
function stripForRemix(html) {
  return String(html)
    .replace(/<a\b[^>]*data-spawn-badge[\s\S]*?<\/a>\s*/gi, "")
    .replace(/<!-- spawn-og -->[\s\S]*?<!-- \/spawn-og -->\s*/g, "");
}

/* ---------------- generated cards (PNG via resvg, bundled Inter) ---------------- */
let Resvg = null;
try { Resvg = require("@resvg/resvg-js").Resvg; } catch (_) {}
const FONT_DIR = path.join(__dirname, "assets", "fonts");
const FONTS = ["Inter-400.ttf", "Inter-600.ttf", "Inter-800.ttf"].map((f) => path.join(FONT_DIR, f)).filter((f) => fs.existsSync(f));
const x = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/* Greedy word wrap by an average glyph width (Inter ≈ 0.55em at 800, 0.5em at 400). */
function wrap(text, size, maxW, maxLines, factor) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const per = Math.max(4, Math.floor(maxW / (size * factor)));
  const lines = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? cur + " " + w : w;
    if (next.length > per && cur) { lines.push(cur); cur = w; } else cur = next;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, "") + "…";
  return lines.map((l) => (l.length > per + 2 ? l.slice(0, per) + "…" : l));
}

function cardSvg(o) {
  const W = 1200, H = 630;
  const acc = accentFor(o.slug || o.title, o.accent);
  let size = 76;
  let tl = wrap(o.title, size, 980, 2, 0.56);
  if (tl.length > 1 || (tl[0] || "").length > 22) { size = 64; tl = wrap(o.title, size, 1000, 2, 0.56); }
  const dl = o.description ? wrap(o.description, 30, 960, 2, 0.5) : [];
  const ty = 300 - (tl.length - 1) * size * 0.55;
  const title = tl.map((l, i) => `<text x="88" y="${Math.round(ty + i * size * 1.08)}" font-family="Inter" font-weight="800" font-size="${size}" fill="#f6f4ef" letter-spacing="-1.5">${x(l)}</text>`).join("");
  const dy = ty + tl.length * size * 1.08 + 26;
  const desc = dl.map((l, i) => `<text x="88" y="${Math.round(dy + i * 42)}" font-family="Inter" font-weight="400" font-size="30" fill="#b9b4aa">${x(l)}</text>`).join("");
  const kicker = x(o.kicker || catLabel(o.category || "other"));
  const url = x(o.url || "");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
<radialGradient id="g1" cx="0.85" cy="0.1" r="0.75"><stop offset="0" stop-color="${acc}" stop-opacity="0.55"/><stop offset="1" stop-color="${acc}" stop-opacity="0"/></radialGradient>
<radialGradient id="g2" cx="0.05" cy="1" r="0.6"><stop offset="0" stop-color="${acc}" stop-opacity="0.22"/><stop offset="1" stop-color="${acc}" stop-opacity="0"/></radialGradient>
<pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#ffffff" stroke-opacity="0.045" stroke-width="1"/></pattern>
</defs>
<rect width="${W}" height="${H}" fill="#0b0b0d"/>
<rect width="${W}" height="${H}" fill="url(#grid)"/>
<rect width="${W}" height="${H}" fill="url(#g1)"/>
<rect width="${W}" height="${H}" fill="url(#g2)"/>
<rect x="88" y="96" rx="18" ry="18" width="${Math.round(kicker.length * 11.5 + 44)}" height="36" fill="${acc}" fill-opacity="0.16" stroke="${acc}" stroke-opacity="0.5"/>
<text x="110" y="120" font-family="Inter" font-weight="600" font-size="19" fill="${acc}" letter-spacing="0.5">${kicker}</text>
${title}
${desc}
<rect x="88" y="${H - 104}" width="1024" height="1" fill="#ffffff" fill-opacity="0.1"/>
<text x="88" y="${H - 58}" font-family="Inter" font-weight="600" font-size="24" fill="#f6f4ef">${url}</text>
<circle cx="${W - 236}" cy="${H - 66}" r="6" fill="#d4a574"/>
<text x="${W - 218}" y="${H - 58}" font-family="Inter" font-weight="600" font-size="22" fill="#9b968c">Made with Spawn</text>
</svg>`;
}
const cardCache = new Map();
function cardPng(o) {
  const key = JSON.stringify([o.slug, o.title, o.description, o.category, o.accent, o.url, o.kicker]);
  if (cardCache.has(key)) return cardCache.get(key);
  if (!Resvg) return null;
  const png = new Resvg(cardSvg(o), { font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: "Inter" }, fitTo: { mode: "width", value: 1200 } }).render().asPng();
  if (cardCache.size > 200) cardCache.delete(cardCache.keys().next().value);
  cardCache.set(key, png);
  return png;
}

/* ---------------- page ---------------- */
function entryView(r, apex) {
  const title = r.title || r.app_title || r.slug;
  const v = encodeURIComponent(String(r.updated_at || r.listed_at || "").replace(/\D/g, "").slice(0, 14));
  return {
    slug: r.slug,
    title,
    description: r.description || "",
    category: CAT_IDS.has(r.category) ? r.category : "other",
    categoryLabel: catLabel(r.category),
    accent: accentFor(r.slug, r.accent),
    remixable: !!r.remixable,
    starter: !!r.starter,
    premium: !!r.premium,
    access: r.access || (r.premium ? "pro" : "open"),
    url: "https://" + r.slug + "." + apex + "/",
    host: r.slug + "." + apex,
    thumb: "/gallery/thumb/" + r.slug + ".png?v=" + v,
    screenshot: !!r.thumb_key,
    listedAt: r.listed_at,
    updatedAt: r.app_updated || r.updated_at,
  };
}

function renderCards(entries) {
  return entries.map((e, i) => `
      <li class="gl-card${e.premium ? " gl-card-premium" : ""}" data-cat="${x(e.category)}" data-new="${x(e.listedAt || "")}" data-upd="${x(e.updatedAt || "")}" data-title="${x(e.title.toLowerCase())}" style="--i:${i};--acc:${x(e.accent)}">
        <a class="gl-shot" href="${x(e.url)}" target="_blank" rel="noopener" aria-label="Open ${x(e.title)} live (new tab)">
          <img src="${x(e.thumb)}" width="1200" height="630" alt="${x(e.screenshot ? "Screenshot of " + e.title : e.title + " share card")}" loading="${i < 3 ? "eager" : "lazy"}" decoding="async" />
          <span class="gl-live-pill"><span aria-hidden="true"></span>Live</span>
        </a>
        <div class="gl-body">
          <div class="gl-tags">${e.premium ? '<span class="gl-tag gl-tag-premium" title="Remix it with a Spawn Pro account — no extra charge">Premium · Included with Pro</span><span class="gl-tag gl-tag-ghost" title="Connect your own Stripe account and paid bookings, orders and memberships confirm themselves">Payments unlock automatically</span>' : ""}${e.starter && !e.premium ? '<span class="gl-tag gl-tag-starter" title="Made by Spawn as a starting point — remix it into your own app">Spawn starter</span>' : ""}<span class="gl-tag">${x(e.categoryLabel)}</span>${e.remixable && !e.premium ? '<span class="gl-tag gl-tag-ghost">Remixable</span>' : ""}</div>
          <h2 class="gl-title">${x(e.title)}</h2>
          ${e.description ? `<p class="gl-desc">${x(e.description)}</p>` : ""}
          <p class="gl-host mono">${x(e.host)}</p>
          <div class="gl-actions">
            <a class="btn-solid gl-btn" href="${x(e.url)}" target="_blank" rel="noopener" data-gl-open="${x(e.slug)}">Open live <span aria-hidden="true">↗</span></a>
            ${e.remixable ? `<a class="gl-btn gl-btn-ghost" href="/build?remix=${encodeURIComponent(e.slug)}" data-gl-remix="${x(e.slug)}"${e.premium ? ` data-gl-premium="${x(e.slug)}" data-gl-title="${x(e.title)}"` : ""}>${e.premium ? "Remix with Pro" : "Remix this"}</a>` : `<span class="gl-note">Remix off</span>`}
            <button type="button" class="gl-report" data-gl-report="${x(e.slug)}" aria-label="Report ${x(e.title)}">Report</button>
          </div>
        </div>
      </li>`).join("");
}

function renderFilters(entries) {
  const used = new Set(entries.map((e) => e.category));
  const chips = CATEGORIES.filter((c) => used.has(c[0]));
  return ['<button type="button" class="gl-chip is-on" data-gl-cat="all" aria-pressed="true">All <span>' + entries.length + "</span></button>"]
    .concat(chips.map((c) => `<button type="button" class="gl-chip" data-gl-cat="${c[0]}" aria-pressed="false">${x(c[1])} <span>${entries.filter((e) => e.category === c[0]).length}</span></button>`))
    .join("");
}

/* ---------------- routes ---------------- */
function mount(app, opts) {
  const cloud = opts.cloud || require("./cloudpublish");
  const isAdmin = opts.isAdmin || (() => false);
  const apex = () => process.env.CLOUD_APEX || "spawnapp.org";
  const store = createStore(() => (cloud.enabled() ? cloud.backend() : null));
  module.exports.store = store;
  const TEMPLATE = path.join(__dirname, "public", "gallery.html");
  const express = require("express");
  const rate = new Map();
  const limited = (k, max, ms) => { const t = Date.now(); const e = rate.get(k); if (!e || e.reset < t) { rate.set(k, { n: 1, reset: t + ms }); if (rate.size > 5000) rate.clear(); return false; } return ++e.n > max; };
  const ipOf = (req) => (String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || "unknown");
  const wrapR = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
    if (!err.status) console.error("[gallery]", err && err.message);
    if (!res.headersSent) res.status(err.status || 500).json({ ok: false, error: err.status ? err.message : "Something went wrong — try again." });
  });

  let listCache = { at: 0, rows: null };
  async function entries() {
    if (!cloud.enabled()) return [];
    if (listCache.rows && Date.now() - listCache.at < 20000) return listCache.rows;
    const rows = (await store.list()).map((r) => entryView(r, apex()));
    listCache = { at: Date.now(), rows };
    return rows;
  }
  const bust = () => { listCache = { at: 0, rows: null }; };
  module.exports.bust = bust;

  app.get(["/gallery", "/gallery/"], wrapR(async (req, res) => {
    if (req.path === "/gallery/") return res.redirect(301, "/gallery" + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""));
    let list = [];
    try { list = await entries(); } catch (e) { console.error("[gallery] list failed", e.message); }
    const prem = list.filter((e) => e.premium), rest = list.filter((e) => !e.premium);
    const html = fs.readFileSync(TEMPLATE, "utf8")
      .replace("<!--GL_PREMIUM_HIDDEN-->", prem.length ? "" : "hidden")
      .replace("<!--GL_PREMIUM-->", renderCards(prem))
      .replace("<!--GL_FILTERS-->", renderFilters(rest))
      .replace("<!--GL_CARDS-->", renderCards(rest))
      .replace("<!--GL_COUNT-->", String(rest.length))
      .replace("<!--GL_EMPTY_HIDDEN-->", rest.length ? "hidden" : "")
      .replace("/*GL_LD*/", JSON.stringify({
        "@context": "https://schema.org", "@type": "CollectionPage", "@id": "https://spawnapp.org/gallery#webpage", name: "Spawn Gallery — website templates to remix", url: "https://spawnapp.org/gallery",
        description: "Live apps made with Spawn, Spawn starters you can remix for free, and premium templates — a booking system, an online store and a membership site — included with Spawn Pro.",
        isPartOf: { "@type": "WebSite", "@id": "https://spawnapp.org/#website", name: "Spawn", url: "https://spawnapp.org/" },
        breadcrumb: { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: "https://spawnapp.org/" }, { "@type": "ListItem", position: 2, name: "Gallery", item: "https://spawnapp.org/gallery" }] },
        mainEntity: { "@type": "ItemList", numberOfItems: Math.min(list.length, 50), itemListElement: list.slice(0, 50).map((e, i) => ({ "@type": "ListItem", position: i + 1, url: /^https?:/.test(e.url) ? e.url : "https://" + e.url, name: e.title })) },
      }).replace(/</g, "\\u003c"));
    res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    res.type("html").send(html);
  }));

  app.get("/api/gallery", wrapR(async (req, res) => {
    res.setHeader("Cache-Control", "public, max-age=20");
    res.json({ ok: true, categories: CATEGORIES.map(([id, label]) => ({ id, label })), entries: await entries() });
  }));

  async function cardFor(slug) {
    const g = await store.get(slug);
    if (!g || g.app_status !== "active") return null;
    return { slug, title: g.title || g.app_title || slug, description: g.description || "", category: g.category || guessCategory(g.app_title), accent: g.accent, url: slug + "." + apex(), g };
  }
  app.get("/gallery/thumb/:slug.png", wrapR(async (req, res) => {
    const slug = String(req.params.slug).toLowerCase();
    if (!/^[a-z0-9-]{1,40}$/.test(slug) || !cloud.enabled()) return res.status(404).end();
    const c = await cardFor(slug);
    if (!c || !c.g.listed || c.g.hidden) return res.status(404).end();
    if (c.g.thumb_key) {
      const buf = await store.getBlob(c.g.thumb_key);
      if (buf) {
        const isWebp = buf.slice(8, 12).toString() === "WEBP";
        const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.type(isWebp ? "image/webp" : isJpeg ? "image/jpeg" : "image/png").send(buf);
      }
    }
    const png = cardPng(c);
    if (!png) return res.status(404).end();
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.type("image/png").send(png);
  }));
  /* Share card used as og:image for every published app (listed or not). */
  app.get("/og/app/:slug.png", wrapR(async (req, res) => {
    const slug = String(req.params.slug).toLowerCase();
    if (!/^[a-z0-9-]{1,40}$/.test(slug) || !cloud.enabled()) return res.status(404).end();
    const c = await cardFor(slug);
    if (!c || (c.g.hidden && c.g.listed !== undefined && c.g.hidden)) return res.status(404).end();
    const png = cardPng(c);
    if (!png) return res.status(404).end();
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.type("image/png").send(png);
  }));
  app.get("/og/gallery.png", (req, res) => {
    const png = cardPng({ slug: "gallery", title: "Website templates to remix", description: "Live apps made with Spawn plus five Spawn starters. Open one live or remix it free.", kicker: "Spawn Gallery", accent: "#d4a574", url: "spawnapp.org/gallery" });
    if (!png) return res.redirect(302, "/og.png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.type("image/png").send(png);
  });

  app.post("/api/gallery/:slug/report", express.json({ limit: "8kb" }), wrapR(async (req, res) => {
    const slug = String(req.params.slug).toLowerCase();
    const ip = ipOf(req);
    if (limited("rep:" + ip, 10, 3600000)) return res.status(429).json({ ok: false, error: "Too many reports — try again later." });
    const reason = String((req.body && req.body.reason) || "");
    if (!["broken", "spam", "offensive", "scam", "copyright", "other"].includes(reason)) return res.status(400).json({ ok: false, error: "Pick a reason." });
    const g = await store.get(slug);
    if (!g || !g.listed) return res.status(404).json({ ok: false, error: "That app isn't in the gallery." });
    const reporter = crypto.createHash("sha256").update(ip + ":" + new Date().toISOString().slice(0, 10)).digest("hex").slice(0, 32);
    await store.report(slug, reason, clean(req.body && req.body.note, 300), reporter);
    console.log("[gallery] report", slug, reason);
    res.json({ ok: true, note: "Thanks — we'll take a look." });
  }));

  /* ---- admin (WAITLIST_ADMIN_TOKEN) ---- */
  const admin = (fn) => wrapR(async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });
    res.setHeader("Cache-Control", "no-store");
    return fn(req, res);
  });
  app.post("/api/admin/gallery/:slug", express.json({ limit: "16kb" }), admin(async (req, res) => {
    const slug = String(req.params.slug).toLowerCase();
    const g = await store.get(slug);
    if (!g) return res.status(404).json({ ok: false, error: "No such app." });
    const b = req.body || {};
    const f = g.slug ? {} : await store.autoFields(slug);
    if (typeof b.hidden === "boolean") f.hidden = b.hidden;
    if (typeof b.listed === "boolean") f.listed = b.listed;
    if (typeof b.remixable === "boolean") f.remixable = b.remixable;
    if (typeof b.starter === "boolean") f.starter = b.starter;
    if (typeof b.premium === "boolean") f.premium = b.premium;
    if (b.access !== undefined) f.access = b.access;
    if (b.price_cents !== undefined) f.price_cents = b.price_cents;
    if (b.title !== undefined) { const e = checkTitle(b.title); if (e) return res.status(400).json({ ok: false, error: e }); f.title = clean(b.title, 80); }
    if (b.description !== undefined) { const e = checkText(b.description); if (e) return res.status(400).json({ ok: false, error: e }); f.description = clean(b.description, 200); }
    if (b.category !== undefined) f.category = CAT_IDS.has(b.category) ? b.category : "other";
    if (b.accent !== undefined) f.accent = /^#[0-9a-f]{6}$/i.test(b.accent) ? b.accent : null;
    const row = await store.upsert(slug, g.app_owner, f);
    bust();
    res.json({ ok: true, entry: row });
  }));
  app.put("/api/admin/gallery/:slug/thumb", express.raw({ type: ["image/png", "image/webp", "image/jpeg"], limit: "1500kb" }), admin(async (req, res) => {
    const slug = String(req.params.slug).toLowerCase();
    const g = await store.get(slug);
    if (!g || !g.slug) return res.status(404).json({ ok: false, error: "Not in the gallery." });
    if (!Buffer.isBuffer(req.body) || req.body.length < 100) return res.status(400).json({ ok: false, error: "Send an image body." });
    const key = await store.putThumb(slug, req.body, req.headers["content-type"]);
    await store.upsert(slug, g.app_owner, { thumb_key: key });
    bust();
    res.json({ ok: true, bytes: req.body.length });
  }));
  app.get("/api/admin/gallery/reports", admin(async (req, res) => res.json({ ok: true, reports: await store.reports() })));
  /* Remove a cloud app completely (test cleanup / takedown): app row, versions, files, gallery entry. */
  app.delete("/api/admin/cloud-apps/:slug", admin(async (req, res) => {
    const slug = String(req.params.slug).toLowerCase();
    if (!/^[a-z0-9-]{2,40}$/.test(slug)) return res.status(400).json({ ok: false });
    if (["bidboard"].includes(slug) && req.query.force !== "1") return res.status(409).json({ ok: false, error: "Protected app." });
    const be = cloud.backend();
    await store.remove(slug);
    await be.query("DELETE FROM versions WHERE slug=?1", [slug]);
    await be.query("DELETE FROM app_secrets WHERE slug=?1", [slug]);
    await be.query("DELETE FROM apps WHERE slug=?1", [slug]);
    let n = 0;
    for (const k of await be.list("blob/" + slug + "/")) { await be.del(k); n++; }
    bust();
    res.json({ ok: true, deleted: slug, blobs: n });
  }));
}

module.exports = { mount, decodeEntities, canRemix, ACCESS, createStore, CATEGORIES, guessCategory, checkTitle, checkText, metaFromHtml, stripForRemix, cardSvg, cardPng, accentFor, catLabel, CAT_IDS };
