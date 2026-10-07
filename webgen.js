"use strict";

/* Their description, tidied for the hero: "neighborhood bakery" → "Neighborhood bakery." */
function heroLine(d) {
  return require("./webdetails").sentence(d || "");
}

const fs = require("fs");
const path = require("path");
const webcopy = require("./webcopy");

const GENERATED_ROOT = process.env.BUILDS_DIR || path.join(__dirname, "data", "builds");

const TEMPLATES = [
  { id: "landing-paywall", name: "Landing + Paywall", blurb: "Polished marketing landing with pricing, social proof, and checkout hook." },
  { id: "local-service", name: "Local Service", blurb: "Trades & local business site with services, trust signals, and lead form." },
  { id: "dashboard-tool", name: "Dashboard Tool", blurb: "Ops dashboard with KPI cards, activity table, and quick actions." },
  { id: "content-feed", name: "Content Feed", blurb: "News / newsletter-style feed with featured posts and subscribe." },
  { id: "marketplace-leads", name: "Marketplace / Leads", blurb: "Lead board for buyers and sellers — post, browse, and unlock contacts." },
];

function slugify(input) {
  return String(input || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function listTemplates() {
  return TEMPLATES.map((t) => ({ ...t }));
}

function listGenerated() {
  if (!fs.existsSync(GENERATED_ROOT)) return [];
  return fs.readdirSync(GENERATED_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const dir = path.join(GENERATED_ROOT, d.name);
      const metaPath = path.join(dir, "forge.json");
      let meta = {};
      if (fs.existsSync(metaPath)) {
        try { meta = JSON.parse(fs.readFileSync(metaPath, "utf8")); } catch (_) { meta = {}; }
      }
      const stat = fs.statSync(dir);
      const thumbPng = path.join(dir, ".forge", "preview.png");
      const hasCapture = fs.existsSync(thumbPng);
      const deploy = meta.deploy || null;
      return {
        slug: d.name,
        name: meta.name || d.name,
        template: meta.template || null,
        monetization: meta.monetization || "none",
        createdAt: meta.createdAt || stat.mtime.toISOString(),
        updatedAt: meta.updatedAt || (deploy && deploy.lastAt) || stat.mtime.toISOString(),
        deploy: deploy
          ? { lastAt: deploy.lastAt || null, target: deploy.target || null, url: deploy.url || null }
          : null,
        thumbnail: "/api/projects/" + encodeURIComponent(d.name) + "/thumbnail",
        hasCapture: hasCapture,
        pinned: !!meta.pinned,
      };
    })
    .sort((a, b) => {
      const ap = a.pinned ? 1 : 0;
      const bp = b.pinned ? 1 : 0;
      if (bp !== ap) return bp - ap;
      return String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt));
    });
}

