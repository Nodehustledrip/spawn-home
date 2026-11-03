/* Spawn Build studio: live build preview, click-to-edit, version timeline, style presets,
 * device preview + phone QR, and the share sheet after publish. Works on top of build-app.js
 * through window.SpawnBuild and the spawn:* DOM events it emits. */
(function () {
  "use strict";
  var B = function () { return window.SpawnBuild; };
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k.indexOf("on") === 0 && typeof attrs[k] === "function") n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null && attrs[k] !== false) n.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function track(ev, p) { try { B().track(ev, p); } catch (_) {} }
  function json(r) { return r.json().then(function (d) { return { status: r.status, data: d || {} }; }); }
  function post(url, body) {
    return B().api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }).then(json);
  }
  function get(url) { return B().api(url, { cache: "no-store" }).then(json); }
  function frame() { return $("[data-preview]"); }
  function doc() { try { var f = frame(); return f && f.contentDocument; } catch (_) { return null; } }
  function toast(msg, kind) {
    var t = $(".sp-toast") || document.body.appendChild(h("div", { class: "sp-toast", role: "status", "aria-live": "polite" }));
    t.textContent = msg;
    t.className = "sp-toast is-on" + (kind ? " is-" + kind : "");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.className = "sp-toast"; }, kind === "error" ? 5200 : 2600);
  }
  var ICON = {
    edit: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 16l.8-3.2L13.5 4a1.6 1.6 0 0 1 2.3 0l.2.2a1.6 1.6 0 0 1 0 2.3L7.3 15.2 4 16Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    style: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="7" cy="8" r="1.2" fill="currentColor"/><circle cx="11" cy="6.5" r="1.2" fill="currentColor"/><circle cx="13.5" cy="9.5" r="1.2" fill="currentColor"/><path d="M9 17c-1.2-1-.5-3 1-3h1.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    history: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 10a6.5 6.5 0 1 0 2-4.7M3.5 3.5v3h3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 6.5V10l2.5 1.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    desktop: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 16.5h6M10 13.5v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    tablet: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="2.5" width="12" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M9 15h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    phone: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="6" y="2.5" width="8" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M9 4.8h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    qr: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 3h5v5H3zM12 3h5v5h-5zM3 12h5v5H3z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 12h2v2h-2zM15 15h2v2h-2zM15 12h2M12 15v2" stroke="currentColor" stroke-width="1.5"/></svg>',
    share: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 12.5V3M6.5 6.2 10 2.8l3.5 3.4M5 9.5H4.5A1.5 1.5 0 0 0 3 11v5a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 17 16v-5a1.5 1.5 0 0 0-1.5-1.5H15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    spark: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5l1.7 4.6 4.8 1.4-4.8 1.6L10 15l-1.7-4.9-4.8-1.6 4.8-1.4L10 2.5Z" fill="currentColor"/></svg>',
  };

  /* Static, script-free copy of a site for thumbnails, compare and the live build. */
  var CALM = "[data-reveal]{opacity:1!important;transform:none!important}*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}";
  function staticDoc(html, css, id) {
    var base = location.origin + "/preview/" + encodeURIComponent(id || "") + "/";
    var out = String(html || "").replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<link\b[^>]*href=["']?styles\.css["']?[^>]*>/gi, "");
    var head = '<base href="' + base + '"><style>' + String(css || "").replace(/<\/style/gi, "<\\/style") + "</style><style>" + CALM + "html,body{overflow:hidden}</style>";
    if (/<head[^>]*>/i.test(out)) out = out.replace(/<head[^>]*>/i, function (m) { return m + head; });
    else out = head + out;
    return out;
  }

  /* ================= 1. Live build preview ================= */
  var Live = {
    text: "", id: null, frame: null, last: 0, timer: null, sections: 0, cssLen: 0, on: false,
    begin: function (name) {
      this.end(true);
      this.text = ""; this.id = null; this.sections = 0; this.cssLen = 0; this.on = true; this.t0 = Date.now();
      var gen = $("[data-gen]");
      if (!gen) return;
      gen.classList.remove("is-streaming");
      var f = h("iframe", { class: "sp-live", title: "Your site, as it's being written", sandbox: "allow-same-origin", "aria-hidden": "true", tabindex: "-1" });
      f.srcdoc = "<!doctype html><html><head><style id=sp-css></style><style>" + CALM + "html{scroll-behavior:auto}.sp-in{animation:sp-in .55s cubic-bezier(.22,1,.36,1) both!important}@keyframes sp-in{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}@media (prefers-reduced-motion:reduce){.sp-in{animation:none!important}}</style></head><body></body></html>";
      var self = this;
      this.ready = false;
      f.addEventListener("load", function () { self.ready = true; if (self.text) self.render(); }, { once: true });
      gen.appendChild(f);
      this.frame = f;
      var pill = $("[data-live-pill]", gen) || gen.appendChild(h("div", { class: "sp-live-pill", "data-live-pill": true, "aria-hidden": "true" }));
      pill.innerHTML = '<span class="sp-live-dot"></span><span data-live-state>Writing styles</span><span class="sp-live-sep">·</span><span data-live-count class="mono">0 sections</span>';
    },
    event: function (ev) {
      if (!this.on) return;
      if (ev.type === "start") { this.id = ev.id; return; }
      if (ev.type === "reset") {
        this.text = ""; this.sections = 0;
        var gen = $("[data-gen]");
        if (gen) gen.classList.remove("is-streaming");
        try { this.frame.contentDocument.body.innerHTML = ""; } catch (_) {}
        return;
      }
      if (ev.type === "delta" && ev.text) {
        this.text += ev.text;
        this.schedule();
      }
    },
    schedule: function () {
      var self = this;
      if (this.timer) return;
      var wait = Math.max(0, 320 - (Date.now() - this.last));
      this.timer = setTimeout(function () { self.timer = null; self.last = Date.now(); self.render(); }, wait);
    },
    render: function () {
      var d;
      if (!this.ready) return;
      try { d = this.frame && this.frame.contentDocument; } catch (_) { return; }
      if (!d || !d.body) return;
      var css = partialString(this.text, "css");
      var html = partialString(this.text, "html");
      var st = d.getElementById("sp-css");
      if (css != null && st && css.length !== this.cssLen) {
        this.cssLen = css.length;
        /* Only complete rules: cut back to the last closing brace. */
        var cut = css.lastIndexOf("}");
        st.textContent = cut > 0 ? css.slice(0, cut + 1) : "";
      }
      var pill = $("[data-live-state]");
      if (html == null) { if (pill) pill.textContent = css ? "Writing styles" : "Planning the layout"; return; }
      var bi = html.search(/<body[^>]*>/i);
      if (bi === -1) { if (pill) pill.textContent = "Writing the page"; return; }
      var body = html.slice(bi).replace(/^<body[^>]*>/i, "");
      var lt = body.lastIndexOf("<"), gt = body.lastIndexOf(">");
      if (lt > gt) body = body.slice(0, lt);
      body = body.replace(/<script\b[\s\S]*?(<\/script>|$)/gi, "").replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
      var parsed = new DOMParser().parseFromString("<body>" + body + "</body>", "text/html").body;
      if (!parsed.firstElementChild) return;
      sync(d, d.body, parsed, 0);
      var gen = $("[data-gen]");
      if (gen && !gen.classList.contains("is-streaming")) {
        gen.classList.add("is-streaming");
        track("live_preview_started", { ms: Date.now() - this.t0 });
      }
      var n = d.body.querySelectorAll("section, header, footer").length;
      if (n !== this.sections) {
        this.sections = n;
        var c = $("[data-live-count]");
        if (c) c.textContent = n + (n === 1 ? " section" : " sections");
      }
      if (pill) pill.textContent = "Writing your site";
      /* Follow the newest content, gently. */
      var last = d.body.lastElementChild;
      while (last && last.lastElementChild && last.lastElementChild.tagName !== "SCRIPT" && /^(MAIN|DIV)$/.test(last.tagName)) last = last.lastElementChild;
      if (last && last.getBoundingClientRect) {
        var r = last.getBoundingClientRect();
        var vh = d.defaultView.innerHeight;
        if (r.top > vh * 0.55) d.defaultView.scrollTo({ top: d.defaultView.scrollY + r.top - vh * 0.35, behavior: reduce ? "auto" : "smooth" });
      }
    },
    end: function (silent) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      if (this.on && !silent && this.sections) track("live_preview_streamed", { sections: this.sections, ms: Date.now() - this.t0 });
      this.on = false;
      var gen = $("[data-gen]");
      if (gen) gen.classList.remove("is-streaming");
      $$(".sp-live").forEach(function (f) { f.remove(); });
      $$("[data-live-pill]").forEach(function (f) { f.remove(); });
      this.frame = null;
    },
  };
  /* Decode a (possibly unfinished) JSON string value for key; null until it starts. */
  function partialString(text, key) {
    var m = new RegExp('"' + key + '"\\s*:\\s*"').exec(text);
    if (!m) return null;
    var i = m.index + m[0].length, out = "";
    while (i < text.length) {
      var c = text[i];
      if (c === '"') break;
      if (c === "\\") {
        var n = text[i + 1];
        if (n == null) break;
        if (n === "u") {
          var hex = text.substr(i + 2, 4);
          if (hex.length < 4) break;
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
        out += n === "n" ? "\n" : n === "t" ? "\t" : n === "r" ? "\r" : n === "b" ? "\b" : n === "f" ? "\f" : n;
        i += 2;
        continue;
      }
      out += c;
      i++;
    }
    return out;
  }
  /* Morph live DOM toward the new parse: keep identical nodes, animate genuinely new blocks. */
  function sync(d, live, next, depth) {
    var a = live.children, b = next.children;
    for (var i = 0; i < b.length; i++) {
      var nb = b[i], la = a[i];
      if (la && la.outerHTML === nb.outerHTML) continue;
      if (la && la.tagName === nb.tagName && depth < 4 && i >= b.length - 1 && nb.children.length) {
        copyAttrs(la, nb);
        sync(d, la, nb, depth + 1);
        continue;
      }
      var imp = d.importNode(nb, true);
      if (!la) {
        if (/^(SECTION|HEADER|FOOTER|ARTICLE|NAV|ASIDE|DIV|FORM|UL|OL|H1|H2|H3|P|FIGURE|DETAILS)$/.test(imp.tagName)) imp.classList.add("sp-in");
        live.appendChild(imp);
      } else {
        if (la.classList && la.classList.contains("sp-in")) imp.classList.add("sp-in");
        live.replaceChild(imp, la);
      }
    }
    while (live.children.length > b.length) live.removeChild(live.lastElementChild);
    if (!b.length && live.textContent !== next.textContent) live.textContent = next.textContent;
  }
  function copyAttrs(to, from) {
    for (var k = to.attributes.length - 1; k >= 0; k--) { var n = to.attributes[k].name; if (n !== "class" && !from.hasAttribute(n)) to.removeAttribute(n); }
    for (var j = 0; j < from.attributes.length; j++) { var at = from.attributes[j]; if (at.name !== "class") to.setAttribute(at.name, at.value); }
    var keep = to.classList.contains("sp-in");
    to.className = from.className;
    if (keep) to.classList.add("sp-in");
    if (!from.children.length && to.textContent !== from.textContent) to.textContent = from.textContent;
  }
  window.SpawnLive = Live;
  window.SpawnLive._partialString = partialString;

  /* ================= Toolbar ================= */
  var S = { id: null, device: "desktop", editing: false, panel: null, source: null, versions: [], compare: [], presets: null, preset: null };
  function buildToolbar() {
    var actions = $(".build-stage-actions");
    if (!actions || $(".sp-tools")) return;
    var tools = h("div", { class: "sp-tools", role: "toolbar", "aria-label": "Preview tools", hidden: true });
    var dev = h("div", { class: "sp-seg", role: "radiogroup", "aria-label": "Preview size" });
    [["desktop", "Desktop"], ["tablet", "Tablet"], ["phone", "Phone"]].forEach(function (d) {
      dev.appendChild(h("button", { type: "button", class: "sp-seg-btn" + (d[0] === "desktop" ? " is-on" : ""), role: "radio", "aria-checked": d[0] === "desktop" ? "true" : "false", "data-device": d[0], title: d[1] + " preview", "aria-label": d[1], html: ICON[d[0]] }));
    });
    tools.appendChild(dev);
    tools.appendChild(h("button", { type: "button", class: "sp-tool", "data-tool": "qr", title: "Open this preview on your phone", "aria-label": "Open on your phone", html: ICON.qr }));
    tools.appendChild(h("span", { class: "sp-tools-sep", "aria-hidden": "true" }));
    tools.appendChild(h("button", { type: "button", class: "sp-tool sp-tool-label", "data-tool": "edit", "aria-pressed": "false", title: "Click anything in the preview to change it", html: ICON.edit + "<span>Edit</span>" }));
    tools.appendChild(h("button", { type: "button", class: "sp-tool sp-tool-label", "data-tool": "style", "aria-expanded": "false", title: "Restyle the whole app in one tap", html: ICON.style + "<span>Style</span>" }));
    tools.appendChild(h("button", { type: "button", class: "sp-tool sp-tool-label", "data-tool": "history", "aria-expanded": "false", title: "Every version of this app", html: ICON.history + "<span>History</span>" }));
    actions.insertBefore(tools, actions.firstChild);
    tools.addEventListener("click", function (e) {
      var d = e.target.closest("[data-device]");
      if (d) return setDevice(d.getAttribute("data-device"));
      var t = e.target.closest("[data-tool]");
      if (!t) return;
      var k = t.getAttribute("data-tool");
      if (k === "edit") return setEditing(!S.editing);
      if (k === "qr") return openPhoneQr();
      togglePanel(k);
    });
    tools.addEventListener("keydown", function (e) {
      if (!e.target.matches("[data-device]") || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
      var all = $$("[data-device]", tools), i = all.indexOf(e.target);
      var n = all[(i + (e.key === "ArrowRight" ? 1 : all.length - 1)) % all.length];
      n.focus(); setDevice(n.getAttribute("data-device"));
    });
  }

  /* ================= 6. Device preview ================= */
  var DEV = { phone: { w: 390, h: 844, label: "iPhone-size · 390 × 844" }, tablet: { w: 820, h: 1180, label: "Tablet · 820 × 1180" } };
  function ensureDevice() {
    var wrap = $("[data-preview-wrap]");
    var f = frame();
    if (!wrap || !f) return null;
    var dev = $(".sp-device", wrap);
    if (!dev) {
      dev = h("div", { class: "sp-device", "data-device-frame": "desktop" });
      var screen = h("div", { class: "sp-device-screen" });
      f.parentNode.insertBefore(dev, f);
      screen.appendChild(f);
      dev.appendChild(h("div", { class: "sp-device-body" }, [h("span", { class: "sp-device-island", "aria-hidden": "true" }), screen]));
      dev.appendChild(h("p", { class: "sp-device-cap mono", "data-device-cap": true }));
      new ResizeObserver(fitDevice).observe(wrap);
    }
    return dev;
  }
  function setDevice(name) {
    S.device = DEV[name] ? name : "desktop";
    var dev = ensureDevice();
    $$("[data-device]").forEach(function (b) {
      var on = b.getAttribute("data-device") === S.device;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    });
    if (!dev) return;
    dev.setAttribute("data-device-frame", S.device);
    $("[data-device-cap]").textContent = DEV[S.device] ? DEV[S.device].label : "";
    fitDevice();
    positionEditor();
    track("device_preview_changed", { device: S.device });
  }
  function fitDevice() {
    var wrap = $("[data-preview-wrap]"), dev = $(".sp-device");
    if (!wrap || !dev) return;
    var body = $(".sp-device-body", dev);
    var d = DEV[S.device];
    if (!d) { body.style.width = ""; body.style.height = ""; body.style.transform = ""; dev.style.height = ""; return; }
    var bez = S.device === "phone" ? 14 : 18;
    var W = d.w + bez * 2, H = d.h + bez * 2;
    var availW = wrap.clientWidth - 32, availH = Math.max(480, window.innerHeight - 190);
    var k = Math.min(1, availW / W, availH / H);
    body.style.width = W + "px";
    body.style.height = H + "px";
    body.style.transform = "scale(" + k.toFixed(4) + ")";
    dev.style.height = Math.ceil(H * k + 56) + "px";
    S.scale = k;
  }
  function previewUrl() { return location.origin + "/preview/" + encodeURIComponent(S.id) + "/"; }
  function openPhoneQr() {
    if (!S.id || !window.SpawnShare) return;
    var url = previewUrl();
    modal("sp-qr", function (box, closeIt) {
      box.appendChild(h("p", { class: "sp-kicker", text: "Open on your phone" }));
      box.appendChild(h("h3", { class: "sp-modal-title", id: "sp-qr-h", text: "Scan with your camera" }));
      box.appendChild(h("div", { class: "sp-qr-img", "data-phone-qr": url, html: window.SpawnShare.qrSvg(url, { label: "QR code for this preview" }) }));
      box.appendChild(h("p", { class: "sp-qr-url mono", text: url.replace(/^https?:\/\//, "") }));
      box.appendChild(h("p", { class: "sp-fine", text: "This preview link works for anyone who has it while the build exists. Publish to get a lasting address." }));
      var row = h("div", { class: "sp-row" });
      row.appendChild(h("button", { type: "button", class: "sp-btn", text: "Copy link", onclick: function (e) {
        var b = e.currentTarget;
        (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { b.textContent = "Copied"; }, function () { window.prompt("Copy this link", url); });
      } }));
      row.appendChild(h("button", { type: "button", class: "sp-btn sp-btn-solid", text: "Done", onclick: closeIt }));
      box.appendChild(row);
    }, "sp-qr-h");
    track("phone_qr_opened", {});
  }

  /* Small modal helper (native <dialog>, focus returns to the opener). */
  function modal(cls, fill, labelId) {
    var opener = document.activeElement;
    var d = h("dialog", { class: "sp-modal " + cls, "aria-labelledby": labelId || null });
    var box = h("div", { class: "sp-modal-box" });
    d.appendChild(box);
    document.body.appendChild(d);
    function closeIt() {
      d.classList.remove("is-open");
      setTimeout(function () { if (d.open) d.close(); d.remove(); if (opener && opener.focus) opener.focus(); }, reduce ? 0 : 180);
    }
    d.addEventListener("click", function (e) { if (e.target === d) closeIt(); });
    d.addEventListener("cancel", function (e) { e.preventDefault(); closeIt(); });
    fill(box, closeIt);
    d.showModal();
    requestAnimationFrame(function () { d.classList.add("is-open"); });
    return { el: d, close: closeIt };
  }

  /* ================= Side panel (Style / History) ================= */
  function panelEl() {
    var wrap = $("[data-preview-wrap]");
    var p = $(".sp-panel");
    if (!p && wrap) {
      p = h("aside", { class: "sp-panel", "aria-label": "Build tools", hidden: true });
      wrap.appendChild(p);
    }
    return p;
  }
  function togglePanel(kind) {
    var p = panelEl();
    if (!p) return;
    var open = S.panel !== kind;
    S.panel = open ? kind : null;
    $$("[data-tool=style],[data-tool=history]").forEach(function (b) {
      var on = b.getAttribute("data-tool") === S.panel;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-expanded", on ? "true" : "false");
    });
    if (!open) { p.classList.remove("is-open"); setTimeout(function () { if (!S.panel) p.hidden = true; }, reduce ? 0 : 220); return; }
    p.hidden = false;
    requestAnimationFrame(function () { p.classList.add("is-open"); });
    if (kind === "style") renderStyles(); else renderHistory();
  }
  function panelHead(p, title, sub) {
    p.innerHTML = "";
    var head = h("div", { class: "sp-panel-head" }, [
      h("div", {}, [h("h3", { class: "sp-panel-title", text: title }), sub ? h("p", { class: "sp-panel-sub", text: sub }) : null]),
      h("button", { type: "button", class: "sp-x", "aria-label": "Close panel", html: "&times;", onclick: function () { togglePanel(S.panel); } }),
    ]);
    p.appendChild(head);
    var body = h("div", { class: "sp-panel-body" });
    p.appendChild(body);
    return body;
  }

  /* ================= 5. Style presets ================= */
  function loadSource() {
    return get("/api/builds/" + encodeURIComponent(S.id) + "/source").then(function (r) {
      if (r.data.ok) { S.source = r.data; S.presets = r.data.presets; S.preset = r.data.preset; }
      return S.source;
    });
  }
  function renderStyles() {
    var p = panelEl();
    var body = panelHead(p, "Style", "Restyle the whole app in one tap. Instant, free, and saved as a version you can undo.");
    var grid = h("div", { class: "sp-presets", role: "list" });
    body.appendChild(grid);
    var draw = function () {
      grid.innerHTML = "";
      (S.presets || []).concat([{ id: "original", label: "Original", blurb: "Your site's own styles", swatch: null }]).forEach(function (pr) {
        var on = (S.preset || "original") === pr.id;
        var sw = h("span", { class: "sp-swatch sp-swatch-" + pr.id, "aria-hidden": "true" });
        if (pr.swatch) pr.swatch.forEach(function (c) { sw.appendChild(h("i", { style: "background:" + c })); });
        else sw.appendChild(h("i", { class: "sp-swatch-orig" }));
        var b = h("button", { type: "button", role: "listitem", class: "sp-preset" + (on ? " is-on" : ""), "data-preset": pr.id, "aria-pressed": on ? "true" : "false" }, [
          sw, h("span", { class: "sp-preset-name", text: pr.label }), h("span", { class: "sp-preset-blurb", text: pr.blurb }),
        ]);
        b.addEventListener("click", function () { applyPreset(pr.id, b); });
        grid.appendChild(b);
      });
      var refine = h("div", { class: "sp-refine" });
      var cur = (S.presets || []).filter(function (x) { return x.id === S.preset; })[0];
      refine.appendChild(h("p", { class: "sp-fine", text: cur ? "Want it to go further? The writer can rework spacing, copy tone and layout to match " + cur.label + " (counts as one edit)." : "Pick a style first — then refine it with the writer if you like." }));
      refine.appendChild(h("button", { type: "button", class: "sp-btn sp-btn-glow", disabled: !cur || !B().aiReady(), html: ICON.spark + "<span>Refine with AI</span>", onclick: function () {
        track("preset_refine_ai", { preset: S.preset });
        B().sendChat("Refine the whole design so it fully commits to a " + cur.label.toLowerCase() + " look (" + cur.blurb.toLowerCase() + "): adjust spacing, type scale, section rhythm and button styles to match. Keep all content, sections and hooks.");
        togglePanel("style");
      } }));
      body.appendChild(refine);
    };
    if (S.presets) draw();
    else { grid.appendChild(h("p", { class: "sp-fine", text: "Loading styles…" })); loadSource().then(draw); }
  }
  function applyPreset(id, btn) {
    if (S.busy) return;
    S.busy = true;
    $$(".sp-preset").forEach(function (b) { b.classList.toggle("is-loading", b === btn); });
    post("/api/builds/" + encodeURIComponent(S.id) + "/preset", { preset: id }).then(function (r) {
      if (!r.data.ok) { toast(r.data.error || "Couldn't apply that style.", "error"); return; }
      S.preset = r.data.preset || null;
      if (r.data.versions) S.versions = r.data.versions;
      S.source = null;
      track("preset_applied", { preset: id });
      swapStyles();
      B().flashSaved(id === "original" ? "Original style" : "Restyled");
      renderStyles();
    }).catch(function () { toast("Network error — try again.", "error"); }).finally(function () { S.busy = false; });
  }
  /* Re-load only the stylesheet inside the preview (no flash, keeps scroll). */
  function swapStyles() {
    var d = doc();
    var link = d && d.querySelector('link[rel="stylesheet"][href*="styles.css"]');
    if (!link) return reloadPreview();
    var next = link.cloneNode();
    next.href = "styles.css?t=" + Date.now();
    next.onload = function () { link.remove(); };
    link.parentNode.insertBefore(next, link.nextSibling);
    var root = d.documentElement;
    if (!reduce) { root.style.transition = "none"; root.animate && root.animate([{ opacity: 0.55 }, { opacity: 1 }], { duration: 380, easing: "cubic-bezier(.22,1,.36,1)" }); }
  }
  function reloadPreview() {
    var f = frame();
    if (!f) return;
    var y = 0;
    try { y = f.contentWindow.scrollY; } catch (_) {}
    f.addEventListener("load", function once() { f.removeEventListener("load", once); try { f.contentWindow.scrollTo(0, y); } catch (_) {} }, { once: true });
    f.src = "/preview/" + encodeURIComponent(S.id) + "/?t=" + Date.now();
  }

  /* ================= 3. Version timeline ================= */
  function loadVersions() {
    if (!S.id) return Promise.resolve([]);
    return get("/api/builds/" + encodeURIComponent(S.id) + "/versions").then(function (r) {
      S.versions = (r.data && r.data.versions) || [];
      return S.versions;
    });
  }
  var vcache = {};
  function versionDoc(n) {
    var key = S.id + ":" + n;
    if (vcache[key]) return vcache[key];
    vcache[key] = get("/api/builds/" + encodeURIComponent(S.id) + "/versions/" + n).then(function (r) {
      if (!r.data.ok) { delete vcache[key]; throw new Error(r.data.error || "missing"); }
      return staticDoc(r.data.html, r.data.css, S.id);
    });
    return vcache[key];
  }
  function when(iso) {
    var t = Date.parse(iso);
    if (!t) return "";
    var s = Math.round((Date.now() - t) / 1000);
    if (s < 45) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  var KIND = { create: "Created", edit: "Edit", undo: "Undo", preset: "Style", restore: "Restore", text: "Text", image: "Image", element: "Element" };
  function renderHistory() {
    var p = panelEl();
    var body = panelHead(p, "History", "Every change is a version. Tap one to preview it, restore it, or compare two side by side.");
    var list = h("ol", { class: "sp-versions", "aria-label": "Versions, newest first" });
    body.appendChild(list);
    var bar = h("div", { class: "sp-compare-bar", hidden: true }, [
      h("span", { "data-compare-label": true }),
      h("button", { type: "button", class: "sp-btn sp-btn-solid", "data-compare-go": true, text: "Compare", onclick: openCompare }),
    ]);
    p.appendChild(bar);
    list.appendChild(h("li", { class: "sp-fine", text: "Loading versions…" }));
    loadVersions().then(function (vs) {
      list.innerHTML = "";
      if (!vs.length) { list.appendChild(h("li", { class: "sp-fine", text: "No versions yet." })); return; }
      var io = "IntersectionObserver" in window ? new IntersectionObserver(function (ents) {
        ents.forEach(function (en) { if (en.isIntersecting) { io.unobserve(en.target); paintThumb(en.target); } });
      }, { root: body, rootMargin: "120px" }) : null;
      vs.forEach(function (v, i) {
        var thumb = h("div", { class: "sp-thumb", "data-n": v.n, "aria-hidden": "true" }, [h("span", { class: "sp-thumb-skel" })]);
        var cmp = h("input", { type: "checkbox", class: "sp-cmp", "aria-label": "Select v" + v.n + " to compare", "data-cmp": v.n });
        cmp.checked = S.compare.indexOf(v.n) !== -1;
        var item = h("li", { class: "sp-version" + (i === 0 ? " is-current" : ""), style: "--i:" + i }, [
          thumb,
          h("div", { class: "sp-version-meta" }, [
            h("p", { class: "sp-version-top" }, [h("span", { class: "sp-vn mono", text: "v" + v.n }), h("span", { class: "sp-kind sp-kind-" + v.kind, text: KIND[v.kind] || "Edit" }), i === 0 ? h("span", { class: "sp-now", text: "Current" }) : null]),
            h("p", { class: "sp-version-label", text: v.label, title: v.label }),
            h("p", { class: "sp-version-time", text: when(v.at) }),
            h("div", { class: "sp-version-acts" }, [
              i === 0 ? null : h("button", { type: "button", class: "sp-btn sp-btn-sm", "data-restore": v.n, text: "Restore" }),
              h("button", { type: "button", class: "sp-btn sp-btn-sm sp-btn-ghost", "data-peek": v.n, text: "View" }),
              h("label", { class: "sp-cmp-l" }, [cmp, h("span", { text: "Compare" })]),
            ]),
          ]),
        ]);
        list.appendChild(item);
        if (io) io.observe(thumb); else paintThumb(thumb);
      });
      updateCompareBar();
    });
    list.addEventListener("click", function (e) {
      var r = e.target.closest("[data-restore]");
      if (r) return restore(Number(r.getAttribute("data-restore")), r);
      var pk = e.target.closest("[data-peek]");
      if (pk) return peek(Number(pk.getAttribute("data-peek")));
    });
    list.addEventListener("change", function (e) {
      var c = e.target.closest("[data-cmp]");
      if (!c) return;
      var n = Number(c.getAttribute("data-cmp"));
      S.compare = S.compare.filter(function (x) { return x !== n; });
      if (c.checked) S.compare.push(n);
      while (S.compare.length > 2) {
        var drop = S.compare.shift();
        var el = $('[data-cmp="' + drop + '"]', list);
        if (el) el.checked = false;
      }
      updateCompareBar();
    });
  }
  function updateCompareBar() {
    var bar = $(".sp-compare-bar");
    if (!bar) return;
    bar.hidden = !S.compare.length;
    var l = $("[data-compare-label]", bar);
    var sorted = S.compare.slice().sort(function (a, b) { return a - b; });
    l.textContent = S.compare.length === 2 ? "v" + sorted[0] + " vs v" + sorted[1] : "Pick one more to compare";
    $("[data-compare-go]", bar).disabled = S.compare.length !== 2;
  }
  /* Thumbnail = a script-free, scaled-down render of that version (no stored images). */
  function paintThumb(el) {
    var n = Number(el.getAttribute("data-n"));
    versionDoc(n).then(function (html) {
      var f = h("iframe", { class: "sp-thumb-frame", sandbox: "", tabindex: "-1", title: "", loading: "lazy" });
      f.srcdoc = html;
      f.addEventListener("load", function () { el.classList.add("is-ready"); });
      el.appendChild(f);
    }).catch(function () { el.classList.add("is-gone"); });
  }
  function peek(n) {
    var v = S.versions.filter(function (x) { return x.n === n; })[0] || { n: n, label: "" };
    modal("sp-peek", function (box, closeIt) {
      box.appendChild(h("div", { class: "sp-modal-head" }, [
        h("div", {}, [h("p", { class: "sp-kicker", text: "v" + n + " · " + (KIND[v.kind] || "Edit") + " · " + when(v.at) }), h("h3", { class: "sp-modal-title", id: "sp-peek-h", text: v.label })]),
        h("button", { type: "button", class: "sp-x", "aria-label": "Close", html: "&times;", onclick: closeIt }),
      ]));
      var f = h("iframe", { class: "sp-peek-frame", sandbox: "", title: "Version " + n });
      box.appendChild(h("div", { class: "sp-peek-stage" }, [f]));
      versionDoc(n).then(function (d) { f.srcdoc = d.replace("html,body{overflow:hidden}", ""); });
      var row = h("div", { class: "sp-row" });
      if (S.versions[0] && S.versions[0].n !== n) row.appendChild(h("button", { type: "button", class: "sp-btn sp-btn-solid", text: "Restore v" + n, onclick: function (e) { closeIt(); restore(n, e.currentTarget); } }));
      row.appendChild(h("button", { type: "button", class: "sp-btn", text: "Close", onclick: closeIt }));
      box.appendChild(row);
    }, "sp-peek-h");
  }
  function restore(n, btn) {
    if (S.busy) return;
    S.busy = true;
    if (btn) { btn.disabled = true; btn.textContent = "Restoring…"; }
    post("/api/builds/" + encodeURIComponent(S.id) + "/versions/" + n + "/restore", {}).then(function (r) {
      if (!r.data.ok) { toast(r.data.error || "Couldn't restore that version.", "error"); return; }
      S.versions = r.data.versions || S.versions;
      S.source = null; S.presets = null;
      track("version_restored", { from: n });
      reloadPreview();
      B().flashSaved("Restored v" + n);
      toast("Restored v" + n + " — saved as a new version, so nothing is lost.");
      if (S.panel === "history") renderHistory();
    }).catch(function () { toast("Network error — try again.", "error"); }).finally(function () { S.busy = false; });
  }
  function openCompare() {
    if (S.compare.length !== 2) return;
    var pair = S.compare.slice().sort(function (a, b) { return a - b; });
    var meta = function (n) { return S.versions.filter(function (x) { return x.n === n; })[0] || { n: n, label: "" }; };
    track("versions_compared", { a: pair[0], b: pair[1] });
    modal("sp-compare", function (box, closeIt) {
      box.appendChild(h("div", { class: "sp-modal-head" }, [
        h("div", {}, [h("p", { class: "sp-kicker", text: "Compare versions" }), h("h3", { class: "sp-modal-title", id: "sp-cmp-h", text: "v" + pair[0] + " ↔ v" + pair[1] })]),
        h("button", { type: "button", class: "sp-x", "aria-label": "Close", html: "&times;", onclick: closeIt }),
      ]));
      var frames = [];
      var grid = h("div", { class: "sp-compare-grid" });
      pair.forEach(function (n, i) {
        var m = meta(n);
        var f = h("iframe", { class: "sp-compare-frame", sandbox: "allow-same-origin", title: "Version " + n, "data-compare-frame": n });
        frames.push(f);
        grid.appendChild(h("figure", { class: "sp-compare-col" }, [
          h("figcaption", {}, [h("span", { class: "sp-vn mono", text: "v" + n }), h("span", { class: "sp-version-label", text: m.label }), h("span", { class: "sp-version-time", text: when(m.at) })]),
          h("div", { class: "sp-compare-stage" }, [f]),
          h("button", { type: "button", class: "sp-btn sp-btn-sm" + (i ? " sp-btn-solid" : ""), text: "Restore v" + n, disabled: S.versions[0] && S.versions[0].n === n, onclick: function (e) { closeIt(); restore(n, e.currentTarget); } }),
        ]));
        versionDoc(n).then(function (d) { f.srcdoc = d.replace("html,body{overflow:hidden}", ""); });
      });
      box.appendChild(grid);
      var sync = h("label", { class: "sp-cmp-l sp-sync" }, [h("input", { type: "checkbox", checked: true, "data-sync": true }), h("span", { text: "Scroll together" })]);
      box.appendChild(sync);
      /* Scroll-linked panes so the same section lines up in both. */
      var lock = false;
      frames.forEach(function (f, i) {
        f.addEventListener("load", function () {
          var w = f.contentWindow;
          w.addEventListener("scroll", function () {
            if (lock || !$("[data-sync]", box).checked) return;
            var o = frames[1 - i].contentWindow;
            if (!o) return;
            lock = true;
            var src = w.document.documentElement, dst = o.document.documentElement;
            var k = (w.scrollY) / Math.max(1, src.scrollHeight - w.innerHeight);
            o.scrollTo(0, k * Math.max(0, dst.scrollHeight - o.innerHeight));
            requestAnimationFrame(function () { lock = false; });
          }, { passive: true });
        });
      });
    }, "sp-cmp-h");
  }

  /* ================= 2. Click to edit ================= */
  var E = { sel: null, hover: null, box: null, editingText: false };
  var EDIT_CSS =
    "html.sp-editing *{cursor:default}" +
    "html.sp-editing [data-sp-hover]{outline:2px solid rgba(212,165,116,.9)!important;outline-offset:2px!important;cursor:pointer!important;transition:outline-color .12s}" +
    "html.sp-editing [data-sp-sel]{outline:2px solid #d4a574!important;outline-offset:3px!important;box-shadow:0 0 0 6px rgba(212,165,116,.18)!important}" +
    "html.sp-editing [contenteditable=true]{outline:2px dashed #d4a574!important;outline-offset:4px!important;cursor:text!important;caret-color:#d4a574}" +
    "html.sp-editing a,html.sp-editing button{pointer-events:auto}";
  function setEditing(on) {
    S.editing = !!on;
    var btn = $("[data-tool=edit]");
    if (btn) { btn.classList.toggle("is-on", S.editing); btn.setAttribute("aria-pressed", S.editing ? "true" : "false"); }
    var wrap = $("[data-preview-wrap]");
    if (wrap) wrap.classList.toggle("is-editing", S.editing);
    instrument();
    if (!S.editing) deselect();
    var hint = $(".sp-edit-hint");
    if (S.editing && !hint && wrap) {
      hint = h("div", { class: "sp-edit-hint", role: "status" }, [h("span", { html: ICON.edit }), h("span", { text: "Edit mode — click any text, button or image." }), h("button", { type: "button", class: "sp-link", text: "Done", onclick: function () { setEditing(false); } })]);
      wrap.appendChild(hint);
    }
    if (hint) hint.classList.toggle("is-on", S.editing);
    track("edit_mode_toggled", { on: S.editing });
  }
  function instrument() {
    var d = doc();
    if (!d || !d.documentElement) return;
    if (!d.getElementById("sp-edit-css")) {
      var st = d.createElement("style");
      st.id = "sp-edit-css";
      st.textContent = EDIT_CSS;
      (d.head || d.documentElement).appendChild(st);
    }
    d.documentElement.classList.toggle("sp-editing", S.editing);
    if (d._spBound) return;
    d._spBound = true;
    d.addEventListener("mouseover", function (e) {
      if (!S.editing || E.editingText) return;
      var t = pickable(e.target);
      if (E.hover && E.hover !== t) E.hover.removeAttribute("data-sp-hover");
      E.hover = t;
      if (t) t.setAttribute("data-sp-hover", "");
    }, true);
    d.addEventListener("mouseout", function (e) {
      if (E.hover && !E.hover.contains(e.relatedTarget)) { E.hover.removeAttribute("data-sp-hover"); E.hover = null; }
    }, true);
    d.addEventListener("click", function (e) {
      if (!S.editing) return;
      if (E.editingText && E.sel && E.sel.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      var t = pickable(e.target);
      if (t) select(t);
    }, true);
    d.addEventListener("submit", function (e) { if (S.editing) e.preventDefault(); }, true);
    d.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { if (E.editingText) finishText(false); else deselect(); }
      if (e.key === "Enter" && E.editingText && !e.shiftKey) { e.preventDefault(); finishText(true); }
    }, true);
    d.defaultView.addEventListener("scroll", positionEditor, { passive: true });
  }
  function pickable(n) {
    while (n && n.nodeType !== 1) n = n.parentNode;
    if (!n || !n.closest) return null;
    if (n.closest("[data-spawn-badge]")) return null;
    if (/^(HTML|BODY|MAIN|SCRIPT|STYLE)$/.test(n.tagName)) return null;
    /* Inline bits (strong, span inside a heading) select their block, so edits stay meaningful. */
    var inline = /^(SPAN|STRONG|EM|B|I|SMALL|MARK|BR|PATH|CIRCLE|RECT|G|LINE|POLYLINE|POLYGON|USE)$/;
    while (n.parentElement && inline.test(n.tagName.toUpperCase()) && !/^(BODY|MAIN)$/.test(n.parentElement.tagName)) n = n.parentElement;
    if (n.tagName.toLowerCase() === "svg" && n.parentElement && n.parentElement.children.length === 1 && !/^(BODY|MAIN)$/.test(n.parentElement.tagName)) return n;
    return n;
  }
  /* Stable path: element-child indexes from <body>, ignoring the preview badge. */
  function pathOf(el) {
    var p = [];
    while (el && el.parentElement && el.tagName !== "BODY") {
      var i = 0, s = el.parentElement.firstElementChild;
      while (s && s !== el) { if (!s.hasAttribute("data-spawn-badge")) i++; s = s.nextElementSibling; }
      p.unshift(i);
      el = el.parentElement;
    }
    return p;
  }
  function byPath(d, path) {
    var el = d.body;
    for (var k = 0; k < path.length && el; k++) {
      var i = -1, s = el.firstElementChild;
      while (s) { if (!s.hasAttribute("data-spawn-badge")) { i++; if (i === path[k]) break; } s = s.nextElementSibling; }
      el = s;
    }
    return el;
  }
  function plainText(el) {
    if (/^(IMG|SVG|INPUT|TEXTAREA|SELECT|FORM|UL|OL|SECTION|HEADER|FOOTER|NAV|MAIN|DIV|ARTICLE|FIGURE|PICTURE|VIDEO|TABLE)$/i.test(el.tagName)) {
      if (el.tagName !== "DIV" || el.children.length) return false;
    }
    return !el.querySelector("img,svg,input,textarea,select,video,iframe,ul,ol,div,section,p,h1,h2,h3,h4,h5,h6") && el.textContent.trim().length > 0;
  }
  function select(el) {
    deselect(true);
    E.sel = el;
    el.setAttribute("data-sp-sel", "");
    if (E.hover) { E.hover.removeAttribute("data-sp-hover"); E.hover = null; }
    var isImg = /^(img|svg|picture|figure)$/i.test(el.tagName) || (el.querySelector && el.children.length === 1 && /^(IMG|SVG)$/i.test(el.firstElementChild.tagName) && !el.textContent.trim());
    var tag = el.tagName.toLowerCase();
    var name = isImg ? "Image" : /^h[1-6]$/.test(tag) ? "Heading" : tag === "p" ? "Paragraph" : tag === "a" || tag === "button" ? "Button" : tag === "li" ? "List item" : /^(section|header|footer|nav)$/.test(tag) ? tag[0].toUpperCase() + tag.slice(1) : "Element";
    var box = E.box || h("div", { class: "sp-editor", role: "dialog", "aria-label": "Edit element" });
    E.box = box;
    box.innerHTML = "";
    var canText = plainText(el);
    var form = h("form", { class: "sp-editor-form" });
    var input = h("input", { type: "text", maxlength: "500", class: "sp-editor-input", placeholder: isImg ? "e.g. swap this photo for a warm bakery illustration" : canText ? "e.g. make this bolder, shorter, friendlier" : "e.g. tighten the spacing, make the cards pop", "aria-label": "Describe the change" });
    var go = h("button", { type: "submit", class: "sp-btn sp-btn-solid sp-editor-go", html: ICON.spark + "<span>Apply</span>", disabled: !B().aiReady(), title: B().aiReady() ? "Rewrite just this element (counts as one edit)" : "The writer is offline — you can still edit text directly" });
    form.appendChild(input);
    form.appendChild(go);
    box.appendChild(h("div", { class: "sp-editor-head" }, [
      h("span", { class: "sp-editor-tag mono", text: name + " · <" + tag + ">" }),
      h("button", { type: "button", class: "sp-x", "aria-label": "Close editor", html: "&times;", onclick: function () { deselect(); } }),
    ]));
    box.appendChild(form);
    var chips = h("div", { class: "sp-editor-chips" });
    (isImg ? ["Swap this photo", "Make it brighter"] : canText ? ["Make this bolder", "Shorter", "More premium"] : ["More spacing", "Make it stand out"]).forEach(function (c) {
      chips.appendChild(h("button", { type: "button", class: "sp-chip", text: c, onclick: function () { input.value = c; if (B().aiReady()) runElementEdit(c, go); else input.focus(); } }));
    });
    box.appendChild(chips);
    var row = h("div", { class: "sp-editor-row" });
    if (canText) row.appendChild(h("button", { type: "button", class: "sp-btn sp-btn-sm", html: ICON.edit + "<span>Edit text</span>", onclick: startText }));
    if (isImg) {
      var file = h("input", { type: "file", accept: "image/*", class: "sr-only", id: "sp-img-file", tabindex: "-1" });
      file.addEventListener("change", function () { if (file.files && file.files[0]) uploadImage(file.files[0]); });
      row.appendChild(file);
      row.appendChild(h("button", { type: "button", class: "sp-btn sp-btn-sm", text: "Upload a photo", onclick: function () { file.click(); } }));
    }
    row.appendChild(h("span", { class: "sp-editor-status", role: "status", "aria-live": "polite" }));
    box.appendChild(row);
    form.addEventListener("submit", function (e) { e.preventDefault(); var v = input.value.trim(); if (v) runElementEdit(v, go); });
    if (!box.parentNode) $("[data-preview-wrap]").appendChild(box);
    box.classList.remove("is-on");
    positionEditor();
    requestAnimationFrame(function () { box.classList.add("is-on"); });
    setTimeout(function () { try { input.focus({ preventScroll: true }); } catch (_) {} }, 40);
  }
  function deselect(keepBox) {
    if (E.editingText) finishText(false);
    if (E.sel) E.sel.removeAttribute("data-sp-sel");
    E.sel = null;
    if (!keepBox && E.box) { E.box.classList.remove("is-on"); var b = E.box; setTimeout(function () { if (!E.sel && b.parentNode) b.remove(); }, reduce ? 0 : 160); E.box = null; }
  }
  function positionEditor() {
    if (!E.sel || !E.box) return;
    var f = frame(), wrap = $("[data-preview-wrap]");
    if (!f || !wrap) return;
    var fr = f.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
    var k = DEV[S.device] ? (S.scale || 1) : 1;
    var r = E.sel.getBoundingClientRect();
    var top = fr.top - wr.top + r.bottom * k + 10;
    var left = fr.left - wr.left + r.left * k;
    var bw = E.box.offsetWidth || 360, bh = E.box.offsetHeight || 150;
    if (top + bh > wrap.clientHeight - 8) top = Math.max(8, fr.top - wr.top + r.top * k - bh - 10);
    left = Math.max(8, Math.min(left, wrap.clientWidth - bw - 8));
    E.box.style.transform = "translate(" + Math.round(left) + "px," + Math.round(top) + "px)";
  }
  function status(msg, kind) {
    var s = E.box && $(".sp-editor-status", E.box);
    if (s) { s.textContent = msg || ""; s.className = "sp-editor-status" + (kind ? " is-" + kind : ""); }
  }
  /* Source doc (no badge/runtime changes) + the element at the same path; checks they match. */
  function sourceFor(el) {
    return loadSource().then(function (src) {
      if (!src) throw new Error("source");
      var sd = new DOMParser().parseFromString(src.html, "text/html");
      var path = pathOf(el);
      var node = byPath(sd, path);
      if (!node || node.tagName !== el.tagName) throw Object.assign(new Error("moved"), { code: "moved" });
      return { sd: sd, node: node, path: path, doctype: /^\s*<!doctype[^>]*>/i.exec(src.html) };
    });
  }
  function serialize(src) {
    return (src.doctype ? src.doctype[0] : "<!DOCTYPE html>") + "\n" + src.sd.documentElement.outerHTML + "\n";
  }
  function save(src, label, kind) {
    return post("/api/builds/" + encodeURIComponent(S.id) + "/apply", { html: serialize(src), label: label, kind: kind }).then(function (r) {
      if (!r.data.ok) throw Object.assign(new Error(r.data.error || "Couldn't save that change."), { shown: true });
      S.versions = r.data.versions || S.versions;
      S.source = null;
      if (S.panel === "history") renderHistory();
      document.dispatchEvent(new CustomEvent("spawn:changed", { detail: { id: S.id, reason: kind } }));
      return r.data;
    });
  }
  function runElementEdit(prompt, go) {
    var el = E.sel;
    if (!el || S.busy) return;
    S.busy = true;
    if (go) { go.disabled = true; go.classList.add("is-loading"); }
    el.classList.add("sp-working");
    status("Rewriting this " + el.tagName.toLowerCase() + "…");
    var src;
    sourceFor(el).then(function (s) {
      src = s;
      var ctx = s.node.closest("section,header,footer,nav,article") || s.node.parentElement;
      return post("/api/builds/" + encodeURIComponent(S.id) + "/element", { outer: s.node.outerHTML, context: ctx && ctx !== s.node ? ctx.outerHTML.slice(0, 4000) : "", prompt: prompt });
    }).then(function (r) {
      if (!r.data.ok) {
        var err = new Error(r.data.error || "Couldn't rewrite that element.");
        err.shown = true; err.data = r.data;
        throw err;
      }
      var tpl = src.sd.createElement("template");
      tpl.innerHTML = r.data.html;
      var repl = tpl.content.firstElementChild;
      if (!repl) throw Object.assign(new Error("Empty reply — try again."), { shown: true });
      src.node.replaceWith(repl);
      return save(src, prompt, "element").then(function () {
        /* Update the live preview in place: swap just this node. */
        var d = doc();
        var t = d.createElement("template");
        t.innerHTML = r.data.html;
        var live = d.importNode(t.content.firstElementChild, true);
        el.replaceWith(live);
        if (!reduce && live.animate) live.animate([{ opacity: 0.25, filter: "blur(2px)" }, { opacity: 1, filter: "none" }], { duration: 420, easing: "cubic-bezier(.22,1,.36,1)" });
        track("element_edit_applied", { tag: live.tagName.toLowerCase() });
        B().flashSaved("Updated");
        select(live);
        status(r.data.reply || "Done.", "ok");
      });
    }).catch(function (err) {
      status(err && err.code === "moved" ? "This part of the page changed — refresh the preview and try again." : (err && err.shown ? err.message : "Couldn't apply that — try again."), "error");
      if (err && err.data && E.box) B().upgradeLink($(".sp-editor-status", E.box), err.data);
    }).finally(function () {
      S.busy = false;
      if (go) { go.disabled = !B().aiReady(); go.classList.remove("is-loading"); }
      el.classList.remove("sp-working");
    });
  }
  function startText() {
    var el = E.sel;
    if (!el) return;
    E.editingText = true;
    E.before = el.innerHTML;
    el.setAttribute("contenteditable", "true");
    el.setAttribute("spellcheck", "true");
    el.focus();
    try {
      var d = doc(), rg = d.createRange();
      rg.selectNodeContents(el);
      var s = d.getSelection(); s.removeAllRanges(); s.addRange(rg);
    } catch (_) {}
    status("Type to edit · Enter to save · Esc to cancel");
    var row = E.box && $(".sp-editor-row", E.box);
    if (row && !$("[data-text-save]", row)) row.insertBefore(h("button", { type: "button", class: "sp-btn sp-btn-sm sp-btn-solid", "data-text-save": true, text: "Save text", onclick: function () { finishText(true); } }), row.firstChild);
  }
  function finishText(keep) {
    var el = E.sel;
    if (!el || !E.editingText) return;
    E.editingText = false;
    el.removeAttribute("contenteditable");
    el.removeAttribute("spellcheck");
    var sv = E.box && $("[data-text-save]", E.box);
    if (sv) sv.remove();
    if (!keep) { el.innerHTML = E.before; status(""); return; }
    var text = el.innerText.replace(/\s+\n/g, "\n").trim();
    if (el.innerHTML === E.before) { status(""); return; }
    status("Saving…");
    sourceFor(el).then(function (src) {
      /* Plain text only: rebuild children as text + <br>, no markup from the editor. */
      while (src.node.firstChild) src.node.removeChild(src.node.firstChild);
      text.split("\n").forEach(function (line, i) { if (i) src.node.appendChild(src.sd.createElement("br")); src.node.appendChild(src.sd.createTextNode(line)); });
      el.innerHTML = src.node.innerHTML;
      return save(src, "Text: “" + text.slice(0, 48) + (text.length > 48 ? "…" : "") + "”", "text");
    }).then(function () {
      track("inline_text_saved", { tag: el.tagName.toLowerCase() });
      B().flashSaved("Saved");
      status("Saved — no edit used.", "ok");
    }).catch(function (err) {
      el.innerHTML = E.before;
      status(err && err.shown ? err.message : "Couldn't save that text — try again.", "error");
    });
  }
  /* Photo upload: resized on this device to a compact JPEG kept inside the page. */
  function uploadImage(file) {
    var el = E.sel;
    if (!el) return;
    if (!/^image\//.test(file.type)) return status("That isn't an image file.", "error");
    status("Preparing photo…");
    var img = new Image();
    var url = URL.createObjectURL(file);
    img.onload = function () {
      var max = 1400, w = img.naturalWidth, hh = img.naturalHeight, k = Math.min(1, max / Math.max(w, hh));
      var c = document.createElement("canvas");
      c.width = Math.round(w * k); c.height = Math.round(hh * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      var q = 0.82, data = c.toDataURL("image/jpeg", q);
      while (data.length > 190000 && q > 0.4) { q -= 0.12; data = c.toDataURL("image/jpeg", q); }
      if (data.length > 260000) return status("That photo is too detailed to keep in the page — try a smaller one.", "error");
      sourceFor(el).then(function (src) {
        var alt = (src.node.getAttribute && src.node.getAttribute("alt")) || (file.name || "Photo").replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ");
        var n = src.sd.createElement("img");
        n.setAttribute("src", data);
        n.setAttribute("alt", alt);
        if (src.node.getAttribute && src.node.getAttribute("class")) n.setAttribute("class", src.node.getAttribute("class"));
        n.setAttribute("style", "width:100%;height:100%;object-fit:cover;display:block;border-radius:inherit");
        n.setAttribute("loading", "lazy");
        src.node.replaceWith(n);
        return save(src, "Photo: " + alt.slice(0, 40), "image").then(function () {
          var d = doc();
          var live = d.importNode(n, true);
          el.replaceWith(live);
          track("image_uploaded", { kb: Math.round(data.length / 1024) });
          B().flashSaved("Photo updated");
          select(live);
          status("Photo updated.", "ok");
        });
      }).catch(function (err) { status(err && err.shown ? err.message : "Couldn't use that photo — try again.", "error"); });
    };
    img.onerror = function () { status("Couldn't read that image.", "error"); };
    img.src = url;
  }

  /* ================= Wiring ================= */
  function onPreview(e) {
    var id = e.detail && e.detail.id;
    var tools = $(".sp-tools");
    if (tools) tools.hidden = !id;
    if (id !== S.id) {
      S.id = id; S.versions = []; S.compare = []; S.source = null; S.presets = null; S.preset = null; vcache = {};
      deselect();
      if (S.panel) togglePanel(S.panel);
      if (S.editing) setEditing(false);
    }
    ensureDevice();
    fitDevice();
    var f = frame();
    if (f && !f._spLoad) {
      f._spLoad = true;
      f.addEventListener("load", function () {
        deselect();
        instrument();
        if (S.panel === "history") renderHistory();
      });
    }
  }
  function onChanged() {
    S.source = null; S.presets = null;
    if (S.panel === "history") renderHistory();
    if (S.panel === "style") renderStyles();
  }
  /* Publish success → full share sheet (link, X, text, native share, QR, card preview). */
  function onPublished(e) {
    var d = e.detail || {};
    var share = $("[data-publish-share]");
    if (!share || !d.url) return;
    var slug = (/^https:\/\/([a-z0-9-]+)\./.exec(d.url) || [])[1];
    var fresh = share.cloneNode(true);
    fresh.innerHTML = ICON.share + "<span>Share</span>";
    fresh.classList.add("sp-share-btn");
    share.parentNode.replaceChild(fresh, share);
    fresh.addEventListener("click", function () {
      var b = B().activeBuild() || {};
      window.SpawnShare.open({ url: d.url, title: b.name || slug || "My app", image: slug ? "/og/app/" + slug + ".png?v=" + Date.now().toString(36) : null, kicker: "Your app is live", placement: "build_publish" });
    });
  }
  function init() {
    buildToolbar();
    document.addEventListener("spawn:preview", onPreview);
    document.addEventListener("spawn:changed", onChanged);
    document.addEventListener("spawn:published", onPublished);
    window.addEventListener("resize", function () { fitDevice(); positionEditor(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && E.sel && !document.querySelector("dialog[open]")) deselect();
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
