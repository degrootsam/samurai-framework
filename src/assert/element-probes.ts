import type Locator from "../locator/locator.js";

/** The state a checkbox-like element is in */
export type CheckedState = boolean | "mixed";

/**
 * Runs `body` in the page with the first match as `el` (and the optional `arg`) and answers its result, or
 * null when nothing matches. Reads never wait and do not enforce strict mode: they use the first match.
 */
function readFirst<R, A = undefined>(
  locator: Locator,
  body: string,
  arg?: A,
): Promise<R | null> {
  return locator.evaluateAll<R | null, A>(
    `(els, arg) => { const el = els[0]; if (!el) return null; ${body} }`,
    arg,
  );
}

/** Whether the element is the active element of its document or shadow root */
export function readFocused(locator: Locator): Promise<boolean | null> {
  return readFirst(locator, `return el.getRootNode().activeElement === el;`);
}

/** The element's JS property `name`, wrapped as `{ value }`; null when nothing matches */
export function readJSProperty(
  locator: Locator,
  name: string,
): Promise<{ value: unknown } | null> {
  return readFirst(locator, `return { value: el[arg] };`, name);
}

/** The share (0 to 1) of the element inside the viewport, as an IntersectionObserver reports it; null when nothing matches */
export function readViewportRatio(locator: Locator): Promise<number | null> {
  return readFirst(
    locator,
    `return new Promise((resolve) => {
      const observer = new IntersectionObserver((entries) => {
        observer.disconnect();
        resolve(entries[entries.length - 1].intersectionRatio);
      });
      observer.observe(el);
    });`,
  );
}

/** The `id` property ("" when it has none), or null when nothing matches */
export function readId(locator: Locator): Promise<string | null> {
  return readFirst(locator, `return el.id;`);
}

/**
 * Input and textarea: the value is empty. Anything else: no element children and no text besides whitespace.
 * Null when nothing matches.
 */
export function readEmpty(locator: Locator): Promise<boolean | null> {
  return readFirst(
    locator,
    `if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return el.value === "";
    return el.children.length === 0 && (el.textContent || "").trim() === "";`,
  );
}

/** true, false or "mixed" (an indeterminate checkbox, or `aria-checked="mixed"`); null when nothing matches */
export function readCheckedState(
  locator: Locator,
): Promise<CheckedState | null> {
  return readFirst(
    locator,
    `const type = (el.getAttribute("type") || "").toLowerCase();
    const input = el.tagName === "INPUT" && (type === "checkbox" || type === "radio");
    if (input && el.indeterminate) return "mixed";
    if ((input && el.checked) || el.getAttribute("aria-checked") === "true") return true;
    return el.getAttribute("aria-checked") === "mixed" ? "mixed" : false;`,
  );
}
