import {
  callFunction,
  evaluateExpression,
  type PageFunction,
} from "../script/call-function.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";

/** A function (or arrow function, async or not) written out as source, as opposed to an expression */
const FUNCTION_SOURCE =
  /^\s*(?:async\s+)?(?:function\b|(?:\((?:[^()]|\([^()]*\))*\)|[\w$]+)\s*=>)/;

/** Whether a string is the source of a function (called with the argument) rather than an expression (evaluated) */
export function isFunctionSource(source: string): boolean {
  return FUNCTION_SOURCE.test(source);
}

/**
 * Runs a function, or a string, in the page and returns the result as plain JavaScript (see `fromRemoteValue`).
 * A function (or a string holding a function's source) is called with `arg`; any other string is an expression.
 */
export async function evaluateInPage<R, A>(
  connector: BiDiConnector,
  context: string,
  fn: PageFunction<[A], R>,
  arg?: A,
): Promise<R> {
  if (typeof fn === "string" && !isFunctionSource(fn)) {
    if (arg !== undefined) {
      throw new TypeError(
        "evaluate(): an expression takes no argument; pass a function to use one",
      );
    }
    return evaluateExpression<R>(connector, context, fn);
  }
  return callFunction<R>(
    connector,
    context,
    fn,
    arg === undefined ? [] : [arg],
  );
}
