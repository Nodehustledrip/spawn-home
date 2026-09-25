(function () {
  "use strict";

  var yearEl = document.querySelector("[data-year]");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* Sticky nav elevation on scroll */
  var nav = document.querySelector("[data-nav]");
  if (nav) {
    var onScroll = function () {
      nav.classList.toggle("is-scrolled", window.scrollY > 8);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* Mobile nav */
  var toggle = document.querySelector("[data-nav-toggle]");
  var mobileNav = document.querySelector("[data-mobile-nav]");
  if (toggle && mobileNav) {
    var closeNav = function () {
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open menu");
      mobileNav.setAttribute("hidden", "");
    };
    toggle.addEventListener("click", function () {
      var open = toggle.getAttribute("aria-expanded") === "true";
      if (open) closeNav();
      else {
        toggle.setAttribute("aria-expanded", "true");
        toggle.setAttribute("aria-label", "Close menu");
        mobileNav.removeAttribute("hidden");
      }
    });
    mobileNav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", closeNav);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeNav();
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
      { rootMargin: "0px 0px -10% 0px", threshold: 0.1 }
    );
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("is-visible"); });
  }

  /* Early access form — polished success / error */
  var form = document.querySelector("[data-access-form]");
  var note = document.querySelector("[data-form-note]");
  var successSvg =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
    '<circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.4"/>' +
    '<path d="M4.8 8.2l2.1 2.1 4.3-4.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>' +
    "</svg>";
  var errorSvg =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
    '<circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.4"/>' +
    '<path d="M8 4.8v4M8 11.2h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
    "</svg>";

  function showNote(kind, message, icon) {
    if (!note) return;
    note.className = "form-note is-visible is-" + kind;
    note.innerHTML = icon + "<span>" + message + "</span>";
  }

  if (form) {
    var input = form.querySelector('input[type="email"]');
    if (input) {
      input.addEventListener("input", function () {
        input.classList.remove("is-invalid");
        if (note && note.classList.contains("is-error")) {
          note.className = "form-note";
          note.innerHTML = "";
        }
      });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!input) return;
      var value = (input.value || "").trim();
      var valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
      input.classList.toggle("is-invalid", !valid);
      if (!valid) {
        showNote("error", "Enter a valid email to request access.", errorSvg);
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
      form.classList.add("is-success");
      showNote("success", "You're on the list. We'll be in touch.", successSvg);

      var btn = form.querySelector("[data-submit]");
      var label = form.querySelector("[data-submit-label]");
      if (btn && label) {
        var prev = label.textContent;
        label.textContent = "Requested";
        btn.disabled = true;
        setTimeout(function () {
          label.textContent = prev;
          btn.disabled = false;
          form.classList.remove("is-success");
        }, 3200);
      }
    });
  }
})();
