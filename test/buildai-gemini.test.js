"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const FAKE_KEY = "test-key-not-real-123";
process.env.GEMINI_API_KEY = FAKE_KEY;
process.env.GEMINI_MODEL = "gemini-test-flash";
delete process.env.GEMINI_FALLBACK_MODEL;
delete process.env.OPENAI_API_KEY;
delete process.env.AI_API_KEY;
delete process.env.GROQ_API_KEY;
delete process.env.OPENROUTER_API_KEY;

const buildai = require("../buildai");
const webgen = require("../webgen");

const SITE_HTML =
  '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Cedar Lawn Care</title><link rel="stylesheet" href="styles.css"></head><body>' +
  '<header><button type="button" data-theme-toggle>Light</button><button type="button" data-nav-toggle>Menu</button><nav data-nav-menu><a href="#quote">Quote</a></nav></header>' +
  "<main><h1>Lawn mowing and aeration in Cedar Rapids</h1>" +
  '<form id="leadForm"><label>Name<input name="name" required></label><label>Email<input name="email" type="email" required></label><button type="submit">Send</button></form><p id="leadMsg" role="status"></p>' +
  "</main></body></html>";
const SITE_CSS = ":root{--bg:#0b1210;--fg:#eaf5ef}" + "body{margin:0;font-family:system-ui;background:var(--bg);color:var(--fg)}".repeat(10);

function reply(obj, status) {
  return {
    ok: !status || status < 400,
    status: status || 200,
    text: async function () {
      return JSON.stringify(obj);
    },
  };
}
function geminiOk(payload) {
  return reply({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(payload) }] } }] });
}

function scaffold() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gem-"));
  return webgen.createBuild({ name: "Cedar Lawn Care", template: "local-service", description: "lawn care" }, dir).path;
}

const realFetch = global.fetch;
test.afterEach(function () {
  global.fetch = realFetch;
  buildai._resetLimits();
  delete process.env.AI_DAILY_CAP;
  delete process.env.AI_OWNER_DAILY;
});

test("gemini is selected and status hides the key and vendor label", async function () {
  const s = await buildai.status();
  assert.equal(s.provider, "gemini");
  assert.equal(s.mode, "free-cloud");
  assert.equal(s.online, true);
  const txt = JSON.stringify(s);
  assert.ok(!txt.includes(FAKE_KEY));
  assert.ok(!/gemini|google/i.test(s.label + s.message));
});

test("generateSite writes model site, adds runtime script, sends key only in header", async function () {
  const root = scaffold();
  let seen;
  global.fetch = async function (url, opts) {
    seen = { url: String(url), opts: opts };
    return geminiOk({ reply: "Done", html: SITE_HTML, css: SITE_CSS });
  };
  const r = await buildai.generateSite(root, { name: "Cedar Lawn Care", description: "lawn mowing in Cedar Rapids" }, "1.2.3.4", "o1");
  assert.equal(r.ok, true);
  assert.ok(!seen.url.includes(FAKE_KEY));
  assert.equal(seen.opts.headers["x-goog-api-key"], FAKE_KEY);
  assert.ok(seen.url.includes("gemini-test-flash:generateContent"));
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.ok(html.includes("Cedar Rapids"));
  assert.ok(html.includes("data-ui-runtime"));
  assert.ok(html.includes("/api/lead"));
  assert.ok(fs.readFileSync(path.join(root, "public/styles.css"), "utf8").includes("--bg"));
});

test("generateSite rejects scripts / missing hooks and leaves the scaffold", async function () {
  const root = scaffold();
  const before = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  global.fetch = async function () {
    return geminiOk({ reply: "x", html: SITE_HTML.replace("</main>", "<script>alert(1)</script></main>"), css: SITE_CSS });
  };
  const r = await buildai.generateSite(root, { name: "X" }, "1.2.3.5", "o2");
  assert.equal(r.ok, false);
  global.fetch = async function () {
    return geminiOk({ reply: "x", html: SITE_HTML.replace('id="leadForm"', ""), css: SITE_CSS });
  };
  const r2 = await buildai.generateSite(root, { name: "X" }, "1.2.3.5", "o2");
  assert.equal(r2.ok, false);
  assert.equal(fs.readFileSync(path.join(root, "public/index.html"), "utf8"), before);
});

test("429 from the free tier falls back and pauses cloud AI honestly", async function () {
  const root = scaffold();
  global.fetch = async function () {
    return reply({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "quota" } }, 429);
  };
  const r = await buildai.generateSite(root, { name: "X" }, "1.2.3.6", "o3");
  assert.deepEqual(r, { ok: false, reason: "quota" });
  const s = await buildai.status();
  assert.equal(s.mode, "offline");
  assert.equal(s.configured, false);
  assert.match(s.label, /paused/);
  const e = await buildai.applyAiEdit(root, "make it green", "1.2.3.6", "o3");
  assert.equal(e.reason, "quota");
});

test("daily and per-owner caps stop model calls", async function () {
  process.env.AI_DAILY_CAP = "2";
  process.env.AI_OWNER_DAILY = "1";
  assert.equal(buildai._rateCheck("9.9.9.1", "a"), null);
  assert.equal(buildai._rateCheck("9.9.9.2", "a"), "owner_daily_cap");
  assert.equal(buildai._rateCheck("9.9.9.3", "b"), null);
  assert.equal(buildai._rateCheck("9.9.9.4", "c"), "daily_cap");
  const s = await buildai.status();
  assert.equal(s.capped, true);
  assert.equal(s.mode, "offline");
});

test("edit applies model patches and keeps the runtime on full rewrites", async function () {
  const root = scaffold();
  global.fetch = async function () {
    return geminiOk({ reply: "Site", html: SITE_HTML, css: SITE_CSS });
  };
  await buildai.generateSite(root, { name: "Cedar Lawn Care" }, "1.2.3.7", "o4");
  global.fetch = async function () {
    return geminiOk({
      reply: "Changed headline",
      patches: [{ path: "public/index.html", find: "Lawn mowing and aeration in Cedar Rapids", replace: "Fall cleanup in Cedar Rapids" }],
      files: [],
    });
  };
  const e = await buildai.applyAiEdit(root, "headline about fall cleanup", "1.2.3.7", "o4");
  assert.equal(e.ok, true);
  let html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.ok(html.includes("Fall cleanup in Cedar Rapids"));
  global.fetch = async function () {
    return geminiOk({ reply: "Rewrote", patches: [], files: [{ path: "public/index.html", content: SITE_HTML.replace("Lawn mowing", "Aeration") }] });
  };
  const e2 = await buildai.applyAiEdit(root, "rewrite", "1.2.3.7", "o4");
  assert.equal(e2.ok, true);
  html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.ok(html.includes("data-ui-runtime"));
});
