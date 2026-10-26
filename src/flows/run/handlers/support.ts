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

/** Runs `list` for the node and turns the result into an outcome */
export async function runNodeTests(
  node: FlowNodeModel,
  run: HandlerRun,
  list: NodeTest[],
): Promise<Outcome> {
  let result: "passed" | "failed" | "cancelled";
  try {
    result = await run.runTests(node.id, list, (e) =>
      run.onTestEvent(node.id, e),
    );
  } catch (e) {
    return fail(e);
  }
  if (result === "cancelled") return "cancelled";
  return result === "passed"
    ? { status: "passed" }
    : { status: "failed", error: "A test failed." };
}

/** The checker's problem with an expression, as the builder would show it: a bypassed check fails the node the same way */
export const problemAt = (node: FlowNodeModel, run: HandlerRun, text: string) =>
  checkExpression(
    parseExpression(text),
    scopeAt(run.flow, node.id, run.environment, { nodes: run.nodes }),
  )?.message;
