/**
 * Function declaration run in the page as `(starts, value, match, ignoreCase)`; returns the elements
 * named by a label whose text matches. BiDi has no label locator, so the framework does it.
 *
 * - An element's labels are its `<label>`s (`el.labels`: `for=`, nesting), the elements its
 *   `aria-labelledby` points to, and its `aria-label`.
 * - Searches the descendants of every start node (the whole document when there are none).
 * - Text is whitespace collapsed and trimmed; `full` needs equality, `partial` a substring.
 * - Results are unique and in document order.
 *
 * A string, so the transpiler cannot inject helpers that do not exist in the page.
 */
export const LABEL_LOCATE = `(starts, value, match, ignoreCase) => {
  const normalise = (text) => {
    const collapsed = String(text).replace(/\\s+/g, " ").trim();
    return ignoreCase ? collapsed.toLowerCase() : collapsed;
  };
  const wanted = normalise(value);
  const textOf = (node) => node.innerText ?? node.textContent ?? "";
  const labelsOf = (el) => {
    const texts = [];
    if (el.labels) for (const label of el.labels) texts.push(textOf(label));
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      for (const id of by.split(/\\s+/)) {
        const named = id && document.getElementById(id);
        if (named) texts.push(textOf(named));
      }
    }
    const own = el.getAttribute("aria-label");
    if (own) texts.push(own);
    return texts;
  };
  const roots = starts.length > 0 ? starts : [document];
  const seen = new Set();
  const matches = [];
  for (const root of roots) {
    for (const el of root.querySelectorAll("*")) {
      if (seen.has(el)) continue;
      seen.add(el);
      const found = labelsOf(el).some((text) => {
        const normal = normalise(text);
        return match === "full" ? normal === wanted : normal.includes(wanted);
      });
      if (found) matches.push(el);
    }
  }
  return matches.sort((a, b) => (a === b ? 0 : a.compareDocumentPosition(b) & 4 ? -1 : 1));
}`;