function writeFile(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

function sharedCss(accent) {
  const a = accent || "#5eead4";
  return `/* Spawn starter — dark/light design system */
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap");
:root{
  --accent:${a};
  --accent-ink:#061018;
  --bg:#0b0f14;
  --bg-elev:#0d1218;
  --panel:#121821;
  --panel-2:#161e29;
  --border:#1e2936;
  --border-strong:#2a3646;
  --text:#e8eef7;
  --text-soft:#b7c5d6;
  --muted:#93a4b8;
  --faint:#6f8094;
  --badge-bg:#1a2432;
  --badge-fg:#9ecbff;
  --badge-bd:#2a3a4f;
  --shadow:0 12px 40px rgba(0,0,0,.35);
  --hero-glow:radial-gradient(ellipse 80% 60% at 50% -20%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 70%);
  --radius:14px;
  --font:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
}
[data-theme="light"]{
  --accent-ink:#04201a;
  --bg:#f4f6f9;
  --bg-elev:#ffffff;
  --panel:#ffffff;
  --panel-2:#f0f3f7;
  --border:#e2e8f0;
  --border-strong:#cbd5e1;
  --text:#0f172a;
  --text-soft:#334155;
  --muted:#64748b;
  --faint:#94a3b8;
  --badge-bg:#eef2ff;
  --badge-fg:#3730a3;
  --badge-bd:#c7d2fe;
  --shadow:0 12px 32px rgba(15,23,42,.08);
  --hero-glow:radial-gradient(ellipse 80% 60% at 50% -20%, color-mix(in srgb, var(--accent) 28%, transparent), transparent 70%);
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;font-family:var(--font);background:var(--bg);color:var(--text);line-height:1.55;-webkit-font-smoothing:antialiased}
body{min-height:100vh;background-image:var(--hero-glow);background-attachment:fixed}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:1080px;margin:0 auto;padding:28px 22px 56px}
.nav{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 22px;border-bottom:1px solid var(--border);background:color-mix(in srgb, var(--bg-elev) 92%, transparent);backdrop-filter:blur(10px);position:sticky;top:0;z-index:20;flex-wrap:wrap}
.nav .brand{font-weight:800;letter-spacing:.01em;font-size:1.05rem}
.nav .brand span{color:var(--accent)}
.nav-links{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:var(--accent);color:var(--accent-ink);border:0;border-radius:10px;padding:11px 18px;font-weight:700;font-size:.95rem;cursor:pointer;transition:filter .15s,transform .15s}
.btn:hover{filter:brightness(1.08);text-decoration:none}
.btn:active{transform:translateY(1px)}
.btn.ghost{background:transparent;color:var(--text);border:1px solid var(--border-strong)}
.btn.sm{padding:8px 12px;font-size:.85rem;border-radius:8px}
.theme-toggle{background:var(--panel-2);border:1px solid var(--border);color:var(--muted);border-radius:999px;padding:8px 12px;font-size:.8rem;font-weight:600;cursor:pointer}
.theme-toggle:hover{color:var(--text);border-color:var(--border-strong)}
.card{background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:24px;box-shadow:var(--shadow)}
.card h3{margin:0 0 8px;font-size:1.05rem}
.muted{color:var(--muted)}.soft{color:var(--text-soft)}
.hero{padding:48px 0 20px}
.hero h1{font-size:clamp(2rem,4.5vw,3rem);margin:0 0 14px;letter-spacing:-.03em;line-height:1.15;font-weight:800}
.hero p{font-size:1.12rem;color:var(--text-soft);max-width:40rem;margin:0}
.hero .cta{margin-top:26px;display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.badge{display:inline-flex;align-items:center;gap:6px;background:var(--badge-bg);color:var(--badge-fg);border:1px solid var(--badge-bd);border-radius:999px;padding:5px 12px;font-size:.75rem;font-weight:600;letter-spacing:.02em}
.grid{display:grid;gap:16px}
.grid[class~="2"]{grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.grid[class~="3"]{grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
.grid[class~="4"]{grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}
.feature-icon{width:40px;height:40px;border-radius:10px;background:color-mix(in srgb, var(--accent) 18%, var(--panel-2));color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.95rem;margin-bottom:12px}
.kpi{font-size:2rem;font-weight:800;letter-spacing:-.02em;margin-top:6px}
.kpi-label{font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600}
.section-title{font-size:1.35rem;margin:0 0 6px;letter-spacing:-.02em}
.section-sub{margin:0 0 18px;color:var(--muted);max-width:36rem}
.price-card{position:relative;overflow:hidden}
.price-card.featured{border-color:color-mix(in srgb, var(--accent) 55%, var(--border));box-shadow:0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent), var(--shadow)}
.price{font-size:2.4rem;font-weight:800;letter-spacing:-.03em;margin:8px 0}
.price small{font-size:1rem;font-weight:600;color:var(--muted)}
.price-list{list-style:none;padding:0;margin:16px 0 0}
.price-list li{padding:8px 0;border-bottom:1px solid var(--border);color:var(--text-soft);font-size:.95rem}
.price-list li:last-child{border-bottom:0}
input,textarea,select{width:100%;background:var(--bg);border:1px solid var(--border-strong);border-radius:10px;color:var(--text);padding:12px 14px;font:inherit}
input:focus,textarea:focus,select:focus{outline:2px solid color-mix(in srgb, var(--accent) 45%, transparent);outline-offset:1px;border-color:var(--accent)}
label{display:block;font-size:.85rem;color:var(--muted);margin-bottom:6px;font-weight:500}
.field{margin-bottom:14px}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:12px 10px;border-bottom:1px solid var(--border);font-size:.95rem}
th{color:var(--muted);font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;font-weight:600}
.status{display:inline-block;padding:3px 9px;border-radius:999px;font-size:.75rem;font-weight:600;background:var(--panel-2);border:1px solid var(--border)}
.status.ok{color:#34d399;border-color:#1f3d34;background:#14201c}
.status.warn{color:#fbbf24;border-color:#3d3420;background:#201c14}
.status.open{color:#60a5fa;border-color:#1e3a5f;background:#121a28}
[data-theme="light"] .status.ok{background:#ecfdf5;border-color:#a7f3d0;color:#047857}
[data-theme="light"] .status.warn{background:#fffbeb;border-color:#fde68a;color:#b45309}
[data-theme="light"] .status.open{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8}
.feed-item{padding:20px 0;border-bottom:1px solid var(--border)}
.feed-item:last-child{border-bottom:0}
.feed-meta{font-size:.8rem;color:var(--faint);margin-bottom:8px}
.lead{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:18px 0;border-bottom:1px solid var(--border)}
.lead:last-child{border-bottom:0}
.lead-meta{font-size:.85rem;color:var(--muted);margin-top:4px}
.lead-fee{font-weight:800;color:var(--accent);white-space:nowrap;font-size:1.05rem}
.avatar{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--accent),#818cf8);display:inline-flex;align-items:center;justify-content:center;font-weight:800;color:var(--accent-ink);font-size:.8rem;flex-shrink:0}
.quote{border-left:3px solid var(--accent);padding:4px 0 4px 16px;color:var(--text-soft);font-style:italic}
.bar{height:8px;border-radius:999px;background:var(--panel-2);overflow:hidden;margin-top:10px}
.bar > i{display:block;height:100%;background:var(--accent);border-radius:999px}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.split{display:grid;gap:20px;grid-template-columns:1.2fr .8fr}
@media(max-width:800px){.split{grid-template-columns:1fr}}
.note{background:color-mix(in srgb, var(--accent) 12%, var(--panel));border:1px solid color-mix(in srgb, var(--accent) 28%, var(--border));color:var(--text-soft);border-radius:12px;padding:14px 16px;margin-top:16px}
footer{margin-top:56px;padding:28px 0 8px;color:var(--faint);font-size:.85rem;border-top:1px solid var(--border);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
.logo-row{display:flex;gap:18px;flex-wrap:wrap;opacity:.55;font-weight:700;font-size:.85rem;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin-top:28px}
`;
}

function themeToggleScript() {
  return `<script>
(function(){
  var root=document.documentElement;
  var saved=localStorage.getItem('af-theme');
  if(saved==='light'||saved==='dark') root.setAttribute('data-theme',saved);
  else if(window.matchMedia&&window.matchMedia('(prefers-color-scheme:light)').matches) root.setAttribute('data-theme','light');
  function sync(){
    var t=root.getAttribute('data-theme')==='light'?'light':'dark';
    document.querySelectorAll('[data-theme-toggle]').forEach(function(btn){
      btn.textContent=t==='light'?'Dark':'Light';
      btn.setAttribute('aria-label','Switch to '+(t==='light'?'dark':'light')+' theme');
    });
  }
  document.addEventListener('click',function(e){
    var btn=e.target.closest('[data-theme-toggle]');
    if(!btn) return;
    var next=root.getAttribute('data-theme')==='light'?'dark':'light';
    root.setAttribute('data-theme',next);
    localStorage.setItem('af-theme',next);
    sync();
  });
  sync();
})();
</script>`;
}

function navChrome(name, linksHtml) {
  return `
  <nav class="nav">
    <div class="brand">${escapeHtml(name)}</div>
    <div class="nav-links">
      ${linksHtml || ""}
      <button type="button" class="theme-toggle" data-theme-toggle>Light</button>
    </div>
  </nav>`;
}

function monetizationBlock(opts) {
  const { monetization, checkoutUrl } = opts;
  if (monetization === "stripe") {
    return `
    <section class="card" style="margin-top:24px" id="get-started">
      <span class="badge">Stripe</span>
      <h2 class="section-title" style="margin-top:12px">Unlock full access</h2>
      <p class="muted">Checkout opens your Stripe Payment Link. Set <code>STRIPE_PAYMENT_LINK</code> (or <code>STRIPE_CHECKOUT_URL</code>) in the environment.</p>
      <p style="margin-top:16px"><a class="btn" id="payBtn" href="#" rel="noopener">Continue to checkout</a></p>
    </section>
    <script>
      (function(){
        var el = document.getElementById('payBtn');
        fetch('/api/config').then(function(r){return r.json()}).then(function(c){
          if (c.checkoutUrl) { el.href = c.checkoutUrl; }
          else { el.addEventListener('click', function(e){ e.preventDefault(); alert('Set STRIPE_PAYMENT_LINK in your environment, then restart the server.'); }); }
        }).catch(function(){});
      })();
    </script>`;
  }
  if (monetization === "whop") {
    const href = checkoutUrl ? escapeHtml(checkoutUrl) : "#";
    return `
    <section class="card" style="margin-top:24px" id="get-started">
      <span class="badge">Whop</span>
      <h2 class="section-title" style="margin-top:12px">Get access</h2>
      <p class="muted">Checkout uses your Whop URL. Override with <code>WHOP_CHECKOUT_URL</code> if needed.</p>
      <p style="margin-top:16px"><a class="btn" id="payBtn" href="${href}" rel="noopener" target="_blank">Open checkout</a></p>
    </section>
    <script>
      (function(){
        fetch('/api/config').then(function(r){return r.json()}).then(function(c){
          if (c.checkoutUrl) document.getElementById('payBtn').href = c.checkoutUrl;
        }).catch(function(){});
      })();
    </script>`;
  }
  return "";
}

function serverJs(opts) {
  const { name, monetization, checkoutUrl } = opts;
  return `"use strict";

const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, app: ${JSON.stringify(name)} });
});

app.get("/api/config", (_req, res) => {
  const monetization = ${JSON.stringify(monetization)};
  let checkoutUrl = null;
  if (monetization === "stripe") {
    checkoutUrl = process.env.STRIPE_PAYMENT_LINK || process.env.STRIPE_CHECKOUT_URL || null;
  } else if (monetization === "whop") {
    checkoutUrl = process.env.WHOP_CHECKOUT_URL || ${JSON.stringify(checkoutUrl || null)};
  }
  res.json({ monetization, checkoutUrl });
});

app.post("/api/lead", (req, res) => {
  const { name, email, message, phone, title, zip, trade } = req.body || {};
  if (!email && !title) return res.status(400).json({ ok: false, error: "email or title required" });
  console.log("[lead]", { name, email, phone, message, title, zip, trade, at: new Date().toISOString() });
  res.json({ ok: true });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(${JSON.stringify(name)} + " listening on http://0.0.0.0:" + PORT);
});
`;
}

function packageJson(opts) {
  const { name, slug } = opts;
  return JSON.stringify({
    name: slug,
    version: "1.0.0",
    private: true,
    description: name,
    main: "server.js",
    scripts: { start: "node server.js" },
    engines: { node: ">=18" },
    dependencies: { express: "^4.21.2" },
  }, null, 2) + "\n";
}

function readme(opts) {
  const { name, slug, monetization } = opts;
  let money = "";
  if (monetization === "stripe") {
    money = "\n## Payments (Stripe)\n\nSet one of these environment variables before starting:\n\n```bash\nexport STRIPE_PAYMENT_LINK=\"https://buy.stripe.com/your-link\"\n# or\nexport STRIPE_CHECKOUT_URL=\"https://buy.stripe.com/your-link\"\n```\n\nNo Stripe secret keys are required for a simple payment-link checkout.\n";
  } else if (monetization === "whop") {
    money = "\n## Payments (Whop)\n\nOptionally override the checkout URL:\n\n```bash\nexport WHOP_CHECKOUT_URL=\"https://whop.com/your-product\"\n```\n";
  }
  return `# ${name}\n\nGenerated with Spawn.\n\n## Run locally\n\nRequires Node.js 18+.\n\n\`\`\`bash\ncd ${slug}\nnpm install\nnpm start\n\`\`\`\n\nThe server listens on \`0.0.0.0\` and uses \`PORT\` from the environment (default \`3000\`).\n\nOpen http://localhost:3000 in your browser.\n${money}\n## Project layout\n\n- \`server.js\` — Express server\n- \`public/\` — static UI\n- \`forge.json\` — generation metadata\n\nHost this folder however you prefer (VPS, container, static host with a Node process, etc.).\n`;
}

function templateLanding(opts) {
  const { name, description, accent } = opts;
  const pay = monetizationBlock(opts);
  const year = new Date().getFullYear();
  const P = opts.profile || null;
  const feats = P
    ? P.features.map(function (f) { return [escapeHtml(f[0]), escapeHtml(f[1])]; })
    : [
        ["Fast setup", "Up and running in minutes — no long onboarding or sales calls."],
        ["Clear value", "Visitors understand what you do and why it matters in seconds."],
        ["Works everywhere", "Looks sharp on phones, tablets, and big screens alike."],
        ["Real support", "Talk to a person who can actually fix things, fast."],
      ];
  const qs = P ? P.quotes : [
    ["Set up in an afternoon, and our whole team actually uses it every day.", "Jordan R."],
    ["Clear pricing, fast support, and it just works. Exactly what we needed.", "Alex L."],
  ];
  const initials = function (n) { return escapeHtml(String(n).split(/[ ,.&]+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join("")); };
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="${escapeHtml(description || name)}" />
  <title>${escapeHtml(name)}</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  ${navChrome(name, `<a class="btn ghost sm" href="#features">Features</a><a class="btn sm" href="#pricing">Pricing</a>`)}
  <main class="wrap">
    <section class="hero">
      <span class="badge">${escapeHtml(P ? P.badge : "Now available")}</span>
      <h1 style="margin-top:16px">${escapeHtml(name)}</h1>
      <p>${escapeHtml(heroLine(description) || (P ? P.sub : "A clear, fast way to get what you need — with simple pricing and real people behind it."))}</p>
      <div class="cta">
        <a class="btn" href="#get-started">${escapeHtml(P ? P.cta : "Get started")}</a>
        <a class="btn ghost" href="#features">See what's included</a>
      </div>
${!P || /^(saas|agency|mobileapp|media|finance)$/.test(P.id) ? '<div class="logo-row"><span>Acme Co</span><span>Northwind</span><span>Globex</span><span>Initech</span></div>' : ""}
    </section>

    <section id="features" style="margin-top:12px">
      <h2 class="section-title">${escapeHtml(P ? P.sectionTitle : "Why people choose us")}</h2>
      <p class="section-sub">${escapeHtml(P ? P.sectionSub : "Sample feature cards — swap in what makes you different.")}</p>
      <div class="grid 2">
${feats.map(function (f, i) { return '        <div class="card"><div class="feature-icon">' + (i + 1) + "</div><h3>" + f[0] + '</h3><p class="muted">' + f[1] + "</p></div>"; }).join("\n")}
      </div>
    </section>

    <section id="pricing" style="margin-top:40px">
      <h2 class="section-title">Simple pricing</h2>
      <p class="section-sub">Sample tiers — replace with your real plans.</p>
      <div class="grid 3">
        <div class="card price-card">
          <div class="kpi-label">Starter</div>
          <div class="price">$0 <small>/ mo</small></div>
          <p class="muted">Explore the product and ship a first version.</p>
          <ul class="price-list"><li>Core pages</li><li>Email capture</li><li>Community support</li></ul>
          <p style="margin-top:18px"><a class="btn ghost" href="#get-started">Start free</a></p>
        </div>
        <div class="card price-card featured">
          <span class="badge">Popular</span>
          <div class="kpi-label" style="margin-top:10px">Pro</div>
          <div class="price">$29 <small>/ mo</small></div>
          <p class="muted">For teams ready to grow and monetize.</p>
          <ul class="price-list"><li>Everything in Starter</li><li>Checkout integration</li><li>Priority support</li></ul>
          <p style="margin-top:18px"><a class="btn" href="#get-started">Choose Pro</a></p>
        </div>
        <div class="card price-card">
          <div class="kpi-label">Business</div>
          <div class="price">$99 <small>/ mo</small></div>
          <p class="muted">Custom workflows and higher limits.</p>
          <ul class="price-list"><li>Everything in Pro</li><li>SSO-ready layout</li><li>Dedicated onboarding</li></ul>
          <p style="margin-top:18px"><a class="btn ghost" href="#get-started">Talk to us</a></p>
        </div>
      </div>
    </section>

    <section class="grid 2" style="margin-top:28px">
${qs.slice(0, 2).map(function (q) { return '      <div class="card">\n        <div class="row" style="margin-bottom:12px"><span class="avatar">' + initials(q[1]) + "</span><strong>" + escapeHtml(q[1]) + '</strong></div>\n        <p class="quote">' + escapeHtml(q[0]) + "</p>\n      </div>"; }).join("\n")}
    </section>

    <div id="get-started">${pay || `
    <section class="card" style="margin-top:28px">
      <h2 class="section-title">Get started</h2>
      <p class="muted">Tell us where to send access details.</p>
      <form id="leadForm" style="margin-top:16px">
        <div class="grid 2">
          <div class="field"><label>Name</label><input name="name" placeholder="Your name" /></div>
          <div class="field"><label>Email</label><input name="email" type="email" required placeholder="you@example.com" /></div>
        </div>
        <button class="btn" type="submit">Request access</button>
      </form>
      <p id="leadMsg" class="muted" style="margin-top:12px"></p>
    </section>`}</div>
    <footer><span>&copy; ${year} ${escapeHtml(name)}</span><span>Built with Spawn</span></footer>
  </main>
  ${themeToggleScript()}
  <script>
    var form = document.getElementById('leadForm');
    if (form) form.addEventListener('submit', function(e){
      e.preventDefault();
      var fd = new FormData(form);
      fetch('/api/lead', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ email: fd.get('email'), name: fd.get('name') }) })
        .then(function(r){return r.json()}).then(function(){
          document.getElementById('leadMsg').textContent = 'Thanks — we got your request.';
          form.reset();
        });
    });
  </script>
