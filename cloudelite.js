"use strict";
/* Spawn Elite perks for published apps: password protection and visitor stats.
 * The Worker (cloud/src/elite.js) enforces both at the edge; this module lets the owner manage them.
 * Passwords are stored only as PBKDF2-SHA256 hashes. Stats are aggregate daily counts (no IPs, no personal data). */
const crypto = require("crypto");
const ITER = 10000; // kept modest: the Worker verifies on the free plan's CPU budget
const DDL = [
  "CREATE TABLE IF NOT EXISTS app_protect (slug TEXT PRIMARY KEY, pw_hash TEXT NOT NULL, pw_salt TEXT NOT NULL, iterations INTEGER NOT NULL DEFAULT 10000, ver INTEGER NOT NULL DEFAULT 1, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)",
  "CREATE TABLE IF NOT EXISTS app_stats (slug TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, k TEXT NOT NULL DEFAULT '', n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (slug, day, kind, k))",
  "CREATE TABLE IF NOT EXISTS app_features (slug TEXT PRIMARY KEY, stats INTEGER NOT NULL DEFAULT 0, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)",
];
function hashPassword(pw, saltHex, iter) {
  return crypto.pbkdf2Sync(String(pw), Buffer.from(saltHex, "hex"), iter || ITER, 32, "sha256").toString("hex");
}

