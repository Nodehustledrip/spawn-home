(function () {
  "use strict";
  var CFG = window.SITE_CONFIG || {}, TIERS = CFG.tiers || [];
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var okLink = function (u) { return /^https:\/\/(buy|checkout|donate)\.stripe\.com\//.test(u || "") ? u : ""; };
  var anyLink = TIERS.some(function (t) { return okLink(t.link); });
  var ROOT = document.documentElement.dataset.root || "";
  var DEMO_KEY = "cc-demo-user";
  var live = fetch("/api/health", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : {}; }).then(function (d) { return d && d.hosting === "spawn-cloud"; }).catch(function () { return false; });

  // Card payments: once the owner connects Stripe on spawnapp.org, joining runs through Stripe Checkout and access
  // switches on automatically when Stripe confirms the payment (and off again if the subscription ends).
  var STRIPE = false;
  var stripe = live.then(function (isLive) {
    if (!isLive) return false;
    return fetch("/api/pay/config", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (c) { STRIPE = !!(c && c.connected && c.catalog); return STRIPE; });
  }).catch(function () { return false; });
  // status(): { live, signedIn, member, demo, user }
  function status() {
    return live.then(function (isLive) {
      if (!isLive) { var u = null; try { u = JSON.parse(localStorage.getItem(DEMO_KEY) || "null"); } catch (_) {} return { live: false, signedIn: !!u, member: !!u, demo: true, user: u }; }
      return fetch("/api/members/me", { cache: "no-store", credentials: "same-origin" }).then(function (r) { return r.json(); }).then(function (d) { d.live = true; return d; });
    });
  }
  function api(p, body) {
    return fetch(p, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body || {}) }).then(function (r) { return r.json().then(function (d) { if (!r.ok || d.ok === false) throw new Error(d.error || "Something went wrong (" + r.status + ")."); return d; }); });
  }
  function payUrl(t, email) { var u = okLink(t && t.link); return u ? u + (u.indexOf("?") > -1 ? "&" : "?") + "prefilled_email=" + encodeURIComponent(email || "") + "&client_reference_id=" + encodeURIComponent("cc-" + (t.id || "")) : ""; }
  function tierCards(cta) {
    return TIERS.map(function (t) {
      return '<li class="tier' + (t.featured ? " featured" : "") + '">' + (t.featured ? '<span class="tier-flag">Best value</span>' : "") + '<h3>' + esc(t.name) + '</h3><p class="tier-price"><strong>' + esc(t.price) + '</strong> <span>' + esc(t.per) + '</span></p><p class="muted">' + esc(t.note) + '</p>' +
        '<ul class="ticks"><li>Every lesson in the library</li><li>New bake each month</li><li>Printable recipe cards</li></ul><a class="btn' + (t.featured ? "" : " ghost") + ' wide" href="' + cta + "?join=" + encodeURIComponent(t.id) + '">Join ' + esc(t.name.toLowerCase()) + "</a></li>";
    }).join("");
  }

  /* ---------- landing ---------- */
  var tl = $("[data-tiers]"); if (tl) tl.innerHTML = tierCards("account.html");

  /* ---------- account page ---------- */
  var acc = $("[data-account]");
  if (acc) {
    var qs = new URLSearchParams(location.search), gate = qs.get("gate"), next = qs.get("next") || "members/";
    if (!/^\/?members\//.test(next)) next = "members/";
    next = next.replace(/^\//, "");
    var join = TIERS.filter(function (t) { return t.id === qs.get("join"); })[0] || TIERS.filter(function (t) { return t.featured; })[0] || TIERS[0];
    var mode = qs.get("mode") === "login" || gate === "signin" ? "login" : "signup";
    var render = function (st) {
      if (st.signedIn) {
        var u = st.user || {};
        var pending = !st.member;
        var tPay = STRIPE ? "#card" : payUrl(join, u.email);
        acc.innerHTML = '<div class="acct"><p class="eyebrow">Your account</p><h1>' + (pending ? "Almost there" : "Welcome back") + ", " + esc(u.name || (u.email || "").split("@")[0]) + '.</h1>' +
          '<dl class="kv"><dt>Email</dt><dd>' + esc(u.email) + '</dd><dt>Membership</dt><dd>' + (pending ? '<span class="pill">Pending</span>' : '<span class="pill ok">Active</span>') + "</dd></dl>" +
          (pending ? '<p>Your account is set up. ' + (STRIPE ? "Finish joining by paying on Stripe’s secure page. Your access switches on automatically as soon as Stripe confirms the payment." : tPay ? "Finish joining by paying for your membership on Stripe’s secure page. Use the same email. The club then switches your access on (usually within a day)." : "The club hasn’t switched your access on yet. You’ll get an email once it has.") + "</p>" + (STRIPE ? '<button type="button" class="btn" data-card-pay>Pay ' + esc(join.price + " " + join.per) + " with card</button><p class=\"err\" data-pay-err role=\"alert\"></p>" : tPay ? '<a class="btn" href="' + esc(tPay) + '" rel="noopener">Pay ' + esc(join.price + " " + join.per) + " with Stripe</a>" : "")
            : '<a class="btn" href="' + esc(next) + '">Open the members area</a>') +
          (st.demo ? '<p class="demo-note">' + (st.live ? "<strong>Demo setting:</strong> every new account on this demo gets instant access. A real club approves members after payment." : "<strong>Preview mode:</strong> this account lives only in your browser. Real accounts and gating start once the site is published on Spawn.") + "</p>" : "") +
          '<button type="button" class="link" data-logout>Sign out</button></div>';
        return;
      }
      acc.innerHTML = '<div class="auth"><p class="eyebrow">' + (gate === "signin" ? "Members only" : "Join " + esc(CFG.business || "the club")) + '</p><h1>' + (mode === "login" ? "Sign in" : "Create your account") + '</h1>' +
        (gate === "signin" ? '<p class="muted">That page is for members. Sign in to continue.</p>' : mode === "signup" ? '<p class="muted">Plan: <strong>' + esc(join.name) + " · " + esc(join.price + " " + join.per) + "</strong>. " + (anyLink || STRIPE ? "You’ll pay on Stripe after creating your account." : "Demo — payments not connected, so nothing is charged.") + "</p>" : "") +
        '<form data-auth novalidate>' + (mode === "signup" ? '<label>Name<input name="name" autocomplete="name" placeholder="First name"></label>' : "") +
        '<label>Email<input name="email" type="email" autocomplete="email" required></label><label>Password<input name="password" type="password" autocomplete="' + (mode === "login" ? "current-password" : "new-password") + '" required minlength="8" placeholder="' + (mode === "login" ? "" : "8+ characters") + '"></label>' +
        '<p class="err" data-err role="alert"></p><button class="btn wide" type="submit">' + (mode === "login" ? "Sign in" : "Create account") + "</button></form>" +
        '<p class="muted small">' + (mode === "login" ? 'New here? <a href="?mode=signup' + (join ? "&join=" + join.id : "") + '">Create an account</a>' : 'Already a member? <a href="?mode=login&next=' + encodeURIComponent(next) + '">Sign in</a>') + "</p></div>";
    };
    var refresh = function () { return stripe.then(status).then(render).catch(function () { render({ signedIn: false }); }); };
    if (qs.get("paid") && qs.get("ref") && qs.get("session_id")) {
      acc.insertAdjacentHTML("beforebegin", '<p class="notice" data-pay-note role="status">Confirming your payment with Stripe…</p>');
      var tries = 0, poll = function () {
        fetch("/api/pay/status?ref=" + encodeURIComponent(qs.get("ref")) + "&session_id=" + encodeURIComponent(qs.get("session_id")), { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (x) {
          var n = $("[data-pay-note]");
          if (x && x.payment && x.payment.unlocked) { n.textContent = "Payment confirmed. Your membership is active."; refresh(); return; }
          if (++tries < 12) setTimeout(poll, 3000); else n.textContent = "Stripe hasn’t confirmed the payment yet. Refresh this page in a minute.";
        }).catch(function () {});
      }; poll();
    }
    if (qs.get("canceled")) acc.insertAdjacentHTML("beforebegin", '<p class="notice">Payment cancelled. Nothing was charged.</p>');
    if (gate === "pending") acc.insertAdjacentHTML("beforebegin", '<p class="notice">Your account doesn’t have members access yet.</p>');
    acc.addEventListener("submit", function (e) {
      e.preventDefault(); var f = e.target, err = $("[data-err]", f), btn = f.querySelector("button");
      var body = { email: f.email.value.trim(), password: f.password.value, name: f.name ? f.name.value.trim() : "" };
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) { err.textContent = "Enter a valid email."; return; }
      if (body.password.length < 8) { err.textContent = "Use at least 8 characters for your password."; return; }
      btn.disabled = true; err.textContent = "";
      live.then(function (isLive) {
        if (!isLive) { localStorage.setItem(DEMO_KEY, JSON.stringify({ email: body.email, name: body.name || body.email.split("@")[0] })); return; }
        return api("/api/auth/" + mode, body).catch(function (x) { throw new Error(/already registered/.test(x.message) ? "That email already has an account. Sign in instead." : /invalid credentials/.test(x.message) ? "Email or password doesn’t match." : x.message); });
      }).then(function () { return status(); }).then(function (st) {
        if (st.member && (gate || mode === "login" || !(anyLink || STRIPE))) location.href = next; else render(st);
      }).catch(function (x) { err.textContent = x.message; btn.disabled = false; });
    });
    acc.addEventListener("click", function (e) {
      var cp = e.target.closest("[data-card-pay]");
      if (cp) {
        cp.disabled = true;
        api("/api/pay/checkout", { kind: "membership", item: join.id, returnPath: location.pathname }).then(function (d) { location.href = d.url; })
          .catch(function (x) { cp.disabled = false; var pe = $("[data-pay-err]"); if (pe) pe.textContent = x.message; });
        return;
      }
      if (!e.target.closest("[data-logout]")) return;
      live.then(function (isLive) { if (!isLive) localStorage.removeItem(DEMO_KEY); else return api("/api/auth/logout"); }).then(function () { location.href = "account.html?mode=login"; });
    });
    refresh();
  }

  /* ---------- members area guard (preview only; on Spawn the server already gated this page) ---------- */
  if (document.documentElement.dataset.members != null) {
    status().then(function (st) {
      if (!st.member) { location.replace(ROOT + "account.html?gate=" + (st.signedIn ? "pending" : "signin") + "&next=" + encodeURIComponent(location.pathname.replace(/^.*?(members\/)/, "members/"))); return; }
      var who = $("[data-who]"); if (who && st.user) who.textContent = st.user.name || st.user.email;
      var pv = $("[data-preview]"); if (pv && !st.live) pv.hidden = false;
      document.documentElement.classList.add("ok");
    });
  }

  if (!anyLink) Array.prototype.forEach.call(document.querySelectorAll("[data-demo-banner]"), function (b) { b.hidden = false; });
  if (new URLSearchParams(location.search).get("paid") === "1") { var pb = $("[data-paid]"); if (pb) pb.hidden = false; }
  var tt = $("[data-theme-toggle]"); if (tt) tt.addEventListener("click", function () {
    var cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"), nx = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nx; try { localStorage.setItem("cc-theme", nx); } catch (_) {}
  });
})();
