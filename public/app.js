(function () {
  "use strict";

  var yearEl = document.querySelector("[data-year]");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Topbar scroll */
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
    toggle.addEventListener("click", function () {
      var open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", open ? "false" : "true");
      if (open) mobileNav.setAttribute("hidden", "");
      else mobileNav.removeAttribute("hidden");
    });
  }

  /* ——— Command palette / early access (home + ⌘K) ——— */
  var palette = document.querySelector("[data-palette]");
  var openBtns = document.querySelectorAll("[data-open-access]");
  var accessInput = document.querySelector("[data-access-input]");

  function openPalette() {
    if (!palette) {
      window.location.href = "/access.html";
      return;
    }
    palette.removeAttribute("hidden");
    document.body.style.overflow = "hidden";
    if (accessInput) {
      setTimeout(function () { accessInput.focus(); }, 40);
    }
  }
  function closePalette() {
    if (!palette) return;
    palette.setAttribute("hidden", "");
    document.body.style.overflow = "";
  }

  openBtns.forEach(function (btn) {
    btn.addEventListener("click", openPalette);
  });
  if (palette) {
    palette.querySelectorAll("[data-palette-close]").forEach(function (el) {
      el.addEventListener("click", closePalette);
    });
  }
  document.addEventListener("keydown", function (e) {
    var meta = e.metaKey || e.ctrlKey;
    if (meta && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      if (palette) {
        if (palette.hasAttribute("hidden")) openPalette();
        else closePalette();
      } else {
        window.location.href = "/access.html";
      }
    }
    if (e.key === "Escape") {
      closePalette();
      if (toggle && mobileNav && toggle.getAttribute("aria-expanded") === "true") {
        toggle.setAttribute("aria-expanded", "false");
        mobileNav.setAttribute("hidden", "");
      }
    }
  });

  /* ——— IDE surfaces ——— */
  var ide = document.querySelector("[data-ide]");
  if (ide) {
    var tabs = ide.querySelectorAll("[data-surface]");
    var panes = ide.querySelectorAll("[data-pane]");
    var loopBtns = ide.querySelectorAll("[data-loop]");
    var dot = ide.querySelector("[data-dot]");
    var statusEl = ide.querySelector("[data-status]");
    var runEl = ide.querySelector("[data-run]");
    var typedEl = ide.querySelector("[data-typed]");
    var caretEl = ide.querySelector("[data-caret]");
    var replyEl = ide.querySelector("[data-reply]");
    var replyText = ide.querySelector("[data-reply-text]");
    var diffEl = ide.querySelector("[data-diff]");
    var liveUrl = ide.querySelector("[data-live-url]");
    var urlBadge = ide.querySelector("[data-url-badge]");
    var goLiveBtn = ide.querySelector("[data-go-live]");
    var liveHint = ide.querySelector("[data-live-hint]");
    var captionEl = document.querySelector("[data-ide-caption]");

    var CAPTIONS = {
      home: "Home — your app files and a live preview on your machine.",
      build: "Example: ask Spawn to add pricing — it edits the file.",
      live: "Go Live — your public URL, domains, secrets, and plugins in one place."
    };

    var PROMPT = "Add a pricing table with three tiers and a monthly toggle.";
    var REPLY = "Done. Pricing now shows Free, Pro, and Team with a monthly toggle. Preview refreshed.";
    var typingTimer = null;
    var buildPlayed = false;
    var published = true;

    function setCaption(name) {
      if (captionEl && CAPTIONS[name]) captionEl.textContent = CAPTIONS[name];
    }

    function setStatus(kind, label) {
      if (dot) {
        dot.classList.remove("is-live", "is-busy");
        if (kind) dot.classList.add(kind);
      }
      if (statusEl) statusEl.textContent = label;
    }

    function syncTabs(name) {
      tabs.forEach(function (t) {
        var on = t.getAttribute("data-surface") === name;
        t.classList.toggle("is-on", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
      });
    }

    function syncLoop(name) {
      loopBtns.forEach(function (b) {
        var key = b.getAttribute("data-loop");
        var on =
          (name === "home" && key === "create") ||
          (name === "run" && key === "run") ||
          (name === "build" && key === "build") ||
          (name === "live" && key === "live");
        b.classList.toggle("is-on", on);
      });
    }

    function showPane(name) {
      panes.forEach(function (p) {
        var match = p.getAttribute("data-pane") === name;
        p.classList.toggle("is-on", match);
        if (match) p.removeAttribute("hidden");
        else p.setAttribute("hidden", "");
      });
      if (name === "home") {
        syncTabs("home");
        syncLoop("home");
        setCaption("home");
      } else if (name === "build") {
        syncTabs("build");
        syncLoop("build");
        setCaption("build");
      } else if (name === "live") {
        syncTabs("live");
        syncLoop("live");
        setCaption("live");
      }
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
      if (diffEl) diffEl.setAttribute("hidden", "");
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
      }, 18);
    }

    function playBuild() {
      showPane("build");
      setStatus("is-busy", "Building");
      typePrompt(function () {
        if (replyEl && replyText) {
          replyEl.removeAttribute("hidden");
          replyText.textContent = "";
          if (reduceMotion) {
            replyText.textContent = REPLY;
            if (diffEl) diffEl.removeAttribute("hidden");
            setStatus("", "Synced");
            return;
          }
          var j = 0;
          var t2 = setInterval(function () {
            j += 1;
            replyText.textContent = REPLY.slice(0, j);
            if (j >= REPLY.length) {
              clearInterval(t2);
              if (diffEl) diffEl.removeAttribute("hidden");
              setStatus("", "Synced");
            }
          }, 10);
        } else {
          setStatus("", "Synced");
        }
      });
      buildPlayed = true;
    }

    function showLive() {
      showPane("live");
      setStatus(published ? "is-live" : "", published ? "Live" : "Ready");
    }

    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        var name = tab.getAttribute("data-surface");
        if (name === "build") playBuild();
        else if (name === "live") showLive();
        else {
          showPane("home");
          syncLoop("create");
          setStatus("", "Ready");
          if (runEl) {
            runEl.textContent = "Idle";
            runEl.classList.remove("is-running", "is-live");
          }
        }
      });
    });

    loopBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var key = btn.getAttribute("data-loop");
        if (key === "build") {
          playBuild();
        } else if (key === "live") {
          showLive();
        } else if (key === "run") {
          showPane("home");
          syncTabs("home");
          syncLoop("run");
          setCaption("home");
          if (runEl) {
            runEl.textContent = "Running";
            runEl.classList.add("is-running");
            runEl.classList.remove("is-live");
          }
          setStatus("is-busy", "Running");
          setTimeout(function () {
            if (runEl) {
              runEl.textContent = "Ready";
              runEl.classList.remove("is-running");
            }
            setStatus("", "Ready");
          }, reduceMotion ? 0 : 1200);
        } else {
          showPane("home");
          syncTabs("home");
          syncLoop("create");
          setStatus("", "Ready");
          if (runEl) {
            runEl.textContent = "Idle";
            runEl.classList.remove("is-running", "is-live");
          }
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
          published = true;
          if (liveUrl) liveUrl.textContent = "https://your-app.spawnapp.org";
          if (urlBadge) {
            urlBadge.textContent = "Live";
            urlBadge.classList.add("is-live");
          }
          if (liveHint) {
            liveHint.textContent = "Live on the internet — without leaving Spawn.";
            liveHint.classList.add("is-done");
          }
          goLiveBtn.textContent = "Live";
          setStatus("is-live", "Live");
          if (runEl) {
            runEl.textContent = "Live";
            runEl.classList.add("is-live");
          }
          setTimeout(function () {
            goLiveBtn.disabled = false;
            goLiveBtn.textContent = label;
          }, 2000);
        }, reduceMotion ? 0 : 850);
      });
    }

    /* Default: Go Live (clear payoff). Desktop can still auto-demo Build once. */
    showLive();
    setCaption("live");

    if (!window.matchMedia("(max-width: 720px)").matches && "IntersectionObserver" in window && !reduceMotion) {
      var demoOnce = false;
      var io = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting && !demoOnce) {
              demoOnce = true;
              /* Stay on Go Live — clarity first. Optional build demo only if user hasn't switched. */
              io.disconnect();
            }
          });
        },
        { threshold: 0.35 }
      );
      io.observe(ide);
    }
  }

  /* Early access form (palette and /access.html) */
  var form = document.querySelector("[data-access-form]");
  var note = document.querySelector("[data-form-note]");
  var okIcon =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" style="vertical-align:-2px;margin-right:4px">' +
    '<circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.4"/>' +
    '<path d="M4.8 8.2l2.1 2.1 4.3-4.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>' +
    "</svg>";
  var errIcon =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" style="vertical-align:-2px;margin-right:4px">' +
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
        showNote("error", "Enter a valid work email.", errIcon);
        input.focus();
        return;
      }

      var btn = form.querySelector("[data-submit]");
      var label = form.querySelector("[data-submit-label]");
      var prevLabel = label ? label.textContent : "";
      if (btn) btn.disabled = true;
      if (label) label.textContent = "Joining…";

      var honeypot = form.querySelector('[name="company"]');
      var payload = {
        email: value,
        source: window.location.pathname || "web",
        company: honeypot ? honeypot.value : ""
      };

      fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload)
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, status: res.status, data: data || {} };
          }).catch(function () {
            return { ok: res.ok, status: res.status, data: {} };
          });
        })
        .then(function (result) {
          if (!result.ok || (result.data && result.data.ok === false)) {
            var msg =
              (result.data && result.data.error) ||
              (result.status === 429
                ? "Too many requests. Try again shortly."
                : "Something went wrong. Try again.");
            showNote("error", msg, errIcon);
            if (btn) btn.disabled = false;
            if (label) label.textContent = prevLabel;
            return;
          }

          try {
            var list = JSON.parse(localStorage.getItem("spawn_early_access") || "[]");
            var key = value.toLowerCase();
            if (list.indexOf(key) === -1) {
              list.push(key);
              localStorage.setItem("spawn_early_access", JSON.stringify(list));
            }
          } catch (_) { /* ignore */ }

          /* Event only — email stays server-side, not in PostHog */
          if (typeof window.spawnTrack === "function") {
            window.spawnTrack("early_access_requested", {
              source: window.location.pathname || "web",
              duplicate: !!(result.data && result.data.duplicate)
            });
          }

          form.reset();
          var successMsg = result.data && result.data.duplicate
            ? "You're already on the list. We'll be in touch."
            : "You're on the list. We'll be in touch.";
          showNote("success", successMsg, okIcon);
          if (label) label.textContent = "Requested";
          setTimeout(function () {
            if (label) label.textContent = prevLabel;
            if (btn) btn.disabled = false;
          }, 2800);
        })
        .catch(function () {
          showNote("error", "Network error. Check your connection and try again.", errIcon);
          if (btn) btn.disabled = false;
          if (label) label.textContent = prevLabel;
        });
    });
  }
})();
