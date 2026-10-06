"use strict";

/**
 * Durable storage for on-site builds.
 *
 * Postgres (DATABASE_URL) is the source of truth; the local disk under
 * data/builds/<id>/ is only a working cache that webgen/webedit/buildai edit
 * in place. After every create/edit/undo the project (files + undo history)
 * is written back to Postgres, and a missing cache dir is re-hydrated from
 * Postgres on demand — so builds survive redeploys and restarts.
 *
 * Without DATABASE_URL (local dev) it falls back to disk-only mode.
 */
const fs = require("fs");
const path = require("path");

const SKIP_DIRS = new Set(["node_modules", ".git"]);
const SAFE_REL = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_BUILD_BYTES = Number(process.env.BUILD_MAX_BYTES || 1.5 * 1024 * 1024);

let pool = null;
let ready = false;
let initError = null;
let initPromise = null;

function mode() {
  return ready ? "postgres" : "disk";
}

function safeRel(rel) {
  if (!rel || !SAFE_REL.test(rel)) return false;
  return rel.split("/").every(function (seg) {
    return seg !== ".." && seg !== ".";
  });
}

function init() {
  if (initPromise) return initPromise;
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("[buildstore] DATABASE_URL not set — disk-only mode (builds are ephemeral)");
    initPromise = Promise.resolve(false);
    return initPromise;
  }
  let Pool;
  try {
    Pool = require("pg").Pool;
  } catch (err) {
    initError = err;
    console.error("[buildstore] pg module missing — disk-only mode");
    initPromise = Promise.resolve(false);
    return initPromise;
  }
  /* Render internal URLs (no host suffix) don't use TLS; external ones need it. */
  const needsSsl = /\.render\.com|sslmode=require/i.test(url);
  pool = new Pool({
    connectionString: url,
    ssl: needsSsl ? { rejectUnauthorized: false } : false,
    max: 4,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  pool.on("error", function (err) {
    console.error("[buildstore] pool error", err && err.message);
  });
  initPromise = (async function () {
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        await pool.query(
          "CREATE TABLE IF NOT EXISTS builds (" +
            " id TEXT PRIMARY KEY," +
            " owner TEXT NOT NULL," +
            " name TEXT NOT NULL," +
            " template TEXT," +
            " files JSONB NOT NULL DEFAULT '{}'::jsonb," +
            " history JSONB NOT NULL DEFAULT '{}'::jsonb," +
            " size_bytes INTEGER NOT NULL DEFAULT 0," +
            " edit_count INTEGER NOT NULL DEFAULT 0," +
            " created_at TIMESTAMPTZ NOT NULL DEFAULT now()," +
            " updated_at TIMESTAMPTZ NOT NULL DEFAULT now()" +
            ")"
        );
        await pool.query("CREATE INDEX IF NOT EXISTS builds_owner_idx ON builds (owner, updated_at DESC)");
        ready = true;
        console.log("[buildstore] postgres ready");
        return true;
      } catch (err) {
        initError = err;
        console.error("[buildstore] postgres init attempt " + attempt + " failed:", err && err.message);
        await new Promise(function (r) {
          setTimeout(r, attempt * 1500);
        });
      }
    }
    console.error("[buildstore] giving up on postgres — disk-only mode");
    return false;
  })();
  return initPromise;
}

/** Walk a project dir → { files: {rel: text}, history: {rel: text}, bytes } */
function serialize(root) {
  const files = {};
  const history = {};
  let bytes = 0;
  function walk(dir, prefix) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    entries.forEach(function (ent) {
      if (SKIP_DIRS.has(ent.name)) return;
      const rel = prefix ? prefix + "/" + ent.name : ent.name;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) return walk(full, rel);
      if (!ent.isFile() || !safeRel(rel) || rel === ".owner") return;
      const st = fs.statSync(full);
      if (st.size > MAX_FILE_BYTES) return;
      const text = fs.readFileSync(full, "utf8");
      bytes += st.size;
      if (rel.indexOf(".history/") === 0) history[rel] = text;
      else files[rel] = text;
    });
  }
  walk(root, "");
  return { files: files, history: history, bytes: bytes };
}

function writeTree(root, map) {
  Object.keys(map || {}).forEach(function (rel) {
    if (!safeRel(rel)) return;
    const full = path.join(root, rel);
    if (!full.startsWith(root + path.sep)) return;
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, String(map[rel]), "utf8");
  });
}

function readMetaFile(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "forge.json"), "utf8"));
  } catch (_) {
    return {};
  }
}

function publicBytes(root) {
  let total = 0;
  try {
    const pub = path.join(root, "public");
    fs.readdirSync(pub).forEach(function (f) {
      const st = fs.statSync(path.join(pub, f));
      if (st.isFile()) total += st.size;
    });
  } catch (_) {}
  return total;
}

