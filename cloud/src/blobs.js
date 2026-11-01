// D1-backed object store with the small subset of the R2 API the Worker uses (get/put/delete/head).
// Files are split into base64 chunks (<= 512 KiB raw) so each row stays well under D1's 2 MB row limit.
import { b64ToBytes } from "./util.js";

export const CHUNK = 512 * 1024;

function toB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function blobs(env) {
  const db = env.FILES || env.DB;
  return {
    async head(key) {
      const r = await db.prepare("SELECT type, size, chunks FROM blobs WHERE key=?1").bind(key).first();
      return r ? { size: r.size, chunks: r.chunks, httpMetadata: { contentType: r.type || undefined } } : null;
    },
    async get(key) {
      const r = await db.prepare("SELECT type, size, chunks FROM blobs WHERE key=?1").bind(key).first();
      if (!r) return null;
      let i = 0;
      const body = new ReadableStream({
        async pull(ctrl) {
          if (i >= r.chunks) return ctrl.close();
          const c = await db.prepare("SELECT data FROM blob_chunks WHERE key=?1 AND idx=?2").bind(key, i).first();
          i++;
          if (!c) return ctrl.error(new Error("missing chunk"));
          ctrl.enqueue(b64ToBytes(c.data));
        },
      });
      return { body, size: r.size, httpMetadata: { contentType: r.type || undefined } };
    },
    async put(key, bytes, opts) {
      const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const n = Math.max(1, Math.ceil(u8.length / CHUNK));
      const stmts = [db.prepare("DELETE FROM blob_chunks WHERE key=?1").bind(key)];
      for (let i = 0; i < n; i++) stmts.push(db.prepare("INSERT INTO blob_chunks (key, idx, data) VALUES (?1,?2,?3)").bind(key, i, toB64(u8.subarray(i * CHUNK, (i + 1) * CHUNK))));
      stmts.push(db.prepare("INSERT INTO blobs (key, type, size, chunks) VALUES (?1,?2,?3,?4) ON CONFLICT(key) DO UPDATE SET type=excluded.type, size=excluded.size, chunks=excluded.chunks")
        .bind(key, (opts && opts.httpMetadata && opts.httpMetadata.contentType) || null, u8.length, n));
      await db.batch(stmts);
    },
    async delete(key) {
      await db.batch([db.prepare("DELETE FROM blobs WHERE key=?1").bind(key), db.prepare("DELETE FROM blob_chunks WHERE key=?1").bind(key)]);
    },
  };
}
