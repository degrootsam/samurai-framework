import { AssertionError, toReportValue } from "../assert/assertion-error.js";
import type { TestError } from "../types/test.js";

/** Maps anything a test threw to the error stored in the report */
export function toTestError(err: unknown): TestError {
  if (err instanceof AssertionError) {
    return {
      message: err.message,
      stack: err.stack,
      type: "assertion",
      expected: toReportValue(err.expected),
      actual: toReportValue(err.actual),
    };
  }
  return {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    type: "error",
  };
}
