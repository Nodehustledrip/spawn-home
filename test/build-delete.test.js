const test = require("node:test");
const assert = require("node:assert");
process.env.WAITLIST_ADMIN_TOKEN = "t-admin-123";
const { isAdminReq } = require("../builds");
test("admin token may delete any build", () => {
  assert.strictEqual(isAdminReq({ headers: { "x-waitlist-token": "t-admin-123" } }, null), true);
});
test("wrong or missing token is not admin", () => {
  assert.strictEqual(isAdminReq({ headers: { "x-waitlist-token": "nope" } }, null), false);
  assert.strictEqual(isAdminReq({ headers: {} }, null), false);
  assert.strictEqual(isAdminReq({ headers: {} }, { email: "random@example.com" }), false);
});
