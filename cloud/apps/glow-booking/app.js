(function () {
  "use strict";
  var C = window.SITE_CONFIG || {}; var PAY = C.payments || {}; var FULL = PAY.full || {};
  var SERVICES = [
    { id: "cut", name: "Cut & finish", desc: "Consult, precision cut, wash and blow-dry", mins: 60, price: 68, img: "cut", cat: "Hair" },
    { id: "color", name: "Gloss colour", desc: "Root refresh or all-over tone with gloss", mins: 120, price: 145, img: "color", cat: "Hair" },
    { id: "gloss", name: "Shine gloss", desc: "Tone and shine between colour visits", mins: 45, price: 55, img: "color", cat: "Hair" },
    { id: "facial", name: "Calm facial", desc: "Cleanse, enzyme peel, mask and massage", mins: 60, price: 95, img: "facial", cat: "Skin" },
    { id: "brows", name: "Brow shape & tint", desc: "Map, shape and tint to suit you", mins: 30, price: 35, img: "facial", cat: "Skin" },
    { id: "consult", name: "Free consultation", desc: "15 minutes to plan colour or skin care", mins: 15, price: 0, img: "hero", cat: "Any" }
  ];
  var STAFF = [
    { id: "any", name: "First available", role: "Whoever is free", img: null, does: ["cut", "color", "gloss", "facial", "brows", "consult"] },
    { id: "maya", name: "Maya", role: "Stylist · cuts & curls", img: "staff1", does: ["cut", "gloss", "consult"], days: [2, 3, 4, 5, 6] },
    { id: "theo", name: "Theo", role: "Esthetician · skin & brows", img: "staff2", does: ["facial", "brows", "consult"], days: [3, 4, 5, 6] },
    { id: "ines", name: "Inés", role: "Colourist · gloss & colour", img: "staff3", does: ["color", "gloss", "cut", "consult"], days: [2, 4, 5, 6] }
  ];
  var OPEN = { 2: [10, 19], 3: [10, 19], 4: [10, 20], 5: [10, 20], 6: [9, 17] }, STEP = 30, AHEAD = 28;
  var $ = function (s, r) { return (r || document).querySelector(s); }, $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var st = { svc: null, staff: "any", day: null, time: null, pay: null, monthOff: 0 };
  var money = function (n) { return n ? "$" + n : "Free"; };
  var fmtT = function (m) { var h = Math.floor(m / 60), mm = m % 60; return ((h + 11) % 12 + 1) + ":" + (mm < 10 ? "0" : "") + mm + (h >= 12 ? " pm" : " am"); };
  var key = function (d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var isLink = function (u) { return typeof u === "string" && /^https:\/\/(buy\.stripe\.com|checkout\.stripe\.com|donate\.stripe\.com)\//.test(u); };
  var svc = function () { return SERVICES.filter(function (s) { return s.id === st.svc; })[0]; };
  var staffBy = function (id) { return STAFF.filter(function (s) { return s.id === id; })[0]; };
  var pic = function (n, w, alt) { return '<img src="img/' + n + '-480.webp" alt="' + esc(alt || "") + '" width="480" height="' + (/staff/.test(n) ? 480 : 360) + '" loading="lazy" decoding="async">'; };

  /* Live backend? (published on Spawn). In a Build preview or opened as a file, run fully in the browser. */
  var live = null;
  function backend() {
    if (live) return live;
    live = fetch("/api/health", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : {}; }).then(function (d) { return d && d.hosting === "spawn-cloud"; }).catch(function () { return false; });
    return live;
  }
  /* Card payments: when the owner connects Stripe on spawnapp.org, checkout runs on the server and the booking
   * is marked paid only when Stripe confirms it. Prices then come from pricing.json (the server uses the same file). */
  var STRIPE = false, stripeReady = null;
  function stripeCheck() {
    if (stripeReady) return stripeReady;
    stripeReady = backend().then(function (isLive) {
      if (!isLive) return false;
      return fetch("/api/pay/config", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (c) {
        if (!c || !c.connected || !c.catalog) return false;
        return fetch("pricing.json", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (pj) {
          SERVICES.forEach(function (sv) { var it = pj.items && pj.items[sv.id]; if (it && typeof it.amount === "number") sv.price = it.amount / 100; });
          if (typeof pj.deposit === "number") C.depositAmount = pj.deposit / 100;
          STRIPE = true; return true;
        });
      });
    }).catch(function () { return false; });
    return stripeReady;
  }
  var payable = function (link) { return STRIPE || isLink(link); };

  /* ---------- 1. services ---------- */
  function renderServices() {
    $("[data-services]").innerHTML = SERVICES.map(function (s) {
      return '<button type="button" class="svc" role="radio" aria-checked="false" tabindex="-1" data-id="' + s.id + '">' + pic(s.img, 480, "") +
        '<span class="svc-body"><span class="svc-cat">' + esc(s.cat) + '</span><strong>' + esc(s.name) + '</strong><span class="svc-desc">' + esc(s.desc) + '</span>' +
        '<span class="svc-meta"><span>' + s.mins + ' min</span><span class="svc-price">' + money(s.price) + '</span></span></span></button>';
    }).join("");
    radioGroup($("[data-services]"), function (b) { st.svc = b.dataset.id; if (!staffOk(staffBy(st.staff))) st.staff = "any"; st.time = null; renderStaff(); renderCal(); renderTimes(); update(); });
  }
  function staffOk(p) { return p && (!st.svc || p.does.indexOf(st.svc) > -1); }
  /* ---------- 2. staff ---------- */
  function renderStaff() {
    $("[data-staff]").innerHTML = STAFF.map(function (p) {
      var ok = staffOk(p);
      return '<button type="button" class="who" role="radio" aria-checked="' + (st.staff === p.id) + '" tabindex="' + (st.staff === p.id ? 0 : -1) + '" data-id="' + p.id + '"' + (ok ? "" : " disabled") + '>' +
        (p.img ? '<img src="img/' + p.img + '-480.webp" alt="" width="96" height="96" loading="lazy" decoding="async">' : '<span class="who-any" aria-hidden="true">✦</span>') +
        '<strong>' + esc(p.name) + '</strong><span>' + esc(ok ? p.role : "Doesn’t offer this service") + '</span></button>';
    }).join("");
  }
  /* Deterministic "booked" slots so the demo calendar looks lived-in without fake data claims. */
  function busy(staffId, dk, m) { var s = staffId + dk + m, h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 100 < 34; }
  function workers(day) { return STAFF.filter(function (p) { return p.id !== "any" && staffOk(p) && p.days.indexOf(day.getDay()) > -1; }); }
  function slots(day) {
    var o = OPEN[day.getDay()]; if (!o || !st.svc) return [];
    var who = st.staff === "any" ? workers(day) : [staffBy(st.staff)].filter(function (p) { return p.days.indexOf(day.getDay()) > -1; });
    var dur = svc().mins, out = [], now = new Date(), dk = key(day);
    for (var m = o[0] * 60; m + dur <= o[1] * 60; m += STEP) {
      if (key(now) === dk && m <= now.getHours() * 60 + now.getMinutes() + 60) continue;
      var free = who.filter(function (p) { return !busy(p.id, dk, m); });
      if (free.length) out.push({ m: m, by: free[0].id });
    }
    return out;
  }
  /* ---------- 3. calendar ---------- */
  function renderCal() {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var first = new Date(today.getFullYear(), today.getMonth() + st.monthOff, 1);
    var last = new Date(today); last.setDate(last.getDate() + AHEAD);
    $("[data-month]").textContent = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    $("[data-prev]").disabled = st.monthOff <= 0;
    $("[data-next]").disabled = new Date(first.getFullYear(), first.getMonth() + 1, 1) > last;
    var html = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(function (d) { return '<span class="dow" aria-hidden="true">' + d + "</span>"; });
    var lead = (first.getDay() + 6) % 7; for (var i = 0; i < lead; i++) html.push('<span aria-hidden="true"></span>');
    var dim = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    for (var d = 1; d <= dim; d++) {
      var day = new Date(first.getFullYear(), first.getMonth(), d), k = key(day);
      var inRange = day >= today && day <= last, n = inRange ? slots(day).length : 0, on = st.day === k;
      var label = day.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) + (inRange ? (OPEN[day.getDay()] ? (st.svc ? ", " + n + " times free" : "") : ", closed") : "");
      html.push('<button type="button" class="day' + (on ? " on" : "") + (n ? "" : " none") + '" data-day="' + k + '" aria-pressed="' + on + '" aria-label="' + esc(label) + '"' + (inRange && (n || !st.svc) && OPEN[day.getDay()] ? "" : " disabled") + '>' + d + (st.svc && n ? '<i style="--f:' + Math.min(1, n / 10) + '"></i>' : "") + "</button>");
    }
    $("[data-cal]").innerHTML = html.join("");
  }
  /* ---------- times ---------- */
  function renderTimes() {
    var box = $("[data-times]"), hint = $("[data-times-hint]");
    if (!st.svc || !st.day) { box.innerHTML = ""; hint.textContent = !st.svc ? "Choose a service first." : "Pick a day to see open times."; return; }
    var p = st.day.split("-"), day = new Date(+p[0], +p[1] - 1, +p[2]), list = slots(day);
    hint.textContent = list.length ? day.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) + " · " + list.length + " open" : "No open times that day — try another.";
    var groups = { Morning: [], Afternoon: [], Evening: [] };
    list.forEach(function (s) { (s.m < 720 ? groups.Morning : s.m < 1020 ? groups.Afternoon : groups.Evening).push(s); });
    box.innerHTML = Object.keys(groups).filter(function (g) { return groups[g].length; }).map(function (g) {
      return '<div class="tgroup"><span class="tlabel">' + g + '</span><div class="tlist">' + groups[g].map(function (s) {
        var on = st.time && st.time.m === s.m;
        return '<button type="button" class="slot' + (on ? " on" : "") + '" aria-pressed="' + !!on + '" data-m="' + s.m + '" data-by="' + s.by + '">' + fmtT(s.m) + "</button>";
      }).join("") + "</div></div>";
    }).join("");
  }
  /* ---------- payment options ---------- */
  function renderPay() {
    var s = svc(), box = $("[data-pay]");
    if (!s) { box.innerHTML = '<p class="muted">Choose a service to see payment options.</p>'; return; }
    var opts = [];
    if (s.price === 0) opts.push({ id: "none", t: "Nothing to pay", d: "Consultations are free." });
    else {
      opts.push({ id: "deposit", t: "Pay $" + (C.depositAmount || 20) + " deposit now", d: "Holds your time. The rest is paid at the studio.", link: PAY.deposit });
      opts.push({ id: "full", t: "Pay $" + s.price + " in full now", d: "Nothing to pay on the day.", link: FULL[s.id] });
      if (C.allowPayLater !== false) opts.push({ id: "later", t: "Pay at the studio", d: "Card or cash after your visit." });
    }
    if (!opts.some(function (o) { return o.id === st.pay; })) st.pay = opts[0].id;
    box.innerHTML = opts.map(function (o) {
      var demo = (o.id === "deposit" || o.id === "full") && !payable(o.link);
      return '<label class="pay-opt"><input type="radio" name="pay" value="' + o.id + '"' + (st.pay === o.id ? " checked" : "") + '><span><strong>' + esc(o.t) + '</strong><small>' + esc(o.d) + (demo ? ' <em class="demo-chip">Demo — payments not connected</em>' : "") + "</small></span></label>";
    }).join("");
  }
  /* ---------- summary ---------- */
  function update() {
    var s = svc(), p = st.time ? staffBy(st.time.by) : null;
    $$("[data-step]").forEach(function (el) {
      var n = +el.dataset.step; el.classList.toggle("ok", n === 1 ? !!s : n === 2 ? !!s : n === 3 ? !!st.time : false);
    });
    var rows = [];
    rows.push(["Service", s ? s.name + " · " + s.mins + " min" : "—"]);
    rows.push(["With", st.time ? p.name + (st.staff === "any" ? " (first available)" : "") : st.staff !== "any" ? staffBy(st.staff).name : "First available"]);
    if (st.day && st.time) { var q = st.day.split("-"); rows.push(["When", new Date(+q[0], +q[1] - 1, +q[2]).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) + " · " + fmtT(st.time.m)]); }
    else rows.push(["When", "—"]);
    $("[data-sum]").innerHTML = rows.map(function (r) { return "<div><dt>" + r[0] + "</dt><dd>" + esc(r[1]) + "</dd></div>"; }).join("");
    var due = !s ? 0 : st.pay === "deposit" ? Math.min(s.price, C.depositAmount || 20) : st.pay === "full" ? s.price : 0;
    $("[data-total]").textContent = s ? money(s.price) : "—";
    $("[data-due]").textContent = s ? (due ? "$" + due + " today" : "$0 today") : "—";
    var ready = !!(s && st.time);
    $("[data-submit]").disabled = !ready;
    $("[data-submit]").textContent = !ready ? "Pick a service and time" : due && payable(st.pay === "deposit" ? PAY.deposit : FULL[s.id]) ? "Continue to secure payment" : "Request booking";
    var m = $("[data-mobile-bar]"); if (m) { m.hidden = !s; $("[data-mobile-sum]").textContent = s ? s.name + (st.time ? " · " + fmtT(st.time.m) : "") : ""; }
  }

  function radioGroup(box, pick) {
    box.addEventListener("click", function (e) { var b = e.target.closest("[role=radio]"); if (!b || b.disabled) return; $$("[role=radio]", box).forEach(function (x) { var on = x === b; x.setAttribute("aria-checked", on); x.tabIndex = on ? 0 : -1; }); pick(b); });
    box.addEventListener("keydown", function (e) {
      var d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]; if (!d) return;
      var all = $$("[role=radio]:not(:disabled)", box), i = all.indexOf(document.activeElement); if (i < 0) return;
      e.preventDefault(); var n = all[(i + d + all.length) % all.length]; n.focus(); n.click();
    });
    var f = $("[role=radio]", box); if (f) f.tabIndex = 0;
  }

  function ref() { var c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", s = "GS-"; for (var i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)]; return s; }

  function submit(e) {
    e.preventDefault();
    var f = e.target, s = svc(); if (!s || !st.time) return;
    if (!f.reportValidity()) return;
    var p = staffBy(st.time.by), q = st.day.split("-"), when = new Date(+q[0], +q[1] - 1, +q[2]);
    var link = st.pay === "deposit" ? PAY.deposit : st.pay === "full" ? FULL[s.id] : null, payNow = !!link && isLink(link);
    var cardNow = STRIPE && s.price > 0 && (st.pay === "deposit" || st.pay === "full");
    var booking = {
      ref: ref(), service: s.name, serviceId: s.id, minutes: s.mins, price: s.price, staff: p.name, date: st.day, time: fmtT(st.time.m),
      payment: st.pay, name: f.name.value.trim(), email: f.email.value.trim(), phone: f.phone.value.trim(), message: f.notes.value.trim(),
      title: "Booking " + st.day + " " + fmtT(st.time.m) + " — " + s.name
    };
    var btn = $("[data-submit]"); btn.disabled = true; btn.textContent = "Saving…";
    backend().then(function (isLive) {
      var save = isLive ? fetch("/api/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(booking) }).then(function (r) { return r.json(); }) : Promise.resolve({ ok: true, demo: true });
      return save.then(function (d) {
        if (!d.ok) throw new Error(d.error || "Couldn’t save the booking.");
        try { sessionStorage.setItem("gs-last", JSON.stringify(booking)); } catch (_) {}
        if (cardNow) {
          return fetch("/api/pay/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
            kind: "booking", item: s.id, option: st.pay, ref: booking.ref, email: booking.email, name: booking.name, returnPath: location.pathname,
            details: { date: booking.date, time: booking.time, staff: booking.staff, phone: booking.phone } }) })
            .then(function (r) { return r.json(); }).then(function (x) { if (!x.ok || !x.url) throw new Error(x.error || "Couldn’t start the payment."); showHandoff(booking, x.url); });
        }
        if (payNow) {
          var u = new URL(link); u.searchParams.set("client_reference_id", booking.ref); if (booking.email) u.searchParams.set("prefilled_email", booking.email);
          showHandoff(booking, u.toString()); return;
        }
        confirmView(booking, { live: isLive, demoPay: (st.pay === "deposit" || st.pay === "full") && !payNow });
      });
    }).catch(function (err) { btn.disabled = false; update(); toast(err.message || "Network error — try again."); });
  }

  function showHandoff(b, url) {
    $("[data-flow]").hidden = true; var v = $("[data-confirm]"); v.hidden = false;
    v.innerHTML = '<div class="done-card"><span class="done-icon pay" aria-hidden="true">→</span><h2>Taking you to secure payment</h2><p>Your booking <strong>' + esc(b.ref) + '</strong> is saved. Payment is handled by Stripe on its own secure page.</p><a class="btn" href="' + esc(url) + '" data-go>Continue to payment</a><p class="muted small">Not redirected? Use the button above.</p></div>';
    setTimeout(function () { location.href = url; }, 1200);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function confirmView(b, o) {
    $("[data-flow]").hidden = true; var v = $("[data-confirm]"); v.hidden = false;
    var ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Glow Studio//EN\r\nBEGIN:VEVENT\r\nUID:" + b.ref + "@glow\r\nDTSTART:" + b.date.replace(/-/g, "") + "T" + toHM(b.time) + "00\r\nDURATION:PT" + b.minutes + "M\r\nSUMMARY:" + b.service + " at " + (C.business || "Glow Studio") + "\r\nEND:VEVENT\r\nEND:VCALENDAR";
    v.innerHTML = '<div class="done-card">' +
      (o.confirmed ? '<p class="banner ok" data-pay-status>Payment received: $' + esc((o.confirmed.paid / 100).toFixed(2).replace(/\.00$/, "")) + (o.confirmed.option === "deposit" ? " deposit" : "") + '. Stripe emails your receipt.</p>' : "") +
      (o.waiting ? '<p class="banner demo" data-pay-status>We’re waiting for Stripe to confirm your payment. This page updates on its own.</p>' : "") +
      (o.paid && !o.confirmed && !o.waiting ? '<p class="banner ok">Stripe sent you back here after checkout — your receipt comes from Stripe by email.</p>' : "") +
      (o.demoPay ? '<p class="banner demo" role="note"><strong>Demo — payments not connected.</strong> Nothing was charged. The owner connects their own Stripe account to take payments.</p>' : "") +
      (!o.live && !o.paid ? '<p class="banner demo" role="note">Preview mode: this booking stays in your browser. Once published on Spawn, requests are saved for the owner.</p>' : "") +
      '<span class="done-icon" aria-hidden="true">✓</span><h2>Request sent, ' + esc((b.name || "").split(" ")[0] || "friend") + '.</h2>' +
      '<p>The studio will confirm your time by email, usually within a few hours.</p>' +
      '<dl class="sum done-sum"><div><dt>Reference</dt><dd>' + esc(b.ref) + '</dd></div><div><dt>Service</dt><dd>' + esc(b.service) + '</dd></div><div><dt>With</dt><dd>' + esc(b.staff) + '</dd></div><div><dt>When</dt><dd>' + esc(b.date + " · " + b.time) + '</dd></div><div><dt>Payment</dt><dd>' + esc({ deposit: "Deposit", full: "Paid in full", later: "Pay at the studio", none: "Free" }[b.payment] || b.payment) + "</dd></div></dl>" +
      '<div class="done-actions"><a class="btn" download="glow-booking.ics" href="data:text/calendar;charset=utf-8,' + encodeURIComponent(ics) + '">Add to calendar</a><a class="btn ghost" href="./">Book something else</a></div></div>';
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function toHM(t) { var m = /(\d+):(\d+) (am|pm)/.exec(t); var h = +m[1] % 12 + (m[3] === "pm" ? 12 : 0); return ("0" + h).slice(-2) + m[2]; }
  function toast(msg) { var t = $("[data-toast]"); t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(function () { t.hidden = true; }, 4200); }

  function init() {
    renderServices(); renderStaff(); renderCal(); renderTimes(); renderPay(); update();
    radioGroup($("[data-staff]"), function (b) { st.staff = b.dataset.id; st.time = null; renderCal(); renderTimes(); update(); });
    $("[data-cal]").addEventListener("click", function (e) { var b = e.target.closest("[data-day]"); if (!b || b.disabled) return; st.day = b.dataset.day; st.time = null; renderCal(); renderTimes(); update(); });
    $("[data-prev]").addEventListener("click", function () { st.monthOff = Math.max(0, st.monthOff - 1); renderCal(); });
    $("[data-next]").addEventListener("click", function () { st.monthOff++; renderCal(); });
    $("[data-times]").addEventListener("click", function (e) { var b = e.target.closest("[data-m]"); if (!b) return; st.time = { m: +b.dataset.m, by: b.dataset.by }; renderTimes(); update(); });
    $("[data-services]").addEventListener("click", function () { renderPay(); update(); });
    $("[data-pay]").addEventListener("change", function (e) { st.pay = e.target.value; update(); });
    $("[data-form]").addEventListener("submit", submit);
    var mb = $("[data-mobile-go]"); if (mb) mb.addEventListener("click", function () { $("#summary").scrollIntoView({ behavior: "smooth" }); });
    var tt = $("[data-theme-toggle]"); if (tt) tt.addEventListener("click", function () {
      var cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"), nx = cur === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = nx; try { localStorage.setItem("gs-theme", nx); } catch (_) {}
    });
    /* Back from Stripe: configure your Payment Link's confirmation page to redirect to https://<your-site>/?paid=1 */
    var qs = new URLSearchParams(location.search);
    if (qs.get("paid")) {
      var last = null; try { last = JSON.parse(sessionStorage.getItem("gs-last") || "null"); } catch (_) {}
      if (qs.get("session_id") && qs.get("ref")) {
        var tries = 0, poll = function () {
          fetch("/api/pay/status?ref=" + encodeURIComponent(qs.get("ref")) + "&session_id=" + encodeURIComponent(qs.get("session_id")), { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (x) {
            var p = x && x.payment; var b = last && last.ref === qs.get("ref") ? last : { ref: qs.get("ref"), service: "Your booking", staff: "—", date: "", time: "", minutes: 60, payment: p && p.option || "deposit", name: "" };
            if (p && p.unlocked) return confirmView(b, { live: true, paid: true, confirmed: p });
            confirmView(b, { live: true, paid: true, waiting: true }); if (++tries < 10) setTimeout(poll, 3000);
          }).catch(function () {});
        }; poll();
      } else if (last) confirmView(last, { live: true, paid: true });
    }
    if (qs.get("canceled")) toast("Payment cancelled — your booking request is saved, and you can pay at the studio.");
    stripeCheck().then(function (on) { if (on) { renderServices(); renderPay(); update(); var b = $("[data-demo-banner]"); if (b) b.hidden = true; } });
    backend().then(function (isLive) { var d = $("[data-mode]"); if (d && !isLive) d.hidden = false; });
    if (!isLink(PAY.deposit) && !Object.keys(FULL).some(function (k) { return isLink(FULL[k]); })) stripeCheck().then(function (on) { var b = $("[data-demo-banner]"); if (b) b.hidden = on; });
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (es) { es.forEach(function (x) { if (x.isIntersecting) { x.target.classList.add("in"); io.unobserve(x.target); } }); }, { rootMargin: "0px 0px -8% 0px" });
      $$(".reveal").forEach(function (el) { io.observe(el); });
    } else $$(".reveal").forEach(function (el) { el.classList.add("in"); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
