(function () {
  /* Set your launch moment here (ISO 8601 with timezone). */
  var LAUNCH = new Date("2027-02-01T17:00:00Z");
  var $ = function (s) { return document.querySelector(s); };

  /* Countdown */
  var els = { d: $("[data-d]"), h: $("[data-h]"), m: $("[data-m]"), s: $("[data-s]") };
  $("[data-count-note]").textContent = "Launching " + LAUNCH.toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function tick() {
    var t = Math.max(0, LAUNCH - Date.now()), v = { d: Math.floor(t / 864e5), h: Math.floor(t / 36e5) % 24, m: Math.floor(t / 6e4) % 60, s: Math.floor(t / 1e3) % 60 };
    Object.keys(v).forEach(function (k) { var txt = k === "d" ? String(v[k]).padStart(2, "0") : pad(v[k]); if (els[k].textContent !== txt) { els[k].textContent = txt; els[k].classList.remove("tick"); void els[k].offsetWidth; els[k].classList.add("tick"); } });
    if (!t) { $("[data-count-note]").textContent = "We’re live — invites are going out now."; return; }
    setTimeout(tick, 1000 - (Date.now() % 1000));
  }
  tick();

  /* Referral: who sent this visitor? (?ref=CODE is remembered for this browser) */
  var params = new URLSearchParams(location.search), incoming = params.get("ref");
  try { if (incoming && /^[a-z0-9]{4,16}$/i.test(incoming)) localStorage.setItem("lw-ref-from", incoming); incoming = localStorage.getItem("lw-ref-from"); } catch (e) {}

  function codeFor(email) { var h = 2166136261; for (var i = 0; i < email.length; i++) { h ^= email.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  function post(url, body) {
    return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok && j.ok !== false, status: r.status, j: j }; }); });
  }

  function showRef(email) {
    var code = codeFor(email), link = location.origin + location.pathname + "?ref=" + code;
    $("[data-ref-link]").value = link;
    var text = "I just joined the Pocketbook waitlist — shared budgets without the awkward. Join with my link:";
    $("[data-x]").href = "https://x.com/intent/post?text=" + encodeURIComponent(text) + "&url=" + encodeURIComponent(link);
    $("[data-mail]").href = "mailto:?subject=" + encodeURIComponent("Join me on the Pocketbook waitlist") + "&body=" + encodeURIComponent(text + "\n\n" + link);
    var sh = $("[data-share]"); if (!navigator.share) sh.hidden = true;
    sh.onclick = function () { navigator.share({ title: "Pocketbook", text: text, url: link }).catch(function () {}); };
    $("[data-ref-note]").textContent = "Your code is " + code + ". Signed up as " + email + ".";
    $("[data-join]").hidden = true; $("[data-ref]").hidden = false;
  }
  $("[data-copy]").addEventListener("click", function () {
    var b = this, inp = $("[data-ref-link]");
    (navigator.clipboard ? navigator.clipboard.writeText(inp.value) : Promise.reject()).catch(function () { inp.select(); document.execCommand("copy"); })
      .then(function () { b.textContent = "Copied ✓"; setTimeout(function () { b.textContent = "Copy"; }, 1600); });
  });

  try { var saved = localStorage.getItem("lw-joined"); if (saved) showRef(saved); } catch (e) {}

  /* Join → shared backend: /api/subscribe for the list, /api/lead to record the referral */
  var form = $("[data-join]"), msg = $("[data-msg]");
  form.addEventListener("submit", function (e) {
    e.preventDefault(); msg.className = "msg"; msg.textContent = "";
    var email = form.email.value.trim().toLowerCase();
    if (!form.checkValidity() || !email) { msg.classList.add("err"); msg.textContent = "Enter a valid email address."; form.classList.remove("shake"); void form.offsetWidth; form.classList.add("shake"); form.email.focus(); return; }
    if (form.company.value) return;
    var btn = form.querySelector("button"); btn.disabled = true; btn.textContent = "Joining…";
    var extra = { kind: "waitlist", email: email, refCode: codeFor(email), referredBy: incoming || "", message: "Waitlist signup" + (incoming ? " (referred by " + incoming + ")" : "") };
    post("/api/subscribe", { email: email })
      .then(function (r) {
        if (r.ok) return incoming ? post("/api/lead", extra).catch(function () {}) : null;
        if (r.status === 404 || r.status === 405) return post("/api/lead", extra).then(function (x) { if (!x.ok) throw new Error(x.j.error || "Couldn’t join — try again."); });
        throw new Error(r.j.error || "Couldn’t join — try again.");
      })
      .then(function () { try { localStorage.setItem("lw-joined", email); } catch (e) {} showRef(email); })
      .catch(function (err) { msg.classList.add("err"); msg.textContent = err.message; })
      .finally(function () { btn.disabled = false; btn.textContent = "Join the waitlist"; });
  });

  var root = document.documentElement;
  $("[data-theme-toggle]").addEventListener("click", function () { root.dataset.theme = getComputedStyle(root).colorScheme.indexOf("dark") > -1 ? "light" : "dark"; try { localStorage.setItem("lw-theme", root.dataset.theme); } catch (e) {} });
})();
