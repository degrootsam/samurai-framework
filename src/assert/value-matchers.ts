import { format } from "./assertion-error.js";

/** What `toThrow` accepts: a message part, a RegExp for the message, an error class, or an error whose message must be equal */
export type ThrowExpectation =
  string | RegExp | (new (...args: any[]) => unknown) | Error;

/** The result of calling a function under `toThrow` */
export type Outcome = { threw: false } | { threw: true; error: unknown };

/** Calls `fn` and says whether it threw */
export function callAndCatch(fn: () => unknown): Outcome {
  try {
    fn();
    return { threw: false };
  } catch (error) {
    return { threw: true, error };
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error)
    return String((error as { message: unknown }).message);
  return String(error);
}

/** Whether what was thrown fits `expected`; with no expectation, throwing at all fits */
export function thrownMatches(
  outcome: Outcome,
  expected: ThrowExpectation | undefined,
): boolean {
  if (!outcome.threw) return false;
  if (expected === undefined) return true;
  if (typeof expected === "string")
    return messageOf(outcome.error).includes(expected);
  if (expected instanceof RegExp)
    return messageOf(outcome.error).search(expected) !== -1;
  if (expected instanceof Error)
    return messageOf(outcome.error) === expected.message;
  return outcome.error instanceof expected;
}

/** What a `toThrow` failure shows as the received value */
export function describeOutcome(outcome: Outcome): string {
  return outcome.threw ? `threw ${format(outcome.error)}` : "did not throw";
}

/** Jest's rule: the difference is under half a unit of the last digit asked for */
export function isCloseTo(
  actual: number,
  expected: number,
  digits: number,
): boolean {
  if (actual === expected) return true;
  return Math.abs(expected - actual) < Math.pow(10, -digits) / 2;
}

/** The `length` of a string, array or array-like; undefined for anything else */
export function lengthOf(value: unknown): number | undefined {
  if (typeof value === "string") return value.length;
  if (typeof value === "object" && value !== null && "length" in value) {
    const length = (value as { length: unknown }).length;
    if (typeof length === "number") return length;
  }
  return undefined;
}
