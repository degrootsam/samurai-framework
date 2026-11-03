/**
 * Page-side pieces the text and label searches share. They are strings, glued into the function declarations
 * of `TEXT_LOCATE` and `LABEL_LOCATE`, which run in the page with `(starts, value, match, ignoreCase)` in scope.
 */

/**
 * `normalise` collapses whitespace and trims (lower-casing with `ignoreCase`); `textMatches` compares a text with `value` by
 * `match`. A RegExp `value` is tested on the collapsed text as written (flags kept, `g` and `y` dropped); `match` and
 * `ignoreCase` then do not apply.
 */
export const MATCHING_JS = `
  const collapse = (text) => String(text).replace(/\\s+/g, " ").trim();
  const normalise = (text) => {
    const collapsed = collapse(text);
    return ignoreCase ? collapsed.toLowerCase() : collapsed;
  };
  const pattern = typeof value === "string" ? null : new RegExp(value.source, value.flags.replace(/[gy]/g, ""));
  const wanted = pattern ? "" : normalise(value);
  const textMatches = (text) => {
    if (pattern) return pattern.test(collapse(text));
    const normal = normalise(text);
    return match === "full" ? normal === wanted : normal.includes(wanted);
  };`;

/** The nodes to search in: the start nodes, else the whole document */
export const ROOTS_JS = `const roots = starts.length > 0 ? starts : [document];`;

/** A sort callback putting elements in document order */
export const DOCUMENT_ORDER_JS = `(a, b) => (a === b ? 0 : a.compareDocumentPosition(b) & 4 ? -1 : 1)`;

/**
 * Function declaration run in the page as `(elements)`: the same elements in document order. A search with
 * several start nodes answers per start node, so its results are not in document order.
 */
export const SORT_IN_DOCUMENT_ORDER = `(elements) => elements.slice().sort(${DOCUMENT_ORDER_JS})`;
