import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickTest } from "./session.js";

const tests = [
  { name: "Login > signs in" },
  { name: "Login > signs out" },
  { name: "Cart > adds an item" },
];

describe("pickTest", () => {
  it("takes the only test without a selector, and asks otherwise", () => {
    assert.equal(pickTest([{ name: "a" }], undefined), 0);
    assert.throws(
      () => pickTest(tests, undefined),
      /choose one with --test[\s\S]*Cart > adds an item/,
    );
  });

  it("takes an index", () => {
    assert.equal(pickTest(tests, 2), 2);
    assert.throws(() => pickTest(tests, 3), /no test 3/);
    assert.throws(() => pickTest(tests, -1), /no test -1/);
  });

  it("takes a full name, or a part of one that is unique", () => {
    assert.equal(pickTest(tests, "Login > signs out"), 1);
    assert.equal(pickTest(tests, "adds"), 2);
    assert.throws(() => pickTest(tests, "Login"), /matches 2 tests/);
    assert.throws(() => pickTest(tests, "nope"), /No test matches "nope"/);
  });

  it("explains an empty file", () => {
    assert.throws(() => pickTest([], undefined), /--new/);
  });
});
