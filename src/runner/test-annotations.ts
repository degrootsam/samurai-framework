import type {
  RegisteredTestCase,
  Suite,
  TestError,
  TestFixtures,
  TestInfo,
} from "../types/test.js";
import { conditionHolds, infoFor, runningScope } from "./test-info.js";

type Condition = boolean | ((fixtures: TestFixtures) => boolean);

/**
 * `test.fail(...)` and `test.slow(...)` without a title. In a running test or hook it marks that test when the
 * condition holds (no condition: always). In a `describe` block, or at the top of a file, it marks every test of
 * `suite` instead, and the condition must be a boolean as no test runs yet.
 */
export function markTests(
  type: "fail" | "slow",
  suite: () => Suite,
  condition: Condition = true,
  description?: string,
): void {
  const label = `${type}()`;
  if (description !== undefined && typeof description !== "string")
    throw new TypeError(`${label}: the reason must be a string`);
  if (runningScope()) {
    if (conditionHolds(label, condition))
      infoFor(label)[type](true, description);
    return;
  }
  if (typeof condition === "function")
    throw new Error(`${label}: a condition function needs a running test`);
  if (!condition) return;
  const target = suite();
  (target.marks ??= []).push({
    type,
    ...(description !== undefined && { description }),
  });
}

/** Applies what the test and the suites around it declared (`test.fail("t", fn)`, `test.slow(true)` in a `describe`) */
export function applyDeclaredMarks(
  info: TestInfo,
  test: Pick<RegisteredTestCase, "suite" | "expectedFail">,
): void {
  const chain: Suite[] = [];
  for (let s: Suite | undefined = test.suite; s; s = s.parent) chain.unshift(s);
  for (const suite of chain)
    for (const mark of suite.marks ?? [])
      info[mark.type](true, mark.description);
  if (test.expectedFail) info.fail(true, test.expectedFail.description);
}

/**
 * What a test that ends by itself is reported as, given what it is expected to do: a test expected to fail is
 * passed by a failure and failed by a pass. A timeout is never the failure it was waiting for.
 */
export function judgeExpectation(
  info: TestInfo | undefined,
  error: TestError | undefined,
): TestError | undefined {
  if (info?.expectedStatus !== "failed") return error;
  if (!error) return { message: "expected to fail, but passed", type: "error" };
  return error.type === "timeout" ? error : undefined;
}
