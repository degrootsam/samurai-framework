import type Locator from "../locator/locator.js";
import type Page from "../browser/page.js";
import type { LocatorCall, LocatorSpec, TextMatcher } from "./model.js";

/** The RegExp or string a matcher stands for */
export function textFromMatcher(matcher: TextMatcher): string | RegExp {
  return typeof matcher === "string"
    ? matcher
    : new RegExp(matcher.regex.source, matcher.regex.flags);
}

/** `options` without the keys that are undefined, or undefined when nothing is left */
function defined<T extends object>(options: T): T | undefined {
  const entries = Object.entries(options).filter(([, v]) => v !== undefined);
  return entries.length === 0 ? undefined : (Object.fromEntries(entries) as T);
}

function apply(target: Page | Locator, call: LocatorCall): Locator {
  switch (call.method) {
    case "locator":
      return target.locator(call.xpath);
    case "getByCss":
      return target.getByCss(call.css);
    case "getByText":
    case "getByLabel": {
      const { exact, match, ignoreCase } = call;
      return target[call.method](
        textFromMatcher(call.text),
        defined({ exact, match, ignoreCase }),
      );
    }
    case "getByPlaceholder":
    case "getByAltText":
    case "getByTitle":
      return target[call.method](
        textFromMatcher(call.text),
        defined({ exact: call.exact }),
      );
    case "getByRole": {
      const { method, role, name, ...options } = call;
      return target.getByRole(
        role,
        defined({
          ...options,
          ...(name !== undefined && { name: textFromMatcher(name) }),
        }),
      );
    }
    case "getByTestId":
      return target.getByTestId(call.testId);
    case "nth":
    case "first":
    case "last":
    case "filter": {
      if (!("nth" in target))
        throw new Error(`${call.method} needs a locator to narrow`);
      return call.method === "nth"
        ? target.nth(call.index)
        : call.method === "filter"
          ? target.filter({ hasText: textFromMatcher(call.hasText) })
          : target[call.method]();
    }
  }
}

function fromCalls(page: Page, calls: readonly LocatorCall[]): Locator {
  const [first, ...rest] = calls;
  if (!first) throw new Error("A locator needs at least one call");
  return rest.reduce<Locator>(
    (locator, call) => apply(locator, call),
    apply(page, first),
  );
}

/** The locator a step's `LocatorSpec` stands for, with its fallbacks */
export function locatorFromSpec(page: Page, spec: LocatorSpec): Locator {
  const primary = fromCalls(page, spec.chain);
  return spec.fallbacks.length === 0
    ? primary
    : primary.withFallbacks(
        ...spec.fallbacks.map((chain) => fromCalls(page, chain)),
      );
}
