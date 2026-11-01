(function () {
  "use strict";
  var CFG = window.SITE_CONFIG || {}, PAY = CFG.payments || {};
  var PRODUCTS = [
    { id: "mug", name: "Everyday mug", cat: "Tableware", price: 28, img: "mug", blurb: "Wheel-thrown stoneware mug that holds 12 oz, with a thumb-rest handle.",
      detail: "Thrown by hand, trimmed and glazed in small batches, so each one is a little different. Microwave and dishwasher safe. 12 oz, about 9 cm tall.",
      opt: { name: "Glaze", values: ["Oat", "Moss", "Charcoal"] } },
    { id: "bowl", name: "Low serving bowl", cat: "Tableware", price: 24, img: "bowl", blurb: "Wide, shallow bowl for salads, pasta and fruit.",
      detail: "A satin oat glaze inside and raw clay outside. The large size fits a salad for four. Dishwasher safe.",
      opt: { name: "Size", values: ["Small · 16 cm", "Large · 24 cm"], prices: [24, 36] } },
    { id: "plates", name: "Speckled dinner plates", cat: "Tableware", price: 48, img: "plates", blurb: "Matte speckled plates with a soft rolled rim.",
      detail: "27 cm dinner plates in a speckled cream glaze. They stack neatly. Dishwasher and microwave safe.",
      opt: { name: "Set", values: ["Set of 2", "Set of 4"], prices: [48, 90] } },
    { id: "vase", name: "Bud vase", cat: "Home", price: 64, img: "vase", blurb: "A tall, narrow vase for a single stem or dried grasses.",
      detail: "Glazed inside so it holds water. 22 cm tall. Each vase is signed on the base.",
      opt: { name: "Glaze", values: ["Oat", "Ink"] } },
    { id: "candle", name: "Ceramic candle", cat: "Home", price: 32, img: "candle", blurb: "Soy wax poured into a reusable stoneware cup.",
      detail: "Roughly 45 hours of burn time. Once the candle is finished, clean out the cup and use it as a planter or tumbler.",
      opt: { name: "Scent", values: ["Fig leaf", "Cedar", "Woodsmoke"] } },
    { id: "linen", name: "Linen napkins", cat: "Textiles", price: 38, img: "linen", blurb: "Set of four stonewashed linen napkins.",
      detail: "Medium-weight European linen, 45 × 45 cm. They soften with every wash, so you never need to iron them.",
      opt: { name: "Colour", values: ["Natural", "Rust"] } }
  ];
  var CATS = ["All", "Tableware", "Home", "Textiles"];
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var money = function (n) { return "$" + (Math.round(n * 100) / 100).toFixed(n % 1 ? 2 : 0); };
  var byId = function (id) { return PRODUCTS.filter(function (p) { return p.id === id; })[0]; };
  var priceOf = function (p, v) { var i = p.opt.values.indexOf(v); return p.opt.prices && i >= 0 ? p.opt.prices[i] : p.price; };
  var linkOf = function (id, v) { var u = PAY[id + ":" + v] || PAY[id] || ""; return /^https:\/\/(buy|checkout|donate)\.stripe\.com\//.test(u) ? u : ""; };
  var anyLink = PRODUCTS.some(function (p) { return p.opt.values.some(function (v) { return linkOf(p.id, v); }); });
  var pic = function (name, sizes, alt, eager) { return '<img src="img/' + name + '-480.webp" srcset="img/' + name + "-480.webp 480w, img/" + name + '-960.webp 960w" sizes="' + sizes + '" alt="' + esc(alt) + '" width="960" height="960"' + (eager ? ' fetchpriority="high"' : ' loading="lazy"') + ' decoding="async">'; };

  var live = fetch("/api/health", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : {}; }).then(function (d) { return d && d.hosting === "spawn-cloud"; }).catch(function () { return false; });

  /* Card payments: once the owner connects Stripe on spawnapp.org, the whole cart is paid in one Stripe Checkout,
   * priced on the server from pricing.json, and the order is marked paid only when Stripe confirms it. */
  var stripe = live.then(function (isLive) {
    if (!isLive) return false;
    return fetch("/api/pay/config", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (c) { return !!(c && c.connected && c.catalog); });
  }).catch(function () { return false; });

  /* ---------- cart (persists in localStorage) ---------- */
  var KEY = "ff-cart";
  function load() { try { var c = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(c) ? c.filter(function (l) { return byId(l.id) && l.qty > 0; }) : []; } catch (_) { return []; } }
  var cart = load();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch (_) {} renderCart(); }
  function add(id, v, q) {
    var l = cart.filter(function (x) { return x.id === id && x.v === v; })[0];
    if (l) l.qty = Math.min(20, l.qty + q); else cart.push({ id: id, v: v, qty: q });
    save(); openCart(true);
  }
  function count() { return cart.reduce(function (a, l) { return a + l.qty; }, 0); }
  function subtotal() { return cart.reduce(function (a, l) { return a + priceOf(byId(l.id), l.v) * l.qty; }, 0); }
  function shipping(s) { return s === 0 || s >= (CFG.freeShippingOver || 75) ? 0 : 8; }
  window.addEventListener("storage", function (e) { if (e.key === KEY) { cart = load(); renderCart(); } });

  function renderCart() {
    $$("[data-count]").forEach(function (el) { var n = count(); el.textContent = n; el.hidden = !n; });
    var body = $("[data-cart-body]"); if (!body) return;
    if (!cart.length) { body.innerHTML = '<div class="empty"><p>Your cart is empty.</p><a class="btn ghost" href="./#shop" data-close>Browse the shop</a></div>'; $("[data-cart-foot]").hidden = true; return; }
    $("[data-cart-foot]").hidden = false;
    body.innerHTML = cart.map(function (l, i) {
      var p = byId(l.id);
      return '<div class="line"><a href="product.html?p=' + p.id + '" class="line-img">' + pic(p.img, "72px", p.name) + '</a><div class="line-main"><a href="product.html?p=' + p.id + '" class="line-name">' + esc(p.name) + '</a><span class="muted">' + esc(p.opt.name + ": " + l.v) + '</span>' +
        '<div class="qty" role="group" aria-label="Quantity for ' + esc(p.name) + '"><button type="button" data-q="' + i + '" data-d="-1" aria-label="Decrease">−</button><span>' + l.qty + '</span><button type="button" data-q="' + i + '" data-d="1" aria-label="Increase">+</button></div></div>' +
        '<div class="line-end"><strong>' + money(priceOf(p, l.v) * l.qty) + '</strong><button type="button" class="link" data-rm="' + i + '">Remove</button></div></div>';
    }).join("");
    var s = subtotal(), sh = shipping(s);
    $("[data-sub]").textContent = money(s);
    $("[data-ship]").textContent = sh ? money(sh) : "Free";
    $("[data-total]").textContent = money(s + sh);
    var left = (CFG.freeShippingOver || 75) - s;
    $("[data-free]").textContent = left > 0 ? "Add " + money(left) + " more for free shipping." : "You’ve got free shipping.";
  }
  var lastFocus;
  function openCart(on) {
    var d = $("[data-drawer]"); if (!d) return;
    if (on) { lastFocus = document.activeElement; d.hidden = false; requestAnimationFrame(function () { d.classList.add("open"); }); document.body.classList.add("lock"); setTimeout(function () { var c = $("[data-close-btn]"); c && c.focus(); }, 50); }
    else { d.classList.remove("open"); document.body.classList.remove("lock"); setTimeout(function () { d.hidden = true; }, 250); lastFocus && lastFocus.focus && lastFocus.focus(); }
  }

  /* ---------- checkout hand-off ---------- */
  function ref() { var a = "ABCDEFGHJKMNPQRSTUVWXYZ23456789", s = "FF-"; for (var i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }
  function checkout(e) {
    e.preventDefault();
    var f = e.target, email = f.email.value.trim(), name = f.name.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { f.email.focus(); $("[data-co-err]").textContent = "Enter your email so the shop can reach you about your order."; return; }
    var r = ref(), s = subtotal(), items = cart.map(function (l) { var p = byId(l.id); return { id: l.id, name: p.name, variant: l.v, qty: l.qty, price: priceOf(p, l.v), link: linkOf(l.id, l.v) }; });
    var order = { title: "Order " + r, ref: r, name: name, email: email, items: items.map(function (i) { return i.qty + " × " + i.name + " (" + i.variant + ")"; }).join("; "), subtotal: money(s), shipping: shipping(s) ? money(shipping(s)) : "Free", total: money(s + shipping(s)), payment: anyLink ? "Stripe Payment Links" : "Demo (not connected)" };
    var btn = f.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Saving…";
    Promise.all([live, stripe]).then(function (lv) {
      var isLive = lv[0], card = lv[1];
      if (card) order.payment = "Card (Stripe Checkout)";
      return (isLive ? fetch("/api/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(order) }).then(function (x) { return x.json(); }) : Promise.resolve({ ok: true })).then(function (d) {
        if (!d.ok) throw new Error(d.error || "Couldn’t save your order.");
        if (card) {
          return fetch("/api/pay/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "cart", ref: r, email: email, name: name, returnPath: location.pathname,
            items: cart.map(function (l) { return { id: l.id, variant: l.v, qty: l.qty }; }) }) }).then(function (x) { return x.json(); }).then(function (x) {
            if (!x.ok || !x.url) throw new Error(x.error || "Couldn’t start the payment.");
            try { sessionStorage.setItem("ff-pending", r); } catch (_) {}
            location.href = x.url;
          });
        }
        handoff(r, items, email, isLive, s);
        cart = []; save();
      });
    }).catch(function (err) { $("[data-co-err]").textContent = err.message; }).then(function () { btn.disabled = false; btn.textContent = "Continue to payment"; });
  }
  function handoff(r, items, email, isLive, s) {
    openCart(false);
    var paid = items.filter(function (i) { return i.link; });
    var h = $("[data-handoff]");
    var rows = items.map(function (i) {
      var href = i.link ? i.link + (i.link.indexOf("?") > -1 ? "&" : "?") + "client_reference_id=" + encodeURIComponent(r) + "&prefilled_email=" + encodeURIComponent(email) : "";
      return '<li><span><strong>' + esc(i.name) + '</strong><span class="muted"> · ' + esc(i.variant) + ' · qty ' + i.qty + '</span></span>' + (href ? '<a class="btn sm" href="' + esc(href) + '" rel="noopener">Pay ' + money(i.price * i.qty) + '</a>' : '<span class="tag">Demo · not charged</span>') + '</li>';
    }).join("");
    h.innerHTML = '<div class="ho-card"><p class="eyebrow">Order ' + esc(r) + '</p><h2>' + (paid.length ? "Almost done: pay securely with Stripe" : "Order received") + '</h2>' +
      (paid.length ? '<p>Each item has its own Stripe checkout. Pay for each one below. Your order reference is passed along so the shop can match your payments.' + (paid.length < items.length ? " Items without a link will be invoiced by the shop." : "") + '</p>'
        : '<p class="demo-note"><strong>Demo — payments not connected.</strong> Nothing was charged. The shop owner connects their own Stripe account to take payments.</p>') +
      '<ul class="ho-list">' + rows + '</ul><p class="muted">Subtotal ' + money(s) + ' · shipping ' + (shipping(s) ? money(shipping(s)) : "free") + '. ' + (isLive ? "Your order request was sent to the shop." : "Preview mode: this order stays in your browser.") + '</p><a class="btn ghost" href="./">Back to the shop</a></div>';
    h.hidden = false; h.scrollIntoView({ behavior: "smooth", block: "start" }); h.focus();
  }

  /* ---------- pages ---------- */
  function card(p, i) {
    var from = p.opt.prices ? "From " + money(Math.min.apply(null, p.opt.prices)) : money(p.price);
    return '<li class="card" data-cat="' + p.cat + '"><a href="product.html?p=' + p.id + '"><div class="card-img">' + pic(p.img, "(max-width:640px) 50vw, (max-width:1000px) 33vw, 320px", p.name, i < 3) + '</div><div class="card-body"><span class="muted">' + p.cat + '</span><h3>' + esc(p.name) + '</h3><span class="price">' + from + '</span></div></a></li>';
  }
  function home() {
    var grid = $("[data-grid]"); if (!grid) return;
    grid.innerHTML = PRODUCTS.map(card).join("");
    var f = $("[data-filters]");
    f.innerHTML = CATS.map(function (c, i) { return '<button type="button" role="tab" aria-selected="' + (i === 0) + '" data-cat="' + c + '">' + c + "</button>"; }).join("");
    f.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-cat]"); if (!b) return;
      $$("button", f).forEach(function (x) { x.setAttribute("aria-selected", x === b); });
      $$(".card", grid).forEach(function (c) { c.hidden = b.dataset.cat !== "All" && c.dataset.cat !== b.dataset.cat; });
    });
  }
  function product() {
    var root = $("[data-pdp]"); if (!root) return;
    var id = new URLSearchParams(location.search).get("p"), p = byId(id);
    if (!p) { root.innerHTML = '<div class="empty"><h1>Product not found</h1><p><a href="./#shop">Back to the shop</a></p></div>'; return; }
    document.title = p.name + " — Fern & Fold";
    var can = document.querySelector('link[rel=canonical]'); if (can) can.href = "https://shop-template.spawnapp.org/product.html?p=" + p.id;
    var md = document.querySelector('meta[name=description]'); if (md) md.content = p.blurb;
    var v = p.opt.values[0];
    root.innerHTML = '<nav class="crumbs" aria-label="Breadcrumb"><a href="./">Shop</a> / <a href="./#shop">' + p.cat + '</a> / <span>' + esc(p.name) + '</span></nav><div class="pdp"><div class="pdp-img">' + pic(p.img, "(max-width:900px) 100vw, 55vw", p.name, true) + '</div><div class="pdp-info"><span class="muted">' + p.cat + '</span><h1>' + esc(p.name) + '</h1><p class="pdp-price" data-price>' + money(priceOf(p, v)) + '</p><p class="lead">' + esc(p.blurb) + '</p>' +
      '<fieldset class="opts"><legend>' + esc(p.opt.name) + ': <strong data-vname>' + esc(v) + '</strong></legend>' + p.opt.values.map(function (x, i) { return '<label><input type="radio" name="v" value="' + esc(x) + '"' + (i ? "" : " checked") + '><span>' + esc(x) + "</span></label>"; }).join("") + '</fieldset>' +
      '<div class="buy"><div class="qty big" role="group" aria-label="Quantity"><button type="button" data-pq="-1" aria-label="Decrease">−</button><span data-pqv>1</span><button type="button" data-pq="1" aria-label="Increase">+</button></div><button class="btn wide" type="button" data-add>Add to cart</button></div>' +
      '<p class="muted small">' + esc(CFG.shippingNote || "") + '</p><details open><summary>Details</summary><p>' + esc(p.detail) + '</p></details><details><summary>Care &amp; returns</summary><p>Every piece is handmade, so small variations in glaze are normal. Unused items can be returned within 30 days. Contact the shop with your order reference.</p></details></div></div>' +
      '<section class="more"><h2>You might also like</h2><ul class="grid">' + PRODUCTS.filter(function (x) { return x.id !== p.id; }).slice(0, 3).map(card).join("") + "</ul></section>";
    var q = 1;
    root.addEventListener("change", function (e) { if (e.target.name === "v") { v = e.target.value; $("[data-vname]").textContent = v; $("[data-price]").textContent = money(priceOf(p, v)); } });
    root.addEventListener("click", function (e) {
      var b = e.target.closest("[data-pq]"); if (b) { q = Math.max(1, Math.min(20, q + Number(b.dataset.pq))); $("[data-pqv]").textContent = q; }
      if (e.target.closest("[data-add]")) add(p.id, v, q);
    });
    var ld = document.createElement("script"); ld.type = "application/ld+json";
    ld.textContent = JSON.stringify({ "@context": "https://schema.org", "@type": "Product", name: p.name + " (demo)", description: p.blurb, image: "https://shop-template.spawnapp.org/img/" + p.img + "-960.webp", brand: { "@type": "Brand", name: "Fern & Fold (fictional)" }, offers: { "@type": "Offer", priceCurrency: "USD", price: priceOf(p, p.opt.values[0]), availability: "https://schema.org/InStock" } });
    document.head.appendChild(ld);
  }

  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-open-cart]")) { e.preventDefault(); openCart(true); }
    if (e.target.closest("[data-close]") || e.target.matches("[data-drawer]")) openCart(false);
    var q = e.target.closest("[data-q]"); if (q) { var l = cart[q.dataset.q]; l.qty = Math.max(0, Math.min(20, l.qty + Number(q.dataset.d))); if (!l.qty) cart.splice(q.dataset.q, 1); save(); }
    var r = e.target.closest("[data-rm]"); if (r) { cart.splice(r.dataset.rm, 1); save(); }
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && $("[data-drawer]") && !$("[data-drawer]").hidden) openCart(false); });
  var co = $("[data-checkout]"); if (co) co.addEventListener("submit", checkout);
  if (!anyLink) stripe.then(function (on) { if (!on) $$("[data-demo-banner]").forEach(function (b) { b.hidden = false; }); });
  var qs = new URLSearchParams(location.search);
  if (qs.get("paid") === "1") {
    var t = $("[data-paid]");
    if (t && qs.get("session_id") && qs.get("ref")) {
      var tries = 0, poll = function () {
        fetch("/api/pay/status?ref=" + encodeURIComponent(qs.get("ref")) + "&session_id=" + encodeURIComponent(qs.get("session_id")), { cache: "no-store" }).then(function (x) { return x.json(); }).then(function (x) {
          var p = x && x.payment; t.hidden = false;
          if (p && p.unlocked) { t.textContent = "Payment confirmed for order " + p.ref + " (" + money(p.paid / 100) + "). The shop will email you when it ships."; cart = []; save(); return; }
          t.textContent = "Thanks! We’re waiting for Stripe to confirm the payment for order " + qs.get("ref") + "…"; if (++tries < 10) setTimeout(poll, 3000);
        }).catch(function () {});
      }; poll();
    } else if (t) t.hidden = false;
  }
  if (qs.get("canceled") === "1") { var cb = $("[data-paid]"); if (cb) { cb.hidden = false; cb.textContent = "Payment cancelled. Your cart is still here when you're ready."; } }
  var tt = $("[data-theme-toggle]"); if (tt) tt.addEventListener("click", function () {
    var cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"), nx = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nx; try { localStorage.setItem("ff-theme", nx); } catch (_) {}
  });
  home(); product(); renderCart();
})();
