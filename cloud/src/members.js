// Owner tools and members-only pages for any Spawn app.
//  - Owner view: per-app secret OWNER_KEY (sent as "Authorization: Bearer <key>") reads the app's form
//    submissions (records) and approves members. Never public; nothing here works until the owner sets the key.
//  - Members-only pages: any file under members/ is served only to a signed-in app account that the owner
//    approved (or every signed-in account when the secret MEMBER_EMAILS is "*", used for demos).
import { json, readJson, HttpError, clientIp, rateLimit, validEmail, clip, appSecrets, timingSafeEqual, now } from "./util.js";
import { currentAppUser } from "./auth.js";

export const MEMBERS_PREFIX = "members/";

function emailsFrom(s) { return String(s || "").toLowerCase().split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean); }

export async function memberStatus(c) {
  const s = await appSecrets(c.env, c.slug);
  const list = emailsFrom(s.MEMBER_EMAILS);
  const open = list.includes("*");
  const user = await currentAppUser(c);
  let member = false;
  if (user) {
    member = open || list.includes(String(user.email).toLowerCase());
    if (!member) {
      const r = await c.env.DB.prepare("SELECT 1 FROM records WHERE slug=?1 AND kind='member_ok' AND email=?2 LIMIT 1").bind(c.slug, String(user.email).toLowerCase()).first();
      member = !!r;
    }
  }
  return { user, member, configured: open || list.length > 0 || !!s.OWNER_KEY, demo: open };
}

async function ownerOk(c) {
  const s = await appSecrets(c.env, c.slug);
  const want = String(s.OWNER_KEY || "");
  if (want.length < 12) throw new HttpError(404, "The owner view isn't set up for this app. Add an OWNER_KEY secret (12+ characters) in Spawn.");
  const got = String(c.request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  await rateLimit(c.env, `owner:${c.slug}:${clientIp(c.request)}`, 60, 600);
  if (!got || !timingSafeEqual(got, want)) throw new HttpError(401, "That owner key isn't right.");
}

export async function handleMembers(c) {
  const { path, request, env, slug } = c;
  const m = request.method;
  if (path === "/api/members/me" && m === "GET") {
    const st = await memberStatus(c);
    return json({ ok: true, signedIn: !!st.user, member: st.member, configured: st.configured, demo: st.demo, user: st.user ? { email: st.user.email, name: st.user.name } : null }, 200, { "Cache-Control": "private, no-store" });
  }
  if (!path.startsWith("/api/owner/")) return null;
  await ownerOk(c);
  const H = { "Cache-Control": "private, no-store" };
  if (path === "/api/owner/records" && m === "GET") {
    const kind = clip(c.url.searchParams.get("kind") || "", 32);
    const q = kind
      ? env.DB.prepare("SELECT id, kind, email, data, created_at FROM records WHERE slug=?1 AND kind=?2 ORDER BY created_at DESC LIMIT 500").bind(slug, kind)
      : env.DB.prepare("SELECT id, kind, email, data, created_at FROM records WHERE slug=?1 ORDER BY created_at DESC LIMIT 500").bind(slug);
    const { results } = await q.all();
    return json({ ok: true, records: (results || []).map((r) => { let d = {}; try { d = JSON.parse(r.data || "{}"); } catch (_) {} return { id: r.id, kind: r.kind, email: r.email, data: d, createdAt: r.created_at }; }) }, 200, H);
  }
  const del = path.match(/^\/api\/owner\/records\/([a-f0-9]{16})$/);
  if (del && m === "DELETE") {
    await env.DB.prepare("DELETE FROM records WHERE slug=?1 AND id=?2").bind(slug, del[1]).run();
    return json({ ok: true }, 200, H);
  }
  if (path === "/api/owner/members" && m === "GET") {
    const { results: users } = await env.DB.prepare("SELECT email, name, created_at FROM app_users WHERE slug=?1 ORDER BY created_at DESC LIMIT 1000").bind(slug).all();
    const { results: ok } = await env.DB.prepare("SELECT email FROM records WHERE slug=?1 AND kind='member_ok'").bind(slug).all();
    const s = await appSecrets(env, slug); const list = emailsFrom(s.MEMBER_EMAILS);
    const approved = new Set((ok || []).map((r) => r.email).concat(list));
    return json({ ok: true, open: list.includes("*"), members: (users || []).map((u) => ({ email: u.email, name: u.name, joinedAt: u.created_at, approved: approved.has("*") || approved.has(u.email) })) }, 200, H);
  }
  if (path === "/api/owner/members" && m === "POST") {
    const b = await readJson(request, 2048);
    const email = clip(b.email, 254).toLowerCase();
    if (!validEmail(email)) throw new HttpError(400, "Enter the member's email.");
    await env.DB.prepare("DELETE FROM records WHERE slug=?1 AND kind='member_ok' AND email=?2").bind(slug, email).run();
    if (b.approved !== false) await env.DB.prepare("INSERT INTO records (id, slug, kind, email, data, created_at) VALUES (?1,?2,'member_ok',?3,'{}',?4)")
      .bind([...crypto.getRandomValues(new Uint8Array(8))].map((x) => x.toString(16).padStart(2, "0")).join(""), slug, email, now()).run();
    return json({ ok: true, email, approved: b.approved !== false }, 200, H);
  }
  return json({ ok: false, error: "Not found" }, 404);
}

/** Gate for files under members/. Returns a Response to send instead, or null to serve the file. */
export async function gateMembersPage(c, file) {
  if (!file || !file.startsWith(MEMBERS_PREFIX)) return null;
  const st = await memberStatus(c);
  if (st.member) return null;
  const isHtml = /\.html?$/.test(file);
  if (!isHtml) return new Response("Members only", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" } });
  const next = encodeURIComponent(c.url.pathname);
  const to = (c.app.files["account.html"] ? "/account" : "/") + "?gate=" + (st.user ? "pending" : "signin") + "&next=" + next;
  return new Response(null, { status: 302, headers: { Location: to, "Cache-Control": "private, no-store" } });
}
