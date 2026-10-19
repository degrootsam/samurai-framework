import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseWorkers, validateWorkersConfig } from "./workers.js";

describe("parseWorkers", () => {
  it("reads a whole number, as a number or as text", () => {
    assert.deepEqual(parseWorkers(4, "workers"), { count: 4 });
    assert.deepEqual(parseWorkers("3", "--workers"), { count: 3 });
    assert.deepEqual(parseWorkers(" 2 ", "--workers"), { count: 2 });
  });

  it("reads a percentage of the CPUs", () => {
    assert.deepEqual(parseWorkers("50%", "workers"), { percent: 50 });
    assert.deepEqual(parseWorkers("100%", "workers"), { percent: 100 });
  });

  it("names where the bad value came from", () => {
    for (const bad of [
      0,
      -1,
      1.5,
      "0",
      "abc",
      "",
      "1.5",
      "0%",
      "101%",
      "5 %",
    ]) {
      assert.throws(
        () => parseWorkers(bad, "--workers"),
        new RegExp(
          `^Error: --workers must be a whole number from 1 or a percentage like 50%, got "${String(bad).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"$`,
        ),
      );
    }
    assert.throws(
      () => parseWorkers(true, "SAMURAI_WORKERS"),
      /SAMURAI_WORKERS must be a whole number from 1 or a percentage like 50%, got "true"/,
    );
  });

  it("refuses a percentage where only a count makes sense", () => {
    assert.throws(
      () => parseWorkers("50%", "groups[0].workers", false),
      /groups\[0\]\.workers must be a whole number from 1, got "50%"/,
    );
    assert.deepEqual(parseWorkers(1, "groups[0].workers", false), {
      count: 1,
    });
  });
});

describe("validateWorkersConfig", () => {
  it("accepts a config without workers, with workers, and with workers on groups", () => {
    validateWorkersConfig({});
    validateWorkersConfig({ workers: 4 });
    validateWorkersConfig({ workers: "50%" });
    validateWorkersConfig({
      groups: [{ name: "a", workers: 1 }, { name: "b" }],
    });
  });

  it("names the key that is wrong", () => {
    assert.throws(
      () => validateWorkersConfig({ workers: 0 }),
      /^Error: workers must be a whole number from 1 or a percentage like 50%, got "0"$/,
    );
    assert.throws(
      () =>
        validateWorkersConfig({
          groups: [{ name: "a" }, { name: "b", workers: "2%" as never }],
        }),
      /groups\[1\]\.workers must be a whole number from 1, got "2%"/,
    );
  });
});
