import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSelected } from "./test-runner.js";

describe("isSelected", () => {
  it("selects everything without options", () => {
    assert.equal(isSelected("A > b", {}), true);
  });

  it("grep: a string must be contained, a RegExp must match", () => {
    assert.equal(isSelected("Checkout > coupon", { grep: "coupon" }), true);
    assert.equal(isSelected("Checkout > coupon", { grep: "login" }), false);
    assert.equal(isSelected("Checkout > coupon", { grep: /^Checkout/ }), true);
    const global = /coupon/g;
    assert.equal(isSelected("coupon", { grep: global }), true);
    assert.equal(
      isSelected("coupon", { grep: global }),
      true,
      "a global RegExp does not remember where it stopped",
    );
  });

  it("testNames: exact full names only", () => {
    assert.equal(isSelected("A > b", { testNames: ["A > b"] }), true);
    assert.equal(isSelected("A > b", { testNames: ["A"] }), false);
  });

  it("both must agree", () => {
    assert.equal(
      isSelected("A > b", { testNames: ["A > b"], grep: "zzz" }),
      false,
    );
  });
});
