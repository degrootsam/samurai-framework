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

/** A check for a class attribute: a string equals it after collapsing whitespace and trimming both sides, a RegExp tests it as written */
export function classCheck(
  expected: string | RegExp,
): (actual: string) => boolean {
  if (expected instanceof RegExp)
    return (actual) => matchesText(actual, expected, "exact");
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
  return (actual) => normalize(actual) === normalize(expected);
}
