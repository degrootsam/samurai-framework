import {
  checkExpression,
  parseExpression,
  scopeAt,
  type FlowNodeModel,
} from "../../core/index.js";
import type { NodeTest } from "../events.js";
import type { HandlerRun, Outcome } from "./types.js";

export const fail = (e: unknown): Outcome => ({
  status: "failed",
  error: (e as Error).message,
});

/** A Test or Group node whose browsers lack the run's is skipped with a note */
export const notInBrowser = (
  node: FlowNodeModel,
  run: HandlerRun,
): Outcome | undefined =>
  run.nodeBrowsers?.[node.id]?.includes(run.browser) === false
    ? { status: "skipped", note: `not run in ${run.browser}` }
    : undefined;

/**
 * Runs `list` for the node with `inputs` and turns the result into an outcome: the inputs it sent (when any) and,
 * for a Test node that passed, the outputs its test saved (a retried test's last attempt)
 */
export async function runNodeTests(
  node: FlowNodeModel,
  run: HandlerRun,
  list: NodeTest[],
  inputs: Record<string, string> = {},
): Promise<Outcome> {
  const sent = Object.keys(inputs).length > 0 ? inputs : undefined;
  let saved: Record<string, string> | undefined;
  let result: "passed" | "failed" | "cancelled";
  try {
    result = await run.runTests(
      node.id,
      list,
      (e) => {
        if (e.type === "test-end")
          saved = "outputs" in e.result ? e.result.outputs : undefined;
        run.onTestEvent(node.id, e);
      },
      sent,
    );
  } catch (e) {
    return {
      status: "failed",
      error: (e as Error).message,
      ...(sent && { inputs: sent }),
    };
  }
  if (result === "cancelled") return "cancelled";
  const outputs = node.kind === "test" ? saved : undefined;
  return result === "passed"
    ? {
        status: "passed",
        ...(sent && { inputs: sent }),
        ...(outputs && { outputs }),
      }
    : {
        status: "failed",
        error: "A test failed.",
        ...(sent && { inputs: sent }),
      };
}

/** The checker's problem with an expression, as the builder would show it: a bypassed check fails the node the same way */
export const problemAt = (node: FlowNodeModel, run: HandlerRun, text: string) =>
  checkExpression(
    parseExpression(text),
    scopeAt(run.flow, node.id, run.environment, {
      nodes: run.nodes,
      ...(run.facts && { facts: run.facts }),
    }),
  )?.message;
