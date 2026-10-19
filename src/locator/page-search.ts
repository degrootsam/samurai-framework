/**
 * Page-side pieces the text and label searches share. They are strings, glued into the function declarations
 * of `TEXT_LOCATE` and `LABEL_LOCATE`, which run in the page with `(starts, value, match, ignoreCase)` in scope.
 */

/** `normalise` collapses whitespace and trims (lower-casing with `ignoreCase`); `textMatches` compares a text with `value` by `match` */
export const MATCHING_JS = `
  const normalise = (text) => {
    const collapsed = String(text).replace(/\\s+/g, " ").trim();
    return ignoreCase ? collapsed.toLowerCase() : collapsed;
  };
  const wanted = normalise(value);
  const textMatches = (text) => {
    const normal = normalise(text);
    return match === "full" ? normal === wanted : normal.includes(wanted);
  };`;

/** The nodes to search in: the start nodes, else the whole document */
export const ROOTS_JS = `const roots = starts.length > 0 ? starts : [document];`;

/** A sort callback putting elements in document order */
export const DOCUMENT_ORDER_JS = `(a, b) => (a === b ? 0 : a.compareDocumentPosition(b) & 4 ? -1 : 1)`;
