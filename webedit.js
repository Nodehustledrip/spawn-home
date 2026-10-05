"use strict";

/**
 * Offline Build edits for on-site /build — same spirit as Forge heuristics,
 * without AI. Operates on a project directory (public/index.html + styles.css).
 */
const fs = require("fs");
const path = require("path");

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
    const idx = html.lastIndexOf(m);
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

function pricingSection() {
  return `    <section id="pricing" class="card" style="margin-top:24px" data-forge="pricing">
      <span class="badge">Pricing</span>
      <h2 style="margin:10px 0 8px">Simple pricing</h2>
      <p class="muted">Pick a tier — swap prices and features for yours.</p>
      <div class="grid 3" style="margin-top:16px">
        <div class="card" style="background:var(--bg,#0b0f14)">
          <h3>Starter</h3>
          <p style="font-size:1.8rem;font-weight:800;margin:8px 0">$9<span class="muted" style="font-size:1rem">/mo</span></p>
          <ul class="muted" style="margin:8px 0 0;padding-left:18px;line-height:1.5">
            <li>1 project</li><li>Email support</li><li>Basic analytics</li>
          </ul>
          <p style="margin-top:14px"><a class="btn ghost" href="#get-started">Choose Starter</a></p>
        </div>
        <div class="card" style="background:var(--bg,#0b0f14);border-color:var(--accent,#5eead4)">
          <span class="badge">Popular</span>
          <h3>Pro</h3>
          <p style="font-size:1.8rem;font-weight:800;margin:8px 0">$29<span class="muted" style="font-size:1rem">/mo</span></p>
          <ul class="muted" style="margin:8px 0 0;padding-left:18px;line-height:1.5">
            <li>Unlimited projects</li><li>Priority support</li><li>Team seats (5)</li>
          </ul>
          <p style="margin-top:14px"><a class="btn" href="#get-started">Choose Pro</a></p>
        </div>
        <div class="card" style="background:var(--bg,#0b0f14)">
          <h3>Business</h3>
          <p style="font-size:1.8rem;font-weight:800;margin:8px 0">$79<span class="muted" style="font-size:1rem">/mo</span></p>
          <ul class="muted" style="margin:8px 0 0;padding-left:18px;line-height:1.5">
            <li>Everything in Pro</li><li>SSO-ready hooks</li><li>Custom domains help</li>
          </ul>
          <p style="margin-top:14px"><a class="btn ghost" href="#contact">Talk to sales</a></p>
        </div>
      </div>
    </section>`;
}

function faqSection() {
  return `    <section id="faq" class="card" style="margin-top:24px" data-forge="faq">
      <h2>FAQ</h2>
      <details class="faq-item feed-item" open style="margin-top:10px">
        <summary style="cursor:pointer;font-weight:600">How do I get started?</summary>
        <p class="muted" style="margin:8px 0 0">Create an account, pick a plan, and you are live in minutes.</p>
      </details>
      <details class="faq-item feed-item" style="margin-top:8px">
        <summary style="cursor:pointer;font-weight:600">Can I cancel anytime?</summary>
        <p class="muted" style="margin:8px 0 0">Yes. No long-term contracts.</p>
      </details>
      <details class="faq-item feed-item" style="margin-top:8px">
        <summary style="cursor:pointer;font-weight:600">Do you offer support?</summary>
        <p class="muted" style="margin:8px 0 0">Email support is included on every plan.</p>
      </details>
    </section>`;
}

