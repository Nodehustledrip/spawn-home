"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const badge = require("../badge");

test("badge: injects once before </body>, links to spawnapp.org with ref", () => {
  const html = "<html><body><h1>Hi</h1></body></html>";
  const out = badge.inject(html);
  assert.ok(out.indexOf("Made with Spawn") > 0);
  assert.ok(out.indexOf("https://spawnapp.org/?ref=badge") > 0);
  assert.ok(out.indexOf(badge.MARK) < out.indexOf("</body>"));
  assert.equal(badge.inject(out), out, "idempotent");
  assert.ok(badge.inject("<p>no body</p>").endsWith("\n"));
});

test("badge: Pro and owner-exempt accounts skip it; free and anonymous get it", () => {
  process.env.SPAWN_BADGE_EXEMPT_EMAILS = "Owner@Example.com";
  assert.equal(badge.exempt(null), false);
  assert.equal(badge.exempt({ id: 1, email: "x@y.co", plan: "free" }), false);
  assert.equal(badge.exempt({ id: 2, email: "x@y.co", plan: "pro", plan_status: "active" }), true);
  assert.equal(badge.exempt({ id: 3, email: "owner@example.com", plan: "free" }), true);
  delete process.env.SPAWN_BADGE_EXEMPT_EMAILS;
});
