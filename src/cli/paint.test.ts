import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_PORT } from "../runner/run.js";
import { painter } from "./paint.js";
import { USAGE } from "./usage.js";
import { frameworkVersion } from "./version.js";

describe("painter", () => {
  it("wraps text in the colour code, or leaves it alone without colour", () => {
    assert.equal(painter(true)(31, "x"), "\u001b[31mx\u001b[0m");
    assert.equal(painter(false)(31, "x"), "x");
  });
});

describe("frameworkVersion", () => {
  it("is the version of package.json", () => {
    assert.match(frameworkVersion(), /^\d+\.\d+\.\d+/);
  });
});

describe("the usage text", () => {
  it("names the default port from the runner", () => {
    assert.ok(USAGE.includes(`(default ${DEFAULT_PORT})`));
  });
});
