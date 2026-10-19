import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveRetries } from "./retries-option.js";

describe("resolveRetries", () => {
  it("is 0 when nothing says otherwise", () => {
    assert.equal(resolveRetries({}), 0);
  });

  it("takes the flag, then SAMURAI_RETRIES, then the config", () => {
    assert.equal(resolveRetries({ flag: "1", env: "2", config: 3 }), 1);
    assert.equal(resolveRetries({ env: "2", config: 3 }), 2);
    assert.equal(resolveRetries({ config: 3 }), 3);
    assert.equal(resolveRetries({ flag: 4 }), 4);
  });

  it("lets 0 turn retries off over a higher source", () => {
    assert.equal(resolveRetries({ flag: "0", config: 3 }), 0);
    assert.equal(resolveRetries({ env: "0", config: 3 }), 0);
  });

  it("ignores a blank environment variable", () => {
    assert.equal(resolveRetries({ env: "", config: 2 }), 2);
    assert.equal(resolveRetries({ env: "  ", config: 2 }), 2);
    assert.equal(resolveRetries({ env: "" }), 0);
  });

  it("says which source had a bad value", () => {
    assert.throws(
      () => resolveRetries({ flag: "x" }),
      /^Error: --retries must be a whole number from 0, got "x"$/,
    );
    assert.throws(
      () => resolveRetries({ env: "-1" }),
      /SAMURAI_RETRIES must be a whole number from 0/,
    );
    assert.throws(
      () => resolveRetries({ config: 1.5 }),
      /^Error: retries must be a whole number from 0/,
    );
  });
});
