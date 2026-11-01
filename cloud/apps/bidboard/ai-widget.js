(function () {
  if (document.getElementById("afAiRoot")) return;

  var css =
    "#afAiRoot{all:initial;font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}" +
    "#afAiRoot *{box-sizing:border-box}" +
    "#afAiFab{position:fixed;right:20px;bottom:20px;z-index:2147483000;display:inline-flex;align-items:center;gap:10px;" +
    "padding:12px 18px;border:1px solid rgba(255,255,255,.12);border-radius:999px;cursor:pointer;" +
    "color:#f4f7fb;background:linear-gradient(135deg,rgba(28,32,44,.92),rgba(12,14,20,.88));" +
    "backdrop-filter:blur(18px) saturate(140%);-webkit-backdrop-filter:blur(18px) saturate(140%);" +
    "box-shadow:0 18px 50px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.04) inset;font:600 13px/1 Inter,system-ui,sans-serif;letter-spacing:.02em}" +
    "#afAiFab:hover{transform:translateY(-1px);box-shadow:0 22px 56px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.08) inset}" +
    "#afAiFab .dot{width:8px;height:8px;border-radius:50%;background:#7dd3c0;box-shadow:0 0 12px rgba(125,211,192,.7)}" +
    "#afAiPanel{display:none;position:fixed;right:20px;bottom:76px;z-index:2147483000;width:min(380px,calc(100vw - 28px));" +
    "height:min(520px,calc(100vh - 110px));flex-direction:column;overflow:hidden;border-radius:20px;" +
    "border:1px solid rgba(255,255,255,.1);color:#e8eef7;" +
    "background:linear-gradient(165deg,rgba(22,26,36,.94),rgba(10,12,18,.92));" +
    "backdrop-filter:blur(22px) saturate(150%);-webkit-backdrop-filter:blur(22px) saturate(150%);" +
    "box-shadow:0 30px 80px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.04) inset}" +
    "#afAiPanel.open{display:flex}" +
    "#afAiHead{display:flex;align-items:center;justify-content:space-between;padding:16px 18px 12px;border-bottom:1px solid rgba(255,255,255,.06)}" +
    "#afAiHead strong{font:600 14px/1.2 Inter,system-ui,sans-serif;letter-spacing:.01em}" +
    "#afAiHead span{display:block;margin-top:4px;font:400 11px/1.3 Inter,system-ui,sans-serif;color:rgba(232,238,247,.55)}" +
    "#afAiClose{appearance:none;border:0;background:transparent;color:rgba(232,238,247,.6);cursor:pointer;font-size:18px;line-height:1;padding:4px 6px}" +
    "#afAiLog{flex:1;overflow:auto;padding:14px 16px;display:flex;flex-direction:column;gap:10px}" +
    ".afAiMsg{max-width:92%;padding:10px 12px;border-radius:14px;font:400 13px/1.45 Inter,system-ui,sans-serif;white-space:pre-wrap;word-break:break-word}" +
    ".afAiMsg.user{align-self:flex-end;background:rgba(125,211,192,.16);border:1px solid rgba(125,211,192,.22);color:#f2fbf8}" +
    ".afAiMsg.bot{align-self:flex-start;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);color:#e8eef7}" +
    ".afAiMsg.sys{align-self:stretch;background:transparent;border:1px dashed rgba(255,255,255,.12);color:rgba(232,238,247,.62);font-size:12px}" +
    "#afAiForm{display:flex;gap:8px;padding:12px 14px 14px;border-top:1px solid rgba(255,255,255,.06)}" +
    "#afAiInput{flex:1;min-width:0;height:42px;padding:0 14px;border-radius:12px;border:1px solid rgba(255,255,255,.1);" +
    "background:rgba(0,0,0,.28);color:#f4f7fb;outline:none;font:400 13px/1 Inter,system-ui,sans-serif}" +
    "#afAiInput:focus{border-color:rgba(125,211,192,.45);box-shadow:0 0 0 3px rgba(125,211,192,.12)}" +
    "#afAiSend{height:42px;padding:0 16px;border:0;border-radius:12px;cursor:pointer;font:600 13px/1 Inter,system-ui,sans-serif;" +
    "color:#0b1210;background:linear-gradient(135deg,#9be7d4,#6bc4b0);box-shadow:0 8px 20px rgba(107,196,176,.25)}" +
    "#afAiSend:disabled{opacity:.55;cursor:wait}";

  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  var root = document.createElement("div");
  root.id = "afAiRoot";
  root.innerHTML =
    '<button type="button" id="afAiFab" aria-label="Open assistant"><span class="dot" aria-hidden="true"></span>Assistant</button>' +
    '<div id="afAiPanel" role="dialog" aria-label="Product assistant">' +
    '<div id="afAiHead"><div><strong>Assistant</strong><span>Product help — not a code editor</span></div>' +
    '<button type="button" id="afAiClose" aria-label="Close">×</button></div>' +
    '<div id="afAiLog"></div>' +
    '<form id="afAiForm"><input id="afAiInput" autocomplete="off" placeholder="Ask about this product…" />' +
    '<button type="submit" id="afAiSend">Send</button></form></div>';
  document.body.appendChild(root);

  var panel = document.getElementById("afAiPanel");
  var log = document.getElementById("afAiLog");
  var input = document.getElementById("afAiInput");
  var send = document.getElementById("afAiSend");
  var open = false;

  function chatUrl() {
    try {
      var p = location.pathname || "/";
      if (p.indexOf("/hosted/") === 0) {
        var parts = p.split("/");
        if (parts.length >= 3 && parts[2]) return "/hosted/" + parts[2] + "/api/ai/chat";
      }
    } catch (_) {}
    return "api/ai/chat";
  }

  function add(role, text) {
    var d = document.createElement("div");
    d.className = "afAiMsg " + role;
    d.textContent = text;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
  }

  add(
    "sys",
    "Ask how this product works. I won't change source code, secrets, or deploys. If AI_API_KEY is missing, you'll see an honest empty state."
  );

  function setOpen(v) {
    open = !!v;
    panel.classList.toggle("open", open);
    if (open) setTimeout(function () { input.focus(); }, 30);
  }

  document.getElementById("afAiFab").onclick = function () { setOpen(!open); };
  document.getElementById("afAiClose").onclick = function () { setOpen(false); };

  document.getElementById("afAiForm").onsubmit = function (e) {
    e.preventDefault();
    var v = (input.value || "").trim();
    if (!v) return;
    add("user", v);
    input.value = "";
    send.disabled = true;
    fetch(chatUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: v }),
    })
      .then(function (r) {
        return r.json().then(function (d) {
          return { status: r.status, d: d };
        });
      })
      .then(function (x) {
        var d = x.d || {};
        if (d.reply) add("bot", d.reply);
        else if (d.error) add("sys", d.error);
        else add("sys", "No reply — check AI_API_KEY in Secrets and that the app is Running.");
      })
      .catch(function () {
        add("sys", "Could not reach the assistant — is the app Running?");
      })
      .finally(function () {
        send.disabled = false;
      });
  };
})();
