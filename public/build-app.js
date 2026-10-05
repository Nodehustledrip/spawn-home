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
    if (!list) return;
    list.innerHTML = "";
    if (!state.builds.length) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    state.builds.forEach(function (b) {
      var li = el("li", "build-list-item" + (b.id === state.activeId ? " is-on" : ""));
      var btn = el("button", "build-list-btn");
      btn.type = "button";
      btn.appendChild(el("strong", null, b.name || b.id));
      btn.appendChild(el("span", "mono", b.template || ""));
      btn.addEventListener("click", function () {
        openBuild(b.id);
      });
      li.appendChild(btn);
      list.appendChild(li);
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
  }

  function appendChat(role, text) {
    var log = $("[data-chat-log]");
    if (!log) return;
    var row = el("div", "build-chat-row is-" + role);
    row.appendChild(el("span", "build-chat-role", role === "you" ? "You" : "Build"));
    row.appendChild(el("p", null, text));
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }

  function openBuild(id) {
    state.activeId = id;
    renderList();
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
    return fetch("/api/builds", { credentials: "same-origin" })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data || !data.ok) return;
        state.builds = data.builds || [];
        renderList();
        if (state.activeId) {
          var still = state.builds.some(function (b) {
            return b.id === state.activeId;
          });
          if (still) openBuild(state.activeId);
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
      })
      .catch(function () {
        renderTemplates();
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
    if (label) label.textContent = "Creating…";
    setNote("");

    fetch("/api/builds", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name,
        description: desc,
        template: state.selectedTemplate,
        company: company,
      }),
    })
      .then(function (r) {
        return r.json().then(function (data) {
          return { status: r.status, data: data };
        });
      })
      .then(function (res) {
        if (!res.data || !res.data.ok || !res.data.build) {
          setNote((res.data && res.data.error) || "Could not create.", true);
          return;
        }
        setNote("Created — preview on the right.");
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

    fetch("/api/builds/" + encodeURIComponent(state.activeId) + "/edit", {
      method: "POST",
      credentials: "same-origin",
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
          appendChat("build", (res.data && res.data.error) || "Edit failed.");
          return;
        }
        appendChat("build", (res.data.mode === "ai" ? "✦ " : "") + (res.data.reply || "Done."));
        var path = res.data.previewPath || "/preview/" + state.activeId + "/";
        showPreview(path);
        if (res.data.build) {
          state.builds = state.builds.map(function (b) {
            return b.id === res.data.build.id ? Object.assign({}, b, res.data.build) : b;
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
    var form = $("[data-create-form]");
    if (form) form.addEventListener("submit", onCreate);
    var chat = $("[data-chat-form]");
    if (chat) chat.addEventListener("submit", onChat);
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
        state.aiReady = !!(data && data.configured);
        var badge = $("[data-ai-badge]");
        if (badge) {
          badge.hidden = !state.aiReady;
          badge.textContent = data && data.degraded ? "AI Build (fallback)" : "AI Build ready";
          badge.classList.toggle("is-degraded", !!(data && data.degraded));
          if (state.aiReady && data.model) badge.title = "Edits powered by " + data.model;
        }
        var hint = $("[data-chat-hint]");
        if (hint && state.aiReady) {
          hint.textContent =
            "AI Build ready — describe any change in plain words (sections, copy, layout, style). Falls back to offline rules if AI is unavailable.";
        }
        var input = $("[data-chat-input]");
        if (input && state.aiReady) {
          input.placeholder = "Describe a change — e.g. “add a team section with 3 founders”";
        }
      })
      .catch(function () {});
  }

  function init() {
    loadAiStatus();
    bind();
    renderTemplates();
    loadTemplates();
    loadBuilds();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
