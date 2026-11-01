(function () {
  /* Example projects — edit this list to add your own work. */
  var P = [
    { t: "Tidewater Coffee", k: "brand", kind: "Brand identity", yr: "Example", role: "Identity, packaging", time: "6 weeks",
      bg: "linear-gradient(135deg,#0f3d3e,#1f6f66)", art: "mark", c1: "#f2d7a6", c2: "#e86a3a", glyph: "T",
      ch: "A roaster opening its first café needed an identity that worked on a cup sleeve, a sign and a website.",
      ap: "A tidal wordmark, a warm two-colour palette and a modular label system for single-origin bags.",
      out: "A compact guideline document and print-ready templates the team now updates in-house." },
    { t: "Ledgerly", k: "product", kind: "Product design", yr: "Example", role: "UX, UI, design system", time: "10 weeks",
      bg: "linear-gradient(160deg,#1b1640,#4b3bd1)", art: "ui", c1: "#ffffff", c2: "#b6f36b",
      ch: "Freelancers were losing track of invoices across spreadsheets and email threads.",
      ap: "Mapped the billing flow end to end, then designed a calm dashboard and a three-step invoice builder.",
      out: "A component library and clickable prototype used to guide engineering through launch." },
    { t: "Field Notes Journal", k: "web", kind: "Website", yr: "Example", role: "Art direction, web", time: "5 weeks",
      bg: "linear-gradient(160deg,#efe6d6,#d9c7a8)", art: "web", c1: "#2b2a26", c2: "#c4572f",
      ch: "An independent publication wanted long reads to feel like print without losing speed on mobile.",
      ap: "An editorial grid, generous type scale and image treatments that load progressively.",
      out: "A responsive template system for features, interviews and photo essays." },
    { t: "Halo Health", k: "product", kind: "Mobile app", yr: "Example", role: "Product design", time: "8 weeks",
      bg: "linear-gradient(160deg,#ffd3c4,#ff8f8f)", art: "phone", c1: "#ffffff", c2: "#2b1a3d",
      ch: "Booking a clinic appointment took too many steps and lost people halfway.",
      ap: "Reduced booking to a single scrolling screen with clear availability and gentle reminders.",
      out: "A tested flow and handoff specs ready for the iOS and Android teams." },
    { t: "Kinfolk Bikes", k: "brand", kind: "Brand refresh", yr: "Example", role: "Identity, signage", time: "4 weeks",
      bg: "linear-gradient(160deg,#151515,#2c2c2c)", art: "mark", c1: "#ffd23f", c2: "#ffffff", glyph: "K",
      ch: "A family-run bike shop outgrew a logo drawn decades ago.",
      ap: "Kept the spirit of the original, redrew it for clarity at small sizes and paired it with a bold yellow.",
      out: "New storefront signage, service tags and a simple social kit." },
    { t: "Atlas Studio Site", k: "web", kind: "Marketing site", yr: "Example", role: "Design, build", time: "6 weeks",
      bg: "linear-gradient(160deg,#c6f36b,#6bd3a3)", art: "web", c1: "#0f1a12", c2: "#ffffff",
      ch: "An architecture practice wanted its projects, not its website, to be the focus.",
      ap: "Full-bleed imagery, a quiet type system and a project index that can be filtered by sector.",
      out: "A fast, easy-to-edit site the team updates as projects complete." }
  ];

  function art(p) {
    var s = '<div class="shape" style="background:' + p.bg + '">';
    if (p.art === "mark") s += '<div style="position:absolute;inset:0;display:grid;place-items:center"><div style="width:42%;aspect-ratio:1;border-radius:50%;background:' + p.c2 + ';display:grid;place-items:center;box-shadow:0 30px 60px -20px rgba(0,0,0,.5)"><span style="font:italic 400 clamp(3rem,9vw,7rem)/1 Instrument Serif,serif;color:' + p.c1 + '">' + p.glyph + '</span></div></div><div style="position:absolute;left:8%;bottom:9%;display:flex;gap:6px">' + [p.c1, p.c2, "rgba(255,255,255,.25)"].map(function (c) { return '<i style="width:22px;height:22px;border-radius:6px;background:' + c + '"></i>'; }).join("") + "</div>";
    if (p.art === "ui") s += '<div style="position:absolute;left:10%;top:16%;right:10%;bottom:-10%;border-radius:16px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);padding:6%"><div style="height:10px;width:30%;border-radius:6px;background:' + p.c1 + ';opacity:.8"></div><div style="display:flex;align-items:flex-end;gap:6%;height:45%;margin-top:8%">' + [40, 70, 55, 90, 65, 80].map(function (h) { return '<i style="flex:1;height:' + h + '%;border-radius:6px 6px 2px 2px;background:' + p.c2 + '"></i>'; }).join("") + '</div><div style="height:8px;width:60%;border-radius:6px;background:' + p.c1 + ';opacity:.35;margin-top:8%"></div></div>';
    if (p.art === "web") s += '<div style="position:absolute;left:9%;right:9%;top:14%;bottom:-6%;border-radius:12px 12px 0 0;background:' + (p.c1 === "#2b2a26" ? "#fbf7f0" : "#0f1a12") + ';box-shadow:0 30px 60px -25px rgba(0,0,0,.45);overflow:hidden"><div style="height:22px;display:flex;gap:5px;align-items:center;padding:0 10px;border-bottom:1px solid rgba(127,127,127,.2)"><i style="width:7px;height:7px;border-radius:50%;background:#ff6159"></i><i style="width:7px;height:7px;border-radius:50%;background:#ffbd2e"></i><i style="width:7px;height:7px;border-radius:50%;background:#28c941"></i></div><div style="padding:7%"><div style="font:italic 400 clamp(1.4rem,3vw,2.4rem)/1 Instrument Serif,serif;color:' + (p.c1 === "#2b2a26" ? p.c1 : p.c2) + '">' + p.t.split(" ")[0] + '</div><div style="display:grid;grid-template-columns:1.4fr 1fr;gap:8px;margin-top:8%"><i style="aspect-ratio:4/3;border-radius:6px;background:' + p.c2 + '"></i><i style="border-radius:6px;background:rgba(127,127,127,.25)"></i></div></div></div>';
    if (p.art === "phone") s += '<div style="position:absolute;left:50%;top:12%;width:34%;aspect-ratio:9/18;transform:translateX(-50%) rotate(-8deg);border-radius:22px;background:' + p.c2 + ';padding:8px;box-shadow:0 30px 60px -20px rgba(43,26,61,.6)"><div style="height:100%;border-radius:16px;background:' + p.c1 + ';padding:12%"><div style="height:8px;width:50%;border-radius:4px;background:' + p.c2 + ';opacity:.7"></div>' + [1, 2, 3].map(function (i) { return '<div style="height:16%;margin-top:12%;border-radius:8px;background:' + (i === 2 ? "#ff8f8f" : "rgba(43,26,61,.08)") + '"></div>'; }).join("") + "</div></div>";
    return s + "</div>";
  }

  var grid = document.querySelector("[data-grid]");
  grid.innerHTML = P.map(function (p, i) {
    return '<button class="card reveal" type="button" data-i="' + i + '" data-k="' + p.k + '" aria-label="Open case study: ' + p.t + '"><div class="cover">' + art(p) + '<span class="view">View case study</span></div><div class="card-meta"><h3>' + p.t + "</h3><span>" + p.kind + "</span></div></button>";
  }).join("");

  /* Filters */
  var fb = document.querySelectorAll("[data-filters] button");
  fb.forEach(function (b) {
    b.addEventListener("click", function () {
      fb.forEach(function (x) { x.setAttribute("aria-pressed", x === b); });
      var f = b.dataset.f;
      grid.querySelectorAll(".card").forEach(function (c) {
        var show = f === "all" || c.dataset.k === f;
        if (show) { c.hidden = false; requestAnimationFrame(function () { c.classList.remove("out"); }); }
        else { c.classList.add("out"); setTimeout(function () { if (c.classList.contains("out")) c.hidden = true; }, 300); }
      });
    });
  });

  /* Case study modal */
  var dlg = document.querySelector("[data-modal]"), cur = 0, opener = null;
  function show(i) {
    cur = (i + P.length) % P.length; var p = P[cur];
    dlg.querySelector("[data-m-cover]").innerHTML = art(p);
    dlg.querySelector("[data-m-kind]").textContent = p.kind;
    dlg.querySelector("[data-m-title]").textContent = p.t;
    dlg.querySelector("[data-m-meta]").innerHTML = "<div><dt>Role</dt><dd>" + p.role + "</dd></div><div><dt>Timeline</dt><dd>" + p.time + "</dd></div><div><dt>Status</dt><dd>Example project</dd></div>";
    dlg.querySelector("[data-m-text]").innerHTML = "<h3>The challenge</h3><p>" + p.ch + "</p><h3>The approach</h3><p>" + p.ap + "</p><h3>What was delivered</h3><p>" + p.out + "</p>";
    dlg.querySelector(".modal-inner").scrollTop = 0;
  }
  function open(i, from) {
    opener = from; show(i);
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
    document.body.style.overflow = "hidden";
  }
  function close() { if (dlg.close) dlg.close(); else dlg.removeAttribute("open"); }
  dlg.addEventListener("close", function () { document.body.style.overflow = ""; if (opener) opener.focus(); });
  grid.addEventListener("click", function (e) { var c = e.target.closest(".card"); if (c) open(+c.dataset.i, c); });
  dlg.querySelector("[data-close]").addEventListener("click", close);
  dlg.querySelector("[data-prev]").addEventListener("click", function () { show(cur - 1); });
  dlg.querySelector("[data-next]").addEventListener("click", function () { show(cur + 1); });
  dlg.addEventListener("click", function (e) { if (e.target === dlg) close(); });
  dlg.addEventListener("keydown", function (e) { if (e.key === "ArrowRight") show(cur + 1); if (e.key === "ArrowLeft") show(cur - 1); });

  /* Theme */
  var root = document.documentElement;
  document.querySelector("[data-theme-toggle]").addEventListener("click", function () {
    root.dataset.theme = getComputedStyle(root).colorScheme.indexOf("dark") > -1 ? "light" : "dark";
    try { localStorage.setItem("sf-theme", root.dataset.theme); } catch (e) {}
  });

  /* Pointer glow + reveal */
  var g = document.querySelector(".cursor-glow");
  addEventListener("pointermove", function (e) { g.style.setProperty("--x", e.clientX + "px"); g.style.setProperty("--y", e.clientY + "px"); }, { passive: true });
  var io = "IntersectionObserver" in window ? new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }); }, { threshold: 0.1 }) : null;
  document.querySelectorAll(".reveal").forEach(function (el, i) { el.style.transitionDelay = (i % 3) * 90 + "ms"; if (io) io.observe(el); else el.classList.add("in"); });

  /* Contact → shared backend /api/lead */
  var form = document.querySelector("[data-contact]"), msg = document.querySelector("[data-msg]");
  form.addEventListener("submit", function (e) {
    e.preventDefault(); msg.className = "msg"; msg.textContent = "";
    if (!form.checkValidity()) { var bad = form.querySelector(":invalid"); msg.classList.add("err"); msg.textContent = bad.name === "email" ? "Please enter a valid email." : bad.name === "message" ? "Tell me a little about the project." : "Please add your name."; bad.focus(); return; }
    var f = new FormData(form), needs = f.getAll("need"), btn = form.querySelector("[type=submit]");
    btn.disabled = true; btn.textContent = "Sending…";
    fetch("/api/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "project-inquiry", name: f.get("name"), email: f.get("email"), needs: needs, company: f.get("company"), message: (needs.length ? "[" + needs.join(", ") + "] " : "") + f.get("message") }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || j.ok === false) throw new Error(j.error || "Couldn’t send — please try again."); }); })
      .then(function () { form.reset(); msg.classList.add("ok"); msg.textContent = "Thanks — your message is in. I’ll reply by email."; })
      .catch(function (err) { msg.classList.add("err"); msg.textContent = err.message; })
      .finally(function () { btn.disabled = false; btn.textContent = "Send message"; });
  });
})();
