import { test } from "node:test";
import assert from "node:assert/strict";
import { modifierCodes, NAMED_KEYS, parseKeyChord } from "./key-map.js";

const CONTROL = "";
const SHIFT = "";
const META = "";

test("a single character is its own key", () => {
  assert.deepEqual(parseKeyChord("a", "press"), { modifiers: [], key: "a" });
  assert.deepEqual(parseKeyChord("+", "press"), { modifiers: [], key: "+" });
});

test("a named key maps to its WebDriver code point", () => {
  assert.deepEqual(parseKeyChord("Enter", "press"), {
    modifiers: [],
    key: NAMED_KEYS.Enter,
  });
  assert.equal(NAMED_KEYS.F5, "");
  assert.equal(NAMED_KEYS.Insert, "");
});

test("KeyA and Digit1 are the keys a and 1", () => {
  assert.equal(parseKeyChord("KeyA", "press").key, "a");
  assert.equal(parseKeyChord("Digit7", "press").key, "7");
});

test("a chord is modifiers followed by one key", () => {
  assert.deepEqual(parseKeyChord("Control+a", "press"), {
    modifiers: [CONTROL],
    key: "a",
  });
  assert.deepEqual(parseKeyChord("Control+Shift+Tab", "press"), {
    modifiers: [CONTROL, SHIFT],
    key: NAMED_KEYS.Tab,
  });
});

test("a chord can end in the plus key", () => {
  assert.deepEqual(parseKeyChord("Control++", "press"), {
    modifiers: [CONTROL],
    key: "+",
  });
});

test("a modifier alone is a key", () => {
  assert.deepEqual(parseKeyChord("Shift", "press"), {
    modifiers: [],
    key: SHIFT,
  });
});

test("ControlOrMeta is Control, except on macOS", () => {
  assert.deepEqual(modifierCodes(["ControlOrMeta"], "linux"), [CONTROL]);
  assert.deepEqual(modifierCodes(["ControlOrMeta"], "darwin"), [META]);
  assert.deepEqual(parseKeyChord("ControlOrMeta+c", "press", "darwin"), {
    modifiers: [META],
    key: "c",
  });
});

test("an unknown key names the method and the key", () => {
  assert.throws(
    () => parseKeyChord("Hyper", "keyboard.press"),
    /^Error: keyboard\.press\(\): unknown key "Hyper"/,
  );
  assert.throws(
    () => parseKeyChord("Control+Hyper", "press"),
    /press\(\): unknown key "Hyper"/,
  );
});

test("a non-modifier before the last key is an error", () => {
  assert.throws(
    () => parseKeyChord("a+b", "press"),
    /press\(\): "a" is not a modifier/,
  );
});

test("an empty key is an error", () => {
  assert.throws(() => parseKeyChord("", "press"), /press\(\): unknown key ""/);
});
