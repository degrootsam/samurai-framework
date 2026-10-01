import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CAPTURE_OFF, CAPTURE_SOURCE } from "./capture.js";

describe("capture script", () => {
  it("compiles as a function declaration", () => {
    assert.doesNotThrow(() => new Function(`return (${CAPTURE_SOURCE})`));
    assert.doesNotThrow(() => new Function(`return (${CAPTURE_OFF})`));
  });

  it("uses the same flag name to stop as to check", () => {
    const flag = /Symbol\.for\("(samurai\.recorder\.off)"\)/;
    assert.match(CAPTURE_SOURCE, flag);
    assert.match(CAPTURE_OFF, flag);
  });

  it("holds no template literals, which could not survive the page", () => {
    assert.ok(!CAPTURE_SOURCE.includes("`"));
  });
});