let tierHook = null;
/** Called by billing when an account's tier changes: stats follow Elite on/off. Passwords stay until the owner removes them. */
async function onTierChange(userId, t) { if (tierHook && userId != null) await tierHook(String(userId), t); }
function mountElite(r, h) {
  const { wrap, fail, anyUser, ownedApp, be, auth } = h;
  let ready = null;
  const ensure = () => (ready = ready || (async () => { for (const s of DDL) await be().query(s, []); })().catch((e) => { ready = null; throw e; }));
  async function tier(u) { const acct = (auth.userById ? await auth.userById(u.id) : null) || u; return auth.tierOf ? auth.tierOf(acct) : "free"; }
  function needElite(what) { const e = fail(402, what + " is part of Spawn Elite. Upgrade at spawnapp.org/account."); e.upgrade = "/account#elite"; e.offer = "elite"; return e; }
  async function setStats(slug, on) {
    await ensure();
    await be().query("INSERT INTO app_features (slug, stats) VALUES (?1, ?2) ON CONFLICT(slug) DO UPDATE SET stats=excluded.stats, updated_at=CURRENT_TIMESTAMP", [slug, on ? 1 : 0]);
  }

  r.get("/apps/:slug/protect", wrap(async (req, res) => {
    const u = await anyUser(req); const a = await ownedApp(u, req.params.slug, false); await ensure();
    const rows = await be().query("SELECT updated_at FROM app_protect WHERE slug=?1", [a.slug]);
    res.json({ ok: true, protected: !!rows[0], updatedAt: rows[0] ? rows[0].updated_at : null, elite: (await tier(u)) === "elite" });
  }));
  r.put("/apps/:slug/protect", wrap(async (req, res) => {
    const u = await anyUser(req); const a = await ownedApp(u, req.params.slug, false);
    if ((await tier(u)) !== "elite") throw needElite("Password protection");
    const pw = String((req.body && req.body.password) || "");
    if (pw.length < 6 || pw.length > 200) throw fail(400, "Use a password of 6 to 200 characters.");
    await ensure();
    const salt = crypto.randomBytes(16).toString("hex");
    await be().query("INSERT INTO app_protect (slug, pw_hash, pw_salt, iterations, ver) VALUES (?1,?2,?3,?4,1) ON CONFLICT(slug) DO UPDATE SET pw_hash=excluded.pw_hash, pw_salt=excluded.pw_salt, iterations=excluded.iterations, ver=app_protect.ver+1, updated_at=CURRENT_TIMESTAMP",
      [a.slug, hashPassword(pw, salt, ITER), salt, ITER]);
    res.json({ ok: true, protected: true });
  }));
  r.delete("/apps/:slug/protect", wrap(async (req, res) => {
    // Removing a password is always allowed (also after a downgrade).
    const u = await anyUser(req); const a = await ownedApp(u, req.params.slug, false); await ensure();
    await be().query("DELETE FROM app_protect WHERE slug=?1", [a.slug]);
    res.json({ ok: true, protected: false });
  }));
  r.get("/apps/:slug/stats", wrap(async (req, res) => {
    const u = await anyUser(req); const a = await ownedApp(u, req.params.slug, false);
    if ((await tier(u)) !== "elite") { await setStats(a.slug, false).catch(() => {}); throw needElite("Visitor stats"); }
    await setStats(a.slug, true);
    const days = Math.max(1, Math.min(90, Number(req.query.days) || 30));
    const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
    const rows = await be().query("SELECT day, kind, k, n FROM app_stats WHERE slug=?1 AND day>=?2", [a.slug, since]);
    const daily = {}; const pages = {}; const refs = {}; let total = 0;
    for (const x of rows) {
      const n = Number(x.n) || 0;
      if (x.kind === "v") { daily[x.day] = (daily[x.day] || 0) + n; total += n; }
      else if (x.kind === "p") pages[x.k] = (pages[x.k] || 0) + n;
      else if (x.kind === "r") refs[x.k || "(direct)"] = (refs[x.k || "(direct)"] || 0) + n;
    }
    const series = []; for (let i = days - 1; i >= 0; i--) { const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10); series.push({ day: d, views: daily[d] || 0 }); }
    const top = (o) => Object.entries(o).sort((p, q) => q[1] - p[1]).slice(0, 10).map(([k, n]) => ({ k, n }));
    res.json({ ok: true, slug: a.slug, days, total, series, pages: top(pages), referrers: top(refs) });
  }));
  tierHook = async (userId, t) => {
    await ensure();
    const owned = "SELECT slug FROM apps WHERE owner=?1";
    if (t === "elite") await be().query("INSERT INTO app_features (slug, stats) SELECT slug, 1 FROM apps WHERE owner=?1 ON CONFLICT(slug) DO UPDATE SET stats=1, updated_at=CURRENT_TIMESTAMP", ["u:" + userId]);
    else await be().query("UPDATE app_features SET stats=0, updated_at=CURRENT_TIMESTAMP WHERE slug IN (" + owned + ")", ["u:" + userId]);
  };
  return { onPublish: async (u, slug) => { if ((await tier(u)) === "elite") await setStats(slug, true); } };
}

