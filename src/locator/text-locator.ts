import { DOCUMENT_ORDER_JS, MATCHING_JS, ROOTS_JS } from "./page-search.js";

/**
 * Function declaration run in the page as `(starts, value, match, ignoreCase)`; returns the elements
 * whose text matches. Used when the browser does not implement BiDi's `innerText` locator
 * (Firefox does not): same idea, done by the framework.
 *
 * - Searches the descendants of every start node (the whole document when there are none).
 * - Text is `innerText`, whitespace collapsed and trimmed; `full` needs equality, `partial` a substring.
 * - Only the innermost matches count, so a wrapper `<div>` around a matching `<button>` is not returned.
 * - Results are unique and in document order.
 *
 * A string, so the transpiler cannot inject helpers that do not exist in the page.
 */
export const TEXT_LOCATE = `(starts, value, match, ignoreCase) => {
  const skipped = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "TITLE", "META", "LINK"]);
  ${MATCHING_JS}
  ${ROOTS_JS}
  const seen = new Set();
  const matches = [];
  for (const root of roots) {
    for (const el of root.querySelectorAll("*")) {
      if (seen.has(el) || skipped.has(el.tagName.toUpperCase())) continue;
      seen.add(el);
      if (textMatches(el.innerText ?? el.textContent ?? "")) matches.push(el);
    }
  }
  const hasMatchingDescendant = new Set();
  for (const el of matches) {
    for (let parent = el.parentElement; parent; parent = parent.parentElement) hasMatchingDescendant.add(parent);
  }
  return matches
    .filter((el) => !hasMatchingDescendant.has(el))
    .sort(${DOCUMENT_ORDER_JS});
}`;
