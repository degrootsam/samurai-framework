import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BiDiError } from "./bidi-error.js";
import { isUnsupported, UnsupportedOperationError } from "./unsupported.js";

describe("isUnsupported", () => {
  it("is true for the two codes a browser uses for a command it lacks", () => {
    assert.equal(
      isUnsupported(new BiDiError("x.y", "unknown command", "no")),
      true,
    );
    assert.equal(
      isUnsupported(new BiDiError("x.y", "unsupported operation", "no")),
      true,
    );
  });

  it("is false for other BiDi errors and for anything else", () => {
    assert.equal(
      isUnsupported(new BiDiError("x.y", "no such frame", "gone")),
      false,
    );
    assert.equal(isUnsupported(new Error("unknown command")), false);
    assert.equal(isUnsupported(undefined), false);
  });
});

describe("UnsupportedOperationError", () => {
  it("carries its name and message", () => {
    const err = new UnsupportedOperationError("not here");
    assert.equal(err.name, "UnsupportedOperationError");
    assert.equal(err.message, "not here");
  });
});
