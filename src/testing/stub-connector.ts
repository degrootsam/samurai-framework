import type { BiDiConnector } from "../transport/bidi-connection.js";
import type { RemoteValue } from "../types/bidi-modules/script.js";

export type StubResponse = RemoteValue | { exception: string };

/**
 * Fake BiDiConnector for unit tests. Every `script.evaluate` answers with the next
 * queued response; the last response repeats. Evaluated expressions are recorded.
 */
export function stubConnector(...responses: StubResponse[]) {
  if (responses.length === 0) {
    throw new Error("stubConnector needs at least one response");
  }
  const expressions: string[] = [];
  let calls = 0;

  const connector = {
    async send(method: string, params: { expression: string }) {
      if (method !== "script.evaluate") {
        throw new Error(`stubConnector does not handle ${method}`);
      }
      expressions.push(params.expression);
      const response = responses[Math.min(calls++, responses.length - 1)]!;
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

  return { connector: connector as unknown as BiDiConnector, expressions };
}
