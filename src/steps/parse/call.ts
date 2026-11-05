import ts from "typescript";
import type { LocatorCall, LocatorSpec, TextMatcher } from "../model.js";
import { readTextMatcher } from "./expectation.js";
import { booleanOf, integerOf, readProps, stringOf } from "./literals.js";

type Call<M extends LocatorCall["method"]> = Extract<
  LocatorCall,
  { method: M }
>;

type TextMethod =
  | "getByText"
  | "getByLabel"
  | "getByPlaceholder"
  | "getByAltText"
  | "getByTitle";

/** The calls that narrow the ones before them, so they can't start a chain on `page` */
const NARROWING = ["nth", "first", "last", "filter"];

const MATCHES = ["full", "partial"];
const TRISTATE = ["checked", "pressed"] as const;
const FLAGS = ["expanded", "selected", "disabled", "includeHidden"] as const;
const ROLE_KEYS = ["name", "exact", "level", ...TRISTATE, ...FLAGS];

/** `{ exact, match, ignoreCase }` of a text call, as far as the call allows */
function readTextOptions(
  node: ts.Expression | undefined,
  allowed: readonly string[],
):
  | { exact?: boolean; match?: "full" | "partial"; ignoreCase?: boolean }
  | undefined {
  if (!node) return {};
  const props = readProps(node, allowed);
  if (!props) return undefined;
  const { exact, match, ignoreCase } = props;
  const matchValue = stringOf(match);
  if (
    (exact && booleanOf(exact) === undefined) ||
    (ignoreCase && booleanOf(ignoreCase) === undefined) ||
    (match && (matchValue === undefined || !MATCHES.includes(matchValue)))
  )
    return undefined;
  return {
    ...(exact && { exact: booleanOf(exact)! }),
    ...(match && { match: matchValue as "full" | "partial" }),
    ...(ignoreCase && { ignoreCase: booleanOf(ignoreCase)! }),
  };
}

/** A call that takes a text (or RegExp) and the options `allowed`; a RegExp takes none */
function readTextCall(
  method: TextMethod,
  args: readonly ts.Expression[],
  allowed: readonly string[],
): LocatorCall | undefined {
  const text = readTextMatcher(args[0]);
  if (text === undefined || args.length > 2) return undefined;
  const options = readTextOptions(args[1], allowed);
  if (!options || (typeof text !== "string" && args.length === 2))
    return undefined;
  return { method, text, ...options } as LocatorCall;
}

function readRole(args: readonly ts.Expression[]): LocatorCall | undefined {
  const role = stringOf(args[0]);
  if (role === undefined || args.length > 2) return undefined;
  const props = args.length === 2 ? readProps(args[1], ROLE_KEYS) : {};
  if (!props) return undefined;
  const call: Call<"getByRole"> = { method: "getByRole", role };
  if (props.name) {
    const name = readTextMatcher(props.name);
    if (name === undefined) return undefined;
    call.name = name;
  }
  if (props.exact) {
    const exact = booleanOf(props.exact);
    if (exact === undefined || (call.name && typeof call.name !== "string"))
      return undefined;
    call.exact = exact;
  }
  if (props.level) {
    const level = integerOf(props.level);
    if (level === undefined || level < 1) return undefined;
    call.level = level;
  }
  for (const key of TRISTATE) {
    const node = props[key];
    if (!node) continue;
    const value = stringOf(node) === "mixed" ? "mixed" : booleanOf(node);
    if (value === undefined) return undefined;
    call[key] = value;
  }
  for (const key of FLAGS) {
    const node = props[key];
    if (!node) continue;
    const value = booleanOf(node);
    if (value === undefined) return undefined;
    call[key] = value;
  }
  return call;
}

function readNarrowing(
  method: string,
  args: readonly ts.Expression[],
): LocatorCall | undefined {
  if (method === "first" || method === "last")
    return args.length === 0 ? { method } : undefined;
  if (method === "nth") {
    const index = integerOf(args[0]);
    return args.length === 1 && index !== undefined
      ? { method, index }
      : undefined;
  }
  const hasText = readProps(args[0], ["hasText"])?.hasText;
  const text: TextMatcher | undefined = readTextMatcher(hasText);
  return method === "filter" && args.length === 1 && text !== undefined
    ? { method, hasText: text }
    : undefined;
}

function readCall(
  method: string,
  args: readonly ts.Expression[],
): LocatorCall | undefined {
  if (NARROWING.includes(method)) return readNarrowing(method, args);
  switch (method) {
    case "locator":
    case "getByCss":
    case "getByTestId": {
      const first = stringOf(args[0]);
      if (first === undefined || args.length !== 1) return undefined;
      return method === "locator"
        ? { method, xpath: first }
        : method === "getByCss"
          ? { method, css: first }
          : { method, testId: first };
    }
    case "getByText":
    case "getByLabel":
      return readTextCall(method as TextMethod, args, [
        "exact",
        "match",
        "ignoreCase",
      ]);
    case "getByPlaceholder":
    case "getByAltText":
    case "getByTitle":
      return readTextCall(method as TextMethod, args, ["exact"]);
    case "getByRole":
      return readRole(args);
    default:
      return undefined;
  }
}

/** `page.a(…).b(…)` as calls in order; undefined when it is anything else */
function readChain(node: ts.Expression): LocatorCall[] | undefined {
  const calls: LocatorCall[] = [];
  let current = node;
  while (ts.isCallExpression(current)) {
    if (!ts.isPropertyAccessExpression(current.expression)) return undefined;
    const call = readCall(current.expression.name.text, current.arguments);
    if (!call) return undefined;
    calls.unshift(call);
    current = current.expression.expression;
  }
  return ts.isIdentifier(current) &&
    current.text === "page" &&
    calls.length > 0 &&
    !NARROWING.includes(calls[0]!.method)
    ? calls
    : undefined;
}

export function readLocator(node: ts.Expression): LocatorSpec | undefined {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "withFallbacks"
  ) {
    const chain = readChain(node.expression.expression);
    const fallbacks = node.arguments.map(readChain);
    if (
      !chain ||
      node.arguments.length === 0 ||
      fallbacks.some((fallback) => !fallback)
    )
      return undefined;
    return { chain, fallbacks: fallbacks as LocatorCall[][] };
  }
  const chain = readChain(node);
  return chain && { chain, fallbacks: [] };
}
