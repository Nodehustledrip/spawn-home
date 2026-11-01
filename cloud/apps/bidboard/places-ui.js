(function (global) {
  var STATES_CACHE = null;

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function loadStates(selectEl, selected) {
    function fill(states) {
      if (!selectEl) return;
      var cur = selected || selectEl.value || "";
      selectEl.innerHTML =
        '<option value="">State</option>' +
        states
          .map(function (st) {
            return (
              '<option value="' +
              esc(st.code) +
              '"' +
              (st.code === cur ? " selected" : "") +
              ">" +
              esc(st.code + " — " + st.name) +
              "</option>"
            );
          })
          .join("");
      if (cur) selectEl.value = cur;
    }
    if (STATES_CACHE) {
      fill(STATES_CACHE);
      return Promise.resolve(STATES_CACHE);
    }
    return fetch("api/places/states")
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        STATES_CACHE = (d && d.states) || [];
        fill(STATES_CACHE);
        return STATES_CACHE;
      })
      .catch(function () {
        fill([]);
        return [];
      });
  }

  function bindTypeahead(opts) {
    var input = opts.input;
    var stateSelect = opts.stateSelect || null;
    var listEl = opts.listEl;
    var onPick = opts.onPick || function () {};
    var timer = null;
    if (!input || !listEl) return;

    function hide() {
      listEl.classList.remove("show");
      listEl.innerHTML = "";
    }

    function show(results) {
      if (!results.length) {
        hide();
        return;
      }
      listEl.innerHTML = results
        .map(function (r, i) {
          return (
            '<button type="button" class="place-opt" data-i="' +
            i +
            '" data-city="' +
            esc(r.city) +
            '" data-state="' +
            esc(r.stateCode) +
            '">' +
            esc(r.label || r.city + ", " + r.stateCode) +
            "</button>"
          );
        })
        .join("");
      listEl.classList.add("show");
      listEl.querySelectorAll(".place-opt").forEach(function (btn) {
        btn.addEventListener("mousedown", function (e) {
          e.preventDefault();
          input.value = btn.getAttribute("data-city") || "";
          if (stateSelect) stateSelect.value = btn.getAttribute("data-state") || "";
          onPick({
            city: btn.getAttribute("data-city"),
            stateCode: btn.getAttribute("data-state"),
          });
          hide();
        });
      });
    }

    function search() {
      var q = input.value.trim();
      var st = stateSelect ? stateSelect.value : "";
      if (q.length < 1 && !st) {
        hide();
        return;
      }
      var params = new URLSearchParams();
      if (q) params.set("q", q);
      if (st) params.set("state", st);
      params.set("limit", "20");
      fetch("api/places/search?" + params.toString())
        .then(function (r) {
          return r.json();
        })
        .then(function (d) {
          show((d && d.results) || []);
        })
        .catch(hide);
    }

    input.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(search, 180);
    });
    input.addEventListener("focus", function () {
      if (input.value.trim().length >= 1) search();
    });
    input.addEventListener("blur", function () {
      setTimeout(hide, 150);
    });
    if (stateSelect) {
      stateSelect.addEventListener("change", function () {
        if (input.value.trim().length >= 1) search();
      });
    }
  }

  function readSavedLocation() {
    try {
      var loc = localStorage.getItem("bb_location");
      if (loc) return JSON.parse(loc);
    } catch (_) {}
    try {
      var c = localStorage.getItem("bb_contractor");
      if (c) {
        var o = JSON.parse(c);
        if (o.city || o.state) return { city: o.city || "", state: o.state || "", zip: o.zip || "" };
      }
    } catch (_) {}
    return null;
  }

  function saveLocation(loc) {
    try {
      localStorage.setItem(
        "bb_location",
        JSON.stringify({
          city: loc.city || "",
          state: loc.state || "",
          zip: loc.zip || "",
        })
      );
    } catch (_) {}
  }

  global.BidBoardPlaces = {
    loadStates: loadStates,
    bindTypeahead: bindTypeahead,
    readSavedLocation: readSavedLocation,
    saveLocation: saveLocation,
  };
})(window);
