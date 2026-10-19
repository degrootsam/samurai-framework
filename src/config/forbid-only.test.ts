import assert from "node:assert/strict";
import { test } from "node:test";
import { forbidsOnly, validateForbidOnlyConfig } from "./forbid-only.js";

test("forbidOnly defaults to on when CI is set, and the config wins", () => {
  assert.equal(forbidsOnly({}, {}), false);
  assert.equal(forbidsOnly({}, { CI: "true" }), true);
  assert.equal(forbidsOnly({ forbidOnly: false }, { CI: "true" }), false);
  assert.equal(forbidsOnly({ forbidOnly: true }, {}), true);
});

test("forbidOnly must be a boolean", () => {
  validateForbidOnlyConfig({});
  validateForbidOnlyConfig({ forbidOnly: true });
  assert.throws(
    () => validateForbidOnlyConfig({ forbidOnly: "yes" } as never),
    /forbidOnly must be true or false, got "yes"/,
  );
});
