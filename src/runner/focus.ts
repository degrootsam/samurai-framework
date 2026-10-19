import path from "path";
import type { RegisteredTestCase } from "../types/test.js";
import { toPosix } from "./groups.js";

/** `test.only` is in the specs and the config refuses it: one error that lists every focused test */
export function assertNoOnly(
  all: readonly RegisteredTestCase[],
  forbid: boolean,
  srcDir: string,
): void {
  if (!forbid) return;
  const focused = all.filter((test) => test.modifier === "only");
  if (focused.length === 0) return;
  throw new Error(
    focused
      .map(
        (test) =>
          `test.only is not allowed (forbidOnly): ${toPosix(path.relative(srcDir, test.file))}: ${test.name}`,
      )
      .join("\n"),
  );
}

/** When any of the selected tests is focused, only the focused ones; the others are not run and not reported */
export function narrowToOnly(
  selected: RegisteredTestCase[],
): RegisteredTestCase[] {
  return selected.some((test) => test.modifier === "only")
    ? selected.filter((test) => test.modifier === "only")
    : selected;
}
