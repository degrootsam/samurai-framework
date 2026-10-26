import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { flowFacts } from "./project-facts.js";

describe("flowFacts", () => {
  it("turns the runner's tests and the groups into the facts a flow is wired with", () => {
    assert.deepEqual(
      flowFacts(
        [
          { id: "a", inputs: { email: "a@b.c", ref: "" }, outputs: ["o"] },
          { id: "b" },
        ],
        [{ name: "g", testIds: ["a", "b"] }],
      ),
      {
        tests: {
          a: {
            inputs: [
              { name: "email", default: "a@b.c" },
              { name: "ref", default: "" },
            ],
            outputs: ["o"],
          },
          b: { inputs: [], outputs: [] },
        },
        groups: { g: ["a", "b"] },
      },
    );
  });
});
