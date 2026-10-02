import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { keyActions, parseKey } from "./keys.js";

describe("parseKey", () => {
  it("knows named keys and single characters", () => {
    assert.deepEqual(parseKey("Enter"), { modifiers: [], key: "" });
    assert.deepEqual(parseKey("ArrowDown"), { modifiers: [], key: "" });
    assert.deepEqual(parseKey("a"), { modifiers: [], key: "a" });
    assert.deepEqual(parseKey("é"), { modifiers: [], key: "é" });
  });

  it("holds modifiers in the order given", () => {
    assert.deepEqual(parseKey("Control+Enter"), { modifiers: [""], key: "" });
    assert.deepEqual(parseKey("Control+Shift+Tab"), {
      modifiers: ["", ""],
      key: "",
    });
    assert.deepEqual(parseKey("Meta+a"), { modifiers: [""], key: "a" });
  });

  it("a plus that is the key itself stays whole", () => {
    assert.deepEqual(parseKey("+"), { modifiers: [], key: "+" });
    assert.deepEqual(parseKey("Control++"), { modifiers: [""], key: "+" });
  });

  it("refuses what it does not know", () => {
    for (const key of [
      "",
      "Hyper",
      "enter",
      "Control+",
      "+Enter",
      "Ctrl+Enter",
      "Enter+Control",
      "ab",
      "Control+Hyper",
    ]) {
      assert.equal(parseKey(key), undefined, key);
    }
  });
});

describe("keyActions", () => {
  it("presses the key between the modifiers going down and up, and releases them in reverse", () => {
    assert.deepEqual(keyActions(parseKey("Control+Shift+a")!), [
      { type: "keyDown", value: "" },
      { type: "keyDown", value: "" },
      { type: "keyDown", value: "a" },
      { type: "keyUp", value: "a" },
      { type: "keyUp", value: "" },
      { type: "keyUp", value: "" },
    ]);
  });

  it("a plain key is just down and up", () => {
    assert.deepEqual(keyActions(parseKey("Escape")!), [
      { type: "keyDown", value: "" },
      { type: "keyUp", value: "" },
    ]);
  });
});
