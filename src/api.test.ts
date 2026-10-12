import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as root from "./api.js";
import * as steps from "./flows/steps/index.js";

describe("the package root", () => {
  it("exports defineStep next to defineConfig, the same one as flows/steps", () => {
    assert.equal(root.defineStep, steps.defineStep);
    assert.equal(typeof root.defineConfig, "function");
  });
});