</body>
</html>`;
  return { "public/index.html": html, "public/styles.css": sharedCss(accent) };
}

function menuRows(items) {
  return items
    .map(function (m) {
      return '        <div class="lead"><div><strong>' + escapeHtml(m[0]) + '</strong><div class="lead-meta">' + escapeHtml(m[1]) + '</div></div><div class="lead-fee">' + escapeHtml(m[2]) + "</div></div>";
    })
    .join("\n");
}

/* Default copy for trades / anything we can't place — matches the original Local Service starter. */
const TRADES_LOCAL = {
  badge: "Local &amp; trusted",
  sub: "Reliable local service for homeowners and businesses — clear pricing, fast response, work done right.",
  trust: "Licensed · Insured · Same-week availability",
  cta: "Request a free estimate",
  cta2: "View services",
  sectionTitle: "What we handle",
  features: [
    ["Residential", "Repairs, installs, and seasonal maintenance for homes."],
    ["Commercial", "Service calls and preventative plans for shops &amp; offices."],
    ["Emergency", "Priority slots when something cannot wait."],
    ["Free estimates", "Clear pricing before work begins — no surprise invoices."],
  ],
  featureIcons: ["R", "C", "E", "$"],
  kpis: [["Avg. response", "&lt; 2 hrs", "During business hours"], ["Jobs completed", "1,240+", "Demo stats — replace with yours"], ["Rating", "4.9", "From local reviews"]],
  areaTitle: "Service area",
  areaText: "Your city and the surrounding communities — list the towns you cover so visitors know you'll come to them.",
  areaNote: "Same-day quotes available for emergency calls before 2pm.",
  quote: ["Showed up on time, explained the fix, left the place cleaner than they found it.", "Sam T., homeowner"],
  formTitle: "Request a quote",
  formSub: "We follow up by phone or email — usually within one business day.",
  placeholder: "Describe the job, address, and preferred timing",
  button: "Send request",
  success: "Got it — someone will reach out shortly.",
  titleSuffix: " | Local Service",
  footer: "Serving your local area",
};

function localCopy(profile) {
  if (!profile || profile.id === "trades") return Object.assign({}, TRADES_LOCAL, { pack: profile ? profile.id : null });
  const k = profile.kpis || [];
  return {
    pack: profile.id,
    badge: escapeHtml(profile.badge),
    sub: profile.sub,
    trust: profile.trust,
    cta: profile.cta,
    cta2: profile.cta2,
    cta2Href: profile.cta2Href,
    navServices: profile.navServices,
    navServicesHref: profile.navServicesHref,
    sectionTitle: profile.sectionTitle,
    sectionSub: profile.sectionSub,
    features: profile.features.map(function (f) { return [escapeHtml(f[0]), escapeHtml(f[1])]; }),
    featureIcons: profile.features.map(function (f) { return escapeHtml(String(f[0]).charAt(0).toUpperCase()); }),
    kpis: k.map(function (r, i) { return [escapeHtml(r[0]), escapeHtml(r[1]), i === 1 ? "Demo stats — replace with yours" : "Sample — swap in your real numbers"]; }),
    areaTitle: "Where to find us",
    areaText: "Add your address, neighborhood, or the area you serve — it's one of the first things visitors look for.",
    areaNote: "Tip: add your hours and parking or delivery details here.",
    quote: (profile.quotes && profile.quotes[0]) || ["Easy to work with, quick to reply, and genuinely great at what they do.", "Sam T., customer"],
    formTitle: profile.formTitle,
    formSub: profile.formSub,
    placeholder: profile.placeholder,
    button: profile.button,
    success: profile.success,
    menu: profile.menu || null,
    titleSuffix: "",
    footer: "Locally owned",
  };
}

function templateLocalService(opts) {
  const { name, description, accent } = opts;
  const pay = monetizationBlock(opts);
  const year = new Date().getFullYear();
  const L = localCopy(opts.profile);
  const servicesHref = L.navServicesHref || "#services";
  const menuBlock = L.menu
    ? `
    <section id="menu" data-forge="menu" style="margin-top:40px">
      <h2 class="section-title">Menu</h2>
      <p class="section-sub">Sample items — edit names and prices.</p>
      <div class="card">
