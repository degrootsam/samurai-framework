import type { BiDiConnector } from "../transport/bidi-connection.js";
import type { RemoteValue } from "../types/bidi-modules/script.js";

export type StubResponse = RemoteValue | { exception: string } | { hang: true };

/**
 * Fake BiDiConnector for unit tests. Every `script.evaluate` answers with the next
 * queued response; the last response repeats. `{ hang: true }` never answers.
 * `input.performActions` resolves empty. Evaluated expressions and all sent commands are recorded.
 */
export function stubConnector(...responses: StubResponse[]) {
  if (responses.length === 0) {
    throw new Error("stubConnector needs at least one response");
  }
  const expressions: string[] = [];
  /** Every command sent, in order */
  const sent: Array<{ method: string; params: unknown }> = [];
  let calls = 0;

  const connector = {
    async send(method: string, params: { expression: string }) {
      sent.push({ method, params });
      if (method === "input.performActions") {
        return {};
      }
      if (method !== "script.evaluate") {
        throw new Error(`stubConnector does not handle ${method}`);
      }
      expressions.push(params.expression);
      const response = responses[Math.min(calls++, responses.length - 1)]!;
      if ("hang" in response) {
        return new Promise(() => {});
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

  return { connector: connector as unknown as BiDiConnector, expressions, sent };
}
