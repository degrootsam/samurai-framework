import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { isSelected, testDirOf } from "./test-runner.js";

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

describe("testDirOf", () => {
  const at = (file: string, name = "signs in") =>
    testDirOf(
      { file, name } as Parameters<typeof testDirOf>[0],
      path.resolve("/p/src"),
    );

  it("is the spec file under srcDir without extension, then the cleaned test name", () => {
    assert.equal(
      at(path.resolve("/p/src/auth/login.spec.ts")),
      "auth/login.spec/signs-in",
    );
  });

  it("keeps a spec outside srcDir inside screenshots/", () => {
    const dir = at(path.resolve("/p/e2e/login.spec.ts"));
    assert.equal(dir, "e2e/login.spec/signs-in");
    assert.ok(!dir.split("/").includes(".."), dir);
    const far = at(path.resolve("/elsewhere/deep/x.spec.ts"));
    assert.ok(!far.split("/").includes(".."), far);
    assert.ok(!far.startsWith("/"), far);
  });
});
