import { AssertionError, toReportValue } from "../assert/assertion-error.js";
import type { TestError } from "../types/test.js";
import { HookError } from "./hooks.js";

/** Maps anything a test threw to the error stored in the report */
export function toTestError(err: unknown): TestError {
  // A hook's failure keeps what it threw (an assertion stays one) under the hook's own message
  if (err instanceof HookError)
    return { ...toTestError(err.cause), message: err.message };
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