${menuRows(L.menu)}
      </div>
    </section>
`
    : "";
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="${escapeHtml(description || name)}" />
  <title>${escapeHtml(name)}${L.titleSuffix}</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  ${navChrome(name, `<a class="btn ghost sm" href="${servicesHref}">${escapeHtml(L.navServices || "Services")}</a><a class="btn sm" href="#quote">${L.pack && L.pack !== "trades" ? escapeHtml(L.cta) : "Get a quote"}</a>`)}
  <main class="wrap">
    <section class="hero">
      <span class="badge">${L.badge}</span>
      <h1 style="margin-top:16px">${escapeHtml(name)}</h1>
      <p>${escapeHtml(heroLine(description) || L.sub)}</p>
      <p class="muted" style="margin-top:12px">${escapeHtml(L.trust)}</p>
      <div class="cta">
        <a class="btn" href="#quote">${escapeHtml(L.cta)}</a>
        <a class="btn ghost" href="${L.cta2Href || "#services"}">${escapeHtml(L.cta2)}</a>
      </div>
    </section>

    <section id="services" style="margin-top:8px">
      <h2 class="section-title">${escapeHtml(L.sectionTitle)}</h2>
      <p class="section-sub">${L.sectionSub ? escapeHtml(L.sectionSub) : "Sample service cards — swap in your real offerings."}</p>
      <div class="grid 2">
${L.features.map(function (f, i) { return '        <div class="card"><div class="feature-icon">' + L.featureIcons[i] + "</div><h3>" + f[0] + '</h3><p class="muted">' + f[1] + "</p></div>"; }).join("\n")}
      </div>
    </section>
${menuBlock}
    <section class="grid 3" style="margin-top:24px">
${L.kpis.map(function (k) { return '      <div class="card"><div class="kpi-label">' + k[0] + '</div><div class="kpi">' + k[1] + '</div><p class="muted" style="margin-top:8px">' + k[2] + "</p></div>"; }).join("\n")}
    </section>

    <section class="split" style="margin-top:28px">
      <div class="card">
        <h2 class="section-title">${L.areaTitle}</h2>
        <p class="muted">${L.areaText}</p>
        <div class="note" style="margin-top:16px">${L.areaNote}</div>
      </div>
      <div class="card">
        <h2 class="section-title">What customers say</h2>
        <p class="quote" style="margin-top:12px">${escapeHtml(L.quote[0])}</p>
        <p class="muted" style="margin-top:10px">— ${escapeHtml(L.quote[1])}</p>
      </div>
    </section>

    <section id="quote" class="card" style="margin-top:28px">
      <h2 class="section-title">${escapeHtml(L.formTitle)}</h2>
      <p class="muted">${escapeHtml(L.formSub)}</p>
      <form id="leadForm" style="margin-top:16px">
        <div class="grid 2">
          <div class="field"><label>Name</label><input name="name" required /></div>
          <div class="field"><label>Phone</label><input name="phone" type="tel" /></div>
        </div>
        <div class="field"><label>Email</label><input name="email" type="email" required /></div>
        <div class="field"><label>${L.pack && L.pack !== "trades" ? "Details" : "What do you need?"}</label><textarea name="message" rows="4" placeholder="${escapeHtml(L.placeholder)}"></textarea></div>
        <button class="btn" type="submit">${escapeHtml(L.button)}</button>
      </form>
      <p id="leadMsg" class="muted" style="margin-top:12px"></p>
    </section>
    ${pay}
    <footer><span>&copy; ${year} ${escapeHtml(name)} · ${L.footer}</span><span>Built with Spawn</span></footer>
  </main>
  ${themeToggleScript()}
  <script>
    document.getElementById('leadForm').addEventListener('submit', function(e){
      e.preventDefault();
      var fd = new FormData(e.target);
      fetch('/api/lead', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ name: fd.get('name'), phone: fd.get('phone'), email: fd.get('email'), message: fd.get('message') }) })
        .then(function(r){return r.json()}).then(function(){
          document.getElementById('leadMsg').textContent = ${JSON.stringify(L.success).replace(/</g, "\\u003c")};
          e.target.reset();
        });
    });
  </script>
</body>
</html>`;
  return { "public/index.html": html, "public/styles.css": sharedCss(accent) };
}

