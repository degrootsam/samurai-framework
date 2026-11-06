import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { setActiveProject } from "../config/config.js";
import { parseSpec } from "../steps/parse.js";
import { linkPlan, planAnnotationPath } from "./plan-link.js";

const BODY = 'async ({ page }) => {\n  await page.goto("/");\n});\n';

test("a test without options gets the plan annotation", () => {
  const next = linkPlan(`test("t", ${BODY}`, 0, "plans/pay.plan.md");
  assert.equal(
    next,
    `test("t", { annotations: [{ type: "plan", description: "plans/pay.plan.md" }] }, ${BODY}`,
  );
});

test("linking the same plan twice changes nothing", () => {
  const once = linkPlan(`test("t", ${BODY}`, 0, "plans/a.plan.md");
  assert.equal(linkPlan(once, 0, "plans/a.plan.md"), once);
});

test("a different plan replaces the description and other annotations stay", () => {
  const source = `test("t", { annotations: [{ type: "issue", description: "P-1" }, { type: "plan", description: "plans/old.plan.md" }] }, ${BODY}`;
  const next = linkPlan(source, 0, "plans/new.plan.md");
  assert.deepEqual(parseSpec(next)[0]!.annotations, [
    { type: "issue", description: "P-1" },
    { type: "plan", description: "plans/new.plan.md" },
  ]);
});

test("only the chosen test is marked, and other options stay", () => {
  const source = `test("a", ${BODY}\ntest("b", { inputs: { x: "1" } }, ${BODY}`;
  const next = linkPlan(source, 1, "p.plan.md");
  const [a, b] = parseSpec(next);
  assert.equal(a!.annotations, undefined);
  assert.deepEqual(b!.annotations, [
    { type: "plan", description: "p.plan.md" },
  ]);
  assert.deepEqual(b!.inputs, [{ name: "x", default: "1" }]);
});

test("the path is relative to the project with forward slashes", () => {
  setActiveProject({ dir: "/proj" });
  try {
    assert.equal(
      planAnnotationPath("/proj/plans/a.plan.md"),
      "plans/a.plan.md",
    );
    assert.equal(
      planAnnotationPath(`plans${path.sep}a.plan.md`),
      "plans/a.plan.md",
    );
  } finally {
    setActiveProject(undefined);
  }
});
