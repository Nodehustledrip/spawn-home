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

  var proBtn = document.getElementById("proBtn"), billingBtn = document.getElementById("billingBtn");
  var proMsg = document.getElementById("proMsg"), proState = document.getElementById("proState");
  function proToast(text, err) { proMsg.className = "toast show" + (err ? " err" : ""); proMsg.textContent = text; }
  function signIn() { location.href = "login.html?next=" + encodeURIComponent("/contractors.html#pro"); }
  function post(url) {
    return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); });
  }
  function go(btn, url, busy) {
    var label = btn.textContent; btn.disabled = true; btn.textContent = busy;
    post(url).then(function (d) {
      if (d.url) { location.href = d.url; return; }
      btn.disabled = false; btn.textContent = label;
      if (d._status === 401) { signIn(); return; }
      proToast(d.error || "Something went wrong — try again.", true);
    }).catch(function () { btn.disabled = false; btn.textContent = label; proToast("Network error — try again.", true); });
  }
  proBtn.onclick = function () { go(proBtn, "api/pro/checkout", "Opening secure checkout…"); };
  billingBtn.onclick = function () { go(billingBtn, "api/billing/portal", "Opening billing…"); };
  fetch("api/pro/status").then(function (r) { return r.json(); }).then(function (st) {
    if (!st.proAvailable) { proBtn.hidden = true; proState.textContent = "Contractor Pro sign-up isn’t open on this board."; return; }
    if (st.pro) { proBtn.hidden = true; proState.textContent = "You’re on Contractor Pro (" + st.email + "). Leads unlock with no per-lead fee while you’re signed in."; }
    else if (st.signedIn) proState.textContent = "Signed in as " + st.email + ".";
    else { proState.textContent = "Sign in or create an account to start Pro."; proBtn.textContent = "Sign in to start Pro"; proBtn.onclick = signIn; }
    if (st.canManageBilling) billingBtn.hidden = false;
    if (/[?&]pro=welcome/.test(location.search) && st.pro) proToast("Welcome to Contractor Pro. Your plan is active.");
  }).catch(function () {});

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
