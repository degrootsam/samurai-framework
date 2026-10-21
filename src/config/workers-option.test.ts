import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveWorkers } from "./workers-option.js";

describe("resolveWorkers", () => {
  it("defaults to half the CPUs, and never below 1", () => {
    assert.equal(resolveWorkers({ cpus: 8 }), 4);
    assert.equal(resolveWorkers({ cpus: 7 }), 3);
    assert.equal(resolveWorkers({ cpus: 1 }), 1);
  });

  it("takes the flag over the environment over the config", () => {
    assert.equal(resolveWorkers({ flag: 2, env: "3", config: 4, cpus: 8 }), 2);
    assert.equal(resolveWorkers({ env: "3", config: 4, cpus: 8 }), 3);
    assert.equal(resolveWorkers({ config: 4, cpus: 8 }), 4);
  });

  it("ignores an empty environment variable", () => {
    assert.equal(resolveWorkers({ env: "", config: 5, cpus: 8 }), 5);
    assert.equal(resolveWorkers({ env: "  ", cpus: 8 }), 4);
  });

  it("turns a percentage into a share of the CPUs, at least 1", () => {
    assert.equal(resolveWorkers({ config: "50%", cpus: 10 }), 5);
    assert.equal(resolveWorkers({ flag: "25%", cpus: 10 }), 2);
    assert.equal(resolveWorkers({ flag: "1%", cpus: 10 }), 1);
    assert.equal(resolveWorkers({ config: "100%", cpus: 6 }), 6);
  });

  it("says which source had a bad value", () => {
    assert.throws(
      () => resolveWorkers({ flag: "x" }),
      /^Error: --workers must be a whole number from 1 or a percentage like 50%, got "x"$/,
    );
    assert.throws(
      () => resolveWorkers({ env: "0" }),
      /SAMURAI_WORKERS must be a whole number from 1/,
    );
    assert.throws(
      () => resolveWorkers({ config: -2 }),
      /^Error: workers must be a whole number from 1/,
    );
  });
});
