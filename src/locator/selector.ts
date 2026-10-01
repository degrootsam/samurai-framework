import type { NodeLocator } from "../types/bidi-modules/browsing-context.js";

/** One step of a locator. A locator is a chain of them, each searching inside the previous step's matches */
export type Selector =
  | { kind: "xpath"; value: string }
  | { kind: "css"; value: string }
  | { kind: "text"; value: string; match: "full" | "partial"; ignoreCase: boolean }
  | { kind: "role"; role?: string; name?: string }
  /** Form controls named by a `<label>`, `aria-labelledby` or `aria-label` whose text matches */
  | { kind: "label"; value: string; match: "full" | "partial"; ignoreCase: boolean }
  /** Elements whose `data-testid` attribute equals `value` */
  | { kind: "testid"; value: string }
  /** Picks the n-th (0-based) of everything the chain so far matches; `all()` builds these */
  | { kind: "nth"; index: number };

export interface TextOptions {
  /** @default "full" */
  match?: "full" | "partial";
  /** @default false */
  ignoreCase?: boolean;
}

function nonEmpty(value: string, what: string): string {
  if (value.trim() === "") throw new TypeError(`${what} must not be empty`);
  return value;
}

export function xpathSelector(value: string): Selector {
  return { kind: "xpath", value: nonEmpty(value, "an xpath") };
}

export function cssSelector(value: string): Selector {
  return { kind: "css", value: nonEmpty(value, "a css selector") };
}

export function textSelector(value: string, { match = "full", ignoreCase = false }: TextOptions = {}): Selector {
  return { kind: "text", value: nonEmpty(value, "the text"), match, ignoreCase };
}

export function labelSelector(value: string, { match = "full", ignoreCase = false }: TextOptions = {}): Selector {
  return { kind: "label", value: nonEmpty(value, "the label"), match, ignoreCase };
}

export function testIdSelector(value: string): Selector {
  return { kind: "testid", value: nonEmpty(value, "the test id") };
}

export function roleSelector(role: string, { name }: { name?: string } = {}): Selector {
  nonEmpty(role, "the role");
  return name === undefined ? { kind: "role", role } : { kind: "role", role, name };
}

/**
 * Normalises an xpath. Relative xpaths get a leading `//` (`.//` when `scoped`, i.e. searching inside
 * a parent match). Absolute (`/…`), grouped (`(…)`) and context (`./…`) paths are kept; in a scoped
 * position `//…` is also made relative, so `parent.locator("//x")` means "x inside parent".
 */
export function normalizeXpath(xpath: string, scoped: boolean): string {
  if (scoped) {
    if (xpath.startsWith("//")) return "." + xpath;
    return /^[/(.]/.test(xpath) ? xpath : ".//" + xpath;
  }
  return /^[/(.]/.test(xpath) ? xpath : "//" + xpath;
}

/** The BiDi locator for a step. `scoped` is true for every step after the first */
export function toBiDiLocator(selector: Selector, scoped: boolean): NodeLocator {
  switch (selector.kind) {
    case "xpath":
      return { type: "xpath", value: normalizeXpath(selector.value, scoped) };
    case "css":
      return { type: "css", value: selector.value };
    case "text":
      return {
        type: "innerText",
        value: selector.value,
        matchType: selector.match,
        ignoreCase: selector.ignoreCase,
      };
    case "role":
      return {
        type: "accessibility",
        value: {
          ...(selector.role !== undefined && { role: selector.role }),
          ...(selector.name !== undefined && { name: selector.name }),
        },
      };
    case "testid":
      return { type: "css", value: `[data-testid="${selector.value.replace(/["\\]/g, "\\$&")}"]` };
    case "label":
      throw new Error("label is resolved by the framework, not by the browser");
    case "nth":
      throw new Error("nth is resolved by the framework, not by the browser");
  }
}

/** A short name for error messages */
export function describeSelector(selector: Selector, scoped: boolean): string {
  switch (selector.kind) {
    case "xpath":
      return normalizeXpath(selector.value, scoped);
    case "css":
      return `css=${selector.value}`;
    case "label":
    case "text": {
      const flags = [
        selector.match === "partial" && "partial",
        selector.ignoreCase && "ignoring case",
      ].filter(Boolean);
      return `${selector.kind}=${JSON.stringify(selector.value)}${flags.length ? ` (${flags.join(", ")})` : ""}`;
    }
    case "testid":
      return `testid=${JSON.stringify(selector.value)}`;
    case "role":
      return (
        `role=${selector.role ?? ""}` +
        (selector.name === undefined ? "" : `[name=${JSON.stringify(selector.name)}]`)
      );
    case "nth":
      return `nth=${selector.index}`;
  }
}

export function describeChain(chain: readonly Selector[]): string {
  return chain.map((selector, index) => describeSelector(selector, index > 0)).join(" >> ");
}
