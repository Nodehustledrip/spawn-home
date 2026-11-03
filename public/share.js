/* Spawn share sheet — copy link, post on X, text message, native share, and a QR code drawn
 * on the device (vendor/qrcode.js, no external service). window.SpawnShare.open({url,title,image}) */
(function () {
  "use strict";
  if (window.SpawnShare) return;
  var dlg = null;
  var lastFocus = null;
  function track(ev, props) {
    try { if (typeof window.spawnTrack === "function") window.spawnTrack(ev, props || {}); } catch (_) {}
  }
  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  /** QR as an <svg> string. Error correction M, quiet zone of 4 modules. */
  function qrSvg(text, opts) {
    opts = opts || {};
    if (typeof window.qrcode !== "function") return "";
    var q = window.qrcode(0, opts.ec || "M");
    q.addData(String(text), "Byte");
    q.make();
    var n = q.getModuleCount();
    var pad = 4;
    var size = n + pad * 2;
    var d = "";
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (q.isDark(r, c)) d += "M" + (c + pad) + " " + (r + pad) + "h1v1h-1z";
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + " " + size + '" shape-rendering="crispEdges" role="img" aria-label="' +
      (opts.label || "QR code") + '"><rect width="' + size + '" height="' + size + '" fill="' + (opts.bg || "#fff") + '"/><path d="' + d + '" fill="' + (opts.fg || "#0a0a0b") + '"/></svg>';
  }
  var ICONS = {
    copy: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="6.5" y="6.5" width="9" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4.5 12.5v-7a2 2 0 0 1 2-2h7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    x: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M11.6 8.8 17.3 2.5h-1.4l-4.9 5.4-3.9-5.4H2.6l6 8.3-6 6.7H4l5.2-5.8 4.2 5.8h4.5l-6.3-8.7Zm-1.8 2-.6-.8L4.5 3.5h2l3.9 5.4.6.8 5 6.9h-2l-4.2-5.8Z" fill="currentColor"/></svg>',
    sms: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H9l-3.5 2.5V14.5H4A1.5 1.5 0 0 1 2.5 13V6A1.5 1.5 0 0 1 4 4.5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    more: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 12.5V3M6.5 6.2 10 2.8l3.5 3.4M5 9.5H4.5a1.5 1.5 0 0 0-1.5 1.5v5A1.5 1.5 0 0 0 4.5 17.5h11a1.5 1.5 0 0 0 1.5-1.5v-5a1.5 1.5 0 0 0-1.5-1.5H15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  function close() {
    if (!dlg) return;
    var d = dlg;
    d.classList.remove("is-open");
    var done = function () { if (d.open) d.close(); };
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) done();
    else setTimeout(done, 180);
    if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (_) {}
  }
  function open(o) {
    o = o || {};
    var url = String(o.url || location.href);
    var title = String(o.title || document.title || "My app");
    var text = o.text || title + " — built with Spawn";
    lastFocus = document.activeElement;
    if (!dlg) {
      dlg = h("dialog", { class: "sp-share", "aria-labelledby": "sp-share-h" });
      document.body.appendChild(dlg);
      dlg.addEventListener("click", function (e) { if (e.target === dlg) close(); });
      dlg.addEventListener("cancel", function (e) { e.preventDefault(); close(); });
    }
    dlg.innerHTML = "";
    var host = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
    var card = h("div", { class: "sp-share-card" });
    var head = h("div", { class: "sp-share-head" }, [
      h("div", {}, [h("p", { class: "sp-share-kicker", text: o.kicker || "Share" }), h("h3", { id: "sp-share-h", class: "sp-share-title", text: title })]),
      h("button", { type: "button", class: "sp-share-x", "aria-label": "Close", html: "&times;" }),
    ]);
    card.appendChild(head);
    if (o.image) {
      var img = h("img", { class: "sp-share-og", src: o.image, alt: "Link preview card for " + title, width: "1200", height: "630", loading: "lazy", decoding: "async" });
      img.addEventListener("error", function () { img.remove(); });
      card.appendChild(img);
    }
    var row = h("div", { class: "sp-share-link" }, [
      h("span", { class: "sp-share-url", text: host, title: url }),
      h("button", { type: "button", class: "sp-share-copy", "data-share": "copy", html: ICONS.copy + "<span>Copy link</span>" }),
    ]);
    card.appendChild(row);
    var acts = h("div", { class: "sp-share-actions" });
    var xa = h("a", { class: "sp-share-act", "data-share": "x", target: "_blank", rel: "noopener", href: "https://x.com/intent/post?text=" + encodeURIComponent(text) + "&url=" + encodeURIComponent(url), html: ICONS.x + "<span>Post on X</span>" });
    var sep = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) ? "&" : "?";
    var sa = h("a", { class: "sp-share-act", "data-share": "sms", href: "sms:" + sep + "body=" + encodeURIComponent(text + " " + url), html: ICONS.sms + "<span>Text it</span>" });
    acts.appendChild(xa);
    acts.appendChild(sa);
    if (navigator.share) acts.appendChild(h("button", { type: "button", class: "sp-share-act", "data-share": "native", html: ICONS.more + "<span>More…</span>" }));
    card.appendChild(acts);
    var qr = h("div", { class: "sp-share-qr" }, [
      h("div", { class: "sp-share-qr-img", "data-share-qr": url, html: qrSvg(url, { label: "QR code for " + host }) }),
      h("p", { class: "sp-share-qr-cap", html: "<strong>Scan to open</strong><span>Point a phone camera at the code.</span>" }),
    ]);
    card.appendChild(qr);
    var live = h("p", { class: "sp-share-status", role: "status", "aria-live": "polite" });
    card.appendChild(live);
    dlg.appendChild(card);
    card.addEventListener("click", function (e) {
      var t = e.target.closest("[data-share], .sp-share-x");
      if (!t) return;
      if (t.classList.contains("sp-share-x")) return close();
      var ch = t.getAttribute("data-share");
      track("share_action", { channel: ch, placement: o.placement || null });
      if (ch === "copy") {
        e.preventDefault();
        var ok = function () {
          t.classList.add("is-done");
          t.querySelector("span").textContent = "Copied";
          live.textContent = "Link copied.";
          setTimeout(function () { t.classList.remove("is-done"); t.querySelector("span").textContent = "Copy link"; }, 1800);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(ok, function () { window.prompt("Copy this link", url); });
        else window.prompt("Copy this link", url);
      } else if (ch === "native") {
        e.preventDefault();
        navigator.share({ title: title, text: text, url: url }).catch(function () {});
      }
    });
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    requestAnimationFrame(function () { dlg.classList.add("is-open"); });
    track("share_opened", { placement: o.placement || null });
    setTimeout(function () { var c = dlg.querySelector(".sp-share-copy"); if (c) c.focus(); }, 30);
  }
  window.SpawnShare = { open: open, close: close, qrSvg: qrSvg };
})();
