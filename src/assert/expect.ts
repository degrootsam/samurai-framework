import Page from "../browser/page.js";
import Locator from "../locator/locator.js";
import {
  any,
  anything,
  arrayContaining,
  objectContaining,
  stringContaining,
  stringMatching,
} from "./asymmetric.js";
import { LocatorAssertions } from "./locator-assertions.js";
import { PageAssertions } from "./page-assertions.js";
import { ValueAssertions } from "./value-assertions.js";

export { takePendingAssertions } from "./pending-assertions.js";

/** `expect`: the assertions for a locator, a page or a plain value, plus the asymmetric matchers */
export interface Expect {
  /** Auto-retrying assertions on a page element */
  (locator: Locator): LocatorAssertions;
  /** Auto-retrying assertions on the page URL and title */
  (page: Page): PageAssertions;
  /** Synchronous assertions on a plain value */
  <T>(value: T): ValueAssertions<T>;
  any: typeof any;
  anything: typeof anything;
  stringContaining: typeof stringContaining;
  stringMatching: typeof stringMatching;
  arrayContaining: typeof arrayContaining;
  objectContaining: typeof objectContaining;
}

function expectValue(value: unknown) {
  if (value instanceof Locator) return new LocatorAssertions(value);
  if (value instanceof Page) return new PageAssertions(value);
  return new ValueAssertions(value);
}

export const expect: Expect = Object.assign(expectValue as Expect, {
  any,
  anything,
  stringContaining,
  stringMatching,
  arrayContaining,
  objectContaining,
});
