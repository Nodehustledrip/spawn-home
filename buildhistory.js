"use strict";

/**
 * Tiny per-project undo stack for /build edits.
 * Snapshots live in <project>/.history/ (outside public/, so never served by preview).
 */
const fs = require("fs");
const path = require("path");

const MAX = 10;

function histDir(root) {
  return path.join(root, ".history");
}

function listPublic(root) {
  const pub = path.join(root, "public");
  try {
    return fs.readdirSync(pub).filter(function (f) {
      return /\.(html|css|txt|xml)$/i.test(f) && fs.statSync(path.join(pub, f)).isFile();
    });
  } catch (_) {
    return [];
  }
}

function stack(root) {
  try {
    return fs
      .readdirSync(histDir(root))
      .filter(function (d) {
        return /^\d+$/.test(d);
      })
      .sort(function (a, b) {
        return Number(a) - Number(b);
      });
  } catch (_) {
    return [];
  }
}

function rm(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

function snapshot(root) {
  try {
    const files = listPublic(root);
    if (!files.length) return;
    const s = stack(root);
    const next = String(s.length ? Number(s[s.length - 1]) + 1 : 1);
    const dir = path.join(histDir(root), next);
    fs.mkdirSync(dir, { recursive: true });
    const manifest = { files: files };
    files.forEach(function (f) {
      fs.copyFileSync(path.join(root, "public", f), path.join(dir, f));
    });
    fs.writeFileSync(path.join(dir, "_manifest.json"), JSON.stringify(manifest));
    const after = stack(root);
    while (after.length > MAX) rm(path.join(histDir(root), after.shift()));
  } catch (err) {
    console.error("[build-history] snapshot failed", err && err.message);
  }
}

/** Drop the newest snapshot (used when an edit changed nothing). */
function discard(root) {
  const s = stack(root);
  if (s.length) rm(path.join(histDir(root), s[s.length - 1]));
}

function restore(root) {
  const s = stack(root);
  if (!s.length) return false;
  const dir = path.join(histDir(root), s[s.length - 1]);
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "_manifest.json"), "utf8"));
    const keep = new Set(manifest.files);
    /* Remove files the undone edit created, then restore the snapshot. */
    listPublic(root).forEach(function (f) {
      if (!keep.has(f)) fs.unlinkSync(path.join(root, "public", f));
    });
    manifest.files.forEach(function (f) {
      if (!/^[a-z0-9][a-z0-9_.-]{0,60}$/i.test(f)) return;
      fs.copyFileSync(path.join(dir, f), path.join(root, "public", f));
    });
    rm(dir);
    return true;
  } catch (err) {
    console.error("[build-history] restore failed", err && err.message);
    return false;
  }
}

module.exports = { snapshot, restore, discard };
