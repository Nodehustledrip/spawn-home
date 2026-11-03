"use strict";

/**
 * Version timeline for /build. Every create / edit / undo / preset / restore records a full
 * copy of the site's text files in <project>/.history/versions/<n>/ (outside public/, never
 * served). .history/ is persisted with the build (D1 for accounts, disk for anonymous), so the
 * budget below keeps the stored timeline small.
 */
const fs = require("fs");
const path = require("path");

const MAX_VERSIONS = Number(process.env.BUILD_MAX_VERSIONS || 15);
const BUDGET_BYTES = Number(process.env.BUILD_VERSIONS_BYTES || 520 * 1024);
const FILE_RE = /^[a-z0-9][a-z0-9_.-]{0,60}\.(html|css|txt|xml)$/i;

function vdir(root) {
  return path.join(root, ".history", "versions");
}

function nums(root) {
  try {
    return fs.readdirSync(vdir(root)).filter(function (d) { return /^\d+$/.test(d); }).map(Number).sort(function (a, b) { return a - b; });
  } catch (_) {
    return [];
  }
}

function publicFiles(root) {
  const pub = path.join(root, "public");
  try {
    return fs.readdirSync(pub).filter(function (f) { return FILE_RE.test(f) && fs.statSync(path.join(pub, f)).isFile(); });
  } catch (_) {
    return [];
  }
}

function dirBytes(dir) {
  let n = 0;
  try {
    fs.readdirSync(dir).forEach(function (f) { n += fs.statSync(path.join(dir, f)).size; });
  } catch (_) {}
  return n;
}

function readMeta(root, n) {
  try {
    return JSON.parse(fs.readFileSync(path.join(vdir(root), String(n), "_v.json"), "utf8"));
  } catch (_) {
    return null;
  }
}

function cleanLabel(label) {
  return String(label || "").replace(/\s+/g, " ").trim().slice(0, 90) || "Edit";
}

/** Save the current public/ text files as a new version. Returns the version meta. */
function record(root, label, kind) {
  try {
    const files = publicFiles(root);
    if (!files.length) return null;
    const list = nums(root);
    /* Identical to the newest version (e.g. a no-op) → don't add a duplicate. */
    if (list.length) {
      const last = path.join(vdir(root), String(list[list.length - 1]));
      const same = files.every(function (f) {
        try { return fs.readFileSync(path.join(last, f), "utf8") === fs.readFileSync(path.join(root, "public", f), "utf8"); } catch (_) { return false; }
      });
      if (same && kind !== "create") return readMeta(root, list[list.length - 1]);
    }
    const n = list.length ? list[list.length - 1] + 1 : 1;
    const dir = path.join(vdir(root), String(n));
    fs.mkdirSync(dir, { recursive: true });
    files.forEach(function (f) { fs.copyFileSync(path.join(root, "public", f), path.join(dir, f)); });
    const meta = { n: n, label: cleanLabel(label), kind: String(kind || "edit").slice(0, 16), at: new Date().toISOString(), files: files };
    fs.writeFileSync(path.join(dir, "_v.json"), JSON.stringify(meta));
    prune(root);
    return meta;
  } catch (err) {
    console.error("[build-versions] record failed", err && err.message);
    return null;
  }
}

/** Keep at most MAX_VERSIONS and BUDGET_BYTES; the first (created) and newest always stay. */
function prune(root) {
  let list = nums(root);
  const size = function () { return list.reduce(function (a, n) { return a + dirBytes(path.join(vdir(root), String(n))); }, 0); };
  while (list.length > 2 && (list.length > MAX_VERSIONS || size() > BUDGET_BYTES)) {
    const drop = list[1];
    fs.rmSync(path.join(vdir(root), String(drop)), { recursive: true, force: true });
    list = nums(root);
  }
}

function list(root) {
  return nums(root).map(function (n) {
    const m = readMeta(root, n) || { n: n, label: "Version " + n, kind: "edit" };
    return { n: m.n, label: m.label, kind: m.kind, at: m.at };
  }).reverse();
}

function get(root, n) {
  n = Number(n);
  if (!Number.isInteger(n) || n < 1) return null;
  const meta = readMeta(root, n);
  if (!meta) return null;
  const dir = path.join(vdir(root), String(n));
  const files = {};
  (meta.files || []).forEach(function (f) {
    if (!FILE_RE.test(f)) return;
    try { files[f] = fs.readFileSync(path.join(dir, f), "utf8"); } catch (_) {}
  });
  return { meta: { n: meta.n, label: meta.label, kind: meta.kind, at: meta.at }, files: files };
}

/** Make version n the current site (caller snapshots undo + records a new version). */
function apply(root, n) {
  const v = get(root, n);
  if (!v) return null;
  const keep = new Set(Object.keys(v.files));
  publicFiles(root).forEach(function (f) {
    if (!keep.has(f)) fs.unlinkSync(path.join(root, "public", f));
  });
  Object.keys(v.files).forEach(function (f) {
    fs.writeFileSync(path.join(root, "public", f), v.files[f]);
  });
  return v.meta;
}

module.exports = { record, list, get, apply, prune, MAX_VERSIONS, BUDGET_BYTES };
