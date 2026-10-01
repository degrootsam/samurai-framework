import type Locator from "../locator/locator.js";
import type Page from "../browser/page.js";
import type { LocatorCall, LocatorSpec } from "./model.js";

function fromCalls(page: Page, calls: readonly LocatorCall[]): Locator {
  const [first, ...rest] = calls;
  if (!first) throw new Error("A locator needs at least one call");
  const apply = (target: Page | Locator, call: LocatorCall): Locator => {
    const text = { ...(call.method !== "locator" && call.method !== "getByCss" && call.method !== "getByTestId" && call.method !== "getByRole" && {
      ...(call.match !== undefined && { match: call.match }),
      ...(call.ignoreCase !== undefined && { ignoreCase: call.ignoreCase }),
    }) };
    switch (call.method) {
      case "locator":
        return target.locator(call.xpath);
      case "getByCss":
        return target.getByCss(call.css);
      case "getByText":
        return target.getByText(call.text, text);
      case "getByLabel":
        return target.getByLabel(call.text, text);
      case "getByRole":
        return target.getByRole(call.role, call.name === undefined ? undefined : { name: call.name });
      case "getByTestId":
        return target.getByTestId(call.testId);
    }
  };
  return rest.reduce<Locator>((locator, call) => apply(locator, call), apply(page, first));
}

/** The locator a step's `LocatorSpec` stands for, with its fallbacks */
export function locatorFromSpec(page: Page, spec: LocatorSpec): Locator {
  const primary = fromCalls(page, spec.chain);
  return spec.fallbacks.length === 0 ? primary : primary.withFallbacks(...spec.fallbacks.map((chain) => fromCalls(page, chain)));
}