/** Persist the on-disk project to Postgres (no-op in disk mode). */
async function save(id, owner, root, opts) {
  opts = opts || {};
  try {
    fs.writeFileSync(path.join(root, ".owner"), owner, "utf8");
  } catch (_) {}
  if (!ready) return { ok: true, mode: "disk" };
  const data = serialize(root);
  const meta = readMetaFile(root);
  if (data.bytes > MAX_BUILD_BYTES) {
    const err = new Error("This build is too large to save (" + Math.round(data.bytes / 1024) + " KB).");
    err.status = 413;
    throw err;
  }
  await pool.query(
    "INSERT INTO builds (id, owner, name, template, files, history, size_bytes, edit_count, created_at, updated_at)" +
      " VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,0,COALESCE($8::timestamptz, now()),now())" +
      " ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, template=EXCLUDED.template, files=EXCLUDED.files," +
      " history=EXCLUDED.history, size_bytes=EXCLUDED.size_bytes," +
      " edit_count = builds.edit_count + $9, updated_at=now()",
    [
      id,
      owner,
      String(meta.name || id).slice(0, 120),
      meta.template || null,
      JSON.stringify(data.files),
      JSON.stringify(data.history),
      data.bytes,
      meta.createdAt || null,
      opts.edited ? 1 : 0,
    ]
  );
  return { ok: true, mode: "postgres", bytes: data.bytes };
}

/** Make sure the disk cache for a build exists; pull it from Postgres if not. */
async function hydrate(id, root) {
  if (fs.existsSync(path.join(root, "forge.json"))) return "disk";
  if (!ready) return null;
  const r = await pool.query("SELECT owner, files, history FROM builds WHERE id=$1", [id]);
  if (!r.rows.length) return null;
  const row = r.rows[0];
  const tmp = root + ".hydrate-" + process.pid + "-" + Date.now();
  fs.mkdirSync(tmp, { recursive: true });
  writeTree(tmp, row.files);
  writeTree(tmp, row.history);
  fs.writeFileSync(path.join(tmp, ".owner"), row.owner, "utf8");
  try {
    fs.renameSync(tmp, root);
  } catch (err) {
    /* Another request hydrated it first. */
    fs.rmSync(tmp, { recursive: true, force: true });
    if (!fs.existsSync(path.join(root, "forge.json"))) throw err;
  }
  console.log("[buildstore] hydrated", id, "from postgres");
  return "postgres";
}

function rowSummary(row) {
  return {
    id: row.id,
    name: row.name,
    template: row.template,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    editCount: row.edit_count || 0,
    previewPath: "/preview/" + row.id + "/",
  };
}

function diskBuilds(buildsDir) {
  const out = [];
  let dirs = [];
  try {
    dirs = fs.readdirSync(buildsDir, { withFileTypes: true });
  } catch (_) {
    return out;
  }
  dirs.forEach(function (d) {
    if (!d.isDirectory() || !/^[a-z0-9]{8,32}$/i.test(d.name)) return;
    const root = path.join(buildsDir, d.name);
    let owner = "";
    try {
      owner = fs.readFileSync(path.join(root, ".owner"), "utf8").trim();
    } catch (_) {}
    const meta = readMetaFile(root);
    out.push({
      id: d.name,
      owner: owner,
      name: meta.name || d.name,
      template: meta.template || null,
      created_at: meta.createdAt || null,
      updated_at: meta.updatedAt || meta.createdAt || null,
      edit_count: 0,
    });
  });
  return out;
}

async function listByOwner(owner, buildsDir, limit) {
  limit = limit || 50;
  if (ready) {
    const r = await pool.query(
      "SELECT id, name, template, created_at, updated_at, edit_count FROM builds WHERE owner=$1 ORDER BY updated_at DESC LIMIT $2",
      [owner, limit]
    );
    return r.rows.map(rowSummary);
  }
  return diskBuilds(buildsDir)
    .filter(function (b) {
      return b.owner === owner;
    })
    .sort(function (a, b) {
      return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
    })
    .slice(0, limit)
    .map(rowSummary);
}

async function ownerOf(id, root) {
  if (ready) {
    const r = await pool.query("SELECT owner FROM builds WHERE id=$1", [id]);
    if (r.rows.length) return r.rows[0].owner;
  }
  try {
    return fs.readFileSync(path.join(root, ".owner"), "utf8").trim() || null;
  } catch (_) {
    return null;
  }
}

async function countByOwner(owner, buildsDir) {
  if (ready) {
    const r = await pool.query("SELECT count(*)::int AS n FROM builds WHERE owner=$1", [owner]);
    return r.rows[0].n;
  }
  return diskBuilds(buildsDir).filter(function (b) {
    return b.owner === owner;
  }).length;
}

async function countAll(buildsDir) {
  if (ready) {
    const r = await pool.query("SELECT count(*)::int AS n, COALESCE(sum(size_bytes),0)::bigint AS bytes FROM builds");
    return { count: r.rows[0].n, bytes: Number(r.rows[0].bytes) };
  }
  return { count: diskBuilds(buildsDir).length, bytes: 0 };
}

async function remove(id, root) {
  if (ready) await pool.query("DELETE FROM builds WHERE id=$1", [id]);
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch (_) {}
}

async function health() {
  if (!ready) return { mode: "disk", durable: false, error: initError ? String(initError.message || initError) : undefined };
  try {
    await pool.query("SELECT 1");
    return { mode: "postgres", durable: true };
  } catch (err) {
    return { mode: "postgres", durable: true, ok: false, error: err.message };
  }
}

module.exports = {
  init,
  mode,
  save,
  hydrate,
  listByOwner,
  ownerOf,
  countByOwner,
  countAll,
  remove,
  health,
  serialize,
  publicBytes,
  MAX_BUILD_BYTES,
};
