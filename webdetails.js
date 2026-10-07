"use strict";

/**
 * Pull the specifics people type into Build chat — hours, phone, email,
 * address, their story, FAQ questions, price tiers — so offline edits use
 * their words instead of sample filler. Pure functions, no I/O.
 */

const DAY_RE = "(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)";
const DAYSPEC_RE =
  "(?:" + DAY_RE + "(?:\\s*(?:-|–|—|to|through|thru|&|and|\\/)\\s*" + DAY_RE + ")?|weekdays|weekends|daily|every\\s*day|7\\s*days(?:\\s*a\\s*week)?|seven\\s*days(?:\\s*a\\s*week)?)";
const TIME_RE = "(?:\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)?|noon|midnight)";
const RANGE_RE = "(?:" + TIME_RE + "\\s*(?:-|–|—|to|until|till|til)\\s*" + TIME_RE + "|closed|24\\s*hours|open\\s*24\\s*hours|by appointment(?: only)?)";

const DAY_NAMES = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const DAY_FULL = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };

function dayKey(d) {
  return String(d || "").toLowerCase().slice(0, 3);
}

function fmtDays(spec) {
  const s = spec.toLowerCase().replace(/\s+/g, " ").trim();
  if (/^weekdays$/.test(s)) return "Mon – Fri";
  if (/^weekends$/.test(s)) return "Sat – Sun";
  if (/^(daily|every ?day|7 ?days|seven ?days)/.test(s)) return "Every day";
  const m = s.match(new RegExp("^(" + DAY_RE + ")(?:\\s*(-|–|—|to|through|thru|&|and|\\/)\\s*(" + DAY_RE + "))?$", "i"));
  if (!m) return spec;
  const a = dayKey(m[1]);
  if (!m[3]) return DAY_FULL[a] || spec;
  const b = dayKey(m[3]);
  const join = /&|and|\//.test(m[2]) ? " & " : " – ";
  return (DAY_NAMES[a] || m[1]) + join + (DAY_NAMES[b] || m[3]);
}

function fmtTime(t) {
  return String(t)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/a\.?m\.?/, "am")
    .replace(/p\.?m\.?/, "pm")
    .replace(/:00(?=am|pm|$)/, "");
}

function fmtRange(r) {
  const s = r.trim();
  if (/^closed$/i.test(s)) return "Closed";
  if (/24\s*hours/i.test(s)) return "Open 24 hours";
  if (/appointment/i.test(s)) return "By appointment";
  const m = s.match(new RegExp("^(" + TIME_RE + ")\\s*(?:-|–|—|to|until|till|til)\\s*(" + TIME_RE + ")$", "i"));
  if (!m) return s;
  return fmtTime(m[1]) + " – " + fmtTime(m[2]);
}

/** "Mon-Fri 6am-2pm, Sat 7am-1pm, closed Sunday" → [["Mon – Fri","6am – 2pm"],["Saturday","7am – 1pm"],["Sunday","Closed"]] */
function parseHours(text) {
  const t = String(text || "");
  const rows = [];
  const seen = {};
  const re = new RegExp("\\b(" + DAYSPEC_RE + ")\\b\\s*(?::|,|from|is|are|=)?\\s*(" + RANGE_RE + ")", "gi");
  let m;
  while ((m = re.exec(t))) {
    /* a bare number range must look like a time (am/pm or hh:mm) unless it follows an hours word */
    const range = m[2];
    if (!/[ap]\.?m|:|noon|midnight|closed|24|appointment/i.test(range) && !/\b(hours|open|opening)\b/i.test(t)) continue;
    const d = fmtDays(m[1]);
    if (seen[d]) continue;
    seen[d] = 1;
    rows.push([d, fmtRange(range)]);
  }
  /* "closed sunday(s)" / "closed on weekends" */
  const cre = new RegExp("\\bclosed\\s+(?:on\\s+)?(" + DAYSPEC_RE + ")s?\\b", "gi");
  while ((m = cre.exec(t))) {
    const d = fmtDays(m[1]);
    if (!seen[d]) {
      seen[d] = 1;
      rows.push([d, "Closed"]);
    }
  }
  return rows.slice(0, 8);
}

function parsePhone(text) {
  const m = String(text || "").match(/(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/);
  if (!m) return null;
  const digits = m[0].replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 11) return null;
  const d10 = digits.slice(-10);
  return { label: d10.slice(0, 3) + "-" + d10.slice(3, 6) + "-" + d10.slice(6), href: "tel:+1" + d10 };
}

function parseEmail(text) {
  const m = String(text || "").match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return m ? m[0].replace(/[.]+$/, "") : null;
}

const STREET =
  "(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pl|place|pkwy|parkway|hwy|highway|sq|square|ter|terrace|cir|circle|trl|trail|row|plaza)";

