"use strict";
/* Live build preview (streaming), click-to-edit, version timeline, style presets. */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

process.env.GEMINI_API_KEY = "test-key-not-real-456";
process.env.GEMINI_MODEL = "gemini-test-flash";
delete process.env.GEMINI_FALLBACK_MODEL;
delete process.env.OPENAI_API_KEY;
delete process.env.AI_API_KEY;
delete process.env.GROQ_API_KEY;
delete process.env.OPENROUTER_API_KEY;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "studio-"));
process.env.BUILDS_DIR = path.join(TMP, "builds");
delete process.env.DATABASE_URL;
delete process.env.STORAGE_BACKEND;

const buildai = require("../buildai");
const versions = require("../buildversions");
const presets = require("../buildpresets");
const webgen = require("../webgen");

const HTML =
  '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Cedar Lawn</title><link rel="stylesheet" href="styles.css"></head><body>' +
  '<header><button type="button" data-theme-toggle>Light</button></header><main><section><h1>Lawn care in Cedar Rapids</h1><p>Weekly mowing.</p></section>' +
  '<form id="leadForm"><label>Name<input name="name" required></label><button type="submit">Send</button></form><p id="leadMsg" role="status"></p></main></body></html>';
const CSS = ":root{--bg:#0b1210;--text:#eaf5ef;--accent:#5eead4;--radius:12px}" + "body{margin:0;background:var(--bg);color:var(--text)}".repeat(10);
const PAYLOAD = { reply: "A lawn site.", css: CSS, html: HTML };

function sseBody(text, pieces, failAfter) {
  const enc = new TextEncoder();
  const size = Math.ceil(text.length / pieces);
  return {
    async *[Symbol.asyncIterator]() {
      for (let i = 0, n = 0; i < text.length; i += size, n++) {
        if (failAfter != null && n >= failAfter) throw new Error("socket hang up");
        const ev = { candidates: [{ content: { parts: [{ text: text.slice(i, i + size) }] } }] };
        /* split each SSE event across two network chunks to exercise buffering */
        const line = "data: " + JSON.stringify(ev) + "\r\n\r\n";
        yield enc.encode(line.slice(0, 7));
        yield enc.encode(line.slice(7));
      }
      yield enc.encode('data: {"candidates":[{"finishReason":"STOP","content":{"parts":[]}}]}\n\n');
    },
  };
}
function okJson(obj) {
  return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(obj) }] } }] }) };
}

test("streamed create writes exactly what a non-streamed create writes", async () => {
  const realFetch = global.fetch;
  const calls = [];
  try {
    global.fetch = async (url) => {
      calls.push(String(url));
      if (/streamGenerateContent/.test(url)) return { ok: true, status: 200, body: sseBody(JSON.stringify(PAYLOAD), 9) };
      return okJson(PAYLOAD);
    };
    buildai._resetLimits();
    const a = webgen.createBuild({ template: "local-service", name: "Cedar Lawn", description: "lawn care" }, path.join(TMP, "s1"));
    const b = webgen.createBuild({ template: "local-service", name: "Cedar Lawn", description: "lawn care" }, path.join(TMP, "s2"));
    let streamed = "";
    const ra = await buildai.generateSite(a.path, { name: "Cedar Lawn" }, "1.1.1.1", "o1", (t) => { if (t) streamed += t; });
    const rb = await buildai.generateSite(b.path, { name: "Cedar Lawn" }, "1.1.1.2", "o2");
    assert.ok(ra.ok && rb.ok);
    assert.strictEqual(streamed, JSON.stringify(PAYLOAD));
    assert.ok(calls[0].includes(":streamGenerateContent?alt=sse"));
    assert.ok(calls[1].includes(":generateContent"));
    for (const f of ["index.html", "styles.css"]) {
      assert.strictEqual(fs.readFileSync(path.join(a.path, "public", f), "utf8"), fs.readFileSync(path.join(b.path, "public", f), "utf8"));
    }
  } finally {
    global.fetch = realFetch;
  }
});

