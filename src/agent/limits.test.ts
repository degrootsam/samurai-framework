import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LIMITS, resolveLimits } from "./limits.js";

test("limits default and take per-run overrides", () => {
  assert.deepEqual(resolveLimits(), DEFAULT_LIMITS);
  assert.deepEqual(resolveLimits({ maxSteps: 5 }), {
    ...DEFAULT_LIMITS,
    maxSteps: 5,
  });
});

test("a limit that is not a positive number is refused", () => {
  assert.throws(() => resolveLimits({ maxTokens: 0 }), /limits.maxTokens/);
  assert.throws(() => resolveLimits({ timeoutMs: NaN }), /limits.timeoutMs/);
});
