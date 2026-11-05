import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateFullyParallelConfig } from "./fully-parallel.js";

describe("validateFullyParallelConfig", () => {
  it("accepts a boolean or nothing", () => {
    validateFullyParallelConfig({});
    validateFullyParallelConfig({ fullyParallel: true });
    validateFullyParallelConfig({ fullyParallel: false });
  });

  it("names the key when it is not a boolean", () => {
    assert.throws(
      () => validateFullyParallelConfig({ fullyParallel: "yes" as never }),
      /^Error: fullyParallel must be true or false, got "yes"$/,
    );
  });
});
