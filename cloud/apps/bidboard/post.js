(function () {
  var photoDataUrl = null;
  var photoName = null;
  var saved = BidBoardPlaces.readSavedLocation();
  BidBoardPlaces.loadStates(document.getElementById("state"), saved && saved.state ? saved.state : "").then(function () {
    if (saved) {
      if (saved.city) document.getElementById("city").value = saved.city;
      if (saved.zip) document.getElementById("zip").value = saved.zip;
    }
  });
  BidBoardPlaces.bindTypeahead({
    input: document.getElementById("city"),
    stateSelect: document.getElementById("state"),
    listEl: document.getElementById("cityList"),
  });

  document.getElementById("photo").addEventListener("change", function (e) {
    var f = e.target.files[0];
    if (!f) return;
    photoName = f.name;
    var reader = new FileReader();
    reader.onload = function () {
      photoDataUrl = reader.result;
    };
    reader.readAsDataURL(f);
  });
  document.getElementById("suggestBtn").addEventListener("click", function () {
    fetch("api/jobs/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: document.getElementById("description").value,
        trade: document.getElementById("trade").value,
        zip: document.getElementById("zip").value,
      }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        if (!d.ok) return;
        document.getElementById("title").value = d.suggestion.title;
        document.getElementById("urgency").value = d.suggestion.urgency;
        document.getElementById("helper").textContent = d.suggestion.helper;
      });
  });
  document.getElementById("jobForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var fd = new FormData(e.target);
    var body = {
      trade: fd.get("trade"),
      zip: fd.get("zip"),
      city: fd.get("city"),
      state: fd.get("state"),
      description: fd.get("description"),
      title: fd.get("title"),
      urgency: fd.get("urgency"),
      name: fd.get("name"),
      phone: fd.get("phone"),
      email: fd.get("email"),
      photoName: photoName,
      photoDataUrl: photoDataUrl,
    };
    var msg = document.getElementById("msg");
    if (!body.city || !body.state) {
      msg.className = "toast show err";
      msg.textContent = "City and state are required.";
      return;
    }
    fetch("api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        if (!d.ok) {
          msg.className = "toast show err";
          msg.textContent = (d.error || "Failed") + (d.honesty ? " — " + d.honesty : "");
          return;
        }
        try {
          BidBoardPlaces.saveLocation({ city: body.city, state: body.state, zip: body.zip });
        } catch (_) {}
        try {
          localStorage.setItem("bb_last_post", JSON.stringify({ id: d.job && d.job.id, email: body.email, phone: body.phone, at: Date.now() }));
        } catch (_) {}
        msg.className = "toast show";
        msg.textContent = "Posted! Job ID " + ((d.job && d.job.id) || "") + " — you can delete it below with the same email/phone.";
        setTimeout(function () {
          location.href = "jobs.html";
        }, 1400);
      })
      .catch(function () {
        msg.className = "toast show err";
        msg.textContent = "Network error";
      });
  });


  // Pass T — delete own posted job UI polish (email/phone match + ?id= autofill)
  (function bindDeleteOwn() {
    var btn = document.getElementById("delJobBtn");
    if (!btn) return;
    try {
      var last = JSON.parse(localStorage.getItem("bb_last_post") || "null");
      if (last) {
        if (last.id && document.getElementById("delJobId")) document.getElementById("delJobId").value = last.id;
        if (last.email && document.getElementById("delEmail")) document.getElementById("delEmail").value = last.email;
        if (last.phone && document.getElementById("delPhone")) document.getElementById("delPhone").value = last.phone;
      }
    } catch (_) {}
    try {
      var qid = new URLSearchParams(location.search).get("id") || new URLSearchParams(location.search).get("job");
      if (qid && document.getElementById("delJobId") && !document.getElementById("delJobId").value) {
        document.getElementById("delJobId").value = qid;
      }
    } catch (_) {}
    btn.addEventListener("click", function () {
      var id = (document.getElementById("delJobId") || {}).value || "";
      id = String(id).trim();
      var email = String((document.getElementById("delEmail") || {}).value || "").trim();
      var phone = String((document.getElementById("delPhone") || {}).value || "").trim();
      var msg = document.getElementById("delMsg");
      if (!id) {
        if (msg) { msg.style.color = "#fca5a5"; msg.textContent = "Enter the job ID from your post confirmation or job URL (?id=…)."; }
        return;
      }
      if (!email && !phone) {
        if (msg) { msg.style.color = "#fca5a5"; msg.textContent = "Enter the email or phone used when posting."; }
        return;
      }
      if (!confirm("Permanently delete job " + id + "?\n\nThis cannot be undone. Only works with the email/phone from the original post.")) return;
      btn.disabled = true;
      if (msg) { msg.style.color = ""; msg.textContent = "Deleting…"; }
      fetch("api/jobs/" + encodeURIComponent(id), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, phone: phone }),
      })
        .then(function (r) { return r.json().then(function (d) { return { status: r.status, d: d }; }); })
        .then(function (x) {
          var d = x.d || {};
          btn.disabled = false;
          if (x.status === 429) {
            if (msg) { msg.style.color = "#fca5a5"; msg.textContent = (d.error || "Too many requests") + (d.honesty ? " — " + d.honesty : " — Rate limit: wait a minute and retry."); }
            return;
          }
          if (!d.ok) {
            if (msg) { msg.style.color = "#fca5a5"; msg.textContent = (d.error || "Delete failed") + (d.honesty ? " — " + d.honesty : ""); }
            return;
          }
          if (msg) { msg.style.color = "#6ee7b7"; msg.textContent = (d.message || "Deleted.") + " Job " + id + " is gone."; }
          try { localStorage.removeItem("bb_last_post"); } catch (_) {}
          var idEl = document.getElementById("delJobId");
          if (idEl) idEl.value = "";
        })
        .catch(function (err) {
          btn.disabled = false;
          if (msg) { msg.style.color = "#fca5a5"; msg.textContent = "Network error: " + ((err && err.message) || "failed"); }
        });
    });
  })();

})();
