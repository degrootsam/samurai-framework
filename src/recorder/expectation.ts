import type { Expectation } from "../steps/model.js";

const TEXT_LIMIT = 100;

/** The name a secret gets in `secrets.<NAME>`: the field's name or id, upper snake case */
export function secretNameFor(hint: string | undefined): string {
  const name = (hint ?? "")
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return name === "" || /^\d/.test(name) ? "PASSWORD" : name;
}

/** The assertion an Alt+click or a pick starts with: the value of a field, else the text (cut when long), else visible */
export function expectationFor(
  text: string,
  value: string | undefined,
): Expectation {
  if (value !== undefined) return { matcher: "toHaveValue", expected: value };
  if (text === "") return { matcher: "toBeVisible" };
  return text.length <= TEXT_LIMIT
    ? { matcher: "toHaveText", expected: text }
    : { matcher: "toContainText", expected: text.slice(0, TEXT_LIMIT).trim() };
}

/**
 * The URL a `toHaveURL` step is written with: its path, query and hash when that resolves against `base` back to
 * exactly `url` (as `toHaveURL` resolves it), else the full URL
 */
export function urlForAssertion(url: string, base: string | undefined): string {
  if (base === undefined) return url;
  try {
    const parsed = new URL(url);
    if (parsed.origin !== new URL(base).origin) return url;
    const candidate = parsed.pathname + parsed.search + parsed.hash;
    return new URL(candidate, base).href === parsed.href ? candidate : url;
  } catch {
    return url;
  }
}