test("a stream that breaks mid-way falls back to one normal call", async () => {
  const realFetch = global.fetch;
  const events = [];
  try {
    let n = 0;
    global.fetch = async (url) => {
      n++;
      if (/streamGenerateContent/.test(url)) return { ok: true, status: 200, body: sseBody(JSON.stringify(PAYLOAD), 9, 3) };
      return okJson(PAYLOAD);
    };
    buildai._resetLimits();
    const a = webgen.createBuild({ template: "local-service", name: "Cedar Lawn" }, path.join(TMP, "s3"));
    const r = await buildai.generateSite(a.path, { name: "Cedar Lawn" }, "1.1.1.3", "o3", (t, info) => events.push(t === null ? "reset" : "d"));
    assert.ok(r.ok);
    assert.strictEqual(n, 2);
    assert.ok(events.includes("reset"));
    assert.match(fs.readFileSync(path.join(a.path, "public", "index.html"), "utf8"), /Lawn care in Cedar Rapids/);
  } finally {
    global.fetch = realFetch;
  }
});

test("quota errors on the stream do not spend a second call", async () => {
  const realFetch = global.fetch;
  try {
    let n = 0;
    global.fetch = async () => { n++; return { ok: false, status: 429, text: async () => '{"error":{"status":"RESOURCE_EXHAUSTED"}}', json: async () => ({}) }; };
    buildai._resetLimits();
    const a = webgen.createBuild({ template: "local-service", name: "Quota" }, path.join(TMP, "s4"));
    const r = await buildai.generateSite(a.path, { name: "Quota" }, "1.1.1.4", "o4", () => {});
    assert.strictEqual(r.ok, false);
    assert.strictEqual(n, 1);
  } finally {
    global.fetch = realFetch;
  }
});

test("element rewrite: same tag ok; tag swap, scripts and handlers rejected", () => {
  const before = '<h2 class="title">Our services</h2>';
  assert.strictEqual(buildai.checkElementReplacement(before, '<h2 class="title" style="font-weight:900">Our services</h2>'), '<h2 class="title" style="font-weight:900">Our services</h2>');
  assert.throws(() => buildai.checkElementReplacement(before, "<p>x</p>"), /tag changed/);
  assert.throws(() => buildai.checkElementReplacement(before, '<h2 onclick="x()">a</h2>'), /unsafe/);
  assert.throws(() => buildai.checkElementReplacement(before, "<h2>a<script>x</script></h2>"), /unsafe/);
  /* images may become inline SVG art; remote image URLs are dropped */
  assert.match(buildai.checkElementReplacement('<img src="a.png" alt="x">', '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'), /^<svg/);
  assert.strictEqual(buildai.checkElementReplacement('<img src="a.png" alt="x">', '<img src="https://evil.example/a.jpg" alt="x">'), '<img src="" alt="x">');
});

test("element rewrite calls the model with only the element", async () => {
  const realFetch = global.fetch;
  try {
    let sent = null;
    global.fetch = async (url, opts) => { sent = JSON.parse(opts.body); return okJson({ reply: "Bolder.", html: '<h2 style="font-weight:900">Our services</h2>' }); };
    buildai._resetLimits();
    const r = await buildai.editElement("<h2>Our services</h2>", "<section><h2>Our services</h2></section>", "make this bolder", "2.2.2.2", "o5");
    assert.ok(r.ok);
    assert.match(r.html, /font-weight:900/);
    assert.ok(sent.generationConfig.responseSchema.properties.html);
    assert.ok(!sent.generationConfig.responseSchema.properties.patches);
    assert.ok(sent.generationConfig.maxOutputTokens <= 12000);
  } finally {
    global.fetch = realFetch;
  }
});

function project(name) {
  const root = path.join(TMP, name);
  fs.mkdirSync(path.join(root, "public"), { recursive: true });
  fs.writeFileSync(path.join(root, "public", "index.html"), HTML);
  fs.writeFileSync(path.join(root, "public", "styles.css"), CSS);
  return root;
}

