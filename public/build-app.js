(function () {
  "use strict";

  var TEMPLATES_FALLBACK = [
    { id: "landing-paywall", name: "Landing + Paywall", blurb: "Marketing landing with pricing and CTA." },
    { id: "local-service", name: "Local Service", blurb: "Trades & local business with lead form." },
    { id: "dashboard-tool", name: "Dashboard Tool", blurb: "KPI cards, activity table, quick actions." },
    { id: "content-feed", name: "Content Feed", blurb: "Newsletter-style feed with subscribe." },
    { id: "marketplace-leads", name: "Marketplace / Leads", blurb: "Lead board for buyers and sellers." },
  ];

  var state = {
    templates: TEMPLATES_FALLBACK.slice(),
    selectedTemplate: "landing-paywall",
    builds: [],
    activeId: null,
  };

  /* Owner token: random, kept in this browser only; the server stores a hash and
   * returns just the builds made with it ("My builds"). */
  var OWNER_KEY = "spawn-build-owner";
  var LAST_KEY = "spawn-build-last";
  var memOwner = null;
  function randomToken() {
    var bytes = new Uint8Array(24);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function ownerToken() {
    if (memOwner) return memOwner;
    try {
      var t = localStorage.getItem(OWNER_KEY);
      if (!t || !/^[A-Za-z0-9_-]{24,64}$/.test(t)) {
        t = randomToken();
        localStorage.setItem(OWNER_KEY, t);
      }
      memOwner = t;
    } catch (_) {
      memOwner = memOwner || randomToken();
    }
    return memOwner;
  }
  function store(key, val) {
    try {
      if (val == null) localStorage.removeItem(key);
      else localStorage.setItem(key, val);
    } catch (_) {}
  }
  function recall(key) {
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }
  function api(url, opts) {
    opts = opts || {};
    var headers = Object.assign({ "X-Build-Owner": ownerToken() }, opts.headers || {});
    return fetch(url, Object.assign({ credentials: "same-origin" }, opts, { headers: headers }));
  }

  function timeAgo(iso) {
    if (!iso) return "";
    var t = new Date(iso).getTime();
    if (!t) return "";
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 45) return "just now";
    var m = Math.round(s / 60);
    if (m < 60) return m + "m ago";
    var h = Math.round(m / 60);
    if (h < 24) return h + "h ago";
    var d = Math.round(h / 24);
    if (d < 30) return d + "d ago";
    return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function templateName(id) {
    var t = state.templates.filter(function (x) {
      return x.id === id;
    })[0];
    return (t && t.name) || id || "";
  }

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function setNote(msg, isError) {
    var note = $("[data-create-note]");
    if (!note) return;
    note.textContent = msg || "";
    note.classList.toggle("is-error", !!isError);
  }

  function renderTemplates() {
    var grid = $("[data-templates]");
    if (!grid) return;
    grid.innerHTML = "";
    state.templates.forEach(function (t) {
      var label = el("label", "build-template" + (t.id === state.selectedTemplate ? " is-on" : ""));
      var input = document.createElement("input");
      input.type = "radio";
      input.name = "template";
      input.value = t.id;
      input.checked = t.id === state.selectedTemplate;
      input.addEventListener("change", function () {
        state.selectedTemplate = t.id;
        $$(".build-template").forEach(function (n) {
          n.classList.toggle("is-on", n.querySelector("input").value === state.selectedTemplate);
        });
      });
      label.appendChild(input);
      var body = el("span", "build-template-body");
      body.appendChild(el("strong", null, t.name));
      body.appendChild(el("span", null, t.blurb || ""));
      label.appendChild(body);
      grid.appendChild(label);
    });
  }

  function renderList() {
    var list = $("[data-build-list]");
    var empty = $("[data-build-empty]");
    var count = $("[data-build-count]");
    if (!list) return;
    list.innerHTML = "";
    if (count) {
      count.hidden = !state.builds.length;
      count.textContent = state.builds.length + (state.maxBuilds ? " / " + state.maxBuilds : "");
    }
    if (!state.builds.length) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    state.builds.forEach(function (b, i) {
      var li = el("li", "build-list-item" + (b.id === state.activeId ? " is-on" : ""));
      li.style.setProperty("--i", String(Math.min(i, 8)));
      var btn = el("button", "build-list-btn");
      btn.type = "button";
      btn.setAttribute("aria-current", b.id === state.activeId ? "true" : "false");
      btn.appendChild(el("strong", null, b.name || b.id));
      var metaLine = el("span", "build-list-meta");
      metaLine.appendChild(el("span", "mono", templateName(b.template)));
      var when = timeAgo(b.updatedAt || b.createdAt);
      if (when) metaLine.appendChild(el("span", "build-list-when", (b.editCount ? "Edited " : "Created ") + when));
      btn.appendChild(metaLine);
      btn.addEventListener("click", function () {
        openBuild(b.id);
      });
      li.appendChild(btn);
      var del = el("button", "build-list-del", "×");
      del.type = "button";
      del.title = "Delete " + (b.name || "build");
      del.setAttribute("aria-label", "Delete " + (b.name || "build"));
      del.addEventListener("click", function (e) {
        e.stopPropagation();
        deleteBuild(b);
      });
      li.appendChild(del);
      list.appendChild(li);
    });
  }

  function deleteBuild(b) {
    if (!window.confirm("Delete “" + (b.name || b.id) + "”? This can’t be undone.")) return;
    api("/api/builds/" + encodeURIComponent(b.id), { method: "DELETE" })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data || !data.ok) {
          setNote((data && data.error) || "Could not delete.", true);
          return;
        }
        state.builds = state.builds.filter(function (x) {
          return x.id !== b.id;
        });
        if (state.activeId === b.id) closePreview();
        renderList();
      })
      .catch(function () {
        setNote("Network error — try again.", true);
      });
  }

  function closePreview() {
    state.activeId = null;
    store(LAST_KEY, null);
    var iframe = $("[data-preview]");
    if (iframe) {
      iframe.hidden = true;
      iframe.removeAttribute("src");
    }
    var empty = $("[data-preview-empty]");
    if (empty) empty.hidden = false;
    var chat = $("[data-chat]");
    if (chat) chat.hidden = true;
    var dl = $("[data-download]");
    if (dl) dl.hidden = true;
    var openTab = $("[data-open-tab]");
    if (openTab) openTab.hidden = true;
    var dot = $("[data-preview-dot]");
    if (dot) dot.classList.remove("is-live");
    var label = $("[data-preview-label]");
    if (label) label.textContent = "Preview";
    var pathEl = $("[data-preview-path]");
    if (pathEl) pathEl.textContent = "";
  }

  function flashSaved(text) {
    var n = $("[data-saved]");
    if (!n) return;
    n.textContent = text || "Updated";
    n.hidden = false;
    n.classList.remove("is-flash");
    void n.offsetWidth;
    n.classList.add("is-flash");
  }

  function downloadZip() {
    if (!state.activeId) return;
    var id = state.activeId;
    var btn = $("[data-download]");
    var label = $("[data-download-label]");
    if (btn) btn.disabled = true;
    if (label) label.textContent = "Preparing…";
    api("/api/builds/" + encodeURIComponent(id) + "/zip")
      .then(function (r) {
        if (!r.ok) {
          return r.json().then(
            function (d) {
              throw new Error((d && d.error) || "Download failed");
            },
            function () {
              throw new Error("Download failed");
            }
          );
        }
        var cd = r.headers.get("Content-Disposition") || "";
        var m = cd.match(/filename="([^"]+)"/);
        return r.blob().then(function (blob) {
          return { blob: blob, name: (m && m[1]) || id + ".zip" };
        });
      })
      .then(function (out) {
        var url = URL.createObjectURL(out.blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = out.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () {
          URL.revokeObjectURL(url);
        }, 4000);
        if (label) label.textContent = "Downloaded";
        setTimeout(function () {
          if (label) label.textContent = "Download zip";
        }, 1800);
      })
      .catch(function (err) {
        if (label) label.textContent = "Download zip";
        appendChat("build", (err && err.message) || "Download failed — try again.");
      })
      .finally(function () {
        if (btn) btn.disabled = false;
      });
  }

  function bust(url) {
    var u = String(url || "");
    var sep = u.indexOf("?") >= 0 ? "&" : "?";
    return u + sep + "t=" + Date.now();
  }

  function showPreview(path) {
    var iframe = $("[data-preview]");
    var empty = $("[data-preview-empty]");
    var label = $("[data-preview-label]");
    var pathEl = $("[data-preview-path]");
    var openTab = $("[data-open-tab]");
    var chat = $("[data-chat]");
    var dot = $("[data-preview-dot]");
    if (!iframe) return;
    iframe.hidden = false;
    if (empty) empty.hidden = true;
    iframe.src = bust(path);
    if (label) label.textContent = "Live preview";
    if (pathEl) pathEl.textContent = path;
    if (openTab) {
      openTab.hidden = false;
      openTab.href = path;
    }
    if (chat) chat.hidden = false;
    if (dot) dot.classList.add("is-live");
    var dl = $("[data-download]");
    if (dl) dl.hidden = false;
    var pubBtn = $("[data-publish]");
    if (pubBtn) pubBtn.hidden = !state.cloudOn;
    emit("spawn:preview", { id: state.activeId, path: path });
  }
  function emit(name, detail) {
    try { document.dispatchEvent(new CustomEvent(name, { detail: detail || {} })); } catch (_) {}
  }

  /* ---- Publish to Spawn Cloud (signed-in accounts) ---- */
  function slugify(v) {
    return String(v || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  }
  function setPubNote(msg, kind) {
    var n = $("[data-publish-note]");
    if (!n) return;
    n.textContent = "";
    n.classList.toggle("is-error", kind === "error");
    if (msg && msg.nodeType) n.appendChild(msg); else n.textContent = msg || "";
  }
  function openPublish() {
    if (!state.activeId) return;
    track("publish_started", { signed_in: !!state.signedIn });
    if (!state.signedIn) {
      appendChat("build", "Publishing is free with an account — enter your email above and we’ll send a sign-in link. Your builds come with you.");
      promptSignin({ signin: true });
      return;
    }
    var panel = $("[data-publish-panel]");
    var input = $("[data-publish-slug]");
    var b = state.builds.filter(function (x) { return x.id === state.activeId; })[0] || {};
    var saved = recall("spawn_pub_" + state.activeId);
    if (input && !input.value) input.value = saved || slugify(b.name) || "";
    var fine = $("[data-publish-fine]");
    if (fine) fine.textContent = (state.plan === "pro" || state.plan === "elite")
      ? "Pro: no badge. Connect your own domain anytime from spawnapp.org/cloud/domains."
      : "Free plan: your app shows a small “Made with Spawn” badge. Pro removes it and adds custom domains.";
    setPubNote("");
    var gal = $("[data-publish-gallery]");
    if (gal) gal.checked = state.plan !== "pro" && state.plan !== "elite";
    var done = $("[data-publish-done]");
    if (done) done.hidden = true;
    var form = $("[data-publish-form]");
    if (form) form.hidden = false;
    panel.hidden = false;
    updatePubUrl();
    if (saved) {
      api("/api/cloud/apps/" + encodeURIComponent(saved) + "/gallery", { cache: "no-store" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d || !d.ok || !d.gallery) return;
          if (gal) gal.checked = !!d.gallery.listed;
          var rx = $("[data-publish-remix]");
          if (rx) rx.checked = !!d.gallery.remixable;
        })
        .catch(function () {});
    }
    try { input.focus(); input.select(); } catch (_) {}
  }
  function updatePubUrl() {
    var input = $("[data-publish-slug]");
    var u = $("[data-publish-url]");
    if (u && input) u.textContent = (slugify(input.value) || "yourname") + ".spawnapp.org";
  }
  function onPublish(e) {
    e.preventDefault();
    var input = $("[data-publish-slug]");
    var btn = $("[data-publish-submit]");
    var slug = slugify(input && input.value);
    if (!slug || slug.length < 2) { setPubNote("Use 2–40 letters, numbers and dashes.", "error"); return; }
    if (input) input.value = slug;
    btn.disabled = true;
    setPubNote("Publishing…");
    api("/api/cloud/web/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        buildId: state.activeId,
        slug: slug,
        title: (state.builds.filter(function (x) { return x.id === state.activeId; })[0] || {}).name,
        gallery: !!($("[data-publish-gallery]") || {}).checked,
        remixable: !!($("[data-publish-remix]") || {}).checked,
      }),
    })
      .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
      .then(function (res) {
        var d = res.data || {};
        if (!d.ok) {
          if (res.status === 401) { promptSignin({ signin: true }); }
          setPubNote(d.error || "Couldn’t publish — try again.", "error");
          return;
        }
        store("spawn_pub_" + state.activeId, slug);
        track("publish_completed", { version: d.version || null, badge: !!d.badge, gallery: !!(d.gallery && d.gallery.listed) });
        setPubNote("");
        showPublished(d);
        appendChat("build", "Published to " + d.url + " — share the link.");
      })
      .catch(function () { setPubNote("Network error — try again.", "error"); })
      .finally(function () { btn.disabled = false; });
  }
  /* Success panel: live link, copy/share, gallery status, and (free plan only) the Pro offer. */
  function showPublished(d) {
    var form = $("[data-publish-form]");
    var done = $("[data-publish-done]");
    if (!done) return;
    var host = d.url.replace(/^https:\/\//, "").replace(/\/$/, "");
    var a = $("[data-publish-done-url]");
    if (a) { a.href = d.url; a.textContent = host; }
    var g = $("[data-publish-done-gallery]");
    if (g) {
      g.textContent = "";
      if (d.gallery && d.gallery.listed) {
        g.appendChild(document.createTextNode("Listed in the "));
        var gl = el("a", null, "gallery");
        gl.href = "/gallery"; gl.target = "_blank"; gl.rel = "noopener";
        g.appendChild(gl);
        g.appendChild(document.createTextNode(d.gallery.remixable ? " — others can remix it. " : ". "));
      } else if (d.gallery && d.gallery.note) {
        g.appendChild(document.createTextNode(d.gallery.note + " "));
      }
      g.appendChild(document.createTextNode("Version " + d.version + ". Publish again anytime to update it."));
    }
    var up = $("[data-publish-upsell]");
    if (up) {
      up.hidden = !d.badge;
      if (d.badge) track("upsell_shown", { placement: "publish_success" });
    }
    if (form) form.hidden = true;
    done.hidden = false;
    state.lastPublished = d.url;
    emit("spawn:published", { url: d.url, version: d.version });
  }
  function bindPublishDone() {
    var copy = $("[data-publish-copy]");
    if (copy) copy.addEventListener("click", function () {
      var u = state.lastPublished; if (!u) return;
      var ok = function () { copy.textContent = "Copied"; setTimeout(function () { copy.textContent = "Copy link"; }, 1600); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(u).then(ok, function () { window.prompt("Copy this link", u); });
      else window.prompt("Copy this link", u);
      track("publish_link_copied", {});
    });
    var share = $("[data-publish-share]");
    if (share) share.addEventListener("click", function () {
      var u = state.lastPublished; if (!u) return;
      track("publish_shared", { native: !!navigator.share });
      if (navigator.share) { navigator.share({ title: "My app", url: u }).catch(function () {}); return; }
      window.open("https://x.com/intent/post?url=" + encodeURIComponent(u) + "&text=" + encodeURIComponent("Just published this with Spawn:"), "_blank", "noopener");
    });
    var cta = $("[data-publish-upsell-cta]");
    if (cta) cta.addEventListener("click", function () { track("upsell_clicked", { placement: "publish_success" }); });
    var again = $("[data-publish-again]");
    if (again) again.addEventListener("click", function () { $("[data-publish-done]").hidden = true; $("[data-publish-form]").hidden = false; });
    var close = $("[data-publish-done-close]");
    if (close) close.addEventListener("click", function () { $("[data-publish-panel]").hidden = true; });
  }

  /* Remix from the gallery: /build?remix=<slug> copies that app's static files into a new build you own. */
  function startRemix() {
    var slug = null;
    try { slug = new URLSearchParams(location.search).get("remix"); } catch (_) {}
    if (!slug || !/^[a-z0-9-]{2,40}$/.test(slug)) return false;
    try { history.replaceState(null, "", location.pathname); } catch (_) {}
    track("remix_started", { source_slug: slug, signed_in: !!state.signedIn });
    setNote("Remixing " + slug + "…");
    api("/api/builds/remix", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: slug }) })
      .then(function (r) { return r.json().then(function (data) { return { status: r.status, data: data }; }); })
      .then(function (res) {
        var d = res.data || {};
        if (!d.ok || !d.build) {
          setNote(d.error || "Couldn’t remix that app — try again.", true);
          upgradeLink($("[data-create-note]"), d);
          return;
        }
        setNote("Remixed — this copy is yours. Change anything in Build chat, then publish it under your own name.");
        state.builds = [d.build].concat(state.builds.filter(function (b) { return b.id !== d.build.id; }));
        renderList();
        openBuild(d.build.id);
      })
      .catch(function () { setNote("Network error — try again.", true); });
    return true;
  }

  function bindPublish() {
    bindPublishDone();
    var b = $("[data-publish]");
    if (b) b.addEventListener("click", openPublish);
    var f = $("[data-publish-form]");
    if (f) f.addEventListener("submit", onPublish);
    var c = $("[data-publish-close]");
    if (c) c.addEventListener("click", function () { $("[data-publish-panel]").hidden = true; });
    var i = $("[data-publish-slug]");
    if (i) i.addEventListener("input", updatePubUrl);
    fetch("/api/cloud/status", { credentials: "same-origin", cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        state.cloudOn = !!(d && d.enabled);
        var pb = $("[data-publish]");
        if (pb && state.activeId) pb.hidden = !state.cloudOn;
      })
      .catch(function () {});
  }

  /* Moment-of-value sign-in: the server asks for an email only when a limit is hit. */
  function promptSignin(data) {
    if (!data || !data.signin) return;
    var box = $("[data-account]");
    var input = $("[data-account-email-input]");
    if (!box || box.hidden || !input) return;
    box.classList.remove("is-compact");
    box.classList.add("is-asking");
    try { box.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) {}
    setTimeout(function () { try { input.focus(); } catch (_) {} }, 350);
  }

  /* Product analytics (PostHog via analytics.js). No PII — no emails, names or prompt text. */
  function track(ev, props) {
    try { if (typeof window.spawnTrack === "function") window.spawnTrack(ev, props || {}); } catch (_) {}
  }

  function upgradeLink(node, data) {
    promptSignin(data);
    if (!node || !data || !data.upgrade) return;
    node.appendChild(document.createTextNode(" "));
    var elite = data.offer === "elite";
    var a = el("a", "build-upgrade-link", elite ? "See Elite" : "See Pro");
    a.href = elite ? "/pricing?ref=limit#elite" : "/pricing?ref=limit";
    track("upsell_shown", { placement: "limit", offer: elite ? "elite" : "pro", limit: data.limit || null });
    a.addEventListener("click", function () { track(elite ? "elite_upsell_clicked" : "upsell_clicked", { placement: "limit", limit: data.limit || null }); });
    node.appendChild(a);
  }

  function appendChat(role, text, data) {
    var log = $("[data-chat-log]");
    if (!log) return;
    var row = el("div", "build-chat-row is-" + role);
    row.appendChild(el("span", "build-chat-role", role === "you" ? "You" : "Build"));
    var p = el("p", null, text);
    upgradeLink(p, data);
    row.appendChild(p);
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }

  function openBuild(id) {
    state.activeId = id;
    store(LAST_KEY, id);
    renderList();
    var pp = $("[data-publish-panel]");
    if (pp) pp.hidden = true;
    var ps = $("[data-publish-slug]");
    if (ps) ps.value = "";
    var path = "/preview/" + id + "/";
    showPreview(path);
    var log = $("[data-chat-log]");
    if (log) log.innerHTML = "";
    appendChat(
      "build",
      "Preview ready. Ask for a change — e.g. add FAQ, make it violet, rename to Acme, landing polish."
    );
    var b = state.builds.filter(function (x) {
      return x.id === id;
    })[0];
    if (b && $("[data-preview-label]")) {
      $("[data-preview-label]").textContent = b.name || "Preview";
    }
  }

  function loadBuilds() {
    return api("/api/builds", { cache: "no-store" })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data || !data.ok) return;
        state.builds = data.builds || [];
        state.maxBuilds = (data.limits && data.limits.maxBuilds) || null;
        renderList();
        var want = null;
        try {
          want = new URLSearchParams(location.search).get("b");
        } catch (_) {}
        want = state.activeId || want || recall(LAST_KEY);
        if (want && !state.activeId) {
          var still = state.builds.some(function (b) {
            return b.id === want;
          });
          if (still) openBuild(want);
          else if (want === recall(LAST_KEY)) store(LAST_KEY, null);
        }
      })
      .catch(function () {});
  }

  function loadTemplates() {
    return fetch("/api/builds/templates", { credentials: "same-origin" })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (data && data.ok && data.templates && data.templates.length) {
          state.templates = data.templates;
        }
        renderTemplates();
        renderList();
      })
      .catch(function () {
        renderTemplates();
      });
  }

  /* Generation progress: create waits ~25s on the AI write, so the preview
   * pane shows honest stages + an elapsed clock instead of a dead button. */
  var gen = { timer: null, t0: 0 };
  function startGen(name, ai) {
    var el = $("[data-gen]");
    if (!el) return;
    stopGen();
    var t = $("[data-gen-title]");
    if (t) t.textContent = name || "Your app";
    var k = $("[data-gen-kicker]");
    if (k) k.textContent = ai ? "Writing your site" : "Creating from template";
    var eta = $("[data-gen-eta]");
    if (eta) eta.textContent = ai ? "usually about 25 seconds" : "a few seconds";
    var empty = $("[data-preview-empty]");
    if (empty) empty.hidden = true;
    el.hidden = false;
    el.classList.remove("is-done");
    gen.t0 = Date.now();
    var marks = ai ? [0, 3500, 10000, 19000] : [0, 400, 800, 1200];
    function tick() {
      var ms = Date.now() - gen.t0;
      var s = Math.floor(ms / 1000);
      var e = $("[data-gen-elapsed]");
      if (e) e.textContent = Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
      var cur = 0;
      for (var i = 0; i < marks.length; i++) if (ms >= marks[i]) cur = i;
      $$("[data-gen-steps] li").forEach(function (li, i) {
        li.classList.toggle("is-done", i < cur);
        li.classList.toggle("is-on", i === cur);
      });
      if (eta && ai && s >= 40) eta.textContent = "taking longer than usual — still working";
    }
    tick();
    gen.timer = setInterval(tick, 250);
    if (window.SpawnLive && ai) window.SpawnLive.begin(name);
    var stage = document.querySelector(".build-stage");
    if (stage && window.matchMedia && window.matchMedia("(max-width: 960px)").matches) {
      var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      stage.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    }
  }
  function stopGen() {
    if (window.SpawnLive) window.SpawnLive.end();
    if (gen.timer) clearInterval(gen.timer);
    gen.timer = null;
    var el = $("[data-gen]");
    if (el) el.hidden = true;
    var iframe = $("[data-preview]");
    var empty = $("[data-preview-empty]");
    if (empty && iframe && iframe.hidden) empty.hidden = false;
  }

  /* Create, streamed when the cloud writer is on: NDJSON events feed the live preview
   * (window.SpawnLive) while the model writes; any failure degrades to the plain JSON reply. */
  function createRequest(body, aiOn) {
    var canStream = aiOn && window.SpawnLive && window.ReadableStream && window.TextDecoder;
    var payload = Object.assign({}, body, canStream ? { stream: true } : {});
    return api("/api/builds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(function (r) {
      var ct = r.headers.get("content-type") || "";
      if (!canStream || ct.indexOf("ndjson") === -1 || !r.body || !r.body.getReader) {
        return r.json().then(function (data) { return { status: r.status, data: data }; });
      }
      var reader = r.body.getReader();
      var dec = new TextDecoder();
      var buf = "";
      var final = null;
      function handle(line) {
        if (!line) return;
        var ev;
        try { ev = JSON.parse(line); } catch (_) { return; }
        if (ev.type === "done") final = { status: ev.status, data: ev.data };
        else window.SpawnLive.event(ev);
      }
      function pump() {
        return reader.read().then(function (x) {
          if (x.done) {
            handle(buf.trim());
            if (!final) throw new Error("stream ended early");
            return final;
          }
          buf += dec.decode(x.value, { stream: true });
          var i;
          while ((i = buf.indexOf("\n")) !== -1) {
            handle(buf.slice(0, i));
            buf = buf.slice(i + 1);
          }
          return pump();
        });
      }
      return pump();
    });
  }

  function onCreate(e) {
    e.preventDefault();
    var form = e.target;
    var name = ($("[data-name]", form) || {}).value || "";
    name = String(name).trim();
    var desc = (($("[data-desc]", form) || {}).value || "").trim();
    var company = (form.elements.company && form.elements.company.value) || "";
    var submit = $("[data-create-submit]");
    var label = $("[data-create-label]");
    if (!name) {
      setNote("Enter an app name.", true);
      return;
    }
    if (submit) submit.disabled = true;
    var aiOn = !!(state.aiReady && state.buildMode !== "offline");
    if (label) label.textContent = aiOn ? "Writing your site…" : "Creating…";
    setNote("");
    startGen(name, aiOn);

    createRequest({
      name: name,
      description: desc,
      template: state.selectedTemplate,
      company: company,
    }, aiOn)
      .then(function (res) {
        if (!res.data || !res.data.ok || !res.data.build) {
          setNote((res.data && res.data.error) || "Could not create.", true);
          upgradeLink($("[data-create-note]"), res.data);
          return;
        }
        track("build_created", { template: res.data.build.template || state.selectedTemplate || null, signed_in: !!state.signedIn });
        setNote(
          (res.data.generated === "ai"
            ? "Created — written for your description. Refine it in Build chat, or download the zip."
            : res.data.note
            ? "Created from a template. " + res.data.note
            : "Created — preview on the right. Download the zip to keep it.") +
            (res.data.temporary || (!state.signedIn && res.data.saved !== "postgres" && res.data.saved !== "d1")
              ? " Temporary build — it can disappear when Spawn updates. Sign in free to keep your builds."
              : "")
        );
        state.builds = [res.data.build].concat(
          state.builds.filter(function (b) {
            return b.id !== res.data.build.id;
          })
        );
        renderList();
        openBuild(res.data.build.id);
        if (form.elements.name) form.elements.name.value = "";
        if (form.elements.description) form.elements.description.value = "";
      })
      .catch(function () {
        setNote("Network error — try again.", true);
      })
      .finally(function () {
        stopGen();
        if (submit) submit.disabled = false;
        if (label) label.textContent = "Create & preview";
      });
  }

  function onChat(e) {
    e.preventDefault();
    if (!state.activeId) return;
    var input = $("[data-chat-input]");
    var submit = $("[data-chat-submit]");
    var msg = ((input && input.value) || "").trim();
    if (!msg) return;
    if (input) input.value = "";
    appendChat("you", msg);
    if (submit) submit.disabled = true;

    api("/api/builds/" + encodeURIComponent(state.activeId) + "/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg }),
    })
      .then(function (r) {
        return r.json().then(function (data) {
          return { status: r.status, data: data };
        });
      })
      .then(function (res) {
        if (!res.data || !res.data.ok) {
          appendChat("build", (res.data && res.data.error) || "Edit failed.", res.data);
          return;
        }
        track("build_edited", { mode: res.data.mode || null, changes: (res.data.changes || []).length, signed_in: !!state.signedIn });
        appendChat("build", (res.data.mode === "ai" || res.data.mode === "free-cloud" ? "✦ " : "") + (res.data.reply || "Done."));
        var path = res.data.previewPath || "/preview/" + state.activeId + "/";
        showPreview(path);
        emit("spawn:changed", { id: state.activeId, reason: "chat" });
        if ((res.data.changes || []).length) flashSaved("Updated");
        if (res.data.build) {
          state.builds = state.builds.map(function (b) {
            if (b.id !== res.data.build.id) return b;
            var next = Object.assign({}, b, res.data.build);
            if ((res.data.changes || []).length) {
              next.editCount = (b.editCount || 0) + 1;
              next.updatedAt = new Date().toISOString();
            }
            return next;
          });
          state.builds.sort(function (a, b) {
            return String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""));
          });
          renderList();
        }
      })
      .catch(function () {
        appendChat("build", "Network error — try again.");
      })
      .finally(function () {
        if (submit) submit.disabled = false;
        if (input) input.focus();
      });
  }

  function bind() {
    bindPublish();
    var form = $("[data-create-form]");
    if (form) form.addEventListener("submit", onCreate);
    var chat = $("[data-chat-form]");
    if (chat) chat.addEventListener("submit", onChat);
    var dl = $("[data-download]");
    if (dl) dl.addEventListener("click", downloadZip);
    var refresh = $("[data-refresh]");
    if (refresh) {
      refresh.addEventListener("click", function () {
        if (!state.activeId) return;
        showPreview("/preview/" + state.activeId + "/");
      });
    }
  }

  function loadAiStatus() {
    return fetch("/api/builds/ai-status", { credentials: "same-origin", cache: "no-store" })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        data = data || {};
        var mode = data.mode || (data.configured ? "ai" : "offline");
        state.aiReady = !!data.configured;
        state.buildMode = mode;
        var badge = $("[data-ai-badge]");
        if (badge) {
          badge.hidden = false;
          badge.textContent = data.label || (mode === "ai" ? "AI Build ready" : "Free Build (offline)");
          badge.classList.toggle("is-free", mode !== "ai");
          badge.classList.toggle("is-degraded", !!data.degraded);
          badge.title =
            mode === "ai"
              ? "AI edits — falls back to free offline rules"
              : mode === "free-cloud"
              ? "Free cloud AI writes new builds and applies edits — offline rules as backup when the free daily budget runs out"
              : data.message || "Free offline rules on this server — no API credits needed";
        }
        var hint = $("[data-chat-hint]");
        if (hint && mode !== "offline") {
          hint.innerHTML =
            "<strong>" +
            (mode === "ai" ? "AI Build ready." : "Free Build — no API credits needed.") +
            "</strong> Describe any change in plain words (sections, copy, layout, style). Falls back to free offline rules if the model is unavailable. Say “undo” to revert.";
        }
        var input = $("[data-chat-input]");
        if (input && mode !== "offline") {
          input.placeholder = "Describe a change — e.g. “add a team section with 3 founders”";
        }
      })
      .catch(function () {});
  }

  /* ---- Accounts (only when the server says sign-in is enabled) ---- */
  function setAccountNote(msg, isError) {
    var n = $("[data-account-note]");
    if (!n) return;
    n.textContent = msg || "";
    n.classList.toggle("is-error", !!isError);
  }

  function renderAccount(me) {
    var box = $("[data-account]");
    if (!box) return;
    box.hidden = false;
    var signedIn = !!(me && me.signedIn);
    state.signedIn = signedIn;
    state.plan = signedIn ? me.plan : null;
    $("[data-account-out]").hidden = signedIn;
    var teaser = $("[data-account-teaser]");
    if (teaser) teaser.hidden = signedIn;
    var tempNote = $("[data-temp-note]");
    if (tempNote) tempNote.hidden = signedIn;
    if (!signedIn && !box.classList.contains("is-asking") && !/signin=/.test(location.search)) box.classList.add("is-compact");
    var opener = $("[data-account-open]");
    if (opener && !opener._bound) {
      opener._bound = true;
      opener.addEventListener("click", function () { promptSignin({ signin: true }); });
    }
    $("[data-account-sent]").hidden = true;
    $("[data-account-in]").hidden = !signedIn;
    if (!signedIn && $("[data-account-billing]")) $("[data-account-billing]").hidden = true;
    var title = $("[data-list-title]");
    var sub = $("[data-list-sub]");
    if (signedIn) {
      $("[data-account-email]").textContent = me.email;
      var plan = $("[data-account-plan]");
      plan.textContent = me.plan === "elite" ? "Elite" : me.plan === "pro" ? "Pro" : "Free";
      var bill = $("[data-account-billing]");
      if (bill && window._spawnBilling) {
        bill.hidden = false;
        var up = $("[data-account-upgrade]");
        up.hidden = me.plan === "elite";
        up.textContent = me.plan === "pro" ? "Upgrade to Elite" : "Upgrade";
        up.href = me.plan === "pro" ? "/account#elite" : "/pricing";
        $("[data-account-manage]").hidden = !(me.plan === "pro" || me.plan === "elite" || me.hasBilling);
      }
      if (title) title.textContent = "Your builds";
      if (sub) sub.textContent = "Saved to your account — open them from any browser where you sign in.";
    } else {
      if (title) title.textContent = "This session";
      if (sub) sub.textContent = "Builds last for your session. Download the zip to keep one.";
    }
  }

  function onAccountSubmit(e) {
    e.preventDefault();
    var input = $("[data-account-email-input]");
    var btn = $("[data-account-submit]");
    var email = String((input && input.value) || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAccountNote("Enter a valid email address.", true);
      return;
    }
    btn.disabled = true;
    setAccountNote("Sending…");
    fetch("/api/auth/request", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data || !data.ok) {
          setAccountNote((data && data.error) || "Could not send a link — try again.", true);
          return;
        }
        track("signin_requested", { from: "build" });
        setAccountNote("");
        $("[data-account-out]").hidden = true;
        $("[data-account-sent-to]").textContent = email;
        $("[data-account-sent]").hidden = false;
      })
      .catch(function () {
        setAccountNote("Network error — try again.", true);
      })
      .finally(function () {
        btn.disabled = false;
      });
  }

  function loadAccount() {
    return fetch("/api/auth/config", { credentials: "same-origin", cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (cfg) {
        if (!cfg || !cfg.enabled) return false;
        window._spawnBilling = !!cfg.billing;
        var manage = $("[data-account-manage]");
        if (manage)
          manage.addEventListener("click", function () {
            manage.disabled = true;
            fetch("/api/billing/portal", {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ return: "/build" }),
            })
              .then(function (r) {
                return r.json();
              })
              .then(function (d) {
                if (d && d.ok && d.url) return location.assign(d.url);
                manage.disabled = false;
                setAccountNote((d && d.error) || "Billing is unavailable right now.", true);
              })
              .catch(function () {
                manage.disabled = false;
                setAccountNote("Network error — try again.", true);
              });
          });
        var form = $("[data-account-form]");
        if (form) form.addEventListener("submit", onAccountSubmit);
        var retry = $("[data-account-retry]");
        if (retry)
          retry.addEventListener("click", function () {
            $("[data-account-sent]").hidden = true;
            $("[data-account-out]").hidden = false;
          });
        var out = $("[data-account-logout]");
        if (out)
          out.addEventListener("click", function () {
            fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).finally(function () {
              closePreview();
              renderAccount(null);
              loadBuilds();
            });
          });
        return fetch("/api/me", { credentials: "same-origin", cache: "no-store" })
          .then(function (r) {
            return r.json();
          })
          .then(function (me) {
            renderAccount(me);
            var q = "";
            try {
              q = location.search;
            } catch (_) {}
            if (/signin=(expired|invalid|error)/.test(q)) {
              setAccountNote("That sign-in link has expired or was already used. Send a new one.", true);
            }
            if (/signed_in=1|signin=/.test(q)) {
              try {
                window.history.replaceState(null, "", location.pathname);
              } catch (_) {}
            }
            if (me && me.signedIn) {
              return api("/api/auth/claim", { method: "POST" }).then(function () {
                return true;
              });
            }
            return false;
          });
      })
      .catch(function () {
        return false;
      });
  }

  window.SpawnBuild = {
    api: api,
    activeId: function () { return state.activeId; },
    activeBuild: function () { return state.builds.filter(function (x) { return x.id === state.activeId; })[0] || null; },
    showPreview: showPreview,
    flashSaved: flashSaved,
    appendChat: appendChat,
    upgradeLink: upgradeLink,
    track: function (ev, props) { track(ev, props); },
    aiReady: function () { return !!(state.aiReady && state.buildMode !== "offline"); },
    sendChat: function (msg) {
      var input = $("[data-chat-input]");
      var form = $("[data-chat-form]");
      if (!input || !form) return;
      input.value = msg;
      if (form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event("submit", { cancelable: true }));
    },
  };

  function init() {
    loadAiStatus();
    bind();
    renderTemplates();
    loadTemplates();
    loadAccount().then(function (active) {
      if (active) loadBuilds();
    }).finally(function () { startRemix(); });
    loadBuilds();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
