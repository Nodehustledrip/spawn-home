(function () {
  var root = document.documentElement;
  var nav = document.querySelector("[data-nav]");
  addEventListener("scroll", function () { nav.classList.toggle("is-scrolled", scrollY > 8); }, { passive: true });

  document.querySelector("[data-theme-toggle]").addEventListener("click", function () {
    var dark = getComputedStyle(root).colorScheme.indexOf("dark") > -1;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("eo-theme", root.dataset.theme); } catch (e) {}
  });

  var io = "IntersectionObserver" in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
  }, { threshold: 0.12 }) : null;
  document.querySelectorAll(".reveal").forEach(function (el, i) {
    el.style.transitionDelay = (i % 4) * 80 + "ms";
    if (io) io.observe(el); else el.classList.add("in");
  });

  /* Menu tabs (arrow keys move between tabs) */
  var tabs = Array.prototype.slice.call(document.querySelectorAll("[data-tabs] [role=tab]"));
  function select(t) {
    tabs.forEach(function (x) {
      var on = x === t;
      x.setAttribute("aria-selected", on); x.tabIndex = on ? 0 : -1;
      var p = document.getElementById(x.getAttribute("aria-controls"));
      p.hidden = !on; p.classList.toggle("is-on", on);
    });
  }
  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { select(t); });
    t.addEventListener("keydown", function (e) {
      var d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return; e.preventDefault();
      var n = tabs[(i + d + tabs.length) % tabs.length]; select(n); n.focus();
    });
  });

  /* Hours: highlight today and show open/closed (edit HOURS to match the table above) */
  var HOURS = { 0: [11.5, 21], 1: null, 2: [17, 22], 3: [17, 22], 4: [17, 22], 5: [17, 23], 6: [11.5, 23] };
  var now = new Date(), d = now.getDay(), h = now.getHours() + now.getMinutes() / 60;
  var row = document.querySelector('[data-day="' + d + '"]'); if (row) row.classList.add("is-today");
  var open = HOURS[d] && h >= HOURS[d][0] && h < HOURS[d][1];
  var on = document.querySelector("[data-open-now]");
  on.textContent = open ? "Open now" : "Closed right now";
  on.style.setProperty("--dot", open ? "#4ade80" : "#9a8f80");

  /* Reservation request → shared backend /api/lead */
  var date = document.querySelector("[data-date]");
  date.min = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  var form = document.querySelector("[data-reserve]"), msg = document.querySelector("[data-msg]");
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    msg.className = "form-msg"; msg.textContent = "";
    if (!form.checkValidity()) {
      var bad = form.querySelector(":invalid"); msg.classList.add("err");
      msg.textContent = "Please add your " + (bad.name === "email" ? "email address" : bad.name) + ".";
      bad.focus(); return;
    }
    var f = new FormData(form), btn = form.querySelector("button[type=submit]");
    var body = { kind: "reservation", name: f.get("name"), email: f.get("email"), date: f.get("date"), time: f.get("time"), guests: f.get("guests"), company: f.get("company"),
      message: "Table request: " + f.get("guests") + " guests on " + f.get("date") + " at " + f.get("time") + (f.get("message") ? " — " + f.get("message") : "") };
    btn.disabled = true; btn.textContent = "Sending…";
    fetch("/api/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || j.ok === false) throw new Error(j.error || "Couldn’t send — try again."); }); })
      .then(function () { form.reset(); msg.classList.add("ok"); msg.textContent = "Request sent. We’ll email you to confirm your table."; })
      .catch(function (err) { msg.classList.add("err"); msg.textContent = err.message || "Couldn’t send — try again."; })
      .finally(function () { btn.disabled = false; btn.textContent = "Send request"; });
  });
})();
