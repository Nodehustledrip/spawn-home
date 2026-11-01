const test = require("node:test");
const assert = require("node:assert");
const G = require("../gallery");

test("decodeEntities decodes once", () => {
  assert.strictEqual(G.decodeEntities("Ember &amp; Oak"), "Ember & Oak");
  assert.strictEqual(G.decodeEntities("A &amp;amp; B"), "A &amp; B");
  assert.strictEqual(G.decodeEntities("&#39;x&#x27; &mdash; &quot;y&quot; &bogus;"), "'x' \u2014 \"y\" &bogus;");
});

test("metaFromHtml returns decoded title/description", () => {
  const m = G.metaFromHtml('<title>Ember &amp; Oak &mdash; Kitchen</title><meta name="description" content="Bread &amp; fire">');
  assert.strictEqual(m.title, "Ember & Oak \u2014 Kitchen");
  assert.strictEqual(m.description, "Bread & fire");
});

test("card svg escapes the decoded title exactly once", () => {
  const svg = G.cardSvg({ slug: "ember-oak", title: "Ember & Oak", description: "Bread & fire", category: "local" });
  assert.ok(svg.includes("Ember &amp; Oak"));
  assert.ok(!svg.includes("&amp;amp;"));
});
