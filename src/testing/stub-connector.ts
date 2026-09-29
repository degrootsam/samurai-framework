import type { BiDiConnector } from "../transport/bidi-connection.js";
import { BiDiError } from "../transport/bidi-error.js";
import type { ErrorCode } from "../types/bidi-protocols/error.js";
import type { RemoteValue } from "../types/bidi-modules/script.js";

/** `{ error }` rejects the command like a BiDi error reply (e.g. "no such node") */
export type StubResponse =
  | RemoteValue
  | { exception: string }
  | { hang: true }
  | { error: ErrorCode };

/** Converts plain JS (JSON-like) to the RemoteValue the browser would answer with */
export function remote(value: unknown): RemoteValue {
  if (value === undefined) return { type: "undefined" };
  if (value === null) return { type: "null" };
  if (typeof value === "string") return { type: "string", value };
  if (typeof value === "number") return { type: "number", value };
  if (typeof value === "boolean") return { type: "boolean", value };
  if (Array.isArray(value)) return { type: "array", value: value.map(remote) };
  return {
    type: "object",
    value: Object.entries(value as object).map(([key, item]) => [key, remote(item)]),
  };
}

/** Plain JS for a serialized argument, so tests can assert on what the page function received */
function decodeArgument(argument: any): unknown {
  if (argument.sharedId !== undefined) return { sharedId: argument.sharedId };
  switch (argument.type) {
    case "undefined":
      return undefined;
    case "null":
      return null;
    case "array":
      return argument.value.map(decodeArgument);
    case "object":
      return Object.fromEntries(
        argument.value.map(([key, item]: [string, unknown]) => [key, decodeArgument(item)]),
      );
    default:
      return argument.value;
  }
}

/** A `script.callFunction` the stub received */
export interface StubCall {
  functionDeclaration: string;
  /** Arguments decoded to plain JS */
  args: unknown[];
}

/**
 * Fake BiDiConnector for unit tests. Every `script.evaluate` and `script.callFunction` answers
 * with the next queued response; the last response repeats. `{ hang: true }` never answers.
 * `input.performActions`, `input.setFiles` and `browsingContext.navigate` resolve empty. Sent commands are recorded.
 * `browsingContext.locateNodes` answers with as many nodes as the next queued count (see `nodeCounts`;
 * default: always one), capped by `maxNodeCount`, named `stub-node-<n>`.
 * `expressions` holds one entry per script call: the expression, or the function declaration
 * followed by its arguments as a JSON comment, so tests can match on either.
 */
export function stubConnector(...responses: StubResponse[]) {
  if (responses.length === 0) {
    throw new Error("stubConnector needs at least one response");
  }
  const expressions: string[] = [];
  /** Every `script.callFunction`, in order */
  const calls: StubCall[] = [];
  /** Every command sent, in order */
  const sent: Array<{ method: string; params: unknown }> = [];
  let scriptCalls = 0;
  let counts: number[] = [1];
  let locateCalls = 0;
  let locateFailure: Error | undefined;
  const unsupported = new Set<string>();
  const failures = new Map<string, Error>();

  const connector = {
    async send(method: string, params: any) {
      sent.push({ method, params });
      const failure = failures.get(method);
      if (failure) throw failure;
      if (method === "browsingContext.locateNodes") {
        if (locateFailure) throw locateFailure;
        if (unsupported.has(params.locator.type)) {
          throw new BiDiError(method, "unsupported operation", `${params.locator.type} is not supported`);
        }
        const available = counts[Math.min(locateCalls++, counts.length - 1)]!;
        const length = Math.min(available, params.maxNodeCount ?? Infinity);
        return {
          nodes: Array.from({ length }, (_, index) => ({
            type: "node",
            sharedId: `stub-node-${index}`,
          })),
        };
      }
      if (
        method === "input.performActions" ||
        method === "input.setFiles" ||
        method === "browsingContext.navigate"
      ) {
        return {};
      }
      if (method === "script.evaluate") {
        expressions.push(params.expression);
      } else if (method === "script.callFunction") {
        const args = (params.arguments ?? []).map(decodeArgument);
        calls.push({ functionDeclaration: params.functionDeclaration, args });
        expressions.push(`${params.functionDeclaration}\n/* args: ${JSON.stringify(args)} */`);
      } else {
        throw new Error(`stubConnector does not handle ${method}`);
      }
      const response = responses[Math.min(scriptCalls++, responses.length - 1)]!;
      if ("hang" in response) {
        return new Promise(() => {});
      }
      if ("error" in response) {
        throw new BiDiError(method, response.error, "stub error");
      }
      if ("exception" in response) {
        return {
          type: "exception",
          exceptionDetails: { text: response.exception },
          realm: "stub",
        };
      }
      return { type: "success", result: response, realm: "stub" };
    },
  };

  return {
    connector: connector as unknown as BiDiConnector,
    expressions,
    calls,
    sent,
    /** Queues how many nodes each `browsingContext.locateNodes` finds; the last count repeats. Restarts the queue */
    nodeCounts(...queue: number[]) {
      counts = queue.length > 0 ? queue : [1];
      locateCalls = 0;
    },
    /** Makes `browsingContext.locateNodes` answer "unsupported operation" for these locator types (e.g. "innerText") */
    unsupportedLocators(...types: string[]) {
      types.forEach((type) => unsupported.add(type));
    },
    /** Makes every `browsingContext.locateNodes` reject with `error` */
    failLocate(error: Error) {
      locateFailure = error;
    },
    /** Makes every send of `method` reject with `error` */
    failCommand(method: string, error: Error) {
      failures.set(method, error);
    },
  };
}
