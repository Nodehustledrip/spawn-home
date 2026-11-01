#!/usr/bin/env node
/*
 * Prepare desktop-hosted bundles for Spawn Cloud upload.
 *   node cloud/apps/prepare-bundles.js [hostedRoot=/workspace/app-forge/hosted]
 * Writes cloud/apps/<slug>/ for bidboard, pass-p-checkout, pass-p-landing:
 *  - drops desktop/server-only files (_forge_hosted.json, ai.js server code, test cruft)
 *  - removes the /hosted/<slug> base-path shim (apps live at the domain root on Spawn Cloud)
 *  - replaces builder-facing instructions with visitor-facing copy
 *  - uploads page keeps the delete key returned on upload
 */
"use strict";
const fs = require("fs");
const path = require("path");
const SRC = process.argv[2] || "/workspace/app-forge/hosted";
const OUT = __dirname;
const APPS = ["bidboard", "pass-p-checkout", "pass-p-landing"];
const DROP = new Set(["_forge_hosted.json", "ai.js", "hello-plugin.txt", "admin.html", "waitlist.html"]);

const RUN_HINT = " Open BidBoard in Spawn and hit ▶ Run if APIs are down.";
const REPLACE = [
  [/<!-- spawn-base -->[\s\S]*?<!-- \/spawn-base -->/g, ""],
  [RUN_HINT, " Please refresh in a moment."],
  ["). Hit ▶ Run on BidBoard in Spawn, then refresh.", "). Please refresh in a moment."],
  ["Priority placement & higher unlock volume — <strong id=\"pro2\">$99/mo</strong> set your Stripe Payment Link in Spawn → Payments (not live until connected).",
    "Unlock every lead with no per-lead fee while you’re signed in — <strong id=\"pro2\">$99/mo</strong>, cancel anytime."],
  ["\"Mock unlock until payments are connected. <strong>Connect payments in Spawn Account</strong> (Account → Payments) to use a live Stripe Payment Link or Whop URL.\"",
    "\"Payments aren’t switched on for this board yet — unlocking is a free preview for now.\""],
  ["\"Live checkout connected — unlock opens your Stripe/Whop payment link.\"", "\"Secure checkout by Stripe. Contact details appear as soon as payment is confirmed.\""],
  ["u.connectPaymentsCta || \"Connect payments in Spawn Account\"", "u.connectPaymentsCta || \"Payments aren’t switched on for this board yet\""],
  ["cfg.connectPaymentsCta || \"Connect payments in Spawn Account\"", "cfg.connectPaymentsCta || \"Payments aren’t switched on for this board yet\""],
  ["esc(u.buttonHint || \"Demo unlock (Payment Link not set)\") + \". <strong>\" + esc(cta) + \"</strong> — open Spawn → Account → Payments, paste your Stripe Payment Link or Whop URL, Connect → Test, then Re-Run BidBoard. Spawn never invents a buy.stripe.com link.\" + (u.honesty ? \" \" + esc(u.honesty) : \"\")",
    "esc(u.honesty || cta)"],
  // Same-tab checkout so Stripe returns to /paid in this tab and the lead opens automatically.
  ["if (live && payUrl) window.open(payUrl, \"_blank\");", "if (live && payUrl) { if (u.unlock && u.unlock.token) sessionStorage.setItem(\"bb_pending_\" + id, u.unlock.token); location.href = payUrl; return; }"],
  ['<p class="muted">Email + password or magic-link-lite.</p>', '<p class="muted">Contractors: sign in to use your Pro plan.</p>'],
  ['<button class="btn ghost" type="submit" data-act="magic">Magic link</button>', ''],
  ['aria-label="Spawn"', 'aria-label="App icon"'],
  ['<p class="muted">Files are stored under <code>storage/uploads</code>.</p>', '<p class="muted">Files you upload here can be shared by link. Only this browser can delete them.</p>'],
  ['fetch("api/storage/"+encodeURIComponent(b.getAttribute("data-del")),{method:"DELETE"})',
    'fetch("api/storage/"+encodeURIComponent(b.getAttribute("data-del")),{method:"DELETE",headers:{"x-delete-key":(JSON.parse(localStorage.getItem("up_keys")||"{}"))[b.getAttribute("data-del")]||""}})'],
  ['document.getElementById("msg").textContent=d.ok?"Uploaded "+d.file.name:(d.error||"Failed");',
    'if(d.ok&&d.file&&d.file.deleteKey){var k=JSON.parse(localStorage.getItem("up_keys")||"{}");k[d.file.name]=d.file.deleteKey;localStorage.setItem("up_keys",JSON.stringify(k));}document.getElementById("msg").textContent=d.ok?"Uploaded "+d.file.name:(d.error||"Failed");'],
  [/const CACHE = "hosted-([a-z0-9-]+)-v\d+";/, 'const CACHE = "cloud-$1-v1";'],
  ['<a class="btn ghost" href="/waitlist.html">Waitlist</a>', ''],
  // service worker: the desktop copy is missing a closing paren (SW never installed)
  ["h || caches.match(SCOPE))); });", "h || caches.match(SCOPE))));"],
  // ---- On-site Stripe Checkout (no payment links) ----
  ["Mock checkout records interest until Stripe is live.", "Pay securely with Stripe; contact details appear as soon as payment is confirmed."],
  [/\s*<section id="checkout" class="card"[^>]*data-forge="checkout">[\s\S]*?<\/section>\s*<script>\(function\(\)\{[^<]*?checkoutUrl[^<]*<\/script>/, "\n"],
  ["u.demoMode === true || u.paymentLinkRequired === true || u.paymentsLive === false", "u.demoMode === true || u.paymentsLive === false"],
  ["Flat fee per job unlock. Email-gated mock checkout records interest until Stripe is connected.", "One flat fee per lead. Pay securely with Stripe and the customer’s contact details open right away."],
  ["Priority placement & higher unlock volume. Placeholder subscription.", "Unlock every lead with no per-lead fee while you’re signed in. Billed monthly, cancel anytime."],
  [/<div class="field" style="margin-top:12px">\s*<label>Email for Pro interest<\/label>\s*<input id="proEmail"[^>]*\/>\s*<\/div>\s*<button class="btn ghost" type="button" id="proBtn">Record Pro interest<\/button>/,
    '<p class="muted" id="proState" style="font-size:13px;margin:12px 0 0"></p>\n        <p style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn" type="button" id="proBtn">Start Contractor Pro</button><button class="btn ghost" type="button" id="billingBtn" hidden>Manage billing</button></p>'],
  [" No password for MVP — email is your key.", " Unlocks are tied to your email."],
  [/  document\.getElementById\("proBtn"\)\.onclick = function \(\) \{[\s\S]*?if \(d\.checkoutUrl\) window\.open\(d\.checkoutUrl, "_blank"\);\s*\}\);\s*\};/, `  var proBtn = document.getElementById("proBtn"), billingBtn = document.getElementById("billingBtn");
  var proMsg = document.getElementById("proMsg"), proState = document.getElementById("proState");
  function proToast(text, err) { proMsg.className = "toast show" + (err ? " err" : ""); proMsg.textContent = text; }
  function signIn() { location.href = "login.html?next=" + encodeURIComponent("/contractors.html#pro"); }
  function post(url) {
    return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); });
  }
  function go(btn, url, busy) {
    var label = btn.textContent; btn.disabled = true; btn.textContent = busy;
    post(url).then(function (d) {
      if (d.url) { location.href = d.url; return; }
      btn.disabled = false; btn.textContent = label;
      if (d._status === 401) { signIn(); return; }
      proToast(d.error || "Something went wrong — try again.", true);
    }).catch(function () { btn.disabled = false; btn.textContent = label; proToast("Network error — try again.", true); });
  }
  proBtn.onclick = function () { go(proBtn, "api/pro/checkout", "Opening secure checkout…"); };
  billingBtn.onclick = function () { go(billingBtn, "api/billing/portal", "Opening billing…"); };
  fetch("api/pro/status").then(function (r) { return r.json(); }).then(function (st) {
    if (!st.proAvailable) { proBtn.hidden = true; proState.textContent = "Contractor Pro sign-up isn’t open on this board."; return; }
    if (st.pro) { proBtn.hidden = true; proState.textContent = "You’re on Contractor Pro (" + st.email + "). Leads unlock with no per-lead fee while you’re signed in."; }
    else if (st.signedIn) proState.textContent = "Signed in as " + st.email + ".";
    else { proState.textContent = "Sign in or create an account to start Pro."; proBtn.textContent = "Sign in to start Pro"; proBtn.onclick = signIn; }
    if (st.canManageBilling) billingBtn.hidden = false;
    if (/[?&]pro=welcome/.test(location.search) && st.pro) proToast("Welcome to Contractor Pro. Your plan is active.");
  }).catch(function () {});`],
  ['esc(d.paymentsLive ? ("Unlock lead  -  " + d.leadFeeLabel) : "Demo unlock (Payment Link not set)")', 'esc(d.paymentsLive ? ("Unlock lead  -  " + d.leadFeeLabel) : "Preview unlock")'],
  ["No account password required for MVP — we key unlocks to your email. <a href=\"contractors.html#signup\">Pro signup</a>",
    "Unlocks are tied to your email. On Contractor Pro? <a href=\"login.html?next=%2Fjob.html%3Fid%3D' + encodeURIComponent(j.id) + '\">Sign in</a> to unlock with no per-lead fee."],
  ["\"Live checkout connected — unlock opens your Stripe/Whop payment link.\"", "\"Secure checkout by Stripe. Contact details appear as soon as payment is confirmed.\""],
  ["setTimeout(function(){location.href='/account.html';},600)", "setTimeout(function(){var n=new URLSearchParams(location.search).get('next')||'';location.href=/^\\/(?!\\/)[^\\s]*$/.test(n)?n:'/account.html';},600)"],
];

