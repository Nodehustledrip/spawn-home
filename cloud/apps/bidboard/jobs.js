(function () {
  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function load() {
    var q = new URLSearchParams();
    var t = document.getElementById("trade").value;
    if (t) q.set("trade", t);
    var st = document.getElementById("state").value;
    if (st) q.set("state", st);
    var city = document.getElementById("city").value.trim();
    if (city) q.set("city", city);
    var z = document.getElementById("zip").value.trim();
    if (z) q.set("zip", z);
    var search = document.getElementById("q").value;
    if (search) q.set("q", search);
    var urgEl = document.getElementById("urgency");
    var urg = urgEl ? urgEl.value : "";
    if (urg) q.set("urgency", urg);
    try {
      BidBoardPlaces.saveLocation({ city: city, state: st, zip: z });
    } catch (_) {}
    fetch("api/jobs?" + q.toString())
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        if (!d || d.ok === false) {
          var errEl = document.getElementById("list");
          var msg = (d && d.error) || "Could not load jobs.";
          if (errEl) errEl.innerHTML = '<p class="muted">' + esc(msg) + ' Please refresh in a moment.</p>';
          var cEl = document.getElementById("count");
          if (cEl) cEl.textContent = "Unavailable";
          return;
        }
        if (d.leadFeeLabel) document.getElementById("fee").textContent = d.leadFeeLabel;
        var area = [];
        if (city) area.push(city);
        if (st) area.push(st);
        var n = typeof d.count === "number" ? d.count : (d.jobs ? d.jobs.length : 0);
        document.getElementById("count").textContent =
          n +
          " lead" +
          (n === 1 ? "" : "s") +
          (area.length ? " near " + area.join(", ") : "") +
          " — fee " +
          (d.leadFeeLabel || "");
        var el = document.getElementById("list");
        if (!d.jobs || !d.jobs.length) {
          el.innerHTML =
            '<div class="card empty-state" data-forge="jobs-empty" style="text-align:center;padding:28px 18px">' +
            '<h3 style="margin:0 0 8px">No jobs match these filters</h3>' +
            '<p class="muted" style="margin:0 0 16px">Try clearing filters or post a new job for this area.</p>' +
            '<p style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:0">' +
              '<a class="btn" href="post.html">Post a job</a>' +
              '<button type="button" class="btn ghost" id="clearFiltersBtn">Clear filters</button>' +
            '</p></div>';
          return;
        }
        el.innerHTML = d.jobs
          .map(function (j) {
            var urg =
              j.urgency === "Urgent"
                ? ' <span class="badge urgent">Urgent</span>'
                : j.urgency === "This week"
                  ? ' <span class="badge teal">This week</span>'
                  : "";
            var loc = esc(j.city) + (j.state ? ", " + esc(j.state) : "") + (j.zip ? " " + esc(j.zip) : "");
            return (
              '<div class="job"><div><span class="badge">' +
              esc(j.trade) +
              "  —  " +
              loc +
              "</span>" +
              urg +
              '<h3><a href="job.html?id=' +
              esc(j.id) +
              '">' +
              esc(j.title) +
              "</a></h3>" +
              '<p class="muted" style="margin:0;font-size:13px">' +
              esc(j.preview) +
              "</p>" +
              '<p class="muted" style="margin:6px 0 0;font-size:12px">' +
              (j.hasPhoto ? "Photo — " : "") +
              esc(j.urgency) +
              "</p></div><div style=\"text-align:right\"><div class=\"price\">" +
              esc(d.leadFeeLabel) +
              '</div><a class="btn sm" style="margin-top:8px" href="job.html?id=' +
              esc(j.id) +
              '">View / Unlock</a></div></div>'
            );
          })
          .join("");
      })
      .catch(function (err) {
        var el = document.getElementById("list");
        if (el) el.innerHTML = '<p class="muted">Could not load jobs (' + esc((err && err.message) || "network") + '). Please refresh in a moment.</p>';
        var cEl = document.getElementById("count");
        if (cEl) cEl.textContent = "Unavailable";
      });
  }

  var stateEl = document.getElementById("state");
  var cityEl = document.getElementById("city");
  var saved = BidBoardPlaces.readSavedLocation();
  BidBoardPlaces.loadStates(stateEl, saved && saved.state ? saved.state : "").then(function () {
    if (saved) {
      if (saved.city) cityEl.value = saved.city;
      if (saved.zip) document.getElementById("zip").value = saved.zip;
    }
    BidBoardPlaces.bindTypeahead({
      input: cityEl,
      stateSelect: stateEl,
      listEl: document.getElementById("cityList"),
      onPick: function () {
        load();
      },
    });
    load();
  });

  document.getElementById("filterBtn").addEventListener("click", load);
  document.getElementById("clearLoc").addEventListener("click", function () {
    stateEl.value = "";
    cityEl.value = "";
    document.getElementById("zip").value = "";
    var urgClear = document.getElementById("urgency");
    if (urgClear) urgClear.value = "";
    try {
      localStorage.removeItem("bb_location");
    } catch (_) {}
    load();
  });
  var qDebounce = null;
  document.getElementById("q").addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      if (qDebounce) clearTimeout(qDebounce);
      load();
    }
  });
  document.getElementById("q").addEventListener("input", function () {
    if (qDebounce) clearTimeout(qDebounce);
    qDebounce = setTimeout(function () { load(); }, 280);
  });
  document.querySelectorAll("#quick button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll("#quick button").forEach(function (b) {
        b.classList.remove("active");
      });
      btn.classList.add("active");
      document.getElementById("trade").value = btn.getAttribute("data-trade") || "";
      load();
    });
  });
})();

(function(){
  document.addEventListener("click", function(ev){
    if (!ev.target || ev.target.id !== "clearFiltersBtn") return;
    ["q","trade","city","state"].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=""; });
    var btn=document.getElementById("filterBtn"); if(btn) btn.click(); else if (typeof load==="function") load();
  });
})();