const STATS_HTML = `<style>.app{border-top:1px solid #26262e;padding:18px 0}h2{font-size:17px;margin:0 0 6px}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0}
input{flex:1;min-width:180px;background:#0b0b0f;border:1px solid #33333d;border-radius:10px;color:#fff;padding:11px 12px;font:inherit}.ghost{background:transparent;color:#ececf1;border:1px solid #33333d}
.big{font-size:28px;font-weight:700;color:#fff}.bars{display:flex;align-items:flex-end;gap:2px;height:60px;margin:8px 0}.bars i{flex:1;background:linear-gradient(#a78bfa,#7c5cff);border-radius:2px 2px 0 0;min-height:1px}
table{width:100%;border-collapse:collapse;font-size:14px}td{padding:4px 0;color:#c9c9d6}td:last-child{text-align:right;color:#fff}.cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}small{color:#8b8b98}.pill{font-size:12px;border-radius:99px;padding:2px 9px;background:#2a2142;color:#d8ccff}</style>
<h1>Visitor stats &amp; privacy</h1><p>Views, top pages and referrers for each published app, plus optional password protection. Stats are daily totals only, with no IP addresses or personal data. <span class="pill">Elite</span></p>
<div id="out"><p>Loading…</p></div>
<script>
const esc=(s)=>String(s).replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const J=(u,o)=>fetch(u,Object.assign({credentials:"same-origin",headers:{"content-type":"application/json"}},o||{})).then(async(r)=>Object.assign(await r.json().catch(()=>({})),{status:r.status}));
async function load(){const out=document.getElementById("out");const me=await J("/api/cloud/my-apps");
 if(me.status===401){out.innerHTML='<p><a href="/login?next=/cloud/stats">Sign in</a> to see your apps.</p>';return}
 const apps=(me.apps||[]).filter((a)=>a.live_version);if(!apps.length){out.innerHTML='<p>No published apps yet. <a href="/build">Build one</a>.</p>';return}
 out.innerHTML="";for(const a of apps){const d=document.createElement("div");d.className="app";out.appendChild(d);render(d,a)}}
async function render(d,a){const s=await J("/api/cloud/apps/"+a.slug+"/stats?days=30");const p=await J("/api/cloud/apps/"+a.slug+"/protect");
 const url="https://"+a.slug+".spawnapp.org/";let h='<h2>'+esc(a.title||a.slug)+' <small><a href="'+url+'" target="_blank" rel="noopener">'+esc(a.slug)+'.spawnapp.org</a></small></h2>';
 if(s.status===402){h+='<p>Visitor stats and password protection come with Spawn Elite. <a href="/account#elite">See Elite</a></p>'+(p.protected?'<p>This app is password protected. <button class="ghost" data-rm>Remove password</button></p>':'');}
 else if(!s.ok){h+='<p>'+esc(s.error||"Couldn't load stats.")+'</p>'}
 else{const max=Math.max(1,...s.series.map((x)=>x.views));
  h+='<div class="row"><span class="big">'+s.total+'</span><small>views in the last 30 days</small></div><div class="bars" title="Daily views">'+s.series.map((x)=>'<i style="height:'+Math.round(x.views/max*100)+'%" title="'+x.day+': '+x.views+'"></i>').join("")+'</div>';
  const t=(rows,empty)=>rows.length?'<table>'+rows.map((r)=>'<tr><td>'+esc(r.k)+'</td><td>'+r.n+'</td></tr>').join("")+'</table>':'<small>'+empty+'</small>';
  h+='<div class="cols"><div><b>Top pages</b>'+t(s.pages,"No views yet")+'</div><div><b>Referrers</b>'+t(s.referrers,"No visits yet")+'</div></div>';
  h+='<div class="row"><b>Password</b> <small>'+(p.protected?"On: visitors need the password":"Off: anyone with the link can view")+'</small></div><div class="row"><input type="password" placeholder="'+(p.protected?"New password":"Set a password (6+ characters)")+'" autocomplete="new-password"><button data-set>'+(p.protected?"Change":"Protect")+'</button>'+(p.protected?'<button class="ghost" data-rm>Remove</button>':'')+'</div><small data-msg></small>';}
 d.innerHTML=h;const msg=(t)=>{const m=d.querySelector("[data-msg]");if(m)m.textContent=t;else alert(t)};
 const set=d.querySelector("[data-set]");if(set)set.onclick=async()=>{const r=await J("/api/cloud/apps/"+a.slug+"/protect",{method:"PUT",body:JSON.stringify({password:d.querySelector("input").value})});if(r.ok){window.posthog&&posthog.capture("elite_password_set");render(d,a)}else msg(r.error||"Couldn't save.")};
 const rm=d.querySelector("[data-rm]");if(rm)rm.onclick=async()=>{if(!confirm("Remove the password? Anyone with the link will be able to view this app."))return;const r=await J("/api/cloud/apps/"+a.slug+"/protect",{method:"DELETE"});if(r.ok)render(d,a);else msg(r.error||"Couldn't remove.")};}
load();
</script>`;

module.exports = { mountElite, onTierChange, hashPassword, ITER, DDL, STATS_HTML };
