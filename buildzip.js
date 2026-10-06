"use strict";

/**
 * Zero-dependency ZIP writer + static-site exporter for on-site builds.
 * Produces a folder-style zip (<slug>/index.html, styles.css, …) that opens
 * straight from disk: absolute links to sibling files become relative and
 * demo /api/* calls resolve locally when opened via file://.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const CRC_TABLE = (function () {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time: time & 0xffff, date: date & 0xffff };
}

/** entries: [{ name, data: Buffer|string }] → Buffer */
function createZip(entries, when) {
  const dt = dosDateTime(when || new Date());
  const locals = [];
  const centrals = [];
  let offset = 0;
  entries.forEach(function (e) {
    const name = Buffer.from(e.name, "utf8");
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), "utf8");
    const crc = crc32(raw);
    let method = 8;
    let body = zlib.deflateRawSync(raw, { level: 9 });
    if (body.length >= raw.length) {
      method = 0;
      body = raw;
    }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); /* UTF-8 names */
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dt.time, 10);
    local.writeUInt16LE(dt.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4); /* made by: unix, v2.0 */
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(dt.time, 12);
    central.writeUInt16LE(dt.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  });
  const cdSize = centrals.reduce(function (n, b) {
    return n + b.length;
  }, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat(locals.concat(centrals, [end]));
}

const OFFLINE_SHIM =
  "<script>/* Opened from disk: demo form endpoints answer locally. */" +
  "(function(){var f=window.fetch;if(location.protocol!=='file:'||!f)return;" +
  "window.fetch=function(u,o){var s=typeof u==='string'?u:(u&&u.url)||'';" +
  "if(s.indexOf('/api/')===0){return Promise.resolve(new Response('{\"ok\":true,\"demo\":true}'," +
  "{status:200,headers:{'Content-Type':'application/json'}}));}return f.apply(this,arguments);};})();</script>";

function slugify(s) {
  return (
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "spawn-app"
  );
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build the export zip for a project root. Returns { buffer, filename }. */
function exportSite(root, meta) {
  meta = meta || {};
  const pub = path.join(root, "public");
  const names = fs
    .readdirSync(pub, { withFileTypes: true })
    .filter(function (d) {
      return d.isFile() && /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(d.name);
    })
    .map(function (d) {
      return d.name;
    })
    .sort(function (a, b) {
      if (a === "index.html") return -1;
      if (b === "index.html") return 1;
      return a.localeCompare(b);
    });
  if (names.indexOf("index.html") === -1) {
    const err = new Error("Build has no index.html");
    err.status = 404;
    throw err;
  }
  const slug = slugify(meta.name || meta.slug);
  const entries = names.map(function (n) {
    const full = path.join(pub, n);
    if (!/\.(html?|css|js|txt|xml|svg|json|md)$/i.test(n)) {
      return { name: slug + "/" + n, data: fs.readFileSync(full) };
    }
    let text = fs.readFileSync(full, "utf8");
    names.forEach(function (other) {
      /* "/styles.css" or "/preview/<id>/styles.css" → "styles.css" */
      const re = new RegExp("([\"'(=])(?:/preview/[a-z0-9]+)?/" + escapeRe(other) + "(?=[\"'?#)\\s>])", "g");
      text = text.replace(re, "$1" + other);
    });
    if (/\.html?$/i.test(n)) {
      text = text.replace(/(href=["'])\/(?=["'#])/gi, "$1index.html");
      if (/<head[^>]*>/i.test(text)) text = text.replace(/<head[^>]*>/i, function (m) {
        return m + "\n  " + OFFLINE_SHIM;
      });
      else text = OFFLINE_SHIM + text;
    }
    return { name: slug + "/" + n, data: text };
  });
  const readme =
    (meta.name || "Your app") +
    "\n" +
    "=".repeat(String(meta.name || "Your app").length) +
    "\n\n" +
    "Exported from Spawn on-site Build (https://spawnapp.org/build).\n\n" +
    "Open index.html in any browser — no install or server needed.\n" +
    "It is a plain static site (HTML + CSS), so you can also drop this folder on any static host.\n\n" +
    "Forms are demo-only here: they show a thank-you message but do not send data anywhere.\n" +
    "Spawn desktop (Ship -> Open to the internet) gives you a lasting public URL or custom domain.\n";
  entries.push({ name: slug + "/README.txt", data: readme });
  return { buffer: createZip(entries), filename: slug + ".zip" };
}

module.exports = { createZip, exportSite, crc32 };
