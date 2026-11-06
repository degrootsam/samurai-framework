import assert from "node:assert/strict";
import { test } from "node:test";
import { validatePlansDirConfig } from "./plans-dir.js";
import { resolveConfig } from "./resolved-config.js";
import { DEFAULT_PLANS_DIR } from "./defaults.js";

test("plansDir is optional and must be a folder inside the project", () => {
  validatePlansDirConfig({});
  validatePlansDirConfig({ plansDir: "docs/plans" });
  for (const bad of ["", "  ", 3, "/tmp/plans", "../plans", "a/../../plans"])
    assert.throws(
      () => validatePlansDirConfig({ plansDir: bad } as never),
      /plansDir must be/,
      String(bad),
    );
});

test("the resolved config has plansDir, default plans", () => {
  assert.equal(DEFAULT_PLANS_DIR, "plans");
  const resolved = resolveConfig({}, { projectDir: "/p", env: {} });
  assert.equal(resolved.plansDir, "plans");
  const custom = resolveConfig(
    { plansDir: "x" },
    { projectDir: "/p", env: {} },
  );
  assert.equal(custom.plansDir, "x");
});