function templateDashboard(opts) {
  const { name, description, accent } = opts;
  const pay = monetizationBlock(opts);
  const year = new Date().getFullYear();
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="${escapeHtml(description || name)}" />
  <title>${escapeHtml(name)}</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  ${navChrome(name, `<span class="badge">Demo data</span><button class="btn sm" type="button" id="refreshBtn">Refresh</button>`)}
  <main class="wrap">
    <section class="hero" style="padding-top:28px;padding-bottom:8px">
      <h1 style="font-size:clamp(1.6rem,3vw,2.2rem)">${escapeHtml(name)}</h1>
      <p>${escapeHtml(heroLine(description) || "Operational dashboard for tracking work, revenue, and open tasks.")}</p>
    </section>

    <section class="grid 4" style="margin-top:8px">
      <div class="card"><div class="kpi-label">Active items</div><div class="kpi">24</div><div class="bar"><i style="width:72%"></i></div></div>
      <div class="card"><div class="kpi-label">Completed</div><div class="kpi">128</div><div class="bar"><i style="width:88%"></i></div></div>
      <div class="card"><div class="kpi-label">Revenue</div><div class="kpi">$4,820</div><div class="bar"><i style="width:64%"></i></div></div>
      <div class="card"><div class="kpi-label">Open tasks</div><div class="kpi">7</div><div class="bar"><i style="width:35%"></i></div></div>
    </section>

    <section class="split" style="margin-top:20px">
      <div class="card" style="overflow:auto">
        <div class="row" style="justify-content:space-between;margin-bottom:14px">
          <h2 class="section-title" style="margin:0">Recent activity</h2>
          <span class="muted" style="font-size:.85rem">Live demo table</span>
        </div>
        <table>
          <thead><tr><th>Item</th><th>Status</th><th>Owner</th><th>Updated</th></tr></thead>
          <tbody id="rows">
            <tr><td>Onboarding checklist</td><td><span class="status warn">In progress</span></td><td>Alex</td><td>Today</td></tr>
            <tr><td>Invoice #1042</td><td><span class="status ok">Paid</span></td><td>Sam</td><td>Yesterday</td></tr>
            <tr><td>Support ticket #88</td><td><span class="status open">Open</span></td><td>Jordan</td><td>2d ago</td></tr>
            <tr><td>Weekly report</td><td><span class="status ok">Done</span></td><td>Taylor</td><td>3d ago</td></tr>
          </tbody>
        </table>
      </div>
      <div class="card">
        <h2 class="section-title">Quick actions</h2>
        <p class="muted">Wire these buttons to your real APIs later.</p>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:14px">
          <button class="btn" type="button">New item</button>
          <button class="btn ghost" type="button">Export CSV</button>
          <button class="btn ghost" type="button">Invite teammate</button>
        </div>
        <div class="note">Tip: replace demo rows with data from <code>/api</code> endpoints.</div>
      </div>
    </section>
    ${pay}
    <footer><span>&copy; ${year} ${escapeHtml(name)}</span><span>Built with Spawn</span></footer>
  </main>
  ${themeToggleScript()}
  <script>
    document.getElementById('refreshBtn').addEventListener('click', function(){
      var tbody = document.getElementById('rows');
      var stamp = new Date().toLocaleTimeString();
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>Manual refresh</td><td><span class="status open">Logged</span></td><td>You</td><td>' + stamp + '</td>';
      tbody.insertBefore(tr, tbody.firstChild);
    });
  </script>
</body>
</html>`;
  return { "public/index.html": html, "public/styles.css": sharedCss(accent) };
}

function templateContentFeed(opts) {
  const { name, description, accent } = opts;
  const pay = monetizationBlock(opts);
  const year = new Date().getFullYear();
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="${escapeHtml(description || name)}" />
  <title>${escapeHtml(name)}</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  ${navChrome(name, `<a class="btn ghost sm" href="#latest">Latest</a><a class="btn sm" href="#subscribe">Subscribe</a>`)}
  <main class="wrap">
    <section class="hero">
      <span class="badge">Newsletter</span>
      <h1 style="margin-top:16px">${escapeHtml(name)}</h1>
      <p>${escapeHtml(heroLine(description) || "A news-style content feed with featured stories and an email subscribe form.")}</p>
    </section>

    <section class="split" id="latest">
      <div class="card">
        <article class="feed-item" style="padding-top:0">
          <span class="badge">Featured</span>
          <h2 style="margin:12px 0 8px;font-size:1.5rem;letter-spacing:-.02em">Welcome to your feed</h2>
          <div class="feed-meta">Editor · Today · 4 min read</div>
          <p class="soft">Replace this featured story with your own update, product note, or essay. The layout is ready for real publishing.</p>
        </article>
        <article class="feed-item">
          <div class="feed-meta">Product · Yesterday · 2 min read</div>
          <h3 style="margin:0 0 8px">Shipping notes</h3>
          <p class="muted">Keep readers in the loop with short, frequent posts about what shipped.</p>
        </article>
        <article class="feed-item">
          <div class="feed-meta">Culture · 3d ago · 6 min read</div>
          <h3 style="margin:0 0 8px">Behind the scenes</h3>
          <p class="muted">Share process, roadmaps, and lessons learned with your audience.</p>
        </article>
        <article class="feed-item">
          <div class="feed-meta">Industry · 1w ago · 5 min read</div>
          <h3 style="margin:0 0 8px">Weekly brief</h3>
          <p class="muted">A digest of links and commentary — perfect for a recurring newsletter.</p>
        </article>
      </div>
      <aside>
        <div class="card" id="subscribe">
          <h2 class="section-title">Subscribe</h2>
          <p class="muted">Collect emails for your list. Wire this to your ESP later.</p>
          <form id="leadForm" style="margin-top:14px">
            <div class="field"><label>Email</label><input name="email" type="email" required placeholder="you@example.com" /></div>
            <button class="btn" type="submit" style="width:100%">Join the list</button>
          </form>
          <p id="leadMsg" class="muted" style="margin-top:12px"></p>
        </div>
        <div class="card" style="margin-top:16px">
          <h3>Topics</h3>
          <div class="row" style="margin-top:10px">
            <span class="badge">Product</span><span class="badge">Culture</span><span class="badge">Industry</span>
          </div>
        </div>
      </aside>
    </section>
    ${pay}
    <footer><span>&copy; ${year} ${escapeHtml(name)}</span><span>Built with Spawn</span></footer>
  </main>
  ${themeToggleScript()}
  <script>
    document.getElementById('leadForm').addEventListener('submit', function(e){
      e.preventDefault();
      var fd = new FormData(e.target);
      fetch('/api/lead', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ email: fd.get('email') }) })
        .then(function(r){return r.json()}).then(function(){
          document.getElementById('leadMsg').textContent = 'You are on the list.';
          e.target.reset();
        });
    });
  </script>
</body>
</html>`;
  return { "public/index.html": html, "public/styles.css": sharedCss(accent) };
}

