import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CLOSED_KINDS } from "../../core/index.js";
import { STEPS } from "../../steps/index.js";
import { HANDLERS } from "./index.js";

describe("handlers", () => {
  test("every closed kind and every built-in step has a handler, and nothing else does", () => {
    const kinds = [...CLOSED_KINDS, ...STEPS.map((s) => s.kind)].sort();
    assert.deepEqual(Object.keys(HANDLERS).sort(), kinds);
  });
});
