import type { BiDiConnector } from "../transport/bidi-connection.js";
import type { StackTrace } from "../types/bidi-modules/script.js";
import { fromRemoteValue, toLocalValue, type Arg } from "./serialize.js";

/** How much of a function's source `ScriptError` keeps */
const SOURCE_PREVIEW = 200;

export interface CallOptions {
  /** @default true. The auto-wait probes pass false */
  awaitPromise?: boolean;
  /** Named sandbox realm to run in */
  sandbox?: string;
}

/** The page function threw */
export class ScriptError extends Error {
  /** The browser's description, e.g. "TypeError: el is null" */
  public readonly text: string;
  public readonly stackTrace: StackTrace | undefined;
  /** Start of the function that threw */
  public readonly functionSource: string;

  constructor(text: string, functionSource: string, stackTrace?: StackTrace) {
    super(`Script threw: ${text}`);
    this.name = "ScriptError";
    this.text = text;
    this.stackTrace = stackTrace;
    this.functionSource =
      functionSource.length > SOURCE_PREVIEW
        ? functionSource.slice(0, SOURCE_PREVIEW) + "…"
        : functionSource;
  }
}

/** A function cannot be sent as source */
export class ScriptSerializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptSerializationError";
  }
}

/** A function to run in the page, or its source (a string is used as written) */
export type PageFunction<A extends unknown[], R> =
  string | ((...args: A) => R | Promise<R>);

/** The source to send for `fn`; a function object must not depend on transpiler helpers */
export function toFunctionDeclaration(
  fn: string | ((...args: any[]) => unknown),
): string {
  if (typeof fn === "string") return fn;
  const source = fn.toString();
  // tsx/esbuild (keepNames) wrap named functions in a __name() helper that does not exist in the page
  if (source.includes("__name(")) {
    throw new ScriptSerializationError(
      "The function's source uses __name(), a helper that tsx and esbuild add around named functions " +
        "(also an arrow function assigned to a variable) and that does not exist in the page. " +
        "Write the function without inner named functions (pass callbacks inline as anonymous arrow functions), " +
        "or pass it as a string.",
    );
  }
  return source;
}

/** Calls `fn` in the page with serialized arguments and returns its deserialized result */
export async function callFunction<T = unknown>(
  connector: BiDiConnector,
  context: string,
  fn: string | ((...args: any[]) => unknown),
  args: Arg[] = [],
  options: CallOptions = {},
): Promise<T> {
  const functionDeclaration = toFunctionDeclaration(fn);
  // Serialize first: a bad argument must fail before anything is sent
  const serialized = args.map(toLocalValue);

  const result = await connector.send("script.callFunction", {
    functionDeclaration,
    awaitPromise: options.awaitPromise ?? true,
    target:
      options.sandbox === undefined
        ? { context }
        : { context, sandbox: options.sandbox },
    ...(serialized.length > 0 && { arguments: serialized }),
    resultOwnership: "none",
  });

  if (result.type === "exception") {
    throw new ScriptError(
      result.exceptionDetails.text,
      functionDeclaration,
      result.exceptionDetails.stackTrace,
    );
  }
  return fromRemoteValue(result.result) as T;
}

/**
 * Evaluates `expression` in the page and returns its deserialized result; a promise is awaited.
 * Throws `ScriptError` with the page's message when it throws.
 */
export async function evaluateExpression<T = unknown>(
  connector: BiDiConnector,
  context: string,
  expression: string,
): Promise<T> {
  const result = await connector.send("script.evaluate", {
    expression,
    awaitPromise: true,
    target: { context },
    resultOwnership: "none",
  });
  if (result.type === "exception") {
    throw new ScriptError(
      result.exceptionDetails.text,
      expression,
      result.exceptionDetails.stackTrace,
    );
  }
  return fromRemoteValue(result.result) as T;
}
