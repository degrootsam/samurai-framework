import { ancestors, dominates, reachOrder } from "../graph.js";
import type { AnyNodeDefinition } from "../nodes/define.js";
import { NODES } from "../nodes/index.js";
import { getPath } from "../nodes/path.js";
import type { FlowFile } from "../schema.js";
import { declaredOutputs, type FlowFacts } from "../wiring.js";
import type { ExpressionScope } from "./check.js";

/**
 * What an expression at `nodeId` may use. `options.nodes` adds definitions core
 * doesn't have (steps); `options.facts` adds each keyed Test node's declared outputs.
 */
export function scopeAt(
  flow: FlowFile,
  nodeId: string,
  environment: { name: string; variables: Record<string, unknown> },
  options: { nodes?: readonly AnyNodeDefinition[]; facts?: FlowFacts } = {},
): ExpressionScope {
  const { nodes = [], facts } = options;
  const defOf = (kind: string) =>
    nodes.find((d) => d.kind === kind) ?? NODES.find((d) => d.kind === kind);
  const keyOf = (id: string) => flow.nodes.find((n) => n.id === id)?.key;
  const keys = (ids: Iterable<string>) =>
    [...ids].map(keyOf).filter((k): k is string => !!k);
  const before = ancestors(flow, nodeId);
  const after = new Set(reachOrder(flow, nodeId));
  after.delete(nodeId);
  const vars = flow.nodes
    .filter((n) => n.id !== nodeId && dominates(flow, n.id, nodeId))
    .map((n) => {
      const path = defOf(n.kind)?.writesVar;
      return path ? getPath(n, path) : undefined;
    })
    .filter((name): name is string => typeof name === "string" && name !== "");
  const outputs = Object.fromEntries(
    flow.nodes.flatMap((n) => {
      const results = [
        ...(defOf(n.kind)?.results ?? []),
        ...declaredOutputs(n, facts),
      ];
      return n.key && results.length ? [[n.key, results]] : [];
    }),
  );
  return {
    env: {
      name: environment.name,
      variables: Object.keys(environment.variables),
    },
    vars: [...new Set(vars)],
    before: keys(before),
    after: keys(after),
    all: keys(flow.nodes.map((n) => n.id)),
    outputs,
  };
}
