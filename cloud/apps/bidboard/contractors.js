(function () {
  fetch("api/config")
    .then(function (r) {
      return r.json();
    })
    .then(function (c) {
      if (c.leadFeeLabel) document.getElementById("fee").textContent = c.leadFeeLabel;
      if (c.proFeeLabel) document.getElementById("proFee").textContent = c.proFeeLabel;
      if (c.crossSell) document.getElementById("crossSell").textContent = c.crossSell;
    });

  var saved = BidBoardPlaces.readSavedLocation();
  var existing = null;
  try {
    existing = JSON.parse(localStorage.getItem("bb_contractor") || "null");
  } catch (_) {}
  BidBoardPlaces.loadStates(
    document.getElementById("sstate"),
    (existing && existing.state) || (saved && saved.state) || ""
  ).then(function () {
    if (existing) {
      if (existing.name) document.getElementById("sname").value = existing.name;
      if (existing.email) document.getElementById("semail").value = existing.email;
      if (existing.trade) document.getElementById("strade").value = existing.trade;
      if (existing.company) document.getElementById("scompany").value = existing.company || "";
      if (existing.phone) document.getElementById("sphone").value = existing.phone || "";
      if (existing.license) document.getElementById("slicense").value = existing.license || "";
      if (existing.city) document.getElementById("scity").value = existing.city;
      if (existing.zip) document.getElementById("szip").value = existing.zip || "";
      var submitBtn = document.querySelector("#signupForm button[type=submit]");
      if (submitBtn) submitBtn.textContent = "Update Pro profile";
      var head = document.querySelector("#signup h2");
      if (head) head.textContent = "Edit your Pro profile";
      if (existing.city || existing.state) {
        document.getElementById("profileLoc").textContent =
          "Editing saved profile for " +
          (existing.email || "") +
          " — area: " +
          (existing.city || "") +
          (existing.state ? ", " + existing.state : "") +
          (existing.zip ? " " + existing.zip : "") +
          ". Change any field and save to update.";
      }
    } else if (saved && saved.city) {
      document.getElementById("scity").value = saved.city;
      if (saved.zip) document.getElementById("szip").value = saved.zip;
    }
  });
  BidBoardPlaces.bindTypeahead({
    input: document.getElementById("scity"),
    stateSelect: document.getElementById("sstate"),
    listEl: document.getElementById("scityList"),
  });

  document.getElementById("proBtn").onclick = function () {
    var email = document.getElementById("proEmail").value.trim();
    var msg = document.getElementById("proMsg");
    fetch("api/pro/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        msg.className = "toast show";
        msg.textContent = d.message || "Recorded";
        if (d.checkoutUrl) window.open(d.checkoutUrl, "_blank");
      });
  };

  document.getElementById("signupForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var msg = document.getElementById("smsg");
    var body = {
      name: document.getElementById("sname").value,
      company: document.getElementById("scompany").value,
      email: document.getElementById("semail").value,
      phone: document.getElementById("sphone").value,
      trade: document.getElementById("strade").value,
      zip: document.getElementById("szip").value,
      city: document.getElementById("scity").value,
      state: document.getElementById("sstate").value,
      license: document.getElementById("slicense").value,
    };
    if (!body.city || !body.state) {
      msg.className = "toast show err";
      msg.textContent = "City and state are required.";
      return;
    }
    fetch("api/contractors", {
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
          msg.textContent = d.error || "Failed";
          return;
        }
        msg.className = "toast show";
        msg.textContent = d.message;
        var profile = {
          email: body.email,
          name: body.name,
          trade: body.trade,
          company: body.company,
          phone: body.phone,
          license: body.license,
          city: body.city,
          state: body.state,
          zip: body.zip,
        };
        try {
          localStorage.setItem("bb_contractor", JSON.stringify(profile));
          BidBoardPlaces.saveLocation({ city: body.city, state: body.state, zip: body.zip });
        } catch (_) {}
        var submitBtn2 = document.querySelector("#signupForm button[type=submit]");
        if (submitBtn2) submitBtn2.textContent = "Update Pro profile";
        var head2 = document.querySelector("#signup h2");
        if (head2) head2.textContent = "Edit your Pro profile";
        document.getElementById("profileLoc").textContent =
          (d.returning ? "Profile updated" : "Profile saved") +
          " — " + body.city + ", " + body.state + (body.zip ? " " + body.zip : "") +
          ". Browse jobs near you; unlocks use this email.";
      })
      .catch(function () {
        msg.className = "toast show err";
        msg.textContent = "Network error";
      });
  });
})();
