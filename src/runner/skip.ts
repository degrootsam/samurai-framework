import type { RegisteredTestCase } from "../types/test.js";
import type { TestSkip } from "./reporter.js";

/** Thrown by `test.skip(condition, reason)` and `test.fixme(condition, reason)` inside a test: the test ends as skipped */
export class SkipSignal extends Error {
  constructor(
    public readonly annotation: "skip" | "fixme",
    public readonly reason?: string,
  ) {
    super(reason ?? "skipped");
    this.name = "SkipSignal";
  }
}

export function isSkipSignal(error: unknown): error is SkipSignal {
  return error instanceof SkipSignal;
}

/** Why a test does not run at all: it is marked `skip` or `fixme`, itself or by a `describe` around it */
export function staticSkip(
  test: Pick<RegisteredTestCase, "modifier" | "reason">,
): TestSkip | undefined {
  const { modifier, reason } = test;
  return modifier === "skip" || modifier === "fixme"
    ? { annotation: modifier, ...(reason !== undefined && { reason }) }
    : undefined;
}
