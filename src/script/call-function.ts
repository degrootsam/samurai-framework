import type { BiDiConnector } from "../transport/bidi-connection.js";
import { BiDiError } from "../transport/bidi-error.js";
import type { StackTrace } from "../types/bidi-modules/script.js";
import { fromRemoteValue, toLocalValue, type Arg } from "./serialize.js";

/** How much of a function's source `ScriptError` keeps */
const SOURCE_PREVIEW = 200;

export interface CallOptions {
  /** @default true. The auto-wait probes pass false */
  awaitPromise?: boolean;
  /**
   * "root" keeps a handle alive in the browser; the result then comes back as a `RemoteObject`
   * carrying it, and the caller must `disown` it. @default "none"
   */
  ownership?: "none" | "root";
  /** Named sandbox realm to run in (see the preload-scripts spec) */
  sandbox?: string;
  thisArg?: Arg;
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

/** The source to send for `fn`; a function object must not depend on transpiler helpers */
export function toFunctionDeclaration(fn: string | ((...args: any[]) => unknown)): string {
  if (typeof fn === "string") return fn;
  const source = fn.toString();
  // tsx/esbuild wrap named functions in a __name() helper that does not exist in the page
  if (source.includes("__name(")) {
    throw new ScriptSerializationError(
      "The function's source uses the transpiler's __name helper, which does not exist in the page. " +
        "Use an arrow function without inner named functions, or pass the function as a string.",
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
  const ownership = options.ownership ?? "none";
  // Serialize first: a bad argument must fail before anything is sent
  const serialized = args.map(toLocalValue);
  const thisValue = "thisArg" in options ? toLocalValue(options.thisArg) : undefined;

  const result = await connector.send("script.callFunction", {
    functionDeclaration,
    awaitPromise: options.awaitPromise ?? true,
    target:
      options.sandbox === undefined
        ? { context }
        : { context, sandbox: options.sandbox },
    ...(serialized.length > 0 && { arguments: serialized }),
    resultOwnership: ownership,
    ...(thisValue !== undefined && { this: thisValue }),
  });

  if (result.type === "exception") {
    throw new ScriptError(
      result.exceptionDetails.text,
      functionDeclaration,
      result.exceptionDetails.stackTrace,
    );
  }
  return fromRemoteValue(result.result, { keepHandles: ownership === "root" }) as T;
}

/** Releases handles obtained with `ownership: "root"`; a handle that is already gone is fine */
export async function disown(
  connector: BiDiConnector,
  context: string,
  handles: string[],
): Promise<void> {
  if (handles.length === 0) return;
  try {
    await connector.send("script.disown", { handles, target: { context } });
  } catch (err) {
    if (err instanceof BiDiError && err.code === "no such handle") return;
    throw err;
  }
}
