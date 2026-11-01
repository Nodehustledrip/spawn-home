(function () {
  var params = new URLSearchParams(location.search);
  var id = params.get("id");
  var token = params.get("token") || sessionStorage.getItem("bb_token_" + id) || "";

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function render(d) {
    var j = d.job;
    var el = document.getElementById("main");
    if (d.locked) {
      el.innerHTML =
        '<span class="badge">' +
        esc(j.trade) +
        "  -  " +
        esc(j.city) +
        (j.state ? ", " + esc(j.state) : "") +
        (j.zip ? " " + esc(j.zip) : "") +
        "</span>" +
        (j.urgency === "Urgent" ? ' <span class="badge urgent">Urgent</span>' : "") +
        '<h1 style="margin:12px 0 8px;letter-spacing:-0.02em">' +
        esc(j.title) +
        "</h1>" +
        '<p class="muted" style="margin:0">' +
        esc(j.urgency) +
        "  -  posted for local pros</p>" +
        '<p class="blurred" style="margin-top:16px">' +
        esc(j.preview) +
        " Contact details hidden until unlock.</p>" +
        '<div class="unlock-panel">' +
        "<h3 style=\"margin:0 0 6px\">Unlock this lead — " +
        esc(d.leadFeeLabel) +
        "</h3>" +
        '<p class="muted" style="font-size:13px;margin:0 0 14px" id="unlockPayHint">' +
        (d.paymentsLive
          ? "Secure checkout by Stripe. Contact details appear as soon as payment is confirmed."
          : "Payments aren’t switched on for this board yet — unlocking is a free preview for now.") +
        "</p>" +
        '<div class="grid 2">' +
        '<div class="field"><label>Your name</label><input id="cname" placeholder="Shop contact"/></div>' +
        '<div class="field"><label>Work email *</label><input id="cemail" type="email" required placeholder="you@company.com"/></div>' +
        "</div>" +
        '<div class="grid 2">' +
        '<div class="field"><label>Company</label><input id="ccompany" placeholder="Optional"/></div>' +
        '<div class="field"><label>Your category</label><select id="ctrade"><option value="plumbing">Plumbing</option><option value="hvac">HVAC</option><option value="electrical">Electrical</option><option value="cleaning">Cleaning</option><option value="landscaping">Landscaping</option><option value="moving">Moving</option><option value="painting">Painting</option><option value="handyman">Handyman</option><option value="auto">Mechanic / auto</option><option value="childcare">Babysitting / childcare</option><option value="tech">Tech / IT</option><option value="creative">Creative / design</option><option value="tutoring">Tutoring</option><option value="delivery">Delivery</option><option value="events">Events</option><option value="pet">Pet care</option><option value="beauty">Beauty / personal</option><option value="business">Business / admin</option><option value="general">General / other</option></select></div>' +
        "</div>" +
        '<button class="btn" id="unlockBtn">' +
        esc(d.paymentsLive ? ("Unlock lead  -  " + d.leadFeeLabel) : "Preview unlock") +
        "</button>" +
        '<div id="umsg" class="toast"></div>' +
        '<p class="muted" style="font-size:12px;margin-top:12px">Unlocks are tied to your email. On Contractor Pro? <a href="login.html?next=%2Fjob.html%3Fid%3D' + encodeURIComponent(j.id) + '">Sign in</a> to unlock with no per-lead fee.</p>' +
        "</div>";
      document.getElementById("unlockBtn").onclick = function () {
        var email = document.getElementById("cemail").value.trim();
        var msg = document.getElementById("umsg");
        if (!email) {
          msg.className = "toast show err";
          msg.textContent = "Work email is required.";
          return;
        }
        var btn = document.getElementById("unlockBtn");
        btn.disabled = true;
        fetch("api/leads/unlock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId: id,
            contractorName: document.getElementById("cname").value,
            contractorEmail: email,
            contractorTrade: document.getElementById("ctrade").value,
            company: document.getElementById("ccompany").value,
          }),
        })
          .then(function (r) {
            return r.json();
          })
          .then(function (u) {
            if (!u.ok) {
              msg.className = "toast show err";
              msg.textContent = (u.error || "Failed") + (u.honesty ? " — " + u.honesty : "");
              btn.disabled = false;
              return;
            }
            msg.className = "toast show";
            var payUrl = u.checkoutUrl || (u.unlock && u.unlock.checkoutUrl) || null;
            var cta = u.connectPaymentsCta || "Payments aren’t switched on for this board yet";
            // Pass X: trust API honesty flags — never treat a URL alone as "live" when demoMode
            var demo = u.demoMode === true || u.paymentsLive === false;
            var live = !demo && !!(u.paymentsLive || payUrl);
            msg.textContent = u.message || u.buttonHint || (live ? "Opening live checkout…" : cta);
            if (!live) {
              var hint = document.getElementById("unlockPayHint");
              if (hint) {
                hint.innerHTML = esc(u.honesty || cta);
              }
              if (btn && u.buttonHint) btn.textContent = u.buttonHint;
            }
            if (live && payUrl) { if (u.unlock && u.unlock.token) sessionStorage.setItem("bb_pending_" + id, u.unlock.token); location.href = payUrl; return; }
            // Only reveal contact for demo_unlocked / paid — not pending_payment
            var st = (u.unlock && u.unlock.status) || "";
            var canReveal = st === "demo_unlocked" || st === "paid" || (!live && u.unlock && u.unlock.token && u.job && (u.job.name || u.job.phone));
            if (!live && canReveal && u.unlock && u.unlock.token && u.job && (u.job.name || u.job.phone)) {
              sessionStorage.setItem("bb_token_" + id, u.unlock.token);
              sessionStorage.setItem("bb_unlock_" + id, JSON.stringify(u.job));
              location.href = "job.html?id=" + encodeURIComponent(id) + "&token=" + encodeURIComponent(u.unlock.token);
            } else if (live) {
              btn.disabled = false;
              btn.textContent = "Checkout opened — complete payment to unlock";
              if (u.unlock && u.unlock.token) sessionStorage.setItem("bb_pending_" + id, u.unlock.token);
            }
          })
          .catch(function () {
            msg.className = "toast show err";
            msg.textContent = "Network error";
            btn.disabled = false;
          });
      };
      return;
    }

    var photo = j.photoDataUrl
      ? '<p style="margin-top:14px"><img class="thumb" src="' + j.photoDataUrl + '" alt="Job photo"/></p>'
      : "";
    el.innerHTML =
      '<span class="badge ok">Unlocked lead</span>' +
      '<h1 style="margin:12px 0 8px;letter-spacing:-0.02em">' +
      esc(j.title) +
      "</h1>" +
      '<p class="muted" style="margin:0">' +
      esc(j.trade) +
      "  -  " +
      esc(j.city) +
      (j.state ? ", " + esc(j.state) : "") +
      (j.zip ? " " + esc(j.zip) : "") +
      "  —  " +
      esc(j.urgency) +
      "</p>" +
      '<p style="margin-top:16px;line-height:1.6">' +
      esc(j.description) +
      "</p>" +
      photo +
      '<div class="contact-box">' +
      "<h3 style=\"margin:0 0 8px\">Poster contact</h3>" +
      "<p style=\"margin:0\"><strong>" +
      esc(j.name) +
      "</strong><br/>" +
      '<a href="tel:' +
      esc(j.phone) +
      '">' +
      esc(j.phone) +
      "</a>" +
      (j.email ? "<br/><a href=\"mailto:" + esc(j.email) + '">' + esc(j.email) + "</a>" : "") +
      "</p></div>" +
      '<p class="row" style="margin-top:18px"><a class="btn ghost" href="jobs.html">Back to board</a></p>';
  }

  if (!id) {
    document.getElementById("main").innerHTML = '<p class="muted">Missing job id. <a href="jobs.html">Browse jobs</a></p>';
    return;
  }

  var cached = sessionStorage.getItem("bb_unlock_" + id);
  if (token && cached) {
    render({ locked: false, job: JSON.parse(cached), leadFeeLabel: "$25.00" });
    return;
  }

  var url = "api/jobs/" + encodeURIComponent(id);
  if (token) url += "?token=" + encodeURIComponent(token);
  Promise.all([
    fetch(url).then(function (r) { return r.json(); }),
    fetch("api/config").then(function (r) { return r.json(); }).catch(function () { return {}; }),
  ])
    .then(function (pair) {
      var d = pair[0];
      var cfg = pair[1] || {};
      if (!d.ok) {
        document.getElementById("main").textContent = d.error || "Not found";
        return;
      }
      d.paymentsLive = !!(cfg.paymentsLive || d.paymentsLive);
      d.connectPaymentsCta = cfg.connectPaymentsCta || "Payments aren’t switched on for this board yet";
      render(d);
    });
})();
