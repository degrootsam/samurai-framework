import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setActiveProject } from "../../config/config.js";
import { defaultPlanFile, listPlans, slugOf } from "./plan-path.js";

after(() => setActiveProject(undefined));

test("a goal becomes a lower-case ascii slug of at most 60 characters", () => {
  assert.equal(
    slugOf("Pay for an order, with the Saved Card!"),
    "pay-for-an-order-with-the-saved-card",
  );
  assert.equal(slugOf("Café ñandú"), "cafe-nandu");
  assert.equal(slugOf("日本語"), "plan");
  const long = slugOf("word ".repeat(40));
  assert.ok(long.length <= 60 && !long.endsWith("-"));
});

test("the plan goes into plans/ by default and never replaces a file", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "plan-path-"));
  setActiveProject({ dir });
  const first = await defaultPlanFile("Register now");
  assert.equal(first, "plans/register-now.plan.md");
  assert.ok(existsSync(path.join(dir, "plans")), "the folder is created");
  writeFileSync(path.join(dir, first), "x");
  assert.equal(
    await defaultPlanFile("Register now"),
    "plans/register-now-2.plan.md",
  );
  writeFileSync(path.join(dir, "plans/register-now-2.plan.md"), "x");
  assert.equal(
    await defaultPlanFile("Register now"),
    "plans/register-now-3.plan.md",
  );
});

test("plansDir of the config is used", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "plan-path-"));
  setActiveProject({ dir, config: { plansDir: "docs/plans" } });
  assert.equal(await defaultPlanFile("A b"), "docs/plans/a-b.plan.md");
});

test("listPlans finds the plan files below plansDir, sorted, with / paths", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "plan-list-"));
  setActiveProject({ dir });
  assert.deepEqual(await listPlans(), []);
  mkdirSync(path.join(dir, "plans", "sub"), { recursive: true });
  for (const f of ["b.plan.md", "sub/a.plan.md", "notes.md"])
    writeFileSync(path.join(dir, "plans", f), "x");
  assert.deepEqual(await listPlans(), [
    "plans/b.plan.md",
    "plans/sub/a.plan.md",
  ]);
});