function templateMarketplace(opts) {
  const { name, description, accent } = opts;
  const pay = monetizationBlock(opts);
  const year = new Date().getFullYear();
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="${escapeHtml(description || name)}" />
  <title>${escapeHtml(name)} · Marketplace</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  ${navChrome(name, `<a class="btn ghost sm" href="#board">Browse leads</a><a class="btn sm" href="#post">Post a job</a>`)}
  <main class="wrap">
    <section class="hero">
      <span class="badge">Leads marketplace</span>
      <h1 style="margin-top:16px">${escapeHtml(name)}</h1>
      <p>${escapeHtml(heroLine(description) || "Buyers post jobs free. Pros browse the board and unlock contact details when a lead is a fit.")}</p>
      <div class="cta">
        <a class="btn" href="#post">Post a job free</a>
        <a class="btn ghost" href="#board">View open leads</a>
      </div>
    </section>

    <section class="grid 3" style="margin-top:8px">
      <div class="card"><div class="feature-icon">1</div><h3>Post free</h3><p class="muted">Describe the job, add a zip, and optional details. Listings go live on the board.</p></div>
      <div class="card"><div class="feature-icon">2</div><h3>Pros browse</h3><p class="muted">Filter by trade and area. Preview blurred contact until unlocked.</p></div>
      <div class="card"><div class="feature-icon">3</div><h3>Unlock lead</h3><p class="muted">Pay a flat lead fee to reveal homeowner or buyer contact info.</p></div>
    </section>

    <section id="board" class="card" style="margin-top:28px">
      <div class="row" style="justify-content:space-between;margin-bottom:8px">
        <div>
          <h2 class="section-title" style="margin:0">Open leads</h2>
          <p class="muted" style="margin:6px 0 0">Sample board — replace with live data from your API.</p>
        </div>
        <span class="badge">12 open</span>
      </div>
      <div class="lead">
        <div>
          <strong>Furnace not heating — North side</strong>
          <div class="lead-meta">HVAC · 52402 · Posted 2h ago</div>
          <p class="muted" style="margin:8px 0 0">No heat since last night. Unit is ~12 years old. Prefer same-day if possible.</p>
        </div>
        <div style="text-align:right">
          <div class="lead-fee">$25</div>
          <button class="btn sm" type="button" style="margin-top:8px">Unlock</button>
        </div>
      </div>
      <div class="lead">
        <div>
          <strong>Kitchen faucet leak</strong>
          <div class="lead-meta">Plumbing · 52404 · Posted yesterday</div>
          <p class="muted" style="margin:8px 0 0">Slow drip under sink. Photos available after unlock.</p>
        </div>
        <div style="text-align:right">
          <div class="lead-fee">$20</div>
          <button class="btn sm" type="button" style="margin-top:8px">Unlock</button>
        </div>
      </div>
      <div class="lead">
        <div>
          <strong>Office AC maintenance plan</strong>
          <div class="lead-meta">HVAC · Commercial · 52302 · 3d ago</div>
          <p class="muted" style="margin:8px 0 0">Looking for quarterly service quotes for a small suite.</p>
        </div>
        <div style="text-align:right">
          <div class="lead-fee">$40</div>
          <button class="btn sm" type="button" style="margin-top:8px">Unlock</button>
        </div>
      </div>
    </section>

    <section class="split" style="margin-top:24px">
      <div class="card" id="post">
        <h2 class="section-title">Post a job</h2>
        <p class="muted">Free for buyers. Pros see the listing on the board.</p>
        <form id="leadForm" style="margin-top:16px">
          <div class="field"><label>Job title</label><input name="title" required placeholder="e.g. Water heater replacement" /></div>
          <div class="grid 2">
            <div class="field"><label>Trade</label><select name="trade"><option>Plumbing</option><option>HVAC</option><option>Electrical</option><option>Other</option></select></div>
            <div class="field"><label>Zip</label><input name="zip" required placeholder="52402" /></div>
          </div>
          <div class="field"><label>Your email</label><input name="email" type="email" required /></div>
          <div class="field"><label>Description</label><textarea name="message" rows="4" placeholder="What's going on? Any timing constraints?"></textarea></div>
          <button class="btn" type="submit">Post to board</button>
        </form>
        <p id="leadMsg" class="muted" style="margin-top:12px"></p>
      </div>
      <div class="card">
        <h2 class="section-title">Pro plan</h2>
        <p class="muted">Priority placement and more unlocks — wire to Stripe or Whop.</p>
        <div class="price">$99 <small>/ mo</small></div>
        <ul class="price-list">
          <li>Featured contractor profile</li>
          <li>Higher monthly unlock allowance</li>
          <li>Early access to new leads</li>
        </ul>
        <p style="margin-top:18px"><a class="btn ghost" href="#get-started">See Pro checkout</a></p>
        <div class="note">Inspired by lead-board patterns — customize trades, fees, and geography for your market.</div>
      </div>
    </section>
    ${pay || `<div id="get-started"></div>`}
    <footer><span>&copy; ${year} ${escapeHtml(name)} · Buyer posts are free</span><span>Built with Spawn</span></footer>
  </main>
  ${themeToggleScript()}
  <script>
    document.getElementById('leadForm').addEventListener('submit', function(e){
      e.preventDefault();
      var fd = new FormData(e.target);
      fetch('/api/lead', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ title: fd.get('title'), trade: fd.get('trade'), zip: fd.get('zip'), email: fd.get('email'), message: fd.get('message') }) })
        .then(function(r){return r.json()}).then(function(){
          document.getElementById('leadMsg').textContent = 'Posted — your job is on the board (demo).';
          e.target.reset();
        });
    });
  </script>