function testimonialsSection() {
  return `    <section id="testimonials" class="card" style="margin-top:24px" data-forge="testimonials">
      <h2>What people say</h2>
      <p class="muted">Sample quotes — replace with real customers.</p>
      <div class="grid 2" style="margin-top:14px">
        <div class="card" style="margin:0">
          <div class="row" style="margin-bottom:10px"><span class="avatar">JR</span><strong>Jordan R.</strong></div>
          <p class="quote">We shipped a polished page the same afternoon we started.</p>
        </div>
        <div class="card" style="margin:0">
          <div class="row" style="margin-bottom:10px"><span class="avatar">AL</span><strong>Alex L.</strong></div>
          <p class="quote">Clear layout, real CTAs — felt finished on day one.</p>
        </div>
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
  if (html.includes('data-forge="' + key + '"')) {
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

  // Rename / title
  let titleMatch =
    lower.match(/(?:rename(?:\s+app)?|change title|set title|title to|call it|rename to)\s+["']?([^"'\n.]+)["']?/i) ||
    msg.match(/(?:rename|change title|set title)\s+["']([^"']+)["']/i);
  if (titleMatch) {
    const title = titleMatch[1].trim().slice(0, 80);
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

  // Accent / theme color
  const wantsThemeToggle = /theme.?toggle|dark\/?light/.test(lower);
  if (!wantsThemeToggle && /theme|colors?|palette|recolor|make it (teal|violet|amber|mint|slate|purple|green|orange|blue)/.test(lower)) {
    let hex = null;
    let name = null;
    for (const [k, v] of Object.entries(ACCENTS)) {
      if (new RegExp("\\b" + k + "\\b").test(lower)) {
        hex = v;
        name = k;
        break;
      }
    }
    const hexMatch = msg.match(/#([0-9a-fA-F]{6})\b/);
    if (hexMatch) {
      hex = "#" + hexMatch[1];
      name = hex;
    }
    if (!hex) {
      hex = ACCENTS.teal;
      name = "teal";
    }
    if (css) {
      css = setAccent(css, hex);
      cssDirty = true;
      changes.push({ action: "edit", file: cssPath, detail: "Accent → " + name + " (" + hex + ")" });
    }
  }

  // Section inserts
  if (/pricing|price plan|pricing section|pricing table|add pricing/.test(lower) && !/pricing page/.test(lower)) {
    const r = ensureOnce(html, "pricing", pricingSection(), changes, indexPath);
    html = r.html;
    htmlDirty = htmlDirty || r.dirty;
  }
  if (/\bfaq\b|frequently asked|add faq/.test(lower)) {
    const r = ensureOnce(html, "faq", faqSection(), changes, indexPath);
    html = r.html;
    htmlDirty = htmlDirty || r.dirty;
  }
  if (/testimonial|reviews? section|social proof|add reviews/.test(lower)) {
    const r = ensureOnce(html, "testimonials", testimonialsSection(), changes, indexPath);
    html = r.html;
    htmlDirty = htmlDirty || r.dirty;
  }
  if (/add features?|features? (?:section|grid)|feature (?:grid|cards)/.test(lower)) {
    const r = ensureOnce(html, "features", featuresSection(), changes, indexPath);
    html = r.html;
    htmlDirty = htmlDirty || r.dirty;
  }
  if (/stats?(?:\/counters?)?|counters? row|traction|add (?:stats|counters)/.test(lower)) {
    const r = ensureOnce(html, "stats", statsSection(), changes, indexPath);
    html = r.html;
    htmlDirty = htmlDirty || r.dirty;
  }
  if (/contact (form|section)|add contact|lead form|lead capture|signup form/.test(lower)) {
    const r = ensureOnce(html, "contact", contactSection(), changes, indexPath);
    html = r.html;
    htmlDirty = htmlDirty || r.dirty;
  }
  if (/\bcta\b|call to action|get started banner|add (?:a )?cta/.test(lower) && !/swap cta|change cta|cta to|button (?:to|say)/.test(lower)) {
    const m = msg.match(/(?:cta|banner)[:\s]+["']?([^"'\n]+)["']?/i);
    const r = ensureOnce(html, "cta", ctaBanner(m ? m[1].trim() : "Get started today"), changes, indexPath);
    html = r.html;
    htmlDirty = htmlDirty || r.dirty;
  }
  if (/swap cta|change cta|cta (?:to|text)|button (?:to|say|says)/.test(lower)) {
    const m =
      msg.match(/(?:cta|button|action)\s*(?:to|text|:)?\s*["']([^"']+)["']/i) ||
      msg.match(/(?:says?|to)\s+["']([^"']+)["']/i);
    const label = m ? m[1].trim() : "Get started";
    html = swapCta(html, label);
    htmlDirty = true;
    changes.push({ action: "edit", file: indexPath, detail: "Swapped CTA to '" + label + "'" });
  }

  // Hero subtitle tweak
  const subMatch = msg.match(/(?:subtitle|tagline|hero (?:text|sub(?:title)?))\s*(?:to|:)\s*["']([^"']+)["']/i);
  if (subMatch) {
    const sub = escapeHtml(subMatch[1].trim().slice(0, 200));
    if (/<section class="hero"[\s\S]*?<p>/.test(html)) {
      html = html.replace(/(<section class="hero"[\s\S]*?<p>)([\s\S]*?)(<\/p>)/i, "$1" + sub + "$3");
      htmlDirty = true;
      changes.push({ action: "edit", file: indexPath, detail: "Updated hero subtitle" });
    }
  }

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
        "<p>Tell your story here. This page was added from Build chat.</p></section></main></body></html>\n";
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
    r = ensureOnce(html, "testimonials", testimonialsSection(), changes, indexPath);
    html = r.html;
    htmlDirty = htmlDirty || r.dirty;
    r = ensureOnce(html, "faq", faqSection(), changes, indexPath);
    html = r.html;
    htmlDirty = htmlDirty || r.dirty;
  }

  if (htmlDirty) writeText(projectRoot, indexPath, html);
  if (cssDirty) writeText(projectRoot, cssPath, css);

  try {
    if (exists(projectRoot, "forge.json")) {
      const meta = JSON.parse(readText(projectRoot, "forge.json"));
      meta.updatedAt = new Date().toISOString();
      writeText(projectRoot, "forge.json", JSON.stringify(meta, null, 2) + "\n");
    }
  } catch (_) {}

  const real = changes.filter(function (c) {
    return c.action !== "skip";
  });
  if (!real.length && !changes.length) {
    return {
      ok: true,
      mode: "offline",
      reply:
        'No matching edit yet. Try: "add FAQ", "add pricing", "make it violet", "rename to Acme", "add features", "add testimonials", "landing polish", "add about page", "swap CTA to Start free".',
      changes: [],
    };
  }
  if (!real.length) {
    return {
      ok: true,
      mode: "offline",
      reply: "Already in place. Try another edit, or open Spawn desktop for fuller Build chat.",
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
    reply: "Applied: " + summary,
    changes: changes,
  };
}

module.exports = { applyEdit, ACCENTS };
