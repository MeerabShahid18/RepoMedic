const assert = require("node:assert/strict");
const test = require("node:test");
const { findUser } = require("../src/users");

test("finds the user whose ID is 2 rather than treating the ID as an array index", () => {
  assert.deepEqual(findUser("2"), { id: 2, name: "Grace" });
});

test("returns no user for an ID that does not exist", () => {
  assert.equal(findUser("99"), undefined);
});
