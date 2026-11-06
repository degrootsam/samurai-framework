import path from "node:path";
import { projectDir } from "../config/config.js";
import { applyEdit } from "../steps/edit.js";
import { parseSpec } from "../steps/parse.js";

/** The plan's path as the annotation names it: relative to the project folder, with `/` separators */
export function planAnnotationPath(planFile: string): string {
  const relative = path.isAbsolute(planFile)
    ? path.relative(projectDir(), planFile)
    : path.normalize(planFile);
  return relative.split(path.sep).join("/");
}

/**
 * `source` with test `testIndex` marked as made from `planFile`: an annotation `{ type: "plan", description }` in
 * its options. An existing plan annotation gets the new path in place, the test's other annotations stay, and a
 * test that already names this plan leaves the source as it is.
 */
export function linkPlan(
  source: string,
  testIndex: number,
  planFile: string,
): string {
  const note = { type: "plan", description: planAnnotationPath(planFile) };
  const existing = parseSpec(source)[testIndex]?.annotations ?? [];
  const at = existing.findIndex((entry) => entry.type === "plan");
  const annotations =
    at < 0
      ? [...existing, note]
      : existing.map((entry, i) => (i === at ? note : entry));
  return applyEdit(source, { op: "declare", test: testIndex, annotations });
}
