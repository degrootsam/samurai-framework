import { cssSelector, xpathSelector, type Selector } from "./selector.js";

/** Prefixes that make a string an xpath, as in Playwright: `//a`, `/html`, `(//a)[2]`, `../x`, `./x` */
const XPATH_START = /^(?:\/|\(|\.\.|\.\/)/;

/**
 * What only an xpath written without a leading `//` (the older form of `locator("a[@id='x']")`) has and a
 * css selector cannot: `@`, `/`, `::`, a function call (a `(` that does not follow a `:pseudo-class`) or a
 * positional predicate (`li[2]`, `li[last()]`). Quoted text is ignored, so `a[href^='/x']` stays css.
 */
const RELATIVE_XPATH = /@|\/|::|(?<!:[\w-]+)\(|\[\s*(?:\d|last\b)/;
const QUOTED = /(["'])(?:\\.|(?!\1).)*\1/g;

/**
 * The selector step for the string `locator(…)` takes. `xpath=…` and `css=…` name the kind. A string starting
 * with `//`, `/`, `(`, `..` or `./` is an xpath, as is a relative path that cannot be css (`a[@id='x']`,
 * `button[text()='Go']`). Anything else is css (`input[name='x']`, `a, button`, `main`).
 */
export function selectorFromString(value: string): Selector {
  const text = value.trim();
  if (text.startsWith("xpath=")) return xpathSelector(text.slice(6));
  if (text.startsWith("css=")) return cssSelector(text.slice(4));
  if (text === "" || XPATH_START.test(text)) return xpathSelector(text);
  return RELATIVE_XPATH.test(text.replace(QUOTED, "''"))
    ? xpathSelector(text)
    : cssSelector(text);
}