</body>
</html>`;
  return { "public/index.html": html, "public/styles.css": sharedCss(accent) };
}

/* Templates whose copy adapts to the business described at creation (coffee shop, salon, gym…). */
const PROFILE_TEMPLATES = { "landing-paywall": true, "local-service": true };

const BUILDERS = {
  "landing-paywall": templateLanding,
  "local-service": templateLocalService,
  "dashboard-tool": templateDashboard,
  "content-feed": templateContentFeed,
  "marketplace-leads": templateMarketplace,
};

function generate(body) {
  const name = String(body.name || "").trim();
  const slug = slugify(body.slug || name);
  const description = String(body.description || "").trim();
  const template = String(body.template || "").trim();
  let monetization = String(body.monetization || "none").trim().toLowerCase();
  const checkoutUrl = String(body.checkoutUrl || body.whopCheckoutUrl || "").trim();
  const accent = String(body.accent || "#5eead4").trim();

  if (!name) { const err = new Error("App name is required"); err.status = 400; throw err; }
  if (!slug) { const err = new Error("Valid slug is required"); err.status = 400; throw err; }
  if (!BUILDERS[template]) { const err = new Error("Unknown template: " + template); err.status = 400; throw err; }
  if (!["none", "stripe", "whop"].includes(monetization)) monetization = "none";
  if (monetization === "whop" && !checkoutUrl) {
    const err = new Error("Whop checkout URL is required when monetization is whop");
    err.status = 400;
    throw err;
  }

  const outDir = path.join(GENERATED_ROOT, slug);
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const profile = PROFILE_TEMPLATES[template] ? webcopy.profileFor(description, name) : null;
  const opts = { name, slug, description, template, monetization, checkoutUrl, accent, profile };
  const files = BUILDERS[template](opts);

  writeFile(outDir, "package.json", packageJson(opts));
  writeFile(outDir, "server.js", serverJs(opts));
  writeFile(outDir, "README.md", readme(opts));
  writeFile(outDir, "forge.json", JSON.stringify({
    name, slug, description, template, monetization,
    checkoutUrl: monetization === "whop" ? checkoutUrl : null,
    createdAt: new Date().toISOString(),
    generator: "Spawn",
  }, null, 2) + "\n");
  writeFile(outDir, ".gitignore", "node_modules/\n.env\n.DS_Store\n");

  for (const [rel, content] of Object.entries(files)) writeFile(outDir, rel, content);

  if (monetization === "stripe") {
    writeFile(outDir, ".env.example", "PORT=3000\nSTRIPE_PAYMENT_LINK=https://buy.stripe.com/your-link\n");
  } else if (monetization === "whop") {
    writeFile(outDir, ".env.example", "PORT=3000\nWHOP_CHECKOUT_URL=" + checkoutUrl + "\n");
  } else {
    writeFile(outDir, ".env.example", "PORT=3000\n");
  }

  return { ok: true, slug, name, template, monetization, path: outDir };
}


function createBuild(body, outRoot) {
  const crypto = require("crypto");
  const id = String(body.id || ("b" + crypto.randomBytes(5).toString("hex")));
  const root = outRoot || GENERATED_ROOT;
  const name = String(body.name || "").trim();
  const description = String(body.description || "").trim();
  const template = String(body.template || "").trim();
  const accent = String(body.accent || "#5eead4").trim();
  if (!name) { const err = new Error("App name is required"); err.status = 400; throw err; }
  if (!BUILDERS[template]) { const err = new Error("Unknown template: " + template); err.status = 400; throw err; }
  const outDir = path.join(root, id);
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const profile = PROFILE_TEMPLATES[template] ? webcopy.profileFor(description, name) : null;
  const opts = { name, slug: id, description, template, monetization: "none", checkoutUrl: "", accent, profile };
  const files = BUILDERS[template](opts);
  writeFile(outDir, "package.json", packageJson(opts));
  writeFile(outDir, "server.js", serverJs(opts));
  writeFile(outDir, "README.md", readme(opts));
  writeFile(outDir, "forge.json", JSON.stringify({
    name, slug: id, description, template, monetization: "none",
    checkoutUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    generator: "Spawn",
    source: "web-build",
    pack: profile ? profile.id : null,
  }, null, 2) + "\n");
  writeFile(outDir, ".gitignore", "node_modules/\n.env\n.DS_Store\n");
  writeFile(outDir, ".env.example", "PORT=3000\n");
  for (const [rel, content] of Object.entries(files)) writeFile(outDir, rel, content);
  return { ok: true, id, slug: id, name, template, path: outDir };
}

module.exports = { generate, createBuild, listGenerated, listTemplates, GENERATED_ROOT, slugify, TEMPLATES, BUILDERS, sharedCss, escapeHtml };

