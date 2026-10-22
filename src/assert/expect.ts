import Page from "../browser/page.js";
import Locator from "../locator/locator.js";
import { LocatorAssertions } from "./locator-assertions.js";
import { PageAssertions } from "./page-assertions.js";
import { ValueAssertions } from "./value-assertions.js";

export { takePendingAssertions } from "./pending-assertions.js";
export { LocatorAssertions } from "./locator-assertions.js";
export { PageAssertions } from "./page-assertions.js";
export { ValueAssertions } from "./value-assertions.js";

/** Auto-retrying assertions on a page element */
export function expect(locator: Locator): LocatorAssertions;
/** Auto-retrying assertions on the page URL and title */
export function expect(page: Page): PageAssertions;
/** Synchronous assertions on a plain value */
export function expect<T>(value: T): ValueAssertions<T>;
export function expect(value: unknown) {
  if (value instanceof Locator) return new LocatorAssertions(value);
  if (value instanceof Page) return new PageAssertions(value);
  return new ValueAssertions(value);
}
