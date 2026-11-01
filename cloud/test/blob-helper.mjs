// Writes a file into the D1 blob tables the same way the publish API does (512 KiB base64 chunks).
export async function putBlob(db, key, body, type = null) {
  const b = Buffer.from(body); const C = 512 * 1024; const n = Math.max(1, Math.ceil(b.length / C));
  for (let i = 0; i < n; i++) await db.prepare("INSERT OR REPLACE INTO blob_chunks (key, idx, data) VALUES (?1,?2,?3)").bind(key, i, b.subarray(i * C, (i + 1) * C).toString("base64")).run();
  await db.prepare("INSERT OR REPLACE INTO blobs (key, type, size, chunks) VALUES (?1,?2,?3,?4)").bind(key, type, b.length, n).run();
}