function parseAddress(text) {
  const t = String(text || "");
  /* explicit: "address is …", "located at …", "find us at …" */
  const ex = t.match(/\b(?:address(?:\s+is)?|located at|we(?:'re| are) (?:at|on)|find us at|visit us at)\s*[:\-–]?\s*([^;\n]+)$/i);
  let cand = ex ? ex[1] : null;
  if (cand) {
    cand = cand
      .replace(/\s*,?\s*(?:and\s+)?(?:(?:open|hours|phone|call|text|email)\b|\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}|[a-z0-9._%+-]+@).*$/i, "")
      .replace(new RegExp("\\s*,?\\s*\\b" + DAYSPEC_RE + "\\b\\s*(?::|,)?\\s*" + RANGE_RE + ".*$", "i"), "")
      .replace(/\s+(?:and|&)\s+.*$/i, "")
      .replace(/[.\s,]+$/, "")
      .trim();
    if (cand.length >= 5 && cand.length <= 120) return cand;
  }
  const m = t.match(new RegExp("\\b\\d{1,6}\\s+(?:[A-Za-z0-9.'-]+\\s+){0,4}" + STREET + "\\b\\.?(?:\\s+(?:ne|nw|se|sw|n|s|e|w)\\b)?(?:,?\\s*(?:suite|ste|unit|#)\\s*\\w+)?(?:,\\s*[A-Za-z .'-]{2,30}?,\\s*[A-Z]{2}\\b(?:\\s+\\d{5})?)?", "i"));
  return m ? m[0].trim() : null;
}

function sentence(s) {
  s = String(s || "").replace(/\s+/g, " ").trim().replace(/^["“'‘]|["”'’]$/g, "").trim();
  if (!s) return s;
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (!/[.!?…]$/.test(s)) s += ".";
  return s;
}

/** Story text after "about …:" / "saying …" / quoted — or null. */
function storyFrom(clause) {
  const c = String(clause || "");
  const q = c.match(/["“]([^"”]{12,600})["”]/);
  if (q) return sentence(q[1]);
  const m =
    c.match(/\b(?:about(?:\s+us)?|our story|story|who we are|history|mission)\b[^:—–]{0,40}?\s*[:—–]\s*(.{8,600})$/i) ||
    c.match(/\b(?:saying|that says|that reads|with the text|telling (?:people|visitors))\s+(.{8,600})$/i) ||
    c.match(/\b(?:about how|about the time)\s+(.{8,600})$/i);
  return m ? sentence(m[1]) : null;
}

function yearFrom(text) {
  const now = new Date().getFullYear();
  const re = /\b((?:18|19|20)\d{2})\b/g;
  let m;
  while ((m = re.exec(String(text || "")))) {
    const y = Number(m[1]);
    if (y >= 1850 && y <= now) return y;
  }
  return null;
}

/** "add an FAQ: do you deliver? are you gluten free?" → ["Do you deliver?", "Are you gluten free?"] */
function questionsFrom(clause) {
  const c = String(clause || "");
  const m = c.match(/(?:faqs?|questions|frequently asked(?: questions)?)\b[^:]*?(?::|\bwith\b|\babout\b|\bon\b|\bcovering\b|\bincluding\b)\s*(.+)$/i);
  if (!m) return [];
  let body = m[1].trim();
  let parts;
  if (/\?/.test(body)) parts = body.split(/\?\s*(?:,|and\b)?\s*/);
  else parts = body.split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s*;\s*/);
  const qw = /^(do|does|did|are|is|can|could|how|what|where|when|why|will|who|which|should|may)\b/i;
  return parts
    .map(function (p) { return p.replace(/^["“'‘]|["”'’]$/g, "").replace(/[.!]+$/, "").trim(); })
    .filter(function (p) { return p.length >= 3 && p.length <= 140; })
    .map(function (p) {
      p = p.charAt(0).toUpperCase() + p.slice(1);
      return qw.test(p) ? p + "?" : p;
    })
    .slice(0, 8);
}

/** "pricing with Basic $20, Pro $50 and Max $90/mo" → [{name, price, unit}] (needs ≥2 named tiers). */
function tiersFrom(clause) {
  const c = String(clause || "");
  const m = c.match(/\b(?:pricing|plans?|tiers?|packages?|prices?)\b[^:]*?(?::|\bwith\b|\bfor\b|\bof\b)\s*(.+)$/i);
  if (!m) return [];
  const parts = m[1].split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s*;\s*/).map(function (x) { return x.trim(); }).filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return [];
  const out = [];
  for (const raw of parts) {
    const pm = raw.match(/\$\s?\d+(?:[.,]\d{1,2})?(?:\s*(?:\/|per\s+)\s*(mo|month|yr|year|week|wk|visit|session|hour|hr|class|night|person))?/i);
    const name = raw.replace(/\(?\s*(?:for|at|@|-|–)?\s*\$\s?\d+(?:[.,]\d{1,2})?(?:\s*(?:\/|per\s+)\s*[a-z]+)?\s*\)?/gi, "").replace(/^(?:a|an|the)\s+/i, "").replace(/\s+(?:tier|plan|package)$/i, "").trim();
    if (!name || name.length > 30) return [];
    let unit = pm && pm[1] ? pm[1].toLowerCase() : null;
    if (unit) unit = { mo: "mo", month: "mo", yr: "yr", year: "yr", wk: "week", hr: "hour" }[unit] || unit;
    out.push({ name: name.charAt(0).toUpperCase() + name.slice(1), price: pm ? pm[0].replace(/\s*(?:\/|per\s+).*$/i, "").replace(/\s/g, "") : null, unit: unit });
  }
  return out;
}

/* What kind of business this build is — drives sensible defaults for FAQ / pricing. */
const FOOD = /^(coffee|restaurant|bakery)$/;
const PRODUCT = /^(saas|mobileapp|media|store)$/;
function kindOf(meta) {
  const pack = meta && meta.pack;
  const tpl = meta && meta.template;
  if (pack && FOOD.test(pack)) return "food";
  if (pack && PRODUCT.test(pack)) return "product";
  if (tpl === "local-service") return "service";
  if (pack && !PRODUCT.test(pack) && !/^(agency|nonprofit|education|events|travel)$/.test(pack)) return "service";
  return "product";
}

module.exports = {
  parseHours,
  parsePhone,
  parseEmail,
  parseAddress,
  storyFrom,
  yearFrom,
  questionsFrom,
  tiersFrom,
  kindOf,
  sentence,
};
