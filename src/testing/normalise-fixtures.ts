import assert from "node:assert/strict";
import type { LocatorSpec, Step } from "../steps/model.js";
import type { Observation, RecorderEvent } from "../recorder/normalise.js";

export const loc = (testId: string): LocatorSpec => ({
  chain: [{ method: "getByTestId", testId }],
  fallbacks: [],
});
export const click = (key: string, textEntry = false): Observation => ({
  type: "click",
  key,
  locator: loc(key),
  textEntry,
});
export const input = (key: string, value: string): Observation => ({
  type: "input",
  key,
  locator: loc(key),
  value,
});

/** The step an insert or replace event carries */
export function stepOf(event: RecorderEvent | undefined): Step {
  assert.ok(event && event.op !== "remove");
  return event.step;
}
