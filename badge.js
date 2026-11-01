"use strict";
/**
 * "Made with Spawn" badge — a small link shown on previews and on free-plan Spawn Cloud apps.
 * Pro accounts and the site owner's own apps (BIDBOARD_OWNER_EMAIL, SPAWN_BADGE_EXEMPT_EMAILS) don't get it.
 * Injected at publish time (so a published version never changes underneath its owner) and when serving previews.
 */
const MARK = "data-spawn-badge";
const HREF = "https://spawnapp.org/gallery?ref=badge";

const BADGE_HTML =
  '<a ' + MARK + ' href="' + HREF + '" target="_blank" rel="noopener" aria-label="Made with Spawn" ' +
  'style="position:fixed;right:14px;bottom:14px;z-index:2147483000;display:inline-flex;align-items:center;gap:7px;' +
  'padding:6px 11px 6px 9px;border-radius:999px;background:rgba(12,12,13,.86);color:#f2f0eb;' +
  'border:1px solid rgba(255,255,255,.14);box-shadow:0 4px 18px rgba(0,0,0,.28);' +
  '-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);' +
  'font:500 12px/1.2 Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;letter-spacing:.01em;text-decoration:none">' +
  '<span aria-hidden="true" style="width:7px;height:7px;border-radius:50%;background:#d4a574;box-shadow:0 0 0 3px rgba(212,165,116,.18)"></span>' +
  'Made with Spawn</a>';

function has(html) {
  return String(html).indexOf(MARK) !== -1;
}

function inject(html) {
  html = String(html);
  if (has(html)) return html;
  const i = html.search(/<\/body\s*>/i);
  if (i === -1) return html + "\n" + BADGE_HTML + "\n";
  return html.slice(0, i) + BADGE_HTML + "\n" + html.slice(i);
}

function exemptEmails() {
  return [process.env.BIDBOARD_OWNER_EMAIL, process.env.SPAWN_BADGE_EXEMPT_EMAILS]
    .join(",")
    .split(",")
    .map(function (s) { return s.trim().toLowerCase(); })
    .filter(Boolean);
}

/** Owner exemption: the site owner's own account (treated like Pro for badge + domains). */
function isOwner(user) {
  const email = String((user && user.email) || "").toLowerCase();
  return !!email && exemptEmails().indexOf(email) !== -1;
}

/** True when this account's apps carry no badge (Pro, or the site owner). */
function exempt(user) {
  if (!user) return false;
  if (isOwner(user)) return true;
  return require("./auth").isPro(user);
}

module.exports = { inject, has, exempt, isOwner, BADGE_HTML, HREF, MARK };
