#!/usr/bin/env node
/*
 * Convert a desktop app's JSON data folder into SQL for the Spawn Cloud D1 database (+ photo files for R2).
 *
 *   node cloud/scripts/import-desktop-data.js --app bidboard --data <path-to>/generated/bidboard/data --out ./import-out [--slug bidboard]
 *   node cloud/scripts/import-desktop-data.js --app spawn-backend --data <path>/generated/pass-p-landing/data --slug pass-p-landing --out ./import-out
 *   node cloud/scripts/import-desktop-data.js --places <path>/us-places.json --out ./import-out
 *
 * Then (once the Cloudflare resources exist):
 *   npx wrangler d1 execute spawn-cloud --remote --file import-out/<slug>.sql
 *   bash import-out/<slug>-photos.sh        # uploads job photos to R2
 * Idempotent: every row uses INSERT OR REPLACE / OR IGNORE keyed on the original ids.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const args = {};
for (let i = 2; i < process.argv.length; i++) if (process.argv[i].startsWith("--")) args[process.argv[i].slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
const OUT = path.resolve(args.out || "import-out");
fs.mkdirSync(OUT, { recursive: true });

const q = (v) => (v == null ? "NULL" : typeof v === "number" ? String(v) : "'" + String(v).replace(/'/g, "''") + "'");
const read = (dir, f, def) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch (_) { return def; } };
const iso = (v) => (v && !isNaN(Date.parse(v)) ? new Date(v).toISOString() : new Date().toISOString());
const rid = () => require("crypto").randomBytes(6).toString("hex");
const CODES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "));
const st = (s) => { s = String(s || "").trim().toUpperCase(); return CODES.has(s) ? s : ""; };

if (args.places) {
  const d = JSON.parse(fs.readFileSync(args.places, "utf8"));
  const rows = (d.places || []).filter((p) => p.city && p.stateCode);
  const lines = ["DELETE FROM bb_places;"];
  for (let i = 0; i < rows.length; i += 400) {
    lines.push("INSERT INTO bb_places (city, state, code, city_l) VALUES " + rows.slice(i, i + 400).map((p) => "(" + [p.city, p.state, p.stateCode, p.city.toLowerCase()].map(q).join(",") + ")").join(",") + ";");
  }
  fs.writeFileSync(path.join(OUT, "places.sql"), lines.join("\n") + "\n");
  console.log("places.sql:", rows.length, "places");
}

if (args.data) {
  const dir = path.resolve(args.data);
  const app = args.app || "spawn-backend";
  const slug = args.slug || (app === "bidboard" ? "bidboard" : path.basename(path.dirname(dir)));
  const sql = ["-- Imported from " + dir + " at " + new Date().toISOString(), "-- app: " + slug];
  const photos = [];
  const counts = {};
  const bump = (k) => (counts[k] = (counts[k] || 0) + 1);

  // Generic tables shared by every Spawn backend.
  for (const s of read(dir, "subscribers.json", [])) if (s && s.email) { sql.push(`INSERT OR IGNORE INTO records (id, slug, kind, email, data, created_at) VALUES (${q(rid())},${q(slug)},'subscriber',${q(String(s.email).toLowerCase())},${q(JSON.stringify(s))},${q(iso(s.at || s.createdAt))});`); bump("subscribers"); }
  for (const l of read(dir, "leads.json", [])) if (l) { sql.push(`INSERT OR IGNORE INTO records (id, slug, kind, email, data, created_at) VALUES (${q(l.id || rid())},${q(slug)},'lead',${q(l.email || null)},${q(JSON.stringify(l))},${q(iso(l.at || l.createdAt))});`); bump("leads"); }
  for (const p of read(dir, "posts.json", [])) {
    if (!p || !p.id || /Edit data\/posts\.json/.test(p.body || "")) continue; // skip builder placeholder
    sql.push(`INSERT OR REPLACE INTO rows (slug, tbl, id, data, created_at, updated_at) VALUES (${q(slug)},'posts',${q(p.id)},${q(JSON.stringify(p))},${q(iso(p.at))},${q(iso(p.at))});`); bump("posts");
  }
  if (fs.existsSync(path.join(dir, "db"))) for (const f of fs.readdirSync(path.join(dir, "db"))) {
    if (!/^[a-z0-9_-]{1,40}\.json$/i.test(f)) continue;
    const tbl = f.replace(/\.json$/, "");
    const rows = read(path.join(dir, "db"), f, []);
    for (const r of Array.isArray(rows) ? rows : []) { const id = String(r.id || rid()); sql.push(`INSERT OR REPLACE INTO rows (slug, tbl, id, data, created_at, updated_at) VALUES (${q(slug)},${q(tbl)},${q(id)},${q(JSON.stringify(Object.assign({ id }, r)))},${q(iso(r.createdAt))},${q(iso(r.updatedAt || r.createdAt))});`); bump("db:" + tbl); }
  }
  for (const u of read(dir, "users.json", [])) if (u && u.email && u.salt && u.hash) {
    sql.push(`INSERT OR IGNORE INTO app_users (slug, email, name, algo, salt, hash, created_at) VALUES (${q(slug)},${q(String(u.email).toLowerCase())},${q(u.name || null)},'scrypt',${q(u.salt)},${q(u.hash)},${q(iso(u.createdAt))});`); bump("users");
  }

  if (app === "bidboard") {
    for (const j of read(dir, "jobs.json", [])) {
      if (!j || !j.id) continue;
      let photoKey = null;
      const m = /^data:(image\/(?:png|jpe?g|webp|gif));base64,(.+)$/i.exec(String(j.photoDataUrl || ""));
      if (m) {
        photoKey = `data/${slug}/photos/${j.id}`;
        const file = path.join(OUT, slug + "-photos", j.id);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, Buffer.from(m[2], "base64"));
        photos.push({ key: photoKey, file, type: m[1].toLowerCase() });
      }
      const data = Object.assign({}, j); delete data.photoDataUrl;
      sql.push(`INSERT OR REPLACE INTO bb_jobs (id, slug, status, trade, state, city, zip, urgency, email, phone, photo_key, data, created_at) VALUES (${[j.id, slug, j.status || "open", j.trade || "general", st(j.state), j.city || "", j.zip || "", j.urgency || "", String(j.email || "").toLowerCase(), j.phone || "", photoKey, JSON.stringify(data), iso(j.createdAt)].map(q).join(",")});`);
      bump("jobs");
    }
    for (const c of read(dir, "contractors.json", [])) {
      if (!c || !c.email) continue;
      sql.push(`INSERT OR REPLACE INTO bb_contractors (id, slug, email, plan, data, created_at, updated_at) VALUES (${[c.id || rid(), slug, String(c.email).toLowerCase(), c.plan === "pro" ? "pro" : "pay_per_lead", JSON.stringify(c), iso(c.createdAt), c.updatedAt ? iso(c.updatedAt) : null].map(q).join(",")});`);
      bump("contractors");
    }
    for (const u of read(dir, "unlocks.json", [])) {
      if (!u || !u.id || !u.token) continue;
      // Desktop "pending_payment" unlocks were never verifiably paid; keep them pending.
      const status = u.status === "paid" || u.status === "demo_unlocked" ? u.status : "pending_payment";
      sql.push(`INSERT OR REPLACE INTO bb_unlocks (id, slug, job_id, token, email, status, amount_cents, data, created_at, paid_at) VALUES (${[u.id, slug, u.jobId, u.token, String(u.contractorEmail || "").toLowerCase(), status, Number(u.amountCents || 0), JSON.stringify({ contractorName: u.contractorName, contractorTrade: u.contractorTrade, company: u.company, imported: true }), iso(u.createdAt), u.paidAt ? iso(u.paidAt) : null].map(q).join(",")});`);
      bump("unlocks");
    }
    for (const i of read(dir, "interest.json", [])) {
      if (!i) continue;
      sql.push(`INSERT OR IGNORE INTO records (id, slug, kind, email, data, created_at) VALUES (${q("imp-" + (i.id || rid()) + "-" + (i.type || "x"))},${q(slug)},${q(i.type || "interest")},${q(i.email || null)},${q(JSON.stringify(i))},${q(iso(i.createdAt))});`);
      bump("interest");
    }
  }
  fs.writeFileSync(path.join(OUT, slug + ".sql"), sql.join("\n") + "\n");
  if (photos.length) {
    fs.writeFileSync(path.join(OUT, slug + "-photos.sh"), "#!/usr/bin/env bash\nset -euo pipefail\n" + photos.map((p) => `npx wrangler r2 object put ${q("spawn-cloud-apps/" + p.key)} --file ${q(p.file)} --content-type ${q(p.type)} --remote`).join("\n") + "\n");
  }
  console.log(slug + ".sql:", JSON.stringify(counts), photos.length ? "· photos: " + photos.length : "");
}
