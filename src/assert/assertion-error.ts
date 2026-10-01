import { inspect } from "node:util";

/** Formats a value for assertion messages */
export function format(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value instanceof RegExp) return value.toString();
  return inspect(value, { depth: 2 });
}

/**
 * Converts a value into something JSON can store in the report: regexps, bigints,
 * symbols, functions and anything else JSON.stringify rejects (e.g. circular objects)
 * become their `format()` string; other values are kept as-is.
 */
export function toReportValue(value: unknown): unknown {
  if (
    value instanceof RegExp ||
    typeof value === "bigint" ||
    typeof value === "symbol" ||
    typeof value === "function"
  ) {
    return format(value);
  }
  try {
    JSON.stringify(value);
    return value;
  } catch {
    return format(value);
  }
}

export interface AssertionErrorDetails {
  /** Matcher name, prefixed with `not.` when negated */
  matcher: string;
  expected: unknown;
  actual: unknown;
  /** XPath of the asserted locator, only for locator assertions */
  locator?: string | undefined;
}

export class AssertionError extends Error {
  public readonly matcher: string;
  public readonly expected: unknown;
  public readonly actual: unknown;
  public readonly locator: string | undefined;

  constructor({ matcher, expected, actual, locator }: AssertionErrorDetails) {
    const subject = locator === undefined ? "value" : "locator";
    const lines = [`expect(${subject}).${matcher}`];
    if (locator !== undefined) {
      lines.push(`  locator: ${locator}`);
    }
    lines.push(`  expected: ${format(expected)}`, `  received: ${format(actual)}`);

    super(lines.join("\n"));
    this.name = "AssertionError";
    this.matcher = matcher;
    this.expected = expected;
    this.actual = actual;
    this.locator = locator;
  }
}