test("versions: record, dedupe, list newest first, get, apply", () => {
  const root = project("v1");
  versions.record(root, "Created", "create");
  assert.strictEqual(versions.list(root).length, 1);
  versions.record(root, "same", "edit");
  assert.strictEqual(versions.list(root).length, 1, "identical content is not a new version");
  fs.writeFileSync(path.join(root, "public", "index.html"), HTML.replace("Weekly", "Fortnightly"));
  versions.record(root, "make it fortnightly", "edit");
  const l = versions.list(root);
  assert.deepStrictEqual(l.map((v) => v.n), [2, 1]);
  assert.strictEqual(l[0].label, "make it fortnightly");
  assert.match(versions.get(root, 2).files["index.html"], /Fortnightly/);
  versions.apply(root, 1);
  assert.match(fs.readFileSync(path.join(root, "public", "index.html"), "utf8"), /Weekly/);
  assert.strictEqual(versions.get(root, 99), null);
  assert.strictEqual(versions.get(root, "../x"), null);
});

test("versions: pruned by count, keeping the first and newest", () => {
  const root = project("v2");
  for (let i = 0; i < versions.MAX_VERSIONS + 6; i++) {
    fs.writeFileSync(path.join(root, "public", "index.html"), HTML.replace("Weekly", "Edit " + i));
    versions.record(root, "edit " + i, i ? "edit" : "create");
  }
  const l = versions.list(root);
  assert.strictEqual(l.length, versions.MAX_VERSIONS);
  assert.strictEqual(l[l.length - 1].n, 1);
  assert.strictEqual(l[0].label, "edit " + (versions.MAX_VERSIONS + 5));
});

