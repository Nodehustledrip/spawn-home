(function () {
  "use strict";

  var yearEl = document.querySelector("[data-year]");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* Mobile nav */
  var toggle = document.querySelector("[data-nav-toggle]");
  var mobileNav = document.querySelector("[data-mobile-nav]");
  if (toggle && mobileNav) {
    toggle.addEventListener("click", function () {
      var open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", open ? "false" : "true");
      toggle.setAttribute("aria-label", open ? "Open menu" : "Close menu");
      if (open) mobileNav.setAttribute("hidden", "");
      else mobileNav.removeAttribute("hidden");
    });
    mobileNav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "Open menu");
        mobileNav.setAttribute("hidden", "");
      });
    });
  }

  /* Scroll reveal */
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var reveals = document.querySelectorAll(".reveal");
  if (reduceMotion) {
    reveals.forEach(function (el) { el.classList.add("is-visible"); });
  } else if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 }
    );
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("is-visible"); });
  }

  /* Early access form — local success state (no backend yet) */
  var form = document.querySelector("[data-access-form]");
  var note = document.querySelector("[data-form-note]");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var input = form.querySelector('input[type="email"]');
      if (!input) return;
      var value = (input.value || "").trim();
      var valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
      input.classList.toggle("is-invalid", !valid);
      if (!valid) {
        if (note) {
          note.textContent = "Enter a valid email to request access.";
          note.classList.add("is-error");
        }
        input.focus();
        return;
      }
      input.classList.remove("is-invalid");
      try {
        var list = JSON.parse(localStorage.getItem("spawn_early_access") || "[]");
        if (list.indexOf(value.toLowerCase()) === -1) {
          list.push(value.toLowerCase());
          localStorage.setItem("spawn_early_access", JSON.stringify(list));
        }
      } catch (_) { /* ignore quota / private mode */ }
      form.reset();
      if (note) {
        note.classList.remove("is-error");
        note.textContent = "You're on the list. We'll be in touch.";
      }
      var btn = form.querySelector('button[type="submit"]');
      if (btn) {
        var prev = btn.textContent;
        btn.textContent = "Requested";
        btn.disabled = true;
        setTimeout(function () {
          btn.textContent = prev;
          btn.disabled = false;
        }, 2400);
      }
    });
  }
})();
