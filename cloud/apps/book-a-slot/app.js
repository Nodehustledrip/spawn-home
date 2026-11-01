(function () {
  /* Edit these to match your business. */
  var SERVICES = [
    { id: "cut", name: "Signature cut", desc: "Consult, cut, wash and style", mins: 45, price: 38 },
    { id: "fade", name: "Skin fade", desc: "Clipper fade, detailed finish", mins: 45, price: 42 },
    { id: "beard", name: "Beard sculpt", desc: "Shape, line-up, hot towel", mins: 30, price: 24 },
    { id: "combo", name: "Cut + beard", desc: "The full refresh", mins: 75, price: 58 }
  ];
  var OPEN = { 2: [9, 19], 3: [9, 19], 4: [9, 19], 5: [9, 19], 6: [9, 17] }; // weekday → [open, close] (24h); others closed
  var DAYS_AHEAD = 21, STEP = 30;

  var $ = function (s) { return document.querySelector(s); }, $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var state = { svc: null, day: null, time: null };
  var money = function (n) { return "$" + n; };
  var fmtT = function (m) { var h = Math.floor(m / 60), mm = m % 60, ap = h >= 12 ? "pm" : "am"; return ((h + 11) % 12 + 1) + ":" + (mm < 10 ? "0" : "") + mm + " " + ap; };
  var key = function (d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); };

  /* Radio-group helper with arrow-key support */
  function radio(container, items, onPick) {
    container.addEventListener("click", function (e) { var b = e.target.closest("[role=radio]"); if (b && !b.disabled) onPick(b); });
    container.addEventListener("keydown", function (e) {
      var d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]; if (!d) return;
      var all = $$("#" + container.id + " [role=radio]:not(:disabled)"); if (!container.id) all = Array.prototype.slice.call(container.querySelectorAll("[role=radio]:not(:disabled)"));
      var i = all.indexOf(document.activeElement); if (i < 0) return; e.preventDefault();
      var n = all[(i + d + all.length) % all.length]; n.focus(); onPick(n);
    });
  }
  function check(container, btn) {
    container.querySelectorAll("[role=radio]").forEach(function (b) { var on = b === btn; b.setAttribute("aria-checked", on); b.tabIndex = on ? 0 : -1; });
  }

  /* Services */
  var sv = $("[data-services]");
  sv.innerHTML = SERVICES.map(function (s, i) { return '<button type="button" role="radio" class="svc" aria-checked="false" tabindex="' + (i ? -1 : 0) + '" data-id="' + s.id + '"><b>' + s.name + "</b><small>" + s.desc + '</small><span class="row"><span>' + s.mins + " min</span><strong>" + money(s.price) + "</strong></span></button>"; }).join("");
  radio(sv, null, function (b) { check(sv, b); state.svc = SERVICES.filter(function (s) { return s.id === b.dataset.id; })[0]; state.time = null; renderSlots(); update(); });

  /* Days */
  var dv = $("[data-days]"), today = new Date(); today.setHours(0, 0, 0, 0);
  var days = [];
  for (var i = 0; i < DAYS_AHEAD; i++) { var d = new Date(today); d.setDate(today.getDate() + i); days.push(d); }
  dv.innerHTML = days.map(function (d) {
    var closed = !OPEN[d.getDay()];
    return '<button type="button" role="radio" class="day" aria-checked="false" tabindex="-1" data-k="' + key(d) + '"' + (closed ? " disabled" : "") + ' aria-label="' + d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) + (closed ? ", closed" : "") + '"><span>' + (key(d) === key(today) ? "Today" : d.toLocaleDateString(undefined, { weekday: "short" })) + "</span><b>" + d.getDate() + "</b><span>" + d.toLocaleDateString(undefined, { month: "short" }) + "</span></button>";
  }).join("");
  var firstOpen = dv.querySelector(".day:not(:disabled)"); if (firstOpen) firstOpen.tabIndex = 0;
  radio(dv, null, function (b) { check(dv, b); state.day = days.filter(function (d) { return key(d) === b.dataset.k; })[0]; state.time = null; renderSlots(); update(); });
  $$("[data-scroll]").forEach(function (b) { b.addEventListener("click", function () { dv.scrollBy({ left: +b.dataset.scroll * 320 }); }); });

  /* Deterministic example "busy" slots so the demo looks realistic but stable per day */
  function busy(dk, m) { var h = 0, s = dk + ":" + m; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 4 === 0; }

  function renderSlots() {
    ["am", "pm", "eve"].forEach(function (g) { $('[data-slots="' + g + '"]').innerHTML = ""; });
    var groups = { am: [], pm: [], eve: [] };
    if (state.day) {
      var o = OPEN[state.day.getDay()], dur = state.svc ? state.svc.mins : 30, now = new Date();
      for (var m = o[0] * 60; m + dur <= o[1] * 60; m += STEP) {
        var past = key(state.day) === key(now) && m <= now.getHours() * 60 + now.getMinutes() + 30;
        groups[m < 720 ? "am" : m < 1020 ? "pm" : "eve"].push({ m: m, off: past || busy(key(state.day), m) });
      }
    }
    Object.keys(groups).forEach(function (g) {
      var el = $('[data-slots="' + g + '"]');
      el.parentNode.hidden = state.day && !groups[g].length;
      el.setAttribute("role", "radiogroup"); el.setAttribute("aria-label", { am: "Morning", pm: "Afternoon", eve: "Evening" }[g] + " times");
      el.innerHTML = groups[g].map(function (s) { return '<button type="button" role="radio" class="slot" aria-checked="false" tabindex="-1" data-m="' + s.m + '"' + (s.off ? ' disabled aria-label="' + fmtT(s.m) + ', unavailable"' : "") + ">" + fmtT(s.m) + "</button>"; }).join("");
      var f = el.querySelector(".slot:not(:disabled)"); if (f) f.tabIndex = 0;
      el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop");
    });
    if (!state.day) $('[data-slots="am"]').innerHTML = '<p class="empty">Pick a day to see open times.</p>';
    else if (!$$(".slot:not(:disabled)").length) $('[data-slots="am"]').innerHTML = '<p class="empty">No open times left this day — try another.</p>';
  }
  ["am", "pm", "eve"].forEach(function (g) {
    var el = $('[data-slots="' + g + '"]');
    radio(el, null, function (b) { $$(".slot").forEach(function (x) { x.setAttribute("aria-checked", x === b); }); state.time = +b.dataset.m; update(); });
  });

  /* Summary */
  function set(sel, v) { var el = $(sel); if (el.textContent !== v) { el.textContent = v; el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); } }
  function ready() { return state.svc && state.day && state.time != null; }
  function update() {
    set("[data-sum-service]", state.svc ? state.svc.name : "—");
    set("[data-sum-day]", state.day ? state.day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "—");
    set("[data-sum-time]", state.time != null ? fmtT(state.time) + " – " + fmtT(state.time + state.svc.mins) : "—");
    set("[data-sum-dur]", state.svc ? state.svc.mins + " min" : "—");
    $("[data-sum-total]").textContent = money(state.svc ? state.svc.price : 0);
    $("[data-m-total]").textContent = money(state.svc ? state.svc.price : 0);
    var label = !state.svc ? "Choose a service" : !state.day ? "Pick a day" : state.time == null ? "Pick a time" : "Send booking request";
    $$("[data-submit]").forEach(function (b) { b.disabled = !ready(); b.textContent = b.closest(".mbar") ? (ready() ? "Request" : "Next") : label; });
    $("[data-m-line]").textContent = ready() ? state.svc.name + " · " + $("[data-sum-day]").textContent + " · " + fmtT(state.time) : label;
    $$(".step").forEach(function (s, i) { s.classList.toggle("ok", [state.svc, state.day, state.time != null][i] ? true : false); });
  }

  /* Submit → shared backend /api/lead */
  var form = $("[data-form]"), msg = $("[data-msg]");
  function submit() {
    msg.textContent = "";
    if (!ready()) return;
    if (!form.checkValidity()) { var bad = form.querySelector(":invalid"); msg.textContent = bad.name === "email" ? "Add a valid email so we can confirm." : "Add your name in step 4."; bad.scrollIntoView({ behavior: "smooth", block: "center" }); bad.focus({ preventScroll: true }); return; }
    var f = new FormData(form), when = $("[data-sum-day]").textContent + " " + fmtT(state.time);
    $$("[data-submit]").forEach(function (b) { b.disabled = true; b.textContent = "Sending…"; });
    fetch("/api/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "booking-request", name: f.get("name"), email: f.get("email"), phone: f.get("phone"), company: f.get("company"), service: state.svc.name, date: key(state.day), time: fmtT(state.time), price: state.svc.price,
      message: "Booking request: " + state.svc.name + " (" + state.svc.mins + " min, " + money(state.svc.price) + ") on " + when + (f.get("message") ? " — " + f.get("message") : "") }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || j.ok === false) throw new Error(j.error || "Couldn’t send — please try again."); }); })
      .then(function () {
        $(".booker").hidden = true; $(".intro").hidden = true; $("[data-mbar]").hidden = true;
        $("[data-done-text]").textContent = state.svc.name + " · " + when + ". We’ll email " + f.get("email") + " to confirm.";
        var d = $("[data-done]"); d.hidden = false; d.focus(); scrollTo({ top: 0, behavior: "smooth" });
      })
      .catch(function (e) { msg.textContent = e.message; })
      .finally(function () { update(); });
  }
  $$("[data-submit]").forEach(function (b) { b.addEventListener("click", submit); });
  $("[data-again]").addEventListener("click", function () { location.reload(); });

  /* Hide mobile bar while the summary card is on screen */
  var bar = $("[data-mbar]");
  if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { bar.classList.toggle("away", es[0].isIntersecting); }).observe($(".sum-card"));

  var root = document.documentElement;
  $("[data-theme-toggle]").addEventListener("click", function () { root.dataset.theme = getComputedStyle(root).colorScheme.indexOf("dark") > -1 ? "light" : "dark"; try { localStorage.setItem("bs-theme", root.dataset.theme); } catch (e) {} });

  renderSlots(); update();
})();
