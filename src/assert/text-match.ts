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

/** A check for a read that may find nothing (`null`): true when the text is there and matches */
export function textCheck(
  expected: string | RegExp,
  mode: "exact" | "contains",
): (actual: string | null) => boolean {
  return (actual) => actual !== null && matchesText(actual, expected, mode);
}
