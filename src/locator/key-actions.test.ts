import { test } from "node:test";
import assert from "node:assert/strict";
import { chordSteps, textSteps } from "./key-actions.js";

test("a chord with no modifiers is a key down and up", () => {
  assert.deepEqual(chordSteps({ modifiers: [], key: "a" }), [
    { type: "keyDown", value: "a" },
    { type: "keyUp", value: "a" },
  ]);
});

test("a delay goes between the key down and up, not around the modifiers", () => {
  assert.deepEqual(chordSteps({ modifiers: ["M"], key: "a" }, 5), [
    { type: "keyDown", value: "M" },
    { type: "keyDown", value: "a" },
    { type: "pause", duration: 5 },
    { type: "keyUp", value: "a" },
    { type: "keyUp", value: "M" },
  ]);
});

test("text is one press per character, a line break is Enter, a tab is Tab", () => {
  const values = textSteps("a\nb\t").map((step) =>
    "value" in step ? step.value : "-",
  );
  assert.deepEqual(values, ["a", "a", "", "", "b", "b", "", ""]);
});

test("text with a delay pauses between characters, not after the last", () => {
  const types = textSteps("ab", 7).map((step) => step.type);
  assert.deepEqual(types, ["keyDown", "keyUp", "pause", "keyDown", "keyUp"]);
});

test("no text sends nothing", () => {
  assert.deepEqual(textSteps(""), []);
});
