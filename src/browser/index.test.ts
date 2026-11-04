import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as entry from "./index.js";
import type { BoundingBox, PageFunction } from "./index.js";

describe("the ./browser entry point", () => {
  it("exports the classes evaluate and waitForURL return or throw", () => {
    for (const name of [
      "ElementHandle",
      "RemoteObject",
      "ScriptError",
      "ScriptSerializationError",
      "UrlTimeoutError",
    ] as const) {
      assert.equal(typeof entry[name], "function", name);
    }
  });

  it("lets a caller tell the errors apart with instanceof", () => {
    const err = new entry.ScriptError("TypeError: x", "() => x");
    assert.ok(err instanceof entry.ScriptError);
    assert.ok(err instanceof Error);
    assert.ok(!(err instanceof entry.ScriptSerializationError));
    assert.ok(
      new entry.UrlTimeoutError("/a", 10, undefined) instanceof
        entry.UrlTimeoutError,
    );
    assert.equal(new entry.ElementHandle("id").sharedId, "id");
  });

  it("exports the BoundingBox and PageFunction types", () => {
    const box: BoundingBox = { x: 0, y: 1, width: 2, height: 3 };
    const fn: PageFunction<[number], number> = (n) => n + 1;
    assert.equal(box.height, 3);
    assert.equal(typeof fn, "function");
  });
});
