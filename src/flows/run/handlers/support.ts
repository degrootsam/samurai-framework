import {
  checkExpression,
  parseExpression,
  scopeAt,
  type ExpressionContext,
  type FlowFile,
  type FlowNodeModel,
} from "../../core/index.js";
import type { RunEvent } from "../../../runner/reporter.js";
import type { NodeResult, NodeTest } from "../events.js";

/** What a handler can use of the run */
export interface HandlerRun {
  flow: FlowFile;
  environment: { name: string; variables: Record<string, unknown> };
  context: ExpressionContext;
  nodeTests: Record<string, NodeTest[]>;
  signal: AbortSignal;
  runTests: (
    tests: NodeTest[],
    onEvent: (e: RunEvent) => void,
  ) => Promise<"passed" | "failed" | "cancelled">;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  onTestEvent: (nodeId: string, e: RunEvent) => void;
}

/** What a handler decides; the walker adds timing */
export type Outcome = Omit<NodeResult, "durationMs"> | "cancelled";

/** Runs one kind of node. A `branches` node names the branch it takes in `branch` */
export type Handler = (
  node: FlowNodeModel,
  run: HandlerRun,
) => Promise<Outcome>;

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
    result = await run.runTests(list, (e) => run.onTestEvent(node.id, e));
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
    scopeAt(run.flow, node.id, run.environment),
  )?.message;
