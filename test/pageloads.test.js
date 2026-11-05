"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  create,
  chicagoDay,
  shouldCount,
  isBot,
  timingSafeEqualStr,
} = require("../pageloads");

function mockReq(over) {
  return Object.assign(
    {
      method: "GET",
      headers: {
        host: "spawnapp.org",
        "user-agent": "Mozilla/5.0 (Macintosh) Chrome/120.0.0.0",
        "sec-fetch-dest": "document",
      },
    },
    over || {}
  );
}
function mockRes(status, contentType) {
  return {
    statusCode: status,
    getHeader: function (n) {
      return n.toLowerCase() === "content-type" ? contentType : undefined;
    },
  };
}

test("chicagoDay is YYYY-MM-DD", () => {
  assert.match(chicagoDay(), /^\d{4}-\d{2}-\d{2}$/);
});

test("counts browser HTML document", () => {
  assert.equal(shouldCount(mockReq(), mockRes(200, "text/html; charset=utf-8")), true);
});

test("skips bots", () => {
  assert.equal(isBot("Googlebot/2.1"), true);
  assert.equal(isBot("curl/8.0"), true);
  assert.equal(isBot("spawn-home-keepalive"), true);
  assert.equal(
    shouldCount(
      mockReq({ headers: { host: "spawnapp.org", "user-agent": "Googlebot", "sec-fetch-dest": "document" } }),
      mockRes(200, "text/html")
    ),
    false
  );
});

test("skips assets and JSON even with GET", () => {
  assert.equal(
    shouldCount(
      mockReq({ headers: { host: "spawnapp.org", "user-agent": "Mozilla/5.0", "sec-fetch-dest": "style" } }),
      mockRes(200, "text/css")
    ),
    false
  );
  assert.equal(
    shouldCount(
      mockReq({ headers: { host: "spawnapp.org", "user-agent": "Mozilla/5.0", "sec-fetch-dest": "empty" } }),
      mockRes(200, "application/json")
    ),
    false
  );
});

test("skips redirects and errors", () => {
  assert.equal(shouldCount(mockReq(), mockRes(301, "text/html")), false);
  assert.equal(shouldCount(mockReq(), mockRes(404, "text/html")), false);
  assert.equal(shouldCount(mockReq(), mockRes(500, "text/html")), false);
});

test("skips HEAD", () => {
  assert.equal(shouldCount(mockReq({ method: "HEAD" }), mockRes(200, "text/html")), false);
});

test("counts HTML without Sec-Fetch-Dest (old clients)", () => {
  assert.equal(
    shouldCount(
      mockReq({ headers: { host: "spawnapp.org", "user-agent": "Mozilla/5.0" } }),
      mockRes(200, "text/html")
    ),
    true
  );
});

test("timingSafeEqualStr", () => {
  assert.equal(timingSafeEqualStr("abc", "abc"), true);
  assert.equal(timingSafeEqualStr("abc", "abd"), false);
  assert.equal(timingSafeEqualStr("abc", "ab"), false);
});

test("flush UPSERTs batched counts", async () => {
  const batches = [];
  const pool = {
    batch: async function (stmts) {
      batches.push(stmts);
      return stmts.map(function () { return []; });
    },
  };
  const pl = create({ getPool: function () { return pool; } });
  pl.bump("spawnapp.org");
  pl.bump("spawnapp.org");
  pl.bump("www.spawnapp.org");
  await pl.flush();
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 2);
  const byHost = Object.fromEntries(
    batches[0].map(function (s) { return [s.params[1], s.params[2]]; })
  );
  assert.equal(byHost["spawnapp.org"], 2);
  assert.equal(byHost["www.spawnapp.org"], 1);
  assert.equal(pl._pending.size, 0);
});