function copy(slug) {
  const from = path.join(SRC, slug), to = path.join(OUT, slug);
  if (!fs.existsSync(from)) { console.error("missing", from); process.exitCode = 1; return; }
  fs.rmSync(to, { recursive: true, force: true });
  let n = 0, patched = 0;
  (function walk(rel) {
    for (const e of fs.readdirSync(path.join(from, rel), { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) { walk(r); continue; }
      if (DROP.has(e.name) && !rel) continue;
      let buf = fs.readFileSync(path.join(from, r));
      if (/\.(html|js|css|svg|webmanifest|json|txt|xml)$/.test(e.name)) {
        let s = buf.toString("utf8"); const orig = s;
        if (/edit in Spawn IDE/.test(s)) continue; // unfinished template page — not shipped
        s = s.split('"/hosted/' + slug + '/').join('"/').split("'/hosted/" + slug + "/").join("'/");
        for (const [a, b] of REPLACE) s = typeof a === "string" ? s.split(a).join(b) : s.replace(a, b);
        if (s !== orig) patched++;
        buf = Buffer.from(s);
      }
      fs.mkdirSync(path.dirname(path.join(to, r)), { recursive: true });
      fs.writeFileSync(path.join(to, r), buf); n++;
    }
  })("");
  console.log(slug + ": " + n + " files, " + patched + " patched");
}
APPS.forEach(copy);
// Leftover builder wording check (visitor-facing).
const bad = [];
for (const slug of APPS) (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(html|js)$/.test(e.name) && e.name !== "ai-widget.js") { const s = fs.readFileSync(p, "utf8"); if (/Spawn →|in Spawn|\/hosted\/|Replit|Grok|▶ Run|buy\.stripe\.com|Payment Link|STRIPE_PAYMENT_LINK|Whop|[Mm]ock (checkout|unlock)|Placeholder|for MVP|[Cc]oming soon|Pro interest/.test(s)) bad.push(path.relative(OUT, p)); } } })(path.join(OUT, slug));
if (bad.length) { console.error("Builder wording left in:", bad.join(", ")); process.exitCode = 1; } else console.log("copy check: clean");
