import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRetries, validateRetriesConfig } from "./retries.js";

describe("parseRetries", () => {
  it("reads a whole number from 0, as a number or as text", () => {
    assert.equal(parseRetries(0, "retries"), 0);
    assert.equal(parseRetries(3, "retries"), 3);
    assert.equal(parseRetries("2", "--retries"), 2);
    assert.equal(parseRetries(" 1 ", "--retries"), 1);
    assert.equal(parseRetries("0", "--retries"), 0);
  });

  it("names where the bad value came from", () => {
    for (const bad of [-1, 1.5, "-1", "abc", "", "1.5", "2 3", true, null]) {
      assert.throws(
        () => parseRetries(bad, "--retries"),
        (error: Error) =>
          error.message ===
          `--retries must be a whole number from 0, got "${String(bad)}"`,
      );
    }
    assert.throws(
      () => parseRetries("x", "SAMURAI_RETRIES"),
      /^Error: SAMURAI_RETRIES must be a whole number from 0, got "x"$/,
    );
  });
});

describe("validateRetriesConfig", () => {
  it("accepts a config without retries and a good value", () => {
    validateRetriesConfig({});
    validateRetriesConfig({ retries: 0 });
    validateRetriesConfig({ retries: 2 });
  });

  it("names the key of a bad value", () => {
    assert.throws(
      () => validateRetriesConfig({ retries: -1 }),
      /^Error: retries must be a whole number from 0, got "-1"$/,
    );
    assert.throws(
      () => validateRetriesConfig({ retries: "2" } as never),
      /^Error: retries must be a whole number from 0, got "2"$/,
    );
  });
});