test("presets: deterministic, replace each other, Original removes the layer", () => {
  const a = presets.apply(CSS, "luxury");
  assert.strictEqual(presets.current(a), "luxury");
  assert.match(a, /--bg:#0e0d0b/);
  assert.match(a, /--accent:#c9a45c/);
  assert.match(a, /--radius:4px/);
  assert.strictEqual(presets.apply(CSS, "luxury"), a, "same input, same output");
  const b = presets.apply(a, "bold");
  assert.strictEqual(presets.current(b), "bold");
  assert.strictEqual(b.split(presets.START).length, 2, "only one layer");
  assert.strictEqual(presets.apply(b, "original").trim(), CSS.trim());
  for (const k of ["playful", "minimal", "dark"]) assert.strictEqual(presets.current(presets.apply(CSS, k)), k);
  assert.throws(() => presets.apply(CSS, "nope"), /Unknown/);
  const r = presets.classify(":root{--surface-2:#111;--text-muted:#999;--brand:#f00;--on-brand:#fff;--hero-glow:radial-gradient(red,blue)}");
  assert.deepStrictEqual([r.surface, r.muted, r.accent, r.accentInk], [["--surface-2"], ["--text-muted"], ["--brand"], ["--on-brand"]]);
  assert.ok(!Object.values(r).flat().includes("--hero-glow"));
});

/* ---- HTTP: the real routes on a temporary disk store ---- */
function server() {
  const express = require("express");
  const app = express();
  app.use(express.json({ limit: "420kb" }));
  require("../builds").mount(app);
  return new Promise((resolve) => {
    const s = http.createServer(app).listen(0, () => resolve(s));
  });
}

test("routes: streamed create, apply, element, versions, restore, presets", async () => {
  const s = await server();
  const base = "http://127.0.0.1:" + s.address().port;
  const H = { "Content-Type": "application/json", "X-Build-Owner": "owner_token_for_tests_abcdefghijkl" };
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    url = String(url);
    if (url.startsWith(base)) return realFetch(url, opts);
    if (/streamGenerateContent/.test(url)) return { ok: true, status: 200, body: sseBody(JSON.stringify(PAYLOAD), 6) };
    if (/generativelanguage|:generateContent/.test(url)) return okJson({ reply: "Bolder.", html: '<h1 style="font-weight:900">Lawn care in Cedar Rapids</h1>' });
    return { ok: true, status: 200, text: async () => "{}", json: async () => ({}) };
  };
  try {
    buildai._resetLimits();
    let r = await realFetch(base + "/api/builds", { method: "POST", headers: H, body: JSON.stringify({ name: "Cedar Lawn", template: "local-service", description: "lawn care", stream: true }) });
    assert.match(r.headers.get("content-type"), /ndjson/);
    const lines = (await r.text()).trim().split("\n").map((l) => JSON.parse(l));
    assert.strictEqual(lines[0].type, "start");
    assert.ok(lines.some((l) => l.type === "delta"));
    const done = lines[lines.length - 1];
    assert.strictEqual(done.type, "done");
    assert.strictEqual(done.status, 201);
    assert.strictEqual(done.data.generated, "ai");
    const id = done.data.build.id;
    assert.strictEqual(id, lines[0].id);

    r = await realFetch(base + "/api/builds/" + id + "/versions", { headers: H });
    let j = await r.json();
    assert.strictEqual(j.versions.length, 1);
    assert.strictEqual(j.versions[0].kind, "create");

    r = await realFetch(base + "/api/builds/" + id + "/source", { headers: H });
    j = await r.json();
    assert.match(j.html, /Lawn care in Cedar Rapids/);
    assert.strictEqual(j.presets.length, 5);

    r = await realFetch(base + "/api/builds/" + id + "/element", { method: "POST", headers: H, body: JSON.stringify({ outer: "<h1>Lawn care in Cedar Rapids</h1>", prompt: "make this bolder" }) });
    j = await r.json();
    assert.ok(j.ok, JSON.stringify(j));
    const html2 = (await (await realFetch(base + "/api/builds/" + id + "/source", { headers: H })).json()).html.replace("<h1>Lawn care in Cedar Rapids</h1>", j.html);
    r = await realFetch(base + "/api/builds/" + id + "/apply", { method: "POST", headers: H, body: JSON.stringify({ html: html2, label: "make this bolder", kind: "element" }) });
    j = await r.json();
    assert.ok(j.ok && j.changed);
    assert.strictEqual(j.versions[0].label, "make this bolder");

    r = await realFetch(base + "/api/builds/" + id + "/apply", { method: "POST", headers: H, body: JSON.stringify({ html: html2.replace("</main>", "<script>alert(1)</script></main>") }) });
    assert.strictEqual(r.status, 400, "scripts are refused");

    r = await realFetch(base + "/api/builds/" + id + "/preset", { method: "POST", headers: H, body: JSON.stringify({ preset: "luxury" }) });
    j = await r.json();
    assert.strictEqual(j.preset, "luxury");
    const css = await (await realFetch(base + "/preview/" + id + "/styles.css")).text();
    assert.match(css, /preset=luxury/);

    r = await realFetch(base + "/api/builds/" + id + "/versions/1/restore", { method: "POST", headers: H });
    j = await r.json();
    assert.strictEqual(j.restored, 1);
    assert.match(j.versions[0].label, /^Restored v1/);
    const page = await (await realFetch(base + "/preview/" + id + "/")).text();
    assert.ok(!/font-weight:900/.test(page));
    assert.ok(!/preset=luxury/.test(await (await realFetch(base + "/preview/" + id + "/styles.css")).text()));

    /* chat undo still works and records a version */
    r = await realFetch(base + "/api/builds/" + id + "/edit", { method: "POST", headers: H, body: JSON.stringify({ message: "undo" }) });
    j = await r.json();
    assert.ok(j.ok);
    j = await (await realFetch(base + "/api/builds/" + id + "/versions", { headers: H })).json();
    assert.strictEqual(j.versions[0].label, "Undo");

    r = await realFetch(base + "/api/builds/" + id + "/versions/2", { headers: { "X-Build-Owner": "someone_else_token_abcdefghijklmnop" } });
    assert.strictEqual(r.status, 403);
  } finally {
    global.fetch = realFetch;
    s.close();
  }
});
