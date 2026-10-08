import { ancestors, dominates, reachOrder } from "../graph.js";
import type { FlowFile } from "../schema.js";
import type { ExpressionScope } from "./check.js";

/** What an expression at `nodeId` may use */
export function scopeAt(
  flow: FlowFile,
  nodeId: string,
  environment: { name: string; variables: Record<string, unknown> },
): ExpressionScope {
  const keyOf = (id: string) => flow.nodes.find((n) => n.id === id)?.key;
  const keys = (ids: Iterable<string>) =>
    [...ids].map(keyOf).filter((k): k is string => !!k);
  const before = ancestors(flow, nodeId);
  const after = new Set(reachOrder(flow, nodeId));
  after.delete(nodeId);
  const vars = flow.nodes
    .filter(
      (n) =>
        n.kind === "set-variable" &&
        n.id !== nodeId &&
        dominates(flow, n.id, nodeId),
    )
    .map((n) => n.config?.name)
    .filter((name): name is string => typeof name === "string" && name !== "");
  return {
    env: {
      name: environment.name,
      variables: Object.keys(environment.variables),
    },
    vars: [...new Set(vars)],
    before: keys(before),
    after: keys(after),
    all: keys(flow.nodes.map((n) => n.id)),
  };
}
