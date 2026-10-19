import ts from "typescript";
import type { LocatorCall, LocatorSpec } from "../model.js";
import { readObject, stringOf } from "./literals.js";

function readCall(
  method: string,
  args: readonly ts.Expression[],
): LocatorCall | undefined {
  const first = stringOf(args[0]);
  if (first === undefined) return undefined;
  switch (method) {
    case "locator":
      return args.length === 1 ? { method, xpath: first } : undefined;
    case "getByCss":
      return args.length === 1 ? { method, css: first } : undefined;
    case "getByTestId":
      return args.length === 1 ? { method, testId: first } : undefined;
    case "getByText":
    case "getByLabel": {
      if (args.length > 2) return undefined;
      const options =
        args.length === 2 ? readObject(args[1], ["match", "ignoreCase"]) : {};
      if (!options) return undefined;
      const { match, ignoreCase } = options;
      if (
        (match !== undefined && match !== "full" && match !== "partial") ||
        (ignoreCase !== undefined && typeof ignoreCase !== "boolean")
      ) {
        return undefined;
      }
      return {
        method,
        text: first,
        ...(match !== undefined && { match: match as "full" | "partial" }),
        ...(ignoreCase !== undefined && { ignoreCase: ignoreCase as boolean }),
      };
    }
    case "getByRole": {
      if (args.length > 2) return undefined;
      const options = args.length === 2 ? readObject(args[1], ["name"]) : {};
      if (
        !options ||
        (options.name !== undefined && typeof options.name !== "string")
      )
        return undefined;
      return {
        method,
        role: first,
        ...(options.name !== undefined && { name: options.name as string }),
      };
    }
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
  return ts.isIdentifier(current) && current.text === "page" && calls.length > 0
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
