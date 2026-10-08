import type { FlowEdgeModel, FlowFile } from "./schema.js";

/** The nodes reached from `from`, in the order a walk first meets them (`from` included) */
export function reachOrder(flow: FlowFile, from: string): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    order.push(id);
    for (const e of flow.edges) if (e.source === id) visit(e.target);
  };
  visit(from);
  return order;
}

/** Where the branches of a node meet: the first node the first branch reaches that every other branch reaches too */
export function meetOf(flow: FlowFile, node: string): string | undefined {
  const out = flow.edges.filter((e) => e.source === node);
  if (out.length === 0) return undefined;
  const others = out.slice(1).map((e) => new Set(reachOrder(flow, e.target)));
  return reachOrder(flow, out[0]!.target).find((id) =>
    others.every((reach) => reach.has(id)),
  );
}

/** The edges out of a dynamic `branches` node in the order their branches were filled (by their branch-<n> name) */
export const inFillOrder = (edges: FlowEdgeModel[]): FlowEdgeModel[] => {
  const index = (e: FlowEdgeModel) =>
    Number(e.sourceHandle?.match(/^branch-(\d+)$/)?.[1] ?? 1e9);
  return [...edges].sort((a, b) => index(a) - index(b));
};

/** Every node with a path to `nodeId` (not the node itself) */
export function ancestors(flow: FlowFile, nodeId: string): Set<string> {
  const seen = new Set<string>();
  const visit = (id: string) => {
    for (const e of flow.edges)
      if (e.target === id && !seen.has(e.source)) {
        seen.add(e.source);
        visit(e.source);
      }
  };
  visit(nodeId);
  seen.delete(nodeId);
  return seen;
}

/** Whether every path from Start to `n` passes `d` */
export function dominates(flow: FlowFile, d: string, n: string): boolean {
  const start = flow.nodes.find((x) => x.kind === "start");
  if (!start || d === n) return d === n;
  if (d === start.id) return true;
  const seen = new Set<string>([d]);
  const stack = [start.id];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === n) return false;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of flow.edges) if (e.source === id) stack.push(e.target);
  }
  return true;
}
