"use strict";

/**
 * Free offline Build — freeform edits without any model or API credits.
 * Handles common plain-English asks: hero/copy rewrites, tone, text swaps,
 * add/remove/move sections, colors, fonts, and layout tweaks.
 *
 * applyFreeform(ctx) mutates ctx.html / ctx.css and pushes to ctx.changes.
 */
const copy = require("./webcopy");

/* ---------------- utilities ---------------- */

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripTags(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(s) {
  const small = /^(a|an|the|and|or|of|for|to|in|on|at|by|with)$/i;
  return String(s || "")
    .trim()
    .split(/\s+/)
    .map(function (w, i) {
      if (i && small.test(w)) return w.toLowerCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
}

function slug(s) {
  return (
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "section"
  );
}

/** Quoted strings in a clause: "x", “x”, 'x' (single quotes only as delimiters). */
function quotes(s) {
  const out = [];
  const re = /["“”]([^"“”]{1,300})["“”]|(?:^|[\s:(=])['‘]([^'‘’\n]{1,300})['’](?=$|[\s.,!?;:)])/g;
  let m;
  while ((m = re.exec(s))) out.push((m[1] || m[2]).trim());
  return out;
}

/** Text after a trigger: quoted if present, else the rest of the clause after "to/:/say". */
function valueAfter(clause, triggerRe) {
  const m = clause.match(triggerRe);
  if (!m) return null;
  const rest = clause.slice(m.index + m[0].length);
  const q = quotes(rest);
  if (q.length) return q[0];
  const m2 = rest.match(/^\s*(?:text\s+)?(?:to|:|=|say|says|read|reads|into|as|with)\s+(.+)$/i);
  if (!m2) return null;
  const v = m2[1].replace(/^["'“‘]|["'”’]$/g, "").replace(/[.!]+$/, "").trim();
  return v && v.length <= 200 ? v : null;
}

/** Split a message into clauses ("add FAQ and make it violet; then rename to X"). */
function clauses(msg) {
  const verbs =
    "add|make|change|set|rename|remove|delete|drop|hide|move|put|rewrite|use|center|swap|replace|insert|include|turn|give|update|create|switch|let|bump|increase|decrease|reduce";
  return String(msg)
    .split(new RegExp("\\s*(?:;|\\n|\\bthen\\b|,\\s*(?:and\\s+)?(?=(?:" + verbs + ")\\b)|\\band\\s+(?=(?:" + verbs + ")\\b)|\\.\\s+(?=[A-Z]))\\s*", "i"))
    .map(function (c) {
      return c.trim().replace(/[\s,;]+$/, "");
    })
    .filter(Boolean);
}

/** Replace visible text only (never inside tags, scripts, or styles). */
function replaceText(html, from, to) {
  const parts = html.split(/(<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>)/i);
  let n = 0;
  const fromEsc = esc(from);
  for (let i = 0; i < parts.length; i += 2) {
    const seg = parts[i];
    if (!seg) continue;
    for (const f of fromEsc === from ? [from] : [from, fromEsc]) {
      if (parts[i].indexOf(f) !== -1) {
        n += parts[i].split(f).length - 1;
        parts[i] = parts[i].split(f).join(esc(to));
      }
    }
  }
  if (!n) {
    /* case-insensitive second pass */
    const re = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    for (let i = 0; i < parts.length; i += 2) {
      if (!parts[i]) continue;
      parts[i] = parts[i].replace(re, function () {
        n += 1;
        return esc(to);
      });
    }
  }
  return { html: parts.join(""), count: n };
}

/* ---------------- sections ---------------- */

function findSections(html) {
  const re = /<section\b[^>]*>|<\/section>/gi;
  const stack = [];
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    if (m[0][1] !== "/") stack.push({ start: m.index, open: m[0] });
    else if (stack.length) {
      const s = stack.pop();
      if (!stack.length) {
        const end = m.index + m[0].length;
        const inner = html.slice(s.start, end);
        const idm = s.open.match(/\bid="([^"]+)"/i);
        const fm = s.open.match(/data-forge="([^"]+)"/i);
        const hm = inner.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
        out.push({
          start: s.start,
          end: end,
          open: s.open,
          inner: inner,
          id: idm ? idm[1] : "",
          forge: fm ? fm[1] : "",
          hero: /class="[^"]*\bhero\b/i.test(s.open),
          heading: hm ? stripTags(hm[1]) : "",
        });
      }
    }
  }
  return out;
}

/* [key, words regex, strong test (id/data-forge), weak test (content)] — order matters: specific first. */
const SECTION_ALIASES = [
  ["hero", /\b(hero|header|top section|intro|banner area)\b/, function (s) { return s.hero; }, null],
  ["contact", /\b(contact|lead form|quote form|request a quote|signup form|get started form|form)\b/, function (s) { return /contact|quote|get-started|lead/.test(s.id + s.forge); }, function (s) { return /<form/i.test(s.inner); }],
  ["pricing", /\b(pricing|prices|plans|tiers)\b/, function (s) { return /pricing/.test(s.id + s.forge); }, function (s) { return /price-card|class="price"/.test(s.inner); }],
  ["faq", /\b(faq|faqs|questions)\b/, function (s) { return /faq/.test(s.id + s.forge); }, function (s) { return /<details/i.test(s.inner); }],
  ["testimonials", /\b(testimonials?|reviews?|quotes|social proof)\b/, function (s) { return /testimonial|review/.test(s.id + s.forge); }, function (s) { return /class="quote"/.test(s.inner); }],
  ["features", /\b(features?|benefits)\b/, function (s) { return /feature|benefit/.test(s.id + s.forge); }, null],
  ["services", /\bservices?\b/, function (s) { return /service/.test(s.id + s.forge); }, null],
  ["stats", /\b(stats|statistics|numbers|kpis?|counters?|traction|metrics)\b/, function (s) { return /stats/.test(s.id + s.forge); }, function (s) { return /class="kpi"/.test(s.inner); }],
  ["team", /\b(team|founders|staff|people)\b/, function (s) { return /team/.test(s.id + s.forge); }, null],
  ["steps", /\b(how it works|steps|process)\b/, function (s) { return /steps|how/.test(s.id + s.forge); }, null],
  ["newsletter", /\b(newsletter|subscribe|email signup)\b/, function (s) { return /newsletter|subscribe/.test(s.id + s.forge); }, null],
  ["gallery", /\b(gallery|portfolio|showcase|our work)\b/, function (s) { return /gallery|portfolio/.test(s.id + s.forge); }, null],
  ["logos", /\b(logos?|partners|clients|trusted by)\b/, function (s) { return /logos/.test(s.id + s.forge); }, null],
  ["about", /\b(about|our story)\b/, function (s) { return /about|story/.test(s.id + s.forge); }, null],
  ["cta", /\b(cta|call to action)\b/, function (s) { return /cta/.test(s.forge); }, null],
];

function locateSection(sections, words) {
  const w = String(words || "").toLowerCase();
  const bare = w.replace(/\b(the|section|block|area|part|row|my|our)\b/g, " ").replace(/\s+/g, " ").trim();
  /* 1) exact heading / id match wins */
  if (bare.length >= 3) {
    const exact = sections.findIndex(function (s) {
      return (s.heading && s.heading.toLowerCase() === bare) || (s.id && (s.id === slug(bare) || s.id === "s-" + slug(bare)));
    });
    if (exact !== -1) return { idx: exact, key: bare };
  }
  /* 2) alias: strong (id/data-forge) then weak (content) */
  for (const [key, re, strong, weak] of SECTION_ALIASES) {
    if (!re.test(w)) continue;
    let idx = sections.findIndex(strong);
    let isWeak = false;
    if (idx === -1 && weak) {
      idx = sections.findIndex(weak);
      isWeak = idx !== -1;
    }
    if (idx !== -1) return { idx: idx, key: key, weak: isWeak ? weak : null };
  }
  /* 3) heading contains words */
  if (bare.length >= 3) {
    const idx = sections.findIndex(function (s) {
      return s.heading && s.heading.toLowerCase().indexOf(bare) !== -1;
    });
    if (idx !== -1) return { idx: idx, key: bare };
  }
  return null;
}

/** Ranges of top-level <div class="card"...> blocks inside a chunk of HTML. */
function cardRanges(chunk) {
  const out = [];
  const re = /<div\b[^>]*>|<\/div>/gi;
  let depth = 0;
  let cur = null;
  let m;
  while ((m = re.exec(chunk))) {
    if (m[0][1] !== "/") {
      if (cur == null && /class="card\b/.test(m[0])) {
        cur = { start: m.index, depth: depth };
      }
      depth++;
    } else {
      depth--;
      if (cur && depth === cur.depth) {
        out.push({ start: cur.start, end: m.index + m[0].length });
        cur = null;
      }
    }
  }
  return out;
}

function insertBeforeFooter(html, block) {
  for (const m of ["<footer", "</main>", "</body>"]) {
    let idx = html.lastIndexOf(m);
    if (idx !== -1) {
      while (idx > 0 && /[ \t]/.test(html[idx - 1])) idx--;
      return html.slice(0, idx) + block + "\n\n" + html.slice(idx);
    }
  }
  return html + "\n" + block + "\n";
}

/** Place a block according to "at the top / after X / before X / at the bottom". */
function placeBlock(html, block, clause) {
  const c = clause.toLowerCase();
  const secs = findSections(html);
  let m = c.match(/\b(above|before|below|after|under|beneath)\s+(?:the\s+)?([a-z][a-z \-]{2,30}?)(?:\s+section)?\s*$/);
  if (m) {
    const target = locateSection(secs, m[2]);
    if (target) {
      const s = secs[target.idx];
      const before = /above|before/.test(m[1]);
      let at = before ? s.start : s.end;
      if (before) {
        while (at > 0 && /[ \t]/.test(html[at - 1])) at--;
        return html.slice(0, at) + block + "\n\n" + html.slice(at);
      }
      return html.slice(0, at) + "\n\n" + block + html.slice(at);
    }
  }
  if (/\b(at the top|to the top|top of the page|first|after the hero|below the hero|under the hero)\b/.test(c)) {
    const hero = secs.find(function (s) { return s.hero; });
    if (hero) return html.slice(0, hero.end) + "\n\n" + block + html.slice(hero.end);
    const mm = html.match(/<main[^>]*>/i);
    if (mm) {
      const at = mm.index + mm[0].length;
      return html.slice(0, at) + "\n" + block + html.slice(at);
    }
  }
  return insertBeforeFooter(html, block);
}

/* ---------------- CSS overrides (managed block, keyed) ---------------- */

const OV_START = "/* spawn-build:overrides — managed by Build chat */";
const OV_END = "/* /spawn-build:overrides */";

function getOverrides(css) {
  const a = css.indexOf(OV_START);
  const b = css.indexOf(OV_END);
  const map = {};
  if (a === -1 || b === -1) return map;
  css
    .slice(a + OV_START.length, b)
    .split("\n")
    .forEach(function (line) {
      const m = line.match(/^\/\*@([a-z0-9-]+)\*\/\s?(.*)$/);
      if (m) map[m[1]] = m[2];
    });
  return map;
}

function writeOverrides(css, map) {
  const a = css.indexOf(OV_START);
  const b = css.indexOf(OV_END);
  let base = css;
  if (a !== -1 && b !== -1) base = css.slice(0, a).replace(/\s+$/, "") + "\n" + css.slice(b + OV_END.length).replace(/^\s+/, "");
  base = base.replace(/\s+$/, "") + "\n";
  const keys = Object.keys(map);
  if (!keys.length) return base;
  return (
    base +
    "\n" +
    OV_START +
    "\n" +
    keys
      .map(function (k) {
        return "/*@" + k + "*/ " + map[k];
      })
      .join("\n") +
    "\n" +
    OV_END +
    "\n"
  );
}

function setRule(ctx, key, rule, detail) {
  const map = getOverrides(ctx.css);
  if (map[key] === rule) return;
  if (rule == null) delete map[key];
  else map[key] = rule;
  ctx.css = writeOverrides(ctx.css, map);
  ctx.cssDirty = true;
  ctx.changes.push({ action: "style", file: "public/styles.css", detail: detail });
}

function setVar(ctx, name, value, detail) {
  const re = new RegExp("(:root\\s*\\{[^}]*?)--" + name + "\\s*:\\s*[^;]+;");
  if (re.test(ctx.css)) ctx.css = ctx.css.replace(re, "$1--" + name + ":" + value + ";");
  else if (/:root\s*\{/.test(ctx.css)) ctx.css = ctx.css.replace(/:root\s*\{/, ":root{\n  --" + name + ":" + value + ";");
  else ctx.css = ":root{--" + name + ":" + value + ";}\n" + ctx.css;
  ctx.cssDirty = true;
  ctx.changes.push({ action: "style", file: "public/styles.css", detail: detail });
}

/* ---------------- colors ---------------- */

const COLORS = {
  teal: "#5eead4", turquoise: "#2dd4bf", cyan: "#22d3ee", sky: "#38bdf8", blue: "#60a5fa", navy: "#3b82f6",
  indigo: "#818cf8", violet: "#a78bfa", purple: "#c084fc", lavender: "#c4b5fd", magenta: "#e879f9",
  pink: "#f472b6", rose: "#fb7185", red: "#f87171", crimson: "#ef4444", coral: "#ff7f6e", orange: "#fb923c",
  peach: "#fdba74", amber: "#fbbf24", gold: "#eab308", yellow: "#facc15", lime: "#a3e635", green: "#4ade80",
  emerald: "#10b981", mint: "#34d399", olive: "#a3b14b", brown: "#c08457", slate: "#94a3b8", gray: "#9ca3af", grey: "#9ca3af",
  white: "#f8fafc", black: "#111827",
};

function colorIn(text) {
  const hex = text.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i);
  if (hex) return { name: hex[0], hex: hex[0] };
  const rgb = text.match(/rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)/i);
  if (rgb) return { name: rgb[0], hex: rgb[0] };
  const lower = text.toLowerCase();
  for (const k of Object.keys(COLORS)) {
    if (new RegExp("\\b" + k + "\\b").test(lower)) return { name: k, hex: COLORS[k] };
  }
  return null;
}

function isLightColor(hex) {
  const m = String(hex).match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return false;
  let h = m[1];
  if (h.length === 3) h = h.split("").map(function (x) { return x + x; }).join("");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 170;
}

const BG_COLORS = {
  black: "#05070a", navy: "#0b1220", blue: "#0b1426", purple: "#140d22", violet: "#140d22", green: "#07140f",
  red: "#1a0b0d", brown: "#17110c", gray: "#111317", grey: "#111317", slate: "#0f141b", white: "#ffffff",
  cream: "#fbf7ef", beige: "#f5efe3",
};

/* ---------------- fonts ---------------- */

const FONTS = {
  poppins: "Poppins", montserrat: "Montserrat", "playfair": "Playfair Display", lora: "Lora", merriweather: "Merriweather",
  roboto: "Roboto", "open sans": "Open Sans", lato: "Lato", "space grotesk": "Space Grotesk", "dm sans": "DM Sans",
  manrope: "Manrope", nunito: "Nunito", raleway: "Raleway", oswald: "Oswald", "work sans": "Work Sans", outfit: "Outfit",
  sora: "Sora", fraunces: "Fraunces", "ibm plex": "IBM Plex Sans", "jetbrains": "JetBrains Mono", "space mono": "Space Mono",
  rubik: "Rubik", "plus jakarta": "Plus Jakarta Sans", inter: "Inter", "dm serif": "DM Serif Display", "libre baskerville": "Libre Baskerville",
};

function setFont(ctx, family, fallback, detail) {
  const link =
    '<link data-forge-font rel="stylesheet" href="https://fonts.googleapis.com/css2?family=' +
    family.replace(/ /g, "+") +
    ':wght@400;600;700;800&amp;display=swap" />';
  if (/<link data-forge-font[^>]*>/i.test(ctx.html)) ctx.html = ctx.html.replace(/<link data-forge-font[^>]*>/i, link);
  else ctx.html = ctx.html.replace(/<\/head>/i, "  " + link + "\n</head>");
  ctx.htmlDirty = true;
  setVar(ctx, "font", "'" + family + "'," + fallback, detail || "Font → " + family);
}

/* ---------------- section blocks ---------------- */

function brandName(ctx) {
  return (ctx.meta && ctx.meta.name) || stripTags((ctx.html.match(/<div class="brand">([\s\S]*?)<\/div>/i) || [])[1]) || "us";
}

function sec(key, inner, extra) {
  return '    <section id="' + key + '" data-forge="' + key + '" style="margin-top:40px"' + (extra || "") + ">\n" + inner + "\n    </section>";
}


/* "add a menu with espresso, latte and cold brew ($4)" → [{name:"espresso"}, {name:"latte"}, {name:"cold brew", price:"$4"}] */
function listItems(clause) {
  const m = String(clause || "").match(/\b(?:with|including|featuring|listing|of|for|like|such as)\s*:?\s+(.+)$|:\s*(.+)$/i);
  if (!m) return [];
  let body = (m[1] || m[2] || "")
    .replace(/\b(?:and\s+)?(?:their\s+|the\s+|some\s+)?(?:prices?|pricing|costs?|descriptions?)\s*$/i, "")
    .replace(/\b(?:at|to) the (?:top|bottom).*$|\b(?:above|below|before|after)\s+.*$/i, "")
    .replace(/[.!?]+$/, "")
    .trim();
  if (!/,|\band\b|&/.test(body)) return [];
  const parts = body.split(/\s*,\s*(?:and\s+|&\s*)?|\s+(?:and|&)\s+/i).map(function (x) { return x.trim(); }).filter(Boolean);
  if (parts.length < 2 || parts.length > 10) return [];
  const out = [];
  for (const raw of parts) {
    const price = (raw.match(/\$\s?\d+(?:\.\d{1,2})?/) || [])[0];
    const name = raw.replace(/\(?\s*(?:for|at|@)?\s*\$\s?\d+(?:\.\d{1,2})?\s*\)?/g, "").replace(/^(?:a|an|the|some)\s+/i, "").replace(/["“”]/g, "").trim();
    if (!name || name.length > 40 || /\b(section|block|page|menu)\b/i.test(name)) return [];
    out.push({ name: name, price: price ? price.replace(/\s/g, "") : null });
  }
  return out.slice(0, 8);
}

function packOf(ctx) {
  if (ctx.meta && ctx.meta.pack) return ctx.meta.pack;
  const p = copy.findPack(((ctx.meta && ctx.meta.name) || "") + " " + topicFromCtx(ctx));
  return p ? p.id : null;
}

const BLOCKS = {
  team: function () {
    return sec(
      "team",
      '      <h2 class="section-title">Meet the team</h2>\n      <p class="section-sub">The people behind the work — swap in real names and photos.</p>\n      <div class="grid 3">\n' +
        [["AM", "Avery Morgan", "Founder & CEO"], ["JC", "Jordan Chen", "Head of Product"], ["SP", "Sam Patel", "Customer Success"]]
          .map(function (p) {
            return '        <div class="card" style="text-align:center"><span class="avatar" style="width:64px;height:64px;font-size:1.1rem;margin:0 auto 12px">' + p[0] + "</span><h3>" + p[1] + '</h3><p class="muted" style="margin:0">' + p[2] + "</p></div>";
          })
          .join("\n") +
        "\n      </div>"
    );
  },
  steps: function () {
    return sec(
      "steps",
      '      <h2 class="section-title">How it works</h2>\n      <p class="section-sub">Three simple steps to get going.</p>\n      <div class="grid 3">\n' +
        [["1", "Tell us what you need", "A quick form or a call — whatever is easiest."], ["2", "We get to work", "Clear timeline and updates along the way."], ["3", "Enjoy the results", "Done right, with support if anything comes up."]]
          .map(function (s) {
            return '        <div class="card"><div class="feature-icon">' + s[0] + "</div><h3>" + s[1] + '</h3><p class="muted">' + s[2] + "</p></div>";
          })
          .join("\n") +
        "\n      </div>"
    );
  },
  newsletter: function () {
    return sec(
      "newsletter",
      '      <div class="card" style="text-align:center">\n        <h2 class="section-title">Stay in the loop</h2>\n        <p class="muted">One short email a month. No spam, unsubscribe anytime.</p>\n        <form data-forge-newsletter style="display:flex;gap:10px;max-width:440px;margin:16px auto 0;flex-wrap:wrap">\n          <input name="email" type="email" required placeholder="you@example.com" style="flex:1;min-width:200px" />\n          <button class="btn" type="submit">Subscribe</button>\n        </form>\n        <p class="muted" data-forge-newsletter-msg style="margin-top:10px"></p>\n      </div>'
    ) +
      "\n    <script>\n      (function(){var f=document.querySelector('[data-forge-newsletter]');if(!f)return;f.addEventListener('submit',function(e){e.preventDefault();var fd=new FormData(f);fetch('/api/lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:fd.get('email'),source:'newsletter'})}).finally(function(){var m=document.querySelector('[data-forge-newsletter-msg]');if(m)m.textContent='Thanks — you are subscribed.';f.reset();});});})();\n    </script>";
  },
  gallery: function () {
    const g = ["135deg,var(--accent),#818cf8", "160deg,#f472b6,var(--accent)", "200deg,#fbbf24,#fb7185", "120deg,#34d399,#60a5fa", "45deg,#a78bfa,#f472b6", "90deg,var(--accent),#fbbf24"];
    return sec(
      "gallery",
      '      <h2 class="section-title">Gallery</h2>\n      <p class="section-sub">Placeholder tiles — replace with your own images.</p>\n      <div class="grid 3">\n' +
        g
          .map(function (x, i) {
            return '        <div class="card" style="padding:0;overflow:hidden"><div style="aspect-ratio:4/3;background:linear-gradient(' + x + ')"></div><p class="muted" style="margin:0;padding:12px 16px">Project ' + (i + 1) + "</p></div>";
          })
          .join("\n") +
        "\n      </div>"
    );
  },
  logos: function () {
    return sec(
      "logos",
      '      <p class="kpi-label" style="text-align:center">Trusted by teams at</p>\n      <div class="logo-row" style="justify-content:center;margin-top:12px"><span>Northwind</span><span>Globex</span><span>Initech</span><span>Umbrella</span><span>Hooli</span></div>'
    );
  },
  about: function (ctx) {
    const name = esc(brandName(ctx));
    return sec(
      "about",
      '      <div class="split">\n        <div>\n          <h2 class="section-title">About ' + name + '</h2>\n          <p class="soft">We started ' + name + " to make something simpler, friendlier, and genuinely useful. Today we help people every week — and we still answer every message ourselves.</p>\n          <p class=\"muted\">Replace this with your story: why you started, who you serve, and what makes you different.</p>\n        </div>\n        <div class=\"card\"><div class=\"kpi-label\">Since</div><div class=\"kpi\">2026</div><p class=\"muted\" style=\"margin:8px 0 0\">Independent and customer-funded.</p></div>\n      </div>"
    );
  },
  services: function (ctx, clause) {
    const named = listItems(clause);
    return sec(
      "services-extra",
      '      <h2 class="section-title">Services</h2>\n      <p class="section-sub">What we offer — edit names and descriptions.</p>\n      <div class="grid 3">\n' +
        (named.length
          ? named.map(function (it) { return [esc(titleCase(it.name)), "Add a one-line description of what's included."]; })
          : [["Consultation", "Understand your needs and map out a plan."], ["Full service", "We handle everything from start to finish."], ["Ongoing support", "Help whenever you need it, after launch."]])
          .map(function (s, i) {
            return '        <div class="card"><div class="feature-icon">' + (i + 1) + "</div><h3>" + s[0] + '</h3><p class="muted">' + s[1] + "</p></div>";
          })
          .join("\n") +
        "\n      </div>"
    ).replace('data-forge="services-extra"', 'data-forge="services"');
  },
  comparison: function (ctx) {
    const name = esc(brandName(ctx));
    const rows = [["Setup time", "Minutes", "Weeks"], ["Pricing", "Transparent", "Hidden fees"], ["Support", "Real humans", "Ticket queue"], ["Cancel anytime", "✓", "✗"]];
    return sec(
      "comparison",
      '      <h2 class="section-title">How we compare</h2>\n      <div class="card" style="padding:8px 16px;overflow-x:auto">\n        <table>\n          <thead><tr><th></th><th>' + name + "</th><th>Others</th></tr></thead>\n          <tbody>\n" +
        rows
          .map(function (r) {
            return "            <tr><td>" + r[0] + '</td><td style="color:var(--accent);font-weight:700">' + r[1] + '</td><td class="muted">' + r[2] + "</td></tr>";
          })
          .join("\n") +
        "\n          </tbody>\n        </table>\n      </div>"
    );
  },
  timeline: function () {
    return sec(
      "timeline",
      '      <h2 class="section-title">Roadmap</h2>\n      <div class="card">\n' +
        [["Now", "Core product live and taking customers."], ["Next", "Integrations and team features."], ["Later", "Mobile apps and advanced analytics."]]
          .map(function (r) {
            return '        <div class="feed-item"><div class="feed-meta">' + r[0] + '</div><p class="soft" style="margin:0">' + r[1] + "</p></div>";
          })
          .join("\n") +
        "\n      </div>"
    );
  },
  hours: function () {
    return sec(
      "hours",
      '      <div class="split">\n        <div class="card">\n          <h2 class="section-title">Visit us</h2>\n          <p class="soft">123 Main Street<br />Your City, ST 00000</p>\n          <p><a class="btn ghost" href="#">Get directions</a></p>\n        </div>\n        <div class="card">\n          <h3>Hours</h3>\n          <table><tbody>\n            <tr><td>Mon – Fri</td><td>8am – 6pm</td></tr>\n            <tr><td>Saturday</td><td>9am – 4pm</td></tr>\n            <tr><td>Sunday</td><td class="muted">Closed</td></tr>\n          </tbody></table>\n        </div>\n      </div>'
    );
  },
  benefits: function () {
    return sec(
      "benefits",
      '      <h2 class="section-title">Why choose us</h2>\n      <div class="grid 2">\n' +
        [["✓", "Fast turnaround", "Most requests handled within 24 hours."], ["✓", "Satisfaction guaranteed", "Not happy? We make it right."], ["✓", "Transparent pricing", "Know the cost up front."], ["✓", "Real support", "Talk to a person, not a bot."]]
          .map(function (b) {
            return '        <div class="card"><div class="feature-icon">' + b[0] + "</div><h3>" + b[1] + '</h3><p class="muted">' + b[2] + "</p></div>";
          })
          .join("\n") +
        "\n      </div>"
    );
  },
  menu: function (ctx, clause) {
    const named = listItems(clause);
    const pack = packOf(ctx);
    const packMenu = copy.menuFor(pack);
    const fallback = packMenu || [["House special", "Chef's seasonal favorite", "$14"], ["Classic", "The one everyone orders", "$11"], ["Lighter option", "Fresh and simple", "$9"], ["Dessert", "Made in-house daily", "$7"]];
    const samplePrices = ["$4.50", "$5.25", "$4.75", "$6", "$3.95", "$7", "$5.50", "$8"];
    const items = named.length
      ? named.map(function (it, i) { return [titleCase(it.name), "Add a short description", it.price || (packMenu && packMenu[i] && /^\$/.test(packMenu[i][2]) ? packMenu[i][2] : samplePrices[i % samplePrices.length])]; })
      : fallback;
    return sec(
      "menu",
      '      <h2 class="section-title">Menu</h2>\n      <p class="section-sub">' + (named.length ? "Prices are placeholders — set your real ones." : "Sample items — edit names and prices.") + '</p>\n      <div class="card">\n' +
        items
          .map(function (m) {
            return '        <div class="lead"><div><strong>' + esc(m[0]) + '</strong><div class="lead-meta">' + esc(m[1]) + '</div></div><div class="lead-fee">' + esc(m[2]) + "</div></div>";
          })
          .join("\n") +
        "\n      </div>"
    );
  },
  guarantee: function () {
    return sec("guarantee", '      <div class="note" style="text-align:center;font-size:1.05rem"><strong>100% satisfaction guarantee.</strong> If you are not happy, we will make it right — or refund you. No hassle.</div>');
  },
  video: function () {
    return sec(
      "video",
      '      <h2 class="section-title">See it in action</h2>\n      <div class="card" style="aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 25%,var(--panel)),var(--panel-2))">\n        <span class="btn" style="border-radius:999px;width:64px;height:64px;font-size:1.4rem">▶</span>\n      </div>\n      <p class="muted" style="margin-top:8px">Video placeholder — link your demo here.</p>'
    );
  },
};

const BLOCK_TRIGGERS = [
  ["team", /\b(team|founders|staff|our people|meet the)\b/],
  ["steps", /\b(how it works|steps|process|3 steps|three steps)\b/],
  ["newsletter", /\b(newsletter|subscribe|email signup|mailing list|email capture)\b/],
  ["gallery", /\b(gallery|portfolio|our work|photos? grid|image grid|showcase)\b/],
  ["logos", /\b(logos?|partners|clients|trusted by|as seen on|brands)\b/],
  ["about", /\b(about(?: us)? section|about us|our story|who we are|about section)\b/],
  ["services", /\b(services?|offerings)\b/],
  ["comparison", /\b(comparison|compare|vs\.?|versus|competitors?)\b/],
  ["timeline", /\b(timeline|roadmap|milestones)\b/],
  ["hours", /\b(hours|location|map|address|visit us|directions|find us)\b/],
  ["benefits", /\b(benefits|why choose us|why us|advantages|reasons)\b/],
  ["menu", /\b(menu|food menu|drinks)\b/],
  ["guarantee", /\b(guarantee|money.?back|warranty)\b/],
  ["video", /\b(video|demo video)\b/],
];

/* ---------------- hero helpers ---------------- */

function heroRange(html) {
  const secs = findSections(html);
  const h = secs.find(function (s) { return s.hero; });
  return h || null;
}

function editHero(ctx, fn) {
  const h = heroRange(ctx.html);
  if (!h) return false;
  const next = fn(h.inner);
  if (next === h.inner) return false;
  ctx.html = ctx.html.slice(0, h.start) + next + ctx.html.slice(h.end);
  ctx.htmlDirty = true;
  return true;
}

function currentHeadline(html) {
  const h = heroRange(html);
  const src = h ? h.inner : html;
  const m = src.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return m ? stripTags(m[1]) : "";
}

function setHeadline(ctx, text) {
  const ok =
    editHero(ctx, function (inner) {
      return inner.replace(/(<h1[^>]*>)([\s\S]*?)(<\/h1>)/i, function (_, a, __, c) { return a + esc(text) + c; });
    }) ||
    (function () {
      const next = ctx.html.replace(/(<h1[^>]*>)([\s\S]*?)(<\/h1>)/i, function (_, a, __, c) { return a + esc(text) + c; });
      if (next === ctx.html) return false;
      ctx.html = next;
      ctx.htmlDirty = true;
      return true;
    })();
  if (ok) ctx.changes.push({ action: "edit", file: "public/index.html", detail: 'Headline → "' + text + '"' });
  return ok;
}

function setSub(ctx, text) {
  const ok = editHero(ctx, function (inner) {
    /* first <p> without class (the lead paragraph) */
    if (/<p>([\s\S]*?)<\/p>/i.test(inner)) return inner.replace(/<p>([\s\S]*?)<\/p>/i, function () { return "<p>" + esc(text) + "</p>"; });
    return inner.replace(/(<\/h1>)/i, function (m) { return m + "\n      <p>" + esc(text) + "</p>"; });
  });
  if (ok) ctx.changes.push({ action: "edit", file: "public/index.html", detail: "Hero subtitle updated" });
  return ok;
}

function setBadge(ctx, text) {
  const ok = editHero(ctx, function (inner) {
    if (/<span class="badge">[\s\S]*?<\/span>/i.test(inner)) return inner.replace(/(<span class="badge">)([\s\S]*?)(<\/span>)/i, function (_, a, __, c) { return a + esc(text) + c; });
    return inner.replace(/(<section[^>]*>)/i, function (m) { return m + '\n      <span class="badge">' + esc(text) + "</span>"; });
  });
  if (ok) ctx.changes.push({ action: "edit", file: "public/index.html", detail: 'Badge → "' + text + '"' });
  return ok;
}

function setPrimaryCta(ctx, text) {
  let ok = editHero(ctx, function (inner) {
    return inner.replace(/(<a class="btn"(?![^>]*ghost)[^>]*>)([\s\S]*?)(<\/a>)/i, function (_, a, __, c) { return a + esc(text) + c; });
  });
  if (!ok) {
    const next = ctx.html.replace(/(<main[\s\S]*?<a class="btn"(?![^>]*ghost)[^>]*>)([\s\S]*?)(<\/a>)/i, function (_, a, __, c) { return a + esc(text) + c; });
    if (next !== ctx.html) {
      ctx.html = next;
      ctx.htmlDirty = true;
      ok = true;
    }
  }
  if (ok) ctx.changes.push({ action: "edit", file: "public/index.html", detail: 'Main button → "' + text + '"' });
  return ok;
}

function setMetaDescription(ctx, text) {
  if (/<meta name="description"[^>]*>/i.test(ctx.html)) {
    ctx.html = ctx.html.replace(/<meta name="description"[^>]*>/i, '<meta name="description" content="' + esc(text) + '" />');
    ctx.htmlDirty = true;
  }
}

/** Rewrite the first card section after the hero (features/services) with new titles + blurbs. */
function rewriteCards(ctx, set) {
  const secs = findSections(ctx.html);
  const cardy = function (s) {
    return !s.hero && /<div class="card"[^>]*>(?:<div class="feature-icon">[^<]*<\/div>)?<h3>/i.test(s.inner);
  };
  const target =
    secs.find(function (s) { return cardy(s) && /^(features|services|features-extra)$/.test(s.id); }) || secs.find(cardy);
  if (!target) return false;
  let i = 0;
  let inner = target.inner.replace(/(<div class="card"[^>]*>(?:<div class="feature-icon">[^<]*<\/div>)?<h3>)([\s\S]*?)(<\/h3><p class="muted">)([\s\S]*?)(<\/p>)/gi, function (m, a, _t, b, _d, c) {
    const f = set.features[i++];
    if (!f) return m;
    return a + esc(f[0]) + b + esc(f[1]) + c;
  });
  if (set.sectionTitle) inner = inner.replace(/(<h2 class="section-title">)([\s\S]*?)(<\/h2>)/i, function (_, a, __, c) { return a + esc(set.sectionTitle) + c; });
  if (set.sectionSub) inner = inner.replace(/(<p class="section-sub">)([\s\S]*?)(<\/p>)/i, function (_, a, __, c) { return a + esc(set.sectionSub) + c; });
  if (inner === target.inner) return false;
  ctx.html = ctx.html.slice(0, target.start) + inner + ctx.html.slice(target.end);
  ctx.htmlDirty = true;
  ctx.changes.push({ action: "edit", file: "public/index.html", detail: "Rewrote " + (target.heading ? '"' + target.heading + '"' : "feature") + " cards" });
  return true;
}

function topicFromCtx(ctx) {
  const d = (ctx.html.match(/<meta name="description" content="([^"]*)"/i) || [])[1];
  if (ctx.meta && ctx.meta.topic) return ctx.meta.topic;
  if (d && d.length > 3 && d.length < 80 && !/^(a |the )?(polished|starter|spawn)/i.test(d)) return stripTags(d);
  return (ctx.meta && ctx.meta.name) || "your business";
}

/* ---------------- the rules ---------------- */

const RULES = [];
function rule(name, test, run) {
  RULES.push({ name: name, test: test, run: run });
}

/* Explicit text swap: change "A" to "B" / replace "A" with "B" */
rule("text-swap", /\b(change|replace|swap|rename|turn)\b[\s\S]*["“'‘][\s\S]+["”'’][\s\S]*\b(to|with|into)\b[\s\S]*["“'‘]/i, function (ctx, c) {
  const q = quotes(c);
  if (q.length < 2) return false;
  const r = replaceText(ctx.html, q[0], q[1]);
  if (!r.count) {
    ctx.notes.push('Could not find "' + q[0] + '" on the page.');
    return true;
  }
  ctx.html = r.html;
  ctx.htmlDirty = true;
  ctx.changes.push({ action: "edit", file: "public/index.html", detail: 'Replaced "' + q[0] + '" → "' + q[1] + '" (' + r.count + "×)" });
  return true;
});

/* Headline */
rule("headline", /\b(headline|heading|hero title|main title|h1|big title|hero text says|title of the hero)\b/i, function (ctx, c) {
  if (/\b(bigger|larger|smaller|font|size|gradient|color|center)\b/i.test(c) && !quotes(c).length) return false;
  const v = valueAfter(c, /\b(headline|heading|hero title|main title|h1|big title)\b/i);
  if (!v) return false;
  return setHeadline(ctx, v);
});

/* Subtitle / tagline */
rule("subtitle", /\b(subtitle|sub-?headline|subheading|tagline|hero (?:sub(?:title)?|copy|paragraph|description)|lead text|intro text)\b/i, function (ctx, c) {
  const v = valueAfter(c, /\b(subtitle|sub-?headline|subheading|tagline|hero (?:sub(?:title)?|copy|paragraph|description)|lead text|intro text)\b/i);
  if (!v) return false;
  return setSub(ctx, v);
});

/* Badge */
rule("badge", /\b(badge|eyebrow|pill|kicker)\b/i, function (ctx, c) {
  if (/\b(remove|hide|delete)\b/i.test(c)) {
    const ok = editHero(ctx, function (inner) { return inner.replace(/\s*<span class="badge">[\s\S]*?<\/span>/i, ""); });
    if (ok) ctx.changes.push({ action: "remove", file: "public/index.html", detail: "Removed hero badge" });
    return ok;
  }
  const v = valueAfter(c, /\b(badge|eyebrow|pill|kicker)\b/i);
  return v ? setBadge(ctx, v) : false;
});

/* Main button / CTA text (unquoted too) */
rule("cta-text", /\b(button|cta|call to action)\b[\s\S]*\b(to|say|says|read|reads|text)\b/i, function (ctx, c) {
  if (/\b(add|insert|create)\b/i.test(c) && !/\b(change|set|make|swap|rename|update)\b/i.test(c)) return false;
  if (/\b(pill|round|rounded|square|bigger|larger|smaller|color|colour)\b/i.test(c) && !quotes(c).length) return false;
  const v = valueAfter(c, /\b(button|cta|call to action)\b(?:\s+text)?/i);
  return v ? setPrimaryCta(ctx, v) : false;
});

/* Footer text */
rule("footer", /\bfooter\b/i, function (ctx, c) {
  if (/\b(link|social)\b/i.test(c)) return false;
  const v = valueAfter(c, /\bfooter(?:\s+text)?\b/i);
  if (!v) return false;
  const next = ctx.html.replace(/(<footer[^>]*>\s*<span>)([\s\S]*?)(<\/span>)/i, function (_, a, __, b) { return a + esc(v) + b; });
  if (next === ctx.html) return false;
  ctx.html = next;
  ctx.htmlDirty = true;
  ctx.changes.push({ action: "edit", file: "public/index.html", detail: "Footer text updated" });
  return true;
});

/* Social links in footer */
rule("social", /\b(social (?:links|icons|media)|instagram|twitter|linkedin|facebook|tiktok|youtube)\b/i, function (ctx, c) {
  if (!/\b(add|include|put|show|link)\b/i.test(c)) return false;
  if (/data-forge="social"/.test(ctx.html)) return false;
  const nets = ["Instagram", "X", "LinkedIn", "Facebook", "TikTok", "YouTube"].filter(function (n) {
    return new RegExp(n === "X" ? "\\b(twitter|x)\\b" : "\\b" + n + "\\b", "i").test(c);
  });
  const list = nets.length ? nets : ["Instagram", "X", "LinkedIn"];
  const block = '<span data-forge="social" class="row">' + list.map(function (n) { return '<a href="#">' + n + "</a>"; }).join(" · ") + "</span>";
  const next = ctx.html.replace(/(<footer[^>]*>[\s\S]*?)(<\/footer>)/i, function (_, a, b) { return a + block + b; });
  if (next === ctx.html) return false;
  ctx.html = next;
  ctx.htmlDirty = true;
  ctx.changes.push({ action: "insert", file: "public/index.html", detail: "Added social links (" + list.join(", ") + ")" });
  return true;
});

/* Nav link */
rule("nav-link", /\b(nav|navigation|menu|header)\s+(?:link|item|button)\b|\badd (?:a )?link\b/i, function (ctx, c) {
  if (!/\b(add|include|put)\b/i.test(c)) return false;
  const q = quotes(c);
  const m = c.match(/\b(?:to|for|called|named)\s+(?:the\s+)?([a-z0-9][a-z0-9 &'-]{1,30}?)(?:\s+(?:section|page))?\s*$/i);
  const label = titleCase(q[0] || (m && m[1]) || "");
  if (!label) return false;
  const loc = locateSection(findSections(ctx.html), label);
  const href = loc ? "#" + (findSections(ctx.html)[loc.idx].id || slug(label)) : "#" + slug(label);
  const next = ctx.html.replace(/(<div class="nav-links">)/i, '$1\n      <a class="btn ghost sm" href="' + esc(href) + '">' + esc(label) + "</a>");
  if (next === ctx.html) return false;
  ctx.html = next;
  ctx.htmlDirty = true;
  ctx.changes.push({ action: "edit", file: "public/index.html", detail: 'Added nav link "' + label + '"' });
  return true;
});

/* Topic / industry rewrite of hero + cards */
rule(
  "rewrite",
  /\b(rewrite|re-?write|redo|refresh|improve|punch up|write better|better copy|new copy|fill in|generate copy|write copy|make (?:it|this|the (?:site|page|app|copy))\s+(?:about|for|into)|turn (?:it|this) into|this is (?:an?|my|our)|it'?s (?:an?|for)|(?:site|page|website|app|landing page) (?:is )?(?:for|about))\b/i,
  function (ctx, c) {
    const lower = c.toLowerCase();
    let topic = null;
    const tm =
      c.match(/\b(?:for|about|around|into)\s+(?:an?\s+|my\s+|our\s+|the\s+)?(.+)$/i) ||
      c.match(/\b(?:this is|it'?s)\s+(?:an?\s+|my\s+|our\s+)?(.+)$/i);
    if (tm) topic = copy.cleanTopic(tm[1]);
    if (topic && /^(it|this|the hero|hero|copy|the copy|the site|me)$/i.test(topic)) topic = null;
    const tone = copy.findTone(lower);
    const scopeHeroOnly = /\b(hero|headline|header|top)\b/.test(lower) && !/\b(copy|site|page|everything|whole|all|website|cards|features)\b/.test(lower);
    const base = topic || topicFromCtx(ctx);
    const set = copy.copyFor(base, tone, { headline: currentHeadline(ctx.html) });
    setHeadline(ctx, set.headline);
    setSub(ctx, set.sub);
    if (topic || !scopeHeroOnly) {
      setBadge(ctx, set.badge);
      setPrimaryCta(ctx, set.cta);
    }
    if (!scopeHeroOnly && (topic || /\b(copy|site|page|everything|whole|all|website|cards|features|content)\b/.test(lower))) rewriteCards(ctx, set);
    if (topic) setMetaDescription(ctx, set.sub);
    if (topic && ctx.meta) ctx.meta.topic = topic;
    ctx.notes.push("Free offline copy for " + (set.pack ? set.pack + " " : "") + '"' + base + '"' + (tone ? " (" + tone + " tone)" : "") + " — edit any line by asking, e.g. change \"old\" to \"new\".");
    return true;
  }
);

/* Tone change without explicit rewrite verb */
rule("tone", /\b(more|less|sound|tone|voice)\b[\s\S]*\b(professional|formal|corporate|friendly|casual|warm|playful|fun|funny|bold|punchy|confident|exciting|luxury|luxurious|premium|elegant|minimal|concise|shorter|simpler|persuasive)\b|\bmake (?:the )?(?:copy|text|wording|it)\s+(?:sound\s+)?(?:more\s+)?(professional|formal|friendly|casual|playful|fun|bold|punchy|confident|luxurious|premium|elegant|minimal|concise|shorter|simpler|persuasive)\b/i, function (ctx, c) {
  const tone = copy.findTone(c);
  if (!tone) return false;
  const set = copy.copyFor(topicFromCtx(ctx), tone, { headline: currentHeadline(ctx.html) });
  setHeadline(ctx, set.headline);
  setSub(ctx, set.sub);
  ctx.notes.push("Applied a " + tone + " tone (offline copy).");
  return true;
});

/* Remove things */
rule("remove", /\b(remove|delete|drop|hide|get rid of|take out|kill|lose)\b/i, function (ctx, c) {
  const lower = c.toLowerCase();
  if (/theme.?toggle|dark mode (?:button|toggle)|light mode (?:button|toggle)/.test(lower)) {
    setRule(ctx, "hide-theme-toggle", ".theme-toggle{display:none}", "Hid theme toggle");
    return true;
  }
  if (/\blogo row\b|\blogos? (?:strip|bar)\b/.test(lower) && /class="logo-row"/.test(ctx.html)) {
    setRule(ctx, "hide-logo-row", ".hero .logo-row{display:none}", "Hid logo row");
    return true;
  }
  if (/\b(nav|navigation|navbar|menu bar|header bar)\b/.test(lower) && !/\blink\b/.test(lower)) {
    setRule(ctx, "hide-nav", ".nav{display:none}", "Hid navigation bar");
    return true;
  }
  if (/\b(shadows?)\b/.test(lower)) {
    setVar(ctx, "shadow", "none", "Removed shadows");
    return true;
  }
  if (/\b(glow|background glow|gradient glow)\b/.test(lower)) {
    setVar(ctx, "hero-glow", "none", "Removed background glow");
    return true;
  }
  const m = lower.match(/\b(?:remove|delete|drop|hide|get rid of|take out|kill|lose)\s+(?:the\s+|all\s+|my\s+)?(.+?)(?:\s+(?:section|block|area|part|row))?\s*$/);
  if (!m) return false;
  const secs = findSections(ctx.html);
  const loc = locateSection(secs, m[1]);
  if (!loc) {
    ctx.notes.push('No "' + m[1] + '" section found to remove.');
    return true;
  }
  const s = secs[loc.idx];
  if (s.hero && !/\bhero\b/.test(lower)) return false;
  /* Weak (content) match inside a multi-card section: remove just that card. */
  if (loc.weak) {
    const cards = cardRanges(s.inner);
    if (cards.length > 1) {
      const hit = cards.find(function (r) { return loc.weak({ inner: s.inner.slice(r.start, r.end) }); });
      if (hit) {
        let a = hit.start;
        while (a > 0 && /[ \t]/.test(s.inner[a - 1])) a--;
        const inner = s.inner.slice(0, a) + s.inner.slice(hit.end).replace(/^[ \t]*\n/, "");
        const left = cards.length - 1;
        const fixed = left === 1 ? inner.replace(/^(<section\b[^>]*?)class="split"/i, '$1class=""') : inner;
        ctx.html = ctx.html.slice(0, s.start) + fixed + ctx.html.slice(s.end);
        ctx.htmlDirty = true;
        ctx.changes.push({ action: "remove", file: "public/index.html", detail: "Removed " + loc.key + " card" });
        return true;
      }
    }
  }
  let start = s.start;
  let end = s.end;
  /* take trailing inline <script> that belongs to forge blocks with it */
  const after = ctx.html.slice(end);
  const sm = after.match(/^\s*<script>[\s\S]*?<\/script>/);
  if (sm && s.forge && /(contactForm|forge-newsletter)/.test(sm[0])) end += sm[0].length;
  while (start > 0 && /[ \t]/.test(ctx.html[start - 1])) start--;
  ctx.html = ctx.html.slice(0, start) + ctx.html.slice(end).replace(/^[ \t]*\n/, "");
  ctx.htmlDirty = true;
  ctx.changes.push({ action: "remove", file: "public/index.html", detail: "Removed " + (s.heading ? '"' + s.heading + '"' : loc.key) + " section" });
  return true;
});

/* Move sections */
rule("move", /\b(move|put|place|reorder|swap)\b[\s\S]*\b(above|before|below|after|under|top|bottom|first|last|up|down)\b/i, function (ctx, c) {
  const lower = c.toLowerCase().replace(/[.!]+$/, "");
  const m = lower.match(/\b(?:move|put|place)\s+(?:the\s+)?(.+?)\s+(?:section\s+)?(above|before|below|after|under|to the top|to top|at the top|first|to the bottom|to bottom|at the bottom|last|up|down)\b\s*(?:the\s+)?(.*?)(?:\s+section)?$/);
  if (!m) return false;
  const secs = findSections(ctx.html);
  const src = locateSection(secs, m[1]);
  if (!src) {
    ctx.notes.push('No "' + m[1] + '" section found to move.');
    return true;
  }
  const S = secs[src.idx];
  const block = ctx.html.slice(S.start, S.end);
  let html = ctx.html.slice(0, S.start) + ctx.html.slice(S.end);
  const secs2 = findSections(html);
  const dir = m[2];
  let at = -1;
  let label = "";
  if (/above|before|below|after|under/.test(dir)) {
    const tgt = locateSection(secs2, m[3]);
    if (!tgt) {
      ctx.notes.push('No "' + m[3] + '" section found as a target.');
      return true;
    }
    const T = secs2[tgt.idx];
    at = /above|before/.test(dir) ? T.start : T.end;
    label = (/above|before/.test(dir) ? "above " : "below ") + (T.heading || tgt.key);
  } else if (/top|first/.test(dir)) {
    const hero = secs2.find(function (s) { return s.hero; });
    const first = secs2.find(function (s) { return !s.hero; });
    at = hero ? hero.end : first ? first.start : -1;
    label = "to the top";
  } else if (/bottom|last/.test(dir)) {
    const f = html.lastIndexOf("<footer");
    at = f !== -1 ? f : html.lastIndexOf("</main>");
    label = "to the bottom";
  } else if (dir === "up" || dir === "down") {
    const i = secs2.findIndex(function (s) { return s.start >= S.start; });
    if (dir === "up") {
      const prev = secs2[(i === -1 ? secs2.length : i) - 1];
      if (prev && !prev.hero) at = prev.start;
    } else {
      const nxt = secs2[i === -1 ? secs2.length : i];
      if (nxt) at = nxt.end;
    }
    label = dir;
  }
  if (at < 0) {
    ctx.notes.push((S.heading || src.key) + " is already as far " + (dir === "down" ? "down" : "up") + " as it can go.");
    return true;
  }
  const isEnd = /below|after|under|top|first|down/.test(dir);
  html = html.slice(0, at) + (isEnd ? "\n\n    " + block : block + "\n\n    ") + html.slice(at);
  ctx.html = html.replace(/\n[ \t]*\n[ \t]*\n+/g, "\n\n");
  ctx.htmlDirty = true;
  ctx.changes.push({ action: "move", file: "public/index.html", detail: "Moved " + (S.heading || src.key) + " " + label });
  return true;
});

/* Add sections (known blocks + generic "section about X") */
function stripPlacement(text) {
  return String(text)
    .replace(/\b(?:above|below|before|after|under|beneath)\s+(?:the\s+)?[a-z0-9 '&-]{2,40}$/i, "")
    .replace(/\b(?:at|to) the (?:top|bottom)(?: of the page)?\b/i, "")
    .trim();
}

rule("add-section", /\b(add|insert|include|create|put|need|want|give me|show)\b/i, function (ctx, c) {
  const lower = stripPlacement(c.toLowerCase());
  if (/\b(page)\b/.test(lower) && !/\bsection\b/.test(lower)) return false;
  if (/\b(columns?|col)\b/.test(lower) && !/\bsection\b/.test(lower)) return false;
  if (/\b(link|button|image|photo|picture|illustration|animation|shadow|gradient|font|color|colour)\b/.test(lower) && !/\bsection\b/.test(lower)) return false;
  /* existing offline rules already cover these */
  if (/\b(pricing|faq|testimonials?|reviews?|stats|counters|traction|contact|cta|call to action|lead form|signup form|features?)\b/.test(lower) && !/\babout\b/.test(lower)) return false;
  const named = /\b(?:section|block)\s+(?:called|titled|named|that says)\b/i.test(c);
  for (const [key, re] of BLOCK_TRIGGERS) {
    if (named) break;
    if (!re.test(lower)) continue;
    if (new RegExp('data-forge="' + key + '"').test(ctx.html)) {
      /* "add a menu with espresso, latte and cold brew" when a menu exists → swap in those items */
      const existing = (key === "menu" || key === "services") && listItems(c).length ? findSections(ctx.html).find(function (s) { return s.forge === key; }) : null;
      if (existing) {
        ctx.html = ctx.html.slice(0, existing.start) + BLOCKS[key](ctx, c).replace(/^\s+/, "") + ctx.html.slice(existing.end);
        ctx.htmlDirty = true;
        ctx.changes.push({ action: "edit", file: "public/index.html", detail: "Updated " + key + " items" });
        return true;
      }
      ctx.changes.push({ action: "skip", detail: key + " already present" });
      return true;
    }
    ctx.html = placeBlock(ctx.html, BLOCKS[key](ctx, c), c);
    ctx.htmlDirty = true;
    ctx.changes.push({ action: "insert", file: "public/index.html", detail: "Added " + key + " section" });
    return true;
  }
  const g =
    c.match(/\b(?:section|block|part|area)\s+(?:about|on|for|called|titled|named|explaining|describing|that says)\s+["“']?(.+?)["”']?(?:\s+with\s+.*)?\s*$/i) ||
    c.match(/\b(?:add|insert|include|create)\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?["“']?([a-z0-9][^"”']{1,50}?)["”']?\s+(?:section|block)\b/i);
  if (!g) return false;
  let topic = g[1].replace(/\b(?:at the top|to the top|at the bottom|above .*|below .*|before .*|after .*)$/i, "").trim();
  if (!topic || topic.length < 2) return false;
  const heading = titleCase(topic.replace(/^(?:our|my)\s+/i, "Our "));
  const key = "s-" + slug(topic);
  if (new RegExp('id="' + key + '"').test(ctx.html)) {
    ctx.changes.push({ action: "skip", detail: heading + " already present" });
    return true;
  }
  const items = c.match(/\b(\d|two|three|four|five|six)\s+(?:cards?|items?|points?|columns?|reasons?|values?|steps?)\b/i);
  const nmap = { two: 2, three: 3, four: 4, five: 5, six: 6 };
  const plural = /(?:values|reasons|benefits|principles|services|products|offerings|perks|tips|ideas|goals|options|locations|partners|programs|classes|courses)$/i.test(topic);
  const n = items ? Math.min(6, Number(nmap[items[1].toLowerCase()] || items[1]) || 3) : plural ? 3 : 0;
  const brand = esc(brandName(ctx));
  let body;
  if (n) {
    const cards = [];
    for (let i = 1; i <= n; i++) {
      cards.push('        <div class="card"><div class="feature-icon">' + i + "</div><h3>Point " + i + '</h3><p class="muted">One or two sentences about this — ask Build to change any line.</p></div>');
    }
    body = '      <p class="section-sub">What ' + esc(topic.toLowerCase()) + " means at " + brand + '.</p>\n      <div class="grid ' + Math.min(n, 4) + '">\n' + cards.join("\n") + "\n      </div>";
  } else {
    body =
      '      <div class="card">\n        <p class="soft" style="margin:0 0 10px;font-size:1.05rem">At ' + brand + ", " + esc(topic.toLowerCase().replace(/^our\s+/, "our ")) +
      " comes down to one thing: doing right by the people we serve — simply, honestly, and with care.</p>\n        <p class=\"muted\" style=\"margin:0\">Replace this with your own words, or ask Build: change \u201cdoing right by the people we serve\u201d to \u201c…\u201d.</p>\n      </div>";
  }
  const block =
    '    <section id="' + key + '" data-forge="' + key + '" style="margin-top:40px">\n      <h2 class="section-title">' + esc(heading) + "</h2>\n" + body + "\n    </section>";
  ctx.html = placeBlock(ctx.html, block, c);
  ctx.htmlDirty = true;
  ctx.changes.push({ action: "insert", file: "public/index.html", detail: 'Added "' + heading + '" section' });
  return true;
});

/* Hero image / illustration */
rule("hero-image", /\b(image|photo|picture|illustration|graphic|visual|mockup|screenshot)\b/i, function (ctx, c) {
  if (!/\b(add|insert|include|put|show|need|want|give)\b/i.test(c)) return false;
  if (/data-forge="hero-art"/.test(ctx.html)) {
    ctx.changes.push({ action: "skip", detail: "hero visual already present" });
    return true;
  }
  const art =
    '\n      <div data-forge="hero-art" class="card" style="margin-top:28px;padding:0;overflow:hidden;aspect-ratio:16/7;background:radial-gradient(circle at 20% 30%,color-mix(in srgb,var(--accent) 55%,transparent),transparent 45%),radial-gradient(circle at 80% 70%,#818cf8aa,transparent 50%),var(--panel-2)"><span class="sr-only">Decorative illustration — replace with your image</span></div>';
  const ok = editHero(ctx, function (inner) { return inner.replace(/(\s*<\/section>)$/i, art + "$1"); });
  if (ok) ctx.changes.push({ action: "insert", file: "public/index.html", detail: "Added hero visual (gradient placeholder — swap in your image)" });
  return ok;
});

/* Theme default */
rule("theme-default", /\b(dark|light)\s*(?:mode|theme)\b|\bmake it (dark|light)\b|\b(dark|light) by default\b/i, function (ctx, c) {
  if (/\b(remove|hide)\b/i.test(c)) return false;
  const want = /\blight\b/i.test(c) ? "light" : "dark";
  let html = ctx.html.replace(/<html([^>]*?)\sdata-theme="[^"]*"/i, "<html$1");
  html = html.replace(/<html\b([^>]*)>/i, '<html$1 data-theme="' + want + '">');
  /* Make the starter's script respect the chosen default over system preference */
  html = html.replace(
    "else if(window.matchMedia&&window.matchMedia('(prefers-color-scheme:light)').matches) root.setAttribute('data-theme','light');",
    "/* default theme set on <html> by Build */"
  );
  if (html === ctx.html) return false;
  ctx.html = html;
  ctx.htmlDirty = true;
  ctx.changes.push({ action: "style", file: "public/index.html", detail: "Default theme → " + want });
  return true;
});

/* Background color */
rule("background", /\b(background|bg|backdrop)\b/i, function (ctx, c) {
  const lower = c.toLowerCase();
  if (/\bgradient\b/.test(lower)) {
    setRule(ctx, "bg-gradient", "body{background-image:linear-gradient(160deg,color-mix(in srgb,var(--accent) 16%,var(--bg)) 0%,var(--bg) 55%,color-mix(in srgb,#818cf8 12%,var(--bg)) 100%)}", "Gradient page background");
    return true;
  }
  if (/\b(darker|blacker|deeper)\b/.test(lower)) {
    setVar(ctx, "bg", "#05070a", "Darker background");
    return true;
  }
  if (/\b(lighter|brighter)\b/.test(lower)) {
    setVar(ctx, "bg", "#141b24", "Lighter background");
    return true;
  }
  const named = Object.keys(BG_COLORS).find(function (k) { return new RegExp("\\b" + k + "\\b").test(lower); });
  const col = colorIn(c);
  if (!named && !col) return false;
  const hex = col && /^#|rgb/.test(col.name) ? col.hex : BG_COLORS[named] || col.hex;
  const label = named || col.name;
  if (isLightColor(hex)) {
    /* Light backgrounds only make sense with dark text — apply to the light theme and make it the default. */
    setRule(ctx, "bg-light", '[data-theme="light"]{--bg:' + hex + "}", "Light background → " + label + " (" + hex + ")");
    RULES.find(function (r) { return r.name === "theme-default"; }).run(ctx, "light mode");
  } else {
    setVar(ctx, "bg", hex, "Background → " + label + " (" + hex + ")");
  }
  return true;
});

/* Accent / brand color */
rule("accent", /\b(colou?rs?|palette|accent|theme|brand colou?r|recolou?r|make it|use|switch to|change to|primary|buttons?)\b/i, function (ctx, c) {
  const lower = c.toLowerCase();
  if (/\b(background|bg|font|text colou?r|dark mode|light mode|theme toggle)\b/.test(lower)) return false;
  const col = colorIn(c);
  if (!col) return false;
  if (!/\b(colou?rs?|palette|accent|theme|brand|recolou?r|make it|use|switch|change|primary|buttons?|links?)\b/.test(lower)) return false;
  if (!ctx.css) return false;
  setVar(ctx, "accent", col.hex, "Accent → " + col.name + (col.name !== col.hex ? " (" + col.hex + ")" : ""));
  setVar(ctx, "accent-ink", isLightColor(col.hex) || /^#(5eead4|4ade80|34d399|fb923c|fbbf24|60a5fa|22d3ee|38bdf8|a3e635|2dd4bf|fdba74|f472b6|fb7185|c084fc|a78bfa|c4b5fd|e879f9|f87171|818cf8|ff7f6e|10b981|9ca3af|94a3b8|c08457|a3b14b)$/i.test(col.hex) ? "#061018" : "#ffffff", "Button text contrast");
  return true;
});

/* Fonts */
rule("font", /\b(font|typeface|typography|serif|sans-?serif|monospace|mono)\b/i, function (ctx, c) {
  const lower = c.toLowerCase();
  if (/\b(bigger|larger|smaller|size)\b/.test(lower) && !/\b(serif|mono|poppins|montserrat)\b/.test(lower)) return false;
  for (const k of Object.keys(FONTS)) {
    if (lower.indexOf(k) !== -1) {
      const fam = FONTS[k];
      const fb = /mono/i.test(fam) ? "ui-monospace,monospace" : /playfair|lora|merriweather|fraunces|serif|baskerville/i.test(fam) ? "Georgia,serif" : "system-ui,sans-serif";
      setFont(ctx, fam, fb);
      return true;
    }
  }
  if (/\b(serif|elegant|classic|editorial)\b/.test(lower) && !/sans/.test(lower)) {
    setFont(ctx, "Playfair Display", "Georgia,serif", "Font → Playfair Display (serif)");
    setRule(ctx, "body-font", "p,li,td,input,textarea,label{font-family:Inter,system-ui,sans-serif}", "Body text stays sans-serif for readability");
    return true;
  }
  if (/\b(mono|monospace|techy|code|hacker)\b/.test(lower)) {
    setFont(ctx, "JetBrains Mono", "ui-monospace,monospace", "Font → JetBrains Mono");
    return true;
  }
  if (/\b(rounded|friendly|soft)\b/.test(lower)) {
    setFont(ctx, "Nunito", "system-ui,sans-serif", "Font → Nunito (rounded)");
    return true;
  }
  if (/\b(modern|geometric|clean)\b/.test(lower)) {
    setFont(ctx, "Plus Jakarta Sans", "system-ui,sans-serif", "Font → Plus Jakarta Sans");
    return true;
  }
  if (/\b(sans|default|system)\b/.test(lower)) {
    setFont(ctx, "Inter", "system-ui,sans-serif", "Font → Inter");
    return true;
  }
  return false;
});

/* Layout & style tweaks */
rule("layout", /\b(center|centre|centered|left.?align|align left|wider|wide|full.?width|narrow|narrower|spacing|spacious|airy|breathing room|padding|compact|tight|tighter|dense|rounded|round|rounder|softer corners|square|sharp|corners?|pill|bigger|larger|smaller|huge|columns?|side by side|grid|sticky|fixed nav|animate|animation|animations|fade|hover|glass|glassmorphism|flat|gradient|shadow|shadows|modern|premium|polish|prettier|nicer|better looking|look better|sleek|clean up|cleaner|minimalist)\b/i, function (ctx, c) {
  const lower = c.toLowerCase();
  let did = false;
  function R(k, css, d) {
    setRule(ctx, k, css, d);
    did = true;
  }
  if (/\b(center|centre|centered)\b/.test(lower)) {
    if (/\b(everything|all|page|whole|sections?|titles?|text)\b/.test(lower)) {
      R("center-all", ".section-title,.section-sub{text-align:center;margin-left:auto;margin-right:auto}", "Centered section titles");
    }
    R("hero-center", ".hero{text-align:center}.hero p{margin-left:auto;margin-right:auto}.hero .cta,.hero .logo-row{justify-content:center}", "Centered hero");
  }
  if (/\b(left.?align|align left|left aligned)\b/.test(lower)) {
    const map = getOverrides(ctx.css);
    delete map["hero-center"];
    delete map["center-all"];
    ctx.css = writeOverrides(ctx.css, map);
    ctx.cssDirty = true;
    ctx.changes.push({ action: "style", file: "public/styles.css", detail: "Left-aligned hero" });
    did = true;
  }
  if (/\b(full.?width|edge to edge)\b/.test(lower)) R("wrap-width", ".wrap{max-width:none;padding-left:4vw;padding-right:4vw}", "Full-width layout");
  else if (/\b(wider|wide)\b/.test(lower)) R("wrap-width", ".wrap{max-width:1280px}", "Wider layout (1280px)");
  else if (/\b(narrow|narrower)\b/.test(lower)) R("wrap-width", ".wrap{max-width:860px}", "Narrower layout (860px)");
  if (/\b(more spacing|spacious|airy|breathing room|more padding|more space|more whitespace)\b/.test(lower)) {
    R("spacing", ".wrap>section,.wrap>div>section{margin-top:72px!important}.hero{padding:96px 0 48px}.card{padding:30px}", "More spacing");
  } else if (/\b(compact|tight|tighter|dense|less spacing|less padding|less space)\b/.test(lower)) {
    R("spacing", ".wrap>section,.wrap>div>section{margin-top:20px!important}.hero{padding:28px 0 12px}.card{padding:16px}", "Compact spacing");
  }
  if (/\b(pill)\b/.test(lower) || (/\b(round|rounded)\b/.test(lower) && /\bbuttons?\b/.test(lower))) {
    R("btn-shape", ".btn{border-radius:999px}", "Pill buttons");
  } else if (/\b(square|sharp)\b/.test(lower) && /\bbuttons?\b/.test(lower)) {
    R("btn-shape", ".btn{border-radius:4px}", "Square buttons");
  } else if (/\b(rounder|more rounded|rounded|softer corners|round corners|rounded corners)\b/.test(lower)) {
    setVar(ctx, "radius", "22px", "Rounder corners");
    did = true;
  } else if (/\b(square|sharp|less rounded|no rounded)\b/.test(lower)) {
    setVar(ctx, "radius", "4px", "Sharper corners");
    R("btn-shape", ".btn{border-radius:4px}", "Square buttons");
  }
  if (/\b(bigger|larger|huge|giant)\b/.test(lower)) {
    if (/\b(headline|heading|title|h1|hero)\b/.test(lower)) R("h1-size", ".hero h1{font-size:clamp(2.6rem,6.5vw,4.6rem)}", "Bigger headline");
    else if (/\b(button|cta)s?\b/.test(lower)) R("btn-size", ".btn{padding:14px 24px;font-size:1.05rem}.btn.sm{padding:9px 14px;font-size:.9rem}", "Bigger buttons");
    else if (/\b(text|font|body|everything)\b/.test(lower)) R("text-size", "html{font-size:112%}", "Larger text");
  } else if (/\bsmaller\b/.test(lower)) {
    if (/\b(headline|heading|title|h1|hero)\b/.test(lower)) R("h1-size", ".hero h1{font-size:clamp(1.6rem,3.5vw,2.3rem)}", "Smaller headline");
    else if (/\b(text|font|body|everything)\b/.test(lower)) R("text-size", "html{font-size:93%}", "Smaller text");
  }
  const cols = lower.match(/\b(one|single|1|two|2|three|3|four|4)[\s-]*col(?:umn)?s?\b/);
  if (cols || /\bside by side\b/.test(lower)) {
    const n = cols ? { one: 1, single: 1, two: 2, three: 3, four: 4 }[cols[1]] || Number(cols[1]) : 3;
    const scope = (function () {
      const loc = locateSection(findSections(ctx.html), lower.replace(/\b(in|into|to|as|make|the|layout|grid|columns?|\d)\b/g, " "));
      if (loc) {
        const s = findSections(ctx.html)[loc.idx];
        if (s.id) return "#" + s.id + " ";
      }
      return "";
    })();
    R(
      "cols-" + (scope ? slug(scope) : "all"),
      scope + ".grid{grid-template-columns:repeat(" + n + ",minmax(0,1fr))}@media(max-width:720px){" + scope + ".grid{grid-template-columns:1fr}}",
      n + "-column grid" + (scope ? " in " + scope.trim() : "")
    );
  }
  if (/\b(not sticky|unstick|static nav|non-?sticky)\b/.test(lower)) R("nav-sticky", ".nav{position:static}", "Nav no longer sticky");
  else if (/\b(sticky|fixed nav)\b/.test(lower)) R("nav-sticky", ".nav{position:sticky;top:0}", "Sticky nav");
  if (/\b(animate|animation|animations|fade|motion)\b/.test(lower)) {
    R("anim", "@keyframes sbFadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}.wrap>section,.wrap>div>section{animation:sbFadeUp .6s ease both}.wrap>section:nth-of-type(2){animation-delay:.08s}.wrap>section:nth-of-type(3){animation-delay:.16s}@media(prefers-reduced-motion:reduce){.wrap>section,.wrap>div>section{animation:none}}", "Fade-in animations");
  }
  if (/\bhover\b/.test(lower)) R("hover", ".card{transition:transform .18s,box-shadow .18s,border-color .18s}.card:hover{transform:translateY(-3px);border-color:color-mix(in srgb,var(--accent) 45%,var(--border))}", "Card hover effect");
  if (/\b(glass|glassmorphism|frosted)\b/.test(lower)) R("glass", ".card{background:color-mix(in srgb,var(--panel) 62%,transparent);backdrop-filter:blur(12px)}", "Glass cards");
  if (/\bflat\b/.test(lower)) {
    setVar(ctx, "shadow", "none", "Flat cards (no shadow)");
    did = true;
  }
  if (/\bgradient\b/.test(lower) && !/\bbackground\b/.test(lower)) {
    if (/\b(text|headline|heading|title|h1)\b/.test(lower)) R("h1-gradient", ".hero h1{background:linear-gradient(90deg,var(--accent),#818cf8);-webkit-background-clip:text;background-clip:text;color:transparent}", "Gradient headline");
    else if (/\bbuttons?\b/.test(lower)) R("btn-gradient", ".btn:not(.ghost){background:linear-gradient(135deg,var(--accent),#818cf8)}", "Gradient buttons");
    else R("hero-gradient", ".hero{background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 18%,transparent),transparent 60%);border-radius:var(--radius);padding-left:28px;padding-right:28px}", "Gradient hero");
  }
  if (/\b(modern|premium|polish|prettier|nicer|better looking|look better|sleek|clean up|cleaner|minimalist|fancier|more professional look)\b/.test(lower) && !did) {
    setVar(ctx, "radius", "18px", "Softer corners");
    R("hover", ".card{transition:transform .18s,box-shadow .18s,border-color .18s}.card:hover{transform:translateY(-3px);border-color:color-mix(in srgb,var(--accent) 45%,var(--border))}", "Card hover effect");
    R("h1-size", ".hero h1{font-size:clamp(2.4rem,5.5vw,3.8rem)}", "Bolder headline");
    R("spacing", ".wrap>section,.wrap>div>section{margin-top:64px!important}.hero{padding:80px 0 36px}", "More breathing room");
    R("anim", "@keyframes sbFadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}.wrap>section,.wrap>div>section{animation:sbFadeUp .6s ease both}@media(prefers-reduced-motion:reduce){.wrap>section,.wrap>div>section{animation:none}}", "Subtle fade-in");
    R("btn-shape", ".btn{border-radius:999px}", "Pill buttons");
    if (/\bminimalist|clean\b/.test(lower)) setVar(ctx, "shadow", "none", "Flat cards");
  }
  return did;
});

/* ---------------- entry ---------------- */

/**
 * ctx: { html, css, msg, meta, changes } → mutates; returns ctx with htmlDirty/cssDirty/notes/matched.
 * `skip` lets webedit's classic rules claim clauses they already handled.
 */
function applyFreeform(ctx) {
  ctx.notes = ctx.notes || [];
  ctx.matched = 0;
  const parts = clauses(ctx.msg);
  parts.forEach(function (c) {
    if (ctx.skip && ctx.skip(c)) return;
    for (const r of RULES) {
      if (!r.test.test(c)) continue;
      let hit = false;
      try {
        hit = r.run(ctx, c);
      } catch (err) {
        console.error("[webfree] rule " + r.name + " failed:", err && err.message);
      }
      if (hit) {
        ctx.matched += 1;
        /* style rules may combine with others in one clause (e.g. "center the hero and make the headline bigger") */
        if (!/^(layout|accent|background|font)$/.test(r.name)) break;
      }
    }
  });
  return ctx;
}

module.exports = { listItems, packOf, applyFreeform, clauses, quotes, findSections, replaceText, stripPlacement, placeBlock, COLORS };
