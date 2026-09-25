(function () {
  "use strict";

  var yearEl = document.querySelector("[data-year]");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Header border on scroll */
  var nav = document.querySelector("[data-nav]");
  if (nav) {
    var onScroll = function () {
      nav.classList.toggle("is-scrolled", window.scrollY > 12);
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

  /* ——— Product stage ——— */
  var stage = document.querySelector("[data-stage]");
  if (stage) {
    var tabs = stage.querySelectorAll("[data-tab]");
    var panels = stage.querySelectorAll("[data-panel]");
    var railItems = stage.querySelectorAll("[data-rail]");
    var statusDot = stage.querySelector("[data-status-dot]");
    var statusLabel = stage.querySelector("[data-status-label]");
    var runPill = stage.querySelector("[data-run-pill]");
    var typedEl = stage.querySelector("[data-typed]");
    var caretEl = stage.querySelector("[data-caret]");
    var replyEl = stage.querySelector("[data-reply]");
    var replyText = stage.querySelector("[data-reply-text]");
    var liveUrl = stage.querySelector("[data-live-url]");
    var goLiveBtn = stage.querySelector("[data-go-live]");
    var liveNote = stage.querySelector("[data-live-note]");

    var PROMPT = "Add a pricing table with three tiers and a monthly toggle.";
    var REPLY = "Added PricingSection with Free, Pro, and Team. Toggle wired to billingInterval.";
    var typingTimer = null;
    var buildPlayed = false;

    function setStatus(kind, label) {
      if (statusDot) {
        statusDot.classList.remove("is-live", "is-busy");
        if (kind) statusDot.classList.add(kind);
      }
      if (statusLabel) statusLabel.textContent = label;
    }

    function showPanel(name) {
      panels.forEach(function (p) {
        var match = p.getAttribute("data-panel") === name;
        p.classList.toggle("is-active", match);
        if (match) p.removeAttribute("hidden");
        else p.setAttribute("hidden", "");
      });
      tabs.forEach(function (t) {
        var on = t.getAttribute("data-tab") === name;
        t.classList.toggle("is-active", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
      });
      railItems.forEach(function (r) {
        var key = r.getAttribute("data-rail");
        var on =
          (name === "home" && (key === "create" || key === "run")) ||
          (name === "build" && key === "build") ||
          (name === "live" && key === "live");
        if (name === "home") {
          r.classList.toggle("is-active", key === "create");
        } else {
          r.classList.toggle("is-active", key === name || (name === "live" && key === "live"));
        }
      });
    }

    function typePrompt(done) {
      if (!typedEl) {
        if (done) done();
        return;
      }
      if (typingTimer) clearInterval(typingTimer);
      typedEl.textContent = "";
      if (caretEl) caretEl.classList.remove("is-hidden");
      if (replyEl) replyEl.setAttribute("hidden", "");
      if (reduceMotion) {
        typedEl.textContent = PROMPT;
        if (caretEl) caretEl.classList.add("is-hidden");
        if (done) done();
        return;
      }
      var i = 0;
      setStatus("is-busy", "Building");
      typingTimer = setInterval(function () {
        i += 1;
        typedEl.textContent = PROMPT.slice(0, i);
        if (i >= PROMPT.length) {
          clearInterval(typingTimer);
          typingTimer = null;
          if (caretEl) caretEl.classList.add("is-hidden");
          if (done) done();
        }
      }, 22);
    }

    function playBuildSequence() {
      showPanel("build");
      setStatus("is-busy", "Building");
      typePrompt(function () {
        if (replyEl && replyText) {
          replyEl.removeAttribute("hidden");
          replyText.textContent = "";
          if (reduceMotion) {
            replyText.textContent = REPLY;
            setStatus("is-busy", "Synced");
            return;
          }
          var j = 0;
          var t2 = setInterval(function () {
            j += 1;
            replyText.textContent = REPLY.slice(0, j);
            if (j >= REPLY.length) {
              clearInterval(t2);
              setStatus("", "Synced");
            }
          }, 12);
        } else {
          setStatus("", "Synced");
        }
      });
      buildPlayed = true;
    }

    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        var name = tab.getAttribute("data-tab");
        if (name === "build") {
          playBuildSequence();
        } else if (name === "live") {
          showPanel("live");
          setStatus(liveUrl && liveUrl.textContent.indexOf("spawn") !== -1 ? "is-live" : "", liveUrl && liveUrl.textContent.indexOf("spawn") !== -1 ? "Live" : "Ready");
        } else {
          showPanel("home");
          setStatus("", "Ready");
          if (runPill) {
            runPill.textContent = "Idle";
            runPill.classList.remove("is-running", "is-live");
          }
        }
      });
    });

    railItems.forEach(function (item) {
      item.addEventListener("click", function () {
        var key = item.getAttribute("data-rail");
        if (key === "build") {
          playBuildSequence();
        } else if (key === "live") {
          showPanel("live");
          tabs.forEach(function (t) {
            var on = t.getAttribute("data-tab") === "live";
            t.classList.toggle("is-active", on);
            t.setAttribute("aria-selected", on ? "true" : "false");
          });
          setStatus("", "Ready");
        } else if (key === "run") {
          showPanel("home");
          tabs.forEach(function (t) {
            var on = t.getAttribute("data-tab") === "home";
            t.classList.toggle("is-active", on);
            t.setAttribute("aria-selected", on ? "true" : "false");
          });
          railItems.forEach(function (r) {
            r.classList.toggle("is-active", r.getAttribute("data-rail") === "run");
          });
          if (runPill) {
            runPill.textContent = "Running";
            runPill.classList.add("is-running");
            runPill.classList.remove("is-live");
          }
          setStatus("is-busy", "Running");
          setTimeout(function () {
            if (runPill) {
              runPill.textContent = "Ready";
              runPill.classList.remove("is-running");
            }
            setStatus("", "Ready");
          }, reduceMotion ? 0 : 1400);
        } else {
          showPanel("home");
          tabs.forEach(function (t) {
            var on = t.getAttribute("data-tab") === "home";
            t.classList.toggle("is-active", on);
            t.setAttribute("aria-selected", on ? "true" : "false");
          });
          setStatus("", "Ready");
        }
      });
    });

    if (goLiveBtn) {
      goLiveBtn.addEventListener("click", function () {
        goLiveBtn.disabled = true;
        var label = goLiveBtn.textContent;
        goLiveBtn.textContent = "Publishing…";
        setStatus("is-busy", "Publishing");
        setTimeout(function () {
          if (liveUrl) liveUrl.textContent = "your-app.spawnapp.org";
          if (liveNote) {
            liveNote.textContent = "Live. Public URL is ready.";
            liveNote.classList.add("is-done");
          }
          goLiveBtn.textContent = "Live";
          setStatus("is-live", "Live");
          if (runPill) {
            runPill.textContent = "Live";
            runPill.classList.add("is-live");
          }
          setTimeout(function () {
            goLiveBtn.disabled = false;
            goLiveBtn.textContent = label;
          }, 2200);
        }, reduceMotion ? 0 : 900);
      });
    }

    /* Auto-demo once when stage enters view */
    if ("IntersectionObserver" in window && !reduceMotion) {
      var demoOnce = false;
      var io = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting && !demoOnce) {
              demoOnce = true;
              setTimeout(function () {
                if (!buildPlayed) playBuildSequence();
              }, 900);
              io.disconnect();
            }
          });
        },
        { threshold: 0.45 }
      );
      io.observe(stage);
    }
  }

  /* Early access form */
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
      } catch (_) { /* ignore */ }

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
