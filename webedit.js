"use strict";

/**
 * Offline Build edits for on-site /build — same spirit as Forge heuristics,
 * without AI. Operates on a project directory (public/index.html + styles.css).
 */
const fs = require("fs");
const path = require("path");
const webfree = require("./webfree");
const copy = require("./webcopy");
const det = require("./webdetails");

const ACCENTS = {
  teal: "#5eead4",
  violet: "#a78bfa",
  amber: "#fbbf24",
  mint: "#34d399",
  slate: "#94a3b8",
  orange: "#fb923c",
  blue: "#60a5fa",
  green: "#4ade80",
  purple: "#c084fc",
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readText(root, rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function writeText(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

function exists(root, rel) {
  return fs.existsSync(path.join(root, rel));
}

function insertBeforeFooter(html, block) {
  const markers = ["<footer", "</footer>", "</main>", "</body>"];
  for (const m of markers) {
    let idx = html.lastIndexOf(m);
    if (idx !== -1 && m === "<footer") {
      while (idx > 0 && /[ \t]/.test(html[idx - 1])) idx--;
      return html.slice(0, idx) + block + "\n\n" + html.slice(idx);
    }
    if (idx !== -1) {
      if (m.startsWith("</")) {
        return html.slice(0, idx) + "\n" + block + "\n" + html.slice(idx);
      }
      return html.slice(0, idx) + block + "\n" + html.slice(idx);
    }
  }
  return html + "\n" + block + "\n";
}

function replaceTitle(html, title) {
  const t = escapeHtml(title);
  let out = html.replace(/<title>[^<]*<\/title>/i, "<title>" + t + "</title>");
  out = out.replace(/(<h1[^>]*>)([\s\S]*?)(<\/h1>)/i, "$1" + t + "$3");
  out = out.replace(/(<div class="brand">)([\s\S]*?)(<\/div>)/i, "$1" + t + "$3");
  return out;
}

/** Where "choose a plan" buttons should go: the page's own form section when it has one. */
function formHref(html) {
  const secs = webfree.findSections(html || "");
  const f = secs.find(function (x) { return !x.hero && x.id && /<form\b/i.test(x.inner) && !/data-forge-newsletter/.test(x.inner); });
  return f ? "#" + f.id : /id="get-started"/.test(html || "") ? "#get-started" : "#contact";
}

function tierCard(t, href, popular) {
  const esc = escapeHtml;
  return `        <div class="card" style="background:var(--bg,#0b0f14)${popular ? ";border-color:var(--accent,#5eead4)" : ""}">
          ${popular ? '<span class="badge">Popular</span>\n          ' : ""}<h3>${esc(t.name)}</h3>
          <p style="font-size:1.8rem;font-weight:800;margin:8px 0">${t.price ? esc(t.price) : '<span class="muted" style="font-size:1rem;font-weight:600">Ask us</span>'}${t.unit ? '<span class="muted" style="font-size:1rem">/' + esc(t.unit) + "</span>" : ""}</p>
          <ul class="muted" style="margin:8px 0 0;padding-left:18px;line-height:1.5">
            ${t.items.map(function (i) { return "<li>" + esc(i) + "</li>"; }).join("")}
          </ul>
          <p style="margin-top:14px"><a class="btn${popular ? "" : " ghost"}" href="${href}">${esc(t.cta || "Choose " + t.name)}</a></p>
        </div>`;
}

/* Pricing that fits the business: their tiers when named, else food / local-service / product defaults. */
function pricingSection(meta, clause, html) {
  const kind = det.kindOf(meta);
  const href = formHref(html);
  const pack = meta && meta.pack ? copy.PACKS.find(function (p) { return p.id === meta.pack; }) : null;
  const feats = (pack ? pack.features : []).map(function (f) { return f[0]; });
  let tiers;
  let title = "Simple pricing";
  let sub = "Pick a tier — swap prices and features for yours.";
  const named = det.tiersFrom(clause);
  if (named.length) {
    const unit = (named.find(function (t) { return t.unit; }) || {}).unit || null;
    const f = feats.length >= 3 ? feats : null;
    const perks = {
      product: [["Core features", "Email support"], ["Priority support", "Team seats"], ["Dedicated onboarding", "Custom terms"]],
      food: [["Pickup in store", "Ready in 48 hours"], ["Custom message & colors", "Local delivery"], ["Tasting & planning call", "Delivery and setup"]],
      service: f ? [[f[0], f[3] || "Clear quote up front"], [f[1]], [f[2]]] : [["Consultation", "Clear quote up front"], ["Full service", "Priority scheduling"], ["Ongoing support", "Follow-up included"]],
    }[kind];
    tiers = named.map(function (t, i) {
      const p = perks[Math.min(i, perks.length - 1)];
      const items = i === 0 ? p.slice() : ["Everything in " + named[i - 1].name].concat(p);
      return { name: t.name, price: t.price, unit: t.unit || (t.price && kind === "product" ? unit : null), items: items };
    });
    title = kind === "product" ? "Choose your plan" : "Our prices";
    sub = "Ask Build to change any name, price, or line.";
  } else if (kind === "food") {
    title = "Custom orders & catering";
    sub = "Starting prices — final quote depends on your order.";
    tiers = [
      { name: "Small order", price: "from $40", items: ["Serves 6–8", "Ready in 48 hours", "Pickup in store"], cta: "Start an order" },
      { name: "Party", price: "from $90", items: ["Serves 15–20", "Custom message & colors", "Pickup or local delivery"], cta: "Plan a party order" },
      { name: "Event", price: "from $200", items: ["Serves 40+", "Tasting & planning call", "Delivery and setup"], cta: "Talk to us" },
    ];
  } else if (kind === "service") {
    title = "Packages";
    sub = "Starting prices — you'll get a clear quote before anything starts.";
    const f = feats.length >= 3 ? feats : ["Consultation", "Full service", "Ongoing support"];
    tiers = [
      { name: "Essential", price: "from $49", items: [f[0], "Clear quote up front"], cta: "Book Essential" },
      { name: "Standard", price: "from $99", items: [f[0], f[1], "Priority scheduling"], cta: "Book Standard" },
      { name: "Premium", price: "from $179", items: ["Everything in Standard", f[2], "Follow-up included"], cta: "Book Premium" },
    ];
  } else {
    tiers = [
      { name: "Starter", price: "$9", unit: "mo", items: ["1 project", "Email support", "Basic analytics"] },
      { name: "Pro", price: "$29", unit: "mo", items: ["Unlimited projects", "Priority support", "Team seats (5)"] },
      { name: "Business", price: "$79", unit: "mo", items: ["Everything in Pro", "SSO-ready hooks", "Custom domains help"], cta: "Talk to sales" },
    ];
  }
  const pop = tiers.length >= 3 ? 1 : -1;
  return `    <section id="pricing" class="card" style="margin-top:24px" data-forge="pricing">
      <span class="badge">Pricing</span>
      <h2 style="margin:10px 0 8px">${escapeHtml(title)}</h2>
      <p class="muted">${escapeHtml(sub)}</p>
      <div class="grid ${Math.min(tiers.length, 4)}" style="margin-top:16px">
${tiers.map(function (t, i) { return tierCard(t, href, i === pop); }).join("\n")}
      </div>
    </section>`;
}

const FAQ_DEFAULTS = {
  food: [
    ["Can I order ahead for pickup?", "Yes — send your order through the form and we'll have it ready when you arrive."],
    ["Do you take custom or large orders?", "We do. Tell us the date and quantity and we'll confirm details and pricing."],
    ["Do you have options for dietary needs?", "Ask us — we'll tell you what's available that day and what we can make to order."],
  ],
  service: [
    ["How do I book?", "Use the form on this page or give us a call — we'll confirm a time that works for you."],
    ["What areas do you serve?", "Tell us where you are — we'll let you know right away if we can help."],
    ["How does pricing work?", "You'll get a clear price up front, before anything starts. No surprises."],
  ],
  product: [
    ["How do I get started?", "Create an account, pick a plan, and you are live in minutes."],
    ["Can I cancel anytime?", "Yes. No long-term contracts."],
    ["Do you offer support?", "Email support is included on every plan."],
  ],
};

function faqItem(q, a, first) {
  const esc = escapeHtml;
  return `      <details class="faq-item feed-item"${first ? " open" : ""} style="margin-top:${first ? 10 : 8}px">
        <summary style="cursor:pointer;font-weight:600">${esc(q)}</summary>
        <p class="muted"${a ? "" : ' data-placeholder="1"'} style="margin:8px 0 0">${esc(a || "Add your answer — say: answer “" + q + "” with …")}</p>
      </details>`;
}

/* FAQ that fits the business; their own questions when they list them. */
function faqSection(meta, clause) {
  const asked = det.questionsFrom(clause);
  const items = asked.length
    ? asked.map(function (q) { return [q, webfree.faqAnswer(q)]; })
    : FAQ_DEFAULTS[det.kindOf(meta)];
  return `    <section id="faq" class="card" style="margin-top:24px" data-forge="faq">
      <h2>FAQ</h2>
${items.map(function (it, i) { return faqItem(it[0], it[1], i === 0); }).join("\n")}
    </section>`;
}

function testimonialsSection(packId, html) {
  const esc = escapeHtml;
  const used = String(html || "");
  const pool = copy.quotesFor(packId).concat(copy.GENERIC_QUOTES);
  const picks = [];
  pool.forEach(function (q) {
    if (picks.length < 2 && used.indexOf(q[0]) === -1 && !picks.some(function (p) { return p[0] === q[0]; })) picks.push(q);
  });
  const ini = function (n) { return String(n).split(/[ ,.&]+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join(""); };
  const card = function (q) {
    return `        <div class="card" style="margin:0">
          <div class="row" style="margin-bottom:10px"><span class="avatar">${esc(ini(q[1]))}</span><strong>${esc(q[1])}</strong></div>
          <p class="quote">${esc(q[0])}</p>
        </div>`;
  };
  return `    <section id="testimonials" class="card" style="margin-top:24px" data-forge="testimonials">
      <h2>What people say</h2>
      <p class="muted">Sample quotes — replace with real customers.</p>
      <div class="grid 2" style="margin-top:14px">
${picks.map(card).join("\n")}
      </div>
    </section>`;
}

function featuresSection() {
  return `    <section id="features-extra" class="card" style="margin-top:24px" data-forge="features">
      <h2>Features</h2>
      <p class="muted">Highlights visitors care about — edit freely.</p>
      <div class="grid 3" style="margin-top:14px">
        <div class="card" style="margin:0"><div class="feature-icon">1</div><h3>Fast</h3><p class="muted">Lightweight pages that load quickly.</p></div>
        <div class="card" style="margin:0"><div class="feature-icon">2</div><h3>Clear</h3><p class="muted">Obvious next step for every visitor.</p></div>
        <div class="card" style="margin:0"><div class="feature-icon">3</div><h3>Editable</h3><p class="muted">Change copy and sections in Build chat.</p></div>
      </div>
    </section>`;
}

function statsSection() {
  return `    <section id="stats" class="card" style="margin-top:24px" data-forge="stats">
      <h2>Traction</h2>
      <div class="grid 3" style="margin-top:14px">
        <div class="card" style="margin:0"><div class="kpi-label">Users</div><div class="kpi">2,400+</div></div>
        <div class="card" style="margin:0"><div class="kpi-label">Uptime</div><div class="kpi">99.9%</div></div>
        <div class="card" style="margin:0"><div class="kpi-label">Rating</div><div class="kpi">4.9</div></div>
      </div>
    </section>`;
}

function contactSection() {
  return `    <section id="contact" class="card" style="margin-top:24px" data-forge="contact">
      <h2>Contact</h2>
      <p class="muted">Tell us what you need — we reply within one business day.</p>
      <form id="contactForm" style="margin-top:14px">
        <div class="grid 2">
          <div class="field"><label>Name</label><input name="name" required /></div>
          <div class="field"><label>Email</label><input name="email" type="email" required /></div>
        </div>
        <div class="field"><label>Message</label><textarea name="message" rows="4"></textarea></div>
        <button class="btn" type="submit">Send message</button>
      </form>
      <p id="contactMsg" class="muted" style="margin-top:12px"></p>
    </section>
    <script>
      (function(){
        var form=document.getElementById('contactForm');
        if(!form) return;
        form.addEventListener('submit',function(e){
          e.preventDefault();
          var fd=new FormData(form);
          fetch('/api/lead',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({name:fd.get('name'),email:fd.get('email'),message:fd.get('message')})})
            .then(function(r){return r.json()}).then(function(){
              document.getElementById('contactMsg').textContent='Thanks — we got your message.';
              form.reset();
            }).catch(function(){
              document.getElementById('contactMsg').textContent='Saved locally (demo).';
            });
        });
      })();
    </script>`;
}

function ctaBanner(text) {
  const label = escapeHtml(text || "Get started today");
  return `    <section class="card" style="margin-top:24px;text-align:center" data-forge="cta">
      <h2 style="margin:0 0 8px">${label}</h2>
      <p class="muted">Ready when you are.</p>
      <p style="margin-top:14px"><a class="btn" href="#get-started">${label}</a></p>
    </section>`;
}

function ensureOnce(html, key, block, changes, file) {
  if (html.includes('data-forge="' + key + '"') || html.includes('id="' + key + '"')) {
    changes.push({ action: "skip", detail: key + " already present" });
    return { html: html, dirty: false };
  }
  changes.push({ action: "insert", file: file, detail: "Added " + key });
  return { html: insertBeforeFooter(html, block), dirty: true };
}

function setAccent(css, hex) {
  if (/--accent\s*:/.test(css)) {
    return css.replace(/--accent\s*:\s*[^;]+;/, "--accent:" + hex + ";");
  }
  return css.replace(/:root\s*\{/, ":root{\n  --accent:" + hex + ";");
}

function swapCta(html, label) {
  const t = escapeHtml(label);
  let out = html;
  out = out.replace(/(<a class="btn"(?![^>]*ghost)[^>]*>)([\s\S]*?)(<\/a>)/i, "$1" + t + "$3");
  return out;
}

/**
 * Apply a Build chat message to project root. Returns { ok, reply, changes, mode }.
 */
function applyEdit(projectRoot, message, opts) {
  opts = opts || {};
  const msg = String(message || "").trim();
  if (!msg) {
    const err = new Error("Message required");
    err.status = 400;
    throw err;
  }
  if (msg.length > 2000) {
    const err = new Error("Message too long");
    err.status = 400;
    throw err;
  }

  const indexPath = "public/index.html";
  const cssPath = "public/styles.css";
  if (!exists(projectRoot, indexPath)) {
    const err = new Error("Project has no public/index.html");
    err.status = 400;
    throw err;
  }

  const lower = msg.toLowerCase();
  const changes = [];
  let html = readText(projectRoot, indexPath);
  let css = exists(projectRoot, cssPath) ? readText(projectRoot, cssPath) : "";
  let htmlDirty = false;
  let cssDirty = false;

  // Rename / title (skip 'rename "A" to "B"' — that is a text swap handled by webfree)
  const quoteCount = webfree.quotes(msg).length;
  let titleMatch =
    quoteCount < 2 &&
    msg.match(/\b(?:rename(?:\s+(?:the\s+)?(?:app|site|project|brand|it))?(?:\s+to)?|change (?:the )?(?:title|name|brand(?: name)?)(?:\s+to)?|set (?:the )?(?:title|name)(?:\s+to)?|call it|name it)\s+["'“]?([^"'”\n.,;]+)["'”]?/i);
  if (titleMatch && /^(to|the|it)$/i.test(titleMatch[1].trim())) titleMatch = null;
  if (titleMatch) {
    const title = titleMatch[1].trim().replace(/\s+(?:and|then)\b.*$/i, "").slice(0, 80);
    html = replaceTitle(html, title);
    htmlDirty = true;
    changes.push({ action: "edit", file: indexPath, detail: "Updated title to " + title });
    try {
      const metaPath = "forge.json";
      if (exists(projectRoot, metaPath)) {
        const meta = JSON.parse(readText(projectRoot, metaPath));
        meta.name = title;
        meta.updatedAt = new Date().toISOString();
        writeText(projectRoot, metaPath, JSON.stringify(meta, null, 2) + "\n");
        changes.push({ action: "edit", file: metaPath, detail: "Renamed project" });
      }
    } catch (_) {}
  }

  let packId = null;
  let fmeta = null;
  try {
    const fm = JSON.parse(readText(projectRoot, "forge.json"));
    fmeta = fm;
    packId = fm.pack || null;
    if (!packId) {
      const fp = copy.findPack((fm.name || "") + " " + (fm.description || "") + " " + (fm.topic || ""));
      packId = fp ? fp.id : null;
    }
  } catch (_) {}

  // Section inserts (per clause, so "remove pricing and add FAQ" does the right thing).
  // Colors, CTA text, and hero copy are handled by webfree (freeform offline rules).
  webfree.clauses(msg).forEach(function (clause) {
    const lc = webfree.stripPlacement(clause.toLowerCase());
    if (/\b(remove|delete|drop(?!-in)|hide|move|put|place|get rid of|take out|reorder)\b/.test(lc)) return;
    function add(key, block) {
      if (html.includes('data-forge="' + key + '"') || html.includes('id="' + key + '"')) {
        /* "add an FAQ: do you deliver? …" / "pricing with Basic $20, Pro $50" when one exists → use their items */
        const theirs = (key === "faq" && det.questionsFrom(clause).length) || (key === "pricing" && det.tiersFrom(clause).length);
        const ex = theirs && webfree.findSections(html).find(function (s) { return s.forge === key || s.id === key; });
        if (ex) {
          html = html.slice(0, ex.start) + block.replace(/^\s+/, "") + html.slice(ex.end);
          htmlDirty = true;
          changes.push({ action: "edit", file: indexPath, detail: key === "faq" ? "FAQ → your questions" : "Pricing → your tiers" });
          return;
        }
        changes.push({ action: "skip", detail: key + " already present" });
        return;
      }
      html = webfree.placeBlock(html, block.replace(/^\s+/, "    "), clause);
      htmlDirty = true;
      changes.push({ action: "insert", file: indexPath, detail: "Added " + key });
    }
    if (/\b(pricing|price plans?|pricing table)\b/.test(lc) && !/pricing page/.test(lc) && !/\bfaqs?\b|frequently asked|\banswer\b/.test(lc)) add("pricing", pricingSection(Object.assign({}, fmeta, { pack: packId }), clause, html));
    if (/\bfaqs?\b|frequently asked/.test(lc)) add("faq", faqSection(Object.assign({}, fmeta, { pack: packId }), clause));
    if (/testimonial|reviews? section|social proof|add reviews|customer reviews/.test(lc)) add("testimonials", testimonialsSection(packId, html));
    if (/add (?:a |some )?features?|features? (?:section|grid)|feature (?:grid|cards)/.test(lc)) add("features", featuresSection());
    if (/\bstats\b|\bstat (?:row|section)\b|counters? row|\btraction\b|add (?:stats|counters)/.test(lc)) add("stats", statsSection());
    if (/contact (form|section)|add (?:a )?contact|lead form|lead capture|signup form/.test(lc)) {
      const hasForm = webfree.findSections(html).some(function (s) { return !s.hero && /<form\b/i.test(s.inner) && !/data-forge-newsletter/.test(s.inner); });
      if (!hasForm) add("contact", contactSection());
      else if (!/\d{3}|@|address/.test(lc)) changes.push({ action: "skip", detail: "contact form already present" });
    }
    if (/\bcta\b|call to action|get started banner/.test(lc) && /\b(add|insert|include|create|banner|section)\b/.test(lc) && !/\b(swap|change|set|rename|update)\b|\bcta (?:to|text)\b|button (?:to|say)/.test(lc)) {
      const m = clause.match(/(?:cta|banner)[:\s]+["']?([^"'\n]+)["']?/i);
      let label = m ? m[1].trim() : "Get started today";
      if (/^(banner|section|block)$/i.test(label)) label = "Get started today";
      add("cta", ctaBanner(label));
    }
  });

  // About page (extra file)
  if (/add (?:an? )?about page|create (?:an? )?about page|need (?:an? )?about page/.test(lower)) {
    const aboutRel = "public/about.html";
    if (exists(projectRoot, aboutRel)) {
      changes.push({ action: "skip", detail: "about page already present" });
    } else {
      let appName = "App";
      try {
        appName = JSON.parse(readText(projectRoot, "forge.json")).name || appName;
      } catch (_) {}
      const about =
        "<!DOCTYPE html>\n<html lang=\"en\"><head><meta charset=\"UTF-8\"/>" +
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"/>" +
        "<title>About — " +
        escapeHtml(appName) +
        "</title><link rel=\"stylesheet\" href=\"styles.css\"/></head><body>" +
        "<nav class=\"nav\"><div class=\"brand\">" +
        escapeHtml(appName) +
        '</div><div class="nav-links"><a class="btn ghost sm" href="./">Home</a></div></nav>' +
        '<main class="wrap"><section class="hero"><h1>About</h1>' +
        "<p>" +
        escapeHtml(det.storyFrom(msg) || "Tell Build your story to fill this page, e.g. \u201cadd an about page: we started in a garage in 2014\u201d.") +
        "</p></section></main></body></html>\n";
      writeText(projectRoot, aboutRel, about);
      changes.push({ action: "create", file: aboutRel, detail: "Added about page" });
      if (!/href=["']\.\/about\.html["']|href=["']about\.html["']/.test(html)) {
        html = html.replace(
          /(<div class="nav-links">)/i,
          '$1\n      <a class="btn ghost sm" href="about.html">About</a>'
        );
        htmlDirty = true;
        changes.push({ action: "edit", file: indexPath, detail: "Linked About in nav" });
      }
    }
  }

  // robots + sitemap
  if (/robots\.txt|sitemap|robots and sitemap/.test(lower)) {
    writeText(projectRoot, "public/robots.txt", "User-agent: *\nAllow: /\nSitemap: sitemap.xml\n");
    changes.push({ action: "create", file: "public/robots.txt", detail: "Added robots.txt" });
    writeText(
      projectRoot,
      "public/sitemap.xml",
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>./</loc></url>\n</urlset>\n'
    );
    changes.push({ action: "create", file: "public/sitemap.xml", detail: "Added sitemap.xml" });
  }

  // Landing polish pack
  if (/landing polish|starter polish|polish (?:the )?landing|offline polish/.test(lower)) {
    let r = ensureOnce(html, "features", featuresSection(), changes, indexPath);
    html = r.html;
    htmlDirty = htmlDirty || r.dirty;
    r = ensureOnce(html, "testimonials", testimonialsSection(packId, html), changes, indexPath);
    html = r.html;
    htmlDirty = htmlDirty || r.dirty;
    r = ensureOnce(html, "faq", faqSection(Object.assign({}, fmeta, { pack: packId }), ""), changes, indexPath);
    html = r.html;
    htmlDirty = htmlDirty || r.dirty;
  }

  // Freeform offline edits (copy, sections, layout, colors) — free, no API credits
  let meta = null;
  try {
    meta = JSON.parse(readText(projectRoot, "forge.json"));
  } catch (_) {}
  const ctx = {
    html: html,
    css: css,
    msg: msg,
    meta: meta,
    changes: changes,
    skip: function (clause) {
      return (
        /landing polish|starter polish|polish (?:the )?landing|offline polish|robots|sitemap|about page|^(?:rename|call it|name it|change (?:the )?(?:title|name)|set (?:the )?(?:title|name))\b/i.test(clause) &&
        webfree.quotes(clause).length < 2
      );
    },
  };
  webfree.applyFreeform(ctx);
  html = ctx.html;
  css = ctx.css;
  htmlDirty = htmlDirty || !!ctx.htmlDirty;
  cssDirty = cssDirty || !!ctx.cssDirty;

  if (htmlDirty) writeText(projectRoot, indexPath, html);
  if (cssDirty) writeText(projectRoot, cssPath, css);

  try {
    if (exists(projectRoot, "forge.json")) {
      const m2 = JSON.parse(readText(projectRoot, "forge.json"));
      m2.updatedAt = new Date().toISOString();
      if (ctx.meta && ctx.meta.topic) m2.topic = ctx.meta.topic;
      writeText(projectRoot, "forge.json", JSON.stringify(m2, null, 2) + "\n");
    }
  } catch (_) {}
  const notes = (ctx.notes || []).join(" ");

  const real = changes.filter(function (c) {
    return c.action !== "skip";
  });
  if (!real.length && !changes.length) {
    return {
      ok: true,
      mode: "offline",
      reply: notes
        ? notes
        : "Free Build didn't recognize that one yet. Try plain asks like: “rewrite the hero for a coffee shop”, “make the copy more playful”, “add a team section”, “add a section about our mission”, “remove pricing”, “move FAQ above pricing”, “change 'Get started' to 'Join free'”, “make it rose”, “center the hero”, “use Poppins font”, “3 columns”, “make it look more modern”, or “undo”.",
      changes: [],
    };
  }
  if (!real.length) {
    return {
      ok: true,
      mode: "offline",
      reply: notes || "Already in place — try another edit (or say “undo”).",
      changes: changes,
    };
  }

  const summary = real
    .map(function (c) {
      return c.detail || c.action + (c.file ? " " + c.file : "");
    })
    .join("; ");

  return {
    ok: true,
    mode: "offline",
    reply: "Applied: " + summary + (notes ? " — " + notes : ""),
    changes: changes,
  };
}

module.exports = { applyEdit, ACCENTS, COLORS: webfree.COLORS };
