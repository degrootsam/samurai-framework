import { DOCUMENT_ORDER_JS, MATCHING_JS, ROOTS_JS } from "./page-search.js";

/**
 * Function declaration run in the page as `(starts, value, match, ignoreCase, attribute)`; returns the
 * elements whose `placeholder`, `alt` or `title` attribute matches. BiDi has no such locator, so the
 * framework does it.
 *
 * - Searches the descendants of every start node (the whole document when there are none).
 * - The attribute text is whitespace collapsed and trimmed; `full` needs equality, `partial` a substring,
 *   a RegExp is tested as written (see `MATCHING_JS`).
 * - Results are unique and in document order.
 *
 * A string, so the transpiler cannot inject helpers that do not exist in the page.
 */
export const ATTRIBUTE_LOCATE = `(starts, value, match, ignoreCase, attribute) => {
  ${MATCHING_JS}
  ${ROOTS_JS}
  const seen = new Set();
  const matches = [];
  for (const root of roots) {
    for (const el of root.querySelectorAll("[" + attribute + "]")) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (textMatches(el.getAttribute(attribute))) matches.push(el);
    }
  }
  return matches.sort(${DOCUMENT_ORDER_JS});
}`;
