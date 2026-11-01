// pricing.json (what the server charges) must match the prices each premium template shows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const grab = (file, name) => (0, eval)("(" + new RegExp("var " + name + " = (\\[[\\s\\S]*?\\n  \\]);").exec(readFileSync(file, "utf8"))[1] + ")");
const pj = (t) => JSON.parse(readFileSync("apps/" + t + "/pricing.json", "utf8"));
test("shop-template prices match", () => {
  const P = grab("apps/shop-template/shop.js", "PRODUCTS"), c = pj("shop-template");
  for (const p of P) { const it = c.items[p.id]; assert.ok(it, p.id); assert.equal(it.name, p.name);
    p.opt.values.forEach((v, i) => assert.equal(it.variants[v], Math.round((p.opt.prices ? p.opt.prices[i] : p.price) * 100), p.id + ":" + v)); }
  const cfg = readFileSync("apps/shop-template/config.js", "utf8"); assert.equal(c.shipping.freeOver, 100 * Number(/freeShippingOver:\s*(\d+)/.exec(cfg)[1]));
});
test("glow-booking prices match", () => {
  const S = grab("apps/glow-booking/app.js", "SERVICES"), c = pj("glow-booking");
  for (const s of S) assert.equal(c.items[s.id].amount, s.price * 100, s.id);
  assert.equal(c.deposit, 100 * Number(/depositAmount:\s*(\d+)/.exec(readFileSync("apps/glow-booking/config.js", "utf8"))[1]));
});
test("members-club prices match", () => {
  const cfg = readFileSync("apps/members-club/config.js", "utf8"), c = pj("members-club");
  for (const [id, price, per] of [...cfg.matchAll(/id: "(\w+)".*?price: "\$(\d+)", per: "\/ (\w+)"/g)].map((m) => [m[1], m[2], m[3]])) {
    assert.equal(c.items[id].amount, Number(price) * 100); assert.equal(c.items[id].interval, per);
  }
});
