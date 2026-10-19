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

/** Runs `list` for the node and turns the result into an outcome */
export async function runNodeTests(
  node: FlowNodeModel,
  run: HandlerRun,
  list: NodeTest[],
): Promise<Outcome> {
  let result: "passed" | "failed" | "cancelled";
  try {
    result = await run.runTests(
      list,
      (e) => run.onTestEvent(node.id, e),
      run.nodeBrowsers?.[node.id],
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
    scopeAt(run.flow, node.id, run.environment, run.nodes),
  )?.message;
