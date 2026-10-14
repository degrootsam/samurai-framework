import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CAPTURE_OFF, CAPTURE_SOURCE } from "./capture.js";
import { CANDIDATES_JS } from "./candidates.js";

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

  it("ignores the toolbar and shares the candidate code", () => {
    assert.match(CAPTURE_SOURCE, /inToolbar\(event\)/);
    assert.ok(CAPTURE_SOURCE.includes(CANDIDATES_JS));
    assert.doesNotThrow(
      () => new Function(`return (() => {${CANDIDATES_JS}})`),
    );
    assert.ok(!CANDIDATES_JS.includes("`"));
  });

  it("does not outline the toolbar while Alt is held", () => {
    assert.match(
      CAPTURE_SOURCE,
      /addEventListener\("mousemove", \(event\) => \{\s*(\/\/.*\s*)?if \(inToolbar\(event\)\) return unhighlight\(\);/,
    );
  });
});
