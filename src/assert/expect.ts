import Locator from "../locator/locator.js";
import { LocatorAssertions } from "./locator-assertions.js";
import { ValueAssertions } from "./value-assertions.js";

export { takePendingAssertions } from "./pending-assertions.js";
export { LocatorAssertions } from "./locator-assertions.js";
export { ValueAssertions } from "./value-assertions.js";

/** Auto-retrying assertions on a page element */
export function expect(locator: Locator): LocatorAssertions;
/** Synchronous assertions on a plain value */
export function expect<T>(value: T): ValueAssertions<T>;
export function expect(value: unknown) {
  return value instanceof Locator
    ? new LocatorAssertions(value)
    : new ValueAssertions(value);
}
