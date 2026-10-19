import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRunSettings, setRunSettings } from "./run-settings.js";
import { resolveTimeout } from "./timeouts.js";

test("resolveTimeout prefers the per-call value", async () => {
  assert.equal(await resolveTimeout(1234), 1234);
  assert.equal(await resolveTimeout(0), 0);
});

test("resolveTimeout uses the active run's expect timeout", async () => {
  setRunSettings(resolveRunSettings({}, { expectTimeout: 1234 }));
  try {
    assert.equal(await resolveTimeout(), 1234);
    assert.equal(await resolveTimeout(10), 10);
  } finally {
    setRunSettings(undefined);
  }
});
