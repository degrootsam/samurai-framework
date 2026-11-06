import { test } from "node:test";
import assert from "node:assert/strict";
import { MockLanguageModelV4 } from "ai/test";
import { assertModelObject } from "./model.js";

test("a string model id is refused: it would go through the AI Gateway", () => {
  assert.throws(
    () => assertModelObject("anthropic/claude-sonnet-4"),
    /agent\(\): model must be a model object.*Gateway/s,
  );
});

test("something that is not a model object is refused", () => {
  assert.throws(() => assertModelObject({}), /specificationVersion/);
  assert.throws(() => assertModelObject(undefined), /agent\(\):/);
});

test("a model object passes through", () => {
  const model = new MockLanguageModelV4();
  assert.equal(assertModelObject(model), model);
});
