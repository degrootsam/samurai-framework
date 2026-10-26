/** Whether `actual` equals (`exact`) or contains (`contains`) `expected`, or matches it when it is a RegExp */
export function matchesText(
  actual: string,
  expected: string | RegExp,
  mode: "exact" | "contains",
) {
  // search() ignores lastIndex, so global regexps behave the same on every call
  if (expected instanceof RegExp) return actual.search(expected) !== -1;
  return mode === "exact" ? actual === expected : actual.includes(expected);
}

/**
 * What a text check keeps as an output: the first capture group of a RegExp, else its whole match, else (a
 * string, or no match) the whole `actual`. The flags `g` and `y` are dropped, so the result never depends on a
 * `lastIndex` left by an earlier use.
 */
export function captured(matcher: string | RegExp, actual: string): string {
  if (typeof matcher === "string") return actual;
  const plain = new RegExp(matcher.source, matcher.flags.replace(/[gy]/g, ""));
  const match = plain.exec(actual);
  return match ? (match[1] ?? match[0]) : actual;
}

/** A check for a read that may find nothing (`null`): true when the text is there and matches */
export function textCheck(
  expected: string | RegExp,
  mode: "exact" | "contains",
): (actual: string | null) => boolean {
  return (actual) => actual !== null && matchesText(actual, expected, mode);
}

/** A check for a class attribute: a string equals it after collapsing whitespace and trimming both sides, a RegExp tests it as written */
export function classCheck(
  expected: string | RegExp,
): (actual: string) => boolean {
  if (expected instanceof RegExp)
    return (actual) => matchesText(actual, expected, "exact");
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
  return (actual) => normalize(actual) === normalize(expected);
}
