import { problemOf, scopeAt } from "./expression/index.js";
import { KEY_PATTERN } from "./keys.js";
import {
  branchNames,
  dynamicOf,
  getPath,
  nodeDef,
  withDefaults,
  type FlowProblem,
  type NodeCtx,
} from "./nodes/index.js";
import type { AnyNodeDefinition } from "./nodes/define.js";
import type { FlowFile, FlowNodeModel } from "./schema.js";

export type { FlowProblem } from "./nodes/index.js";

export interface CheckOptions {
  /** The test ids that exist. When given, a Test node whose test is gone is an error. */
  tests?: Iterable<string>;
  /** The group names that exist. When given, a Group node whose group is gone is an error. */
  groups?: Iterable<string>;
  /** The environment expressions are checked against (its name and variable names). Without it, expressions are not checked, only left empty. */
  environment?: { name: string; variables: Record<string, unknown> };
  /**
   * The kinds that have a handler. When given, every step or branches node of
   * another kind is reported as unsupported:
   *  - `unsupported: "skip"` (default): a warning, `<label> nodes can't run yet. They are skipped.`
   *  - `unsupported: "fail"`: an error, `<label> can't run yet.`
   * Without `handled` nothing is reported.
   */
  handled?: ReadonlySet<string>;
  unsupported?: "skip" | "fail";
}

/** What the node is called in a message: its title, else its key, else its kind's label */
const titleOf = (node: FlowNodeModel, def: AnyNodeDefinition | undefined) =>
  node.title || node.key || def?.label || node.kind;

const defOf = (kind: string): AnyNodeDefinition | undefined => {
  try {
    return nodeDef(kind);
  } catch {
    return undefined;
  }
};

/** Node ids in the order a run reaches them: from Start, following edges */
function reachableFrom(flow: FlowFile, startId: string | undefined) {
  const out = new Map<string, string[]>();
  for (const e of flow.edges)
    out.set(e.source, [...(out.get(e.source) ?? []), e.target]);
  const known = new Set(flow.nodes.map((n) => n.id));
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id) || !known.has(id)) return;
    seen.add(id);
    for (const next of out.get(id) ?? []) visit(next);
  };
  if (startId) visit(startId);
  return seen;
}

/**
 * Checks a flow before a run: the shape of the graph, keys, references that still
 * exist, expressions, and what a run can't execute. Pure; returns every problem.
 * Messages are the SAMURAI app's, except that a node is named by its `title`, else
 * its key, else its kind's label (the app names it by what the editor shows).
 */
export function checkFlow(
  flow: FlowFile,
  options: CheckOptions = {},
): FlowProblem[] {
  const problems: FlowProblem[] = [];
  const tests = options.tests ? new Set(options.tests) : undefined;
  const groups = options.groups ? new Set(options.groups) : undefined;
  const shapeOf = (n: FlowNodeModel) => defOf(n.kind)?.shape;

  for (const n of flow.nodes)
    if (!defOf(n.kind))
      problems.push({
        level: "error",
        nodeId: n.id,
        message: `Unknown node kind: ${n.kind}`,
      });

  const starts = flow.nodes.filter((n) => shapeOf(n) === "start");
  const ends = flow.nodes.filter((n) => shapeOf(n) === "end");
  if (starts.length !== 1)
    problems.push({ level: "error", message: "A flow has exactly one Start." });
  if (ends.length !== 1)
    problems.push({ level: "error", message: "A flow has exactly one End." });

  const reachable = reachableFrom(flow, starts[0]?.id);
  // Can reach End: walk edges backwards from End
  const back = new Map<string, string[]>();
  for (const e of flow.edges)
    back.set(e.target, [...(back.get(e.target) ?? []), e.source]);
  const toEnd = new Set<string>();
  const walk = (id: string) => {
    if (toEnd.has(id)) return;
    toEnd.add(id);
    (back.get(id) ?? []).forEach(walk);
  };
  ends.forEach((e) => walk(e.id));

  for (const n of flow.nodes) {
    const def = defOf(n.kind);
    const title = titleOf(n, def);
    if (!reachable.has(n.id))
      problems.push({
        level: "error",
        nodeId: n.id,
        message: `${title} isn't reachable from Start.`,
      });
    else if (!toEnd.has(n.id))
      problems.push({
        level: "error",
        nodeId: n.id,
        message: `${title} doesn't lead to End.`,
      });
    if (!def) continue;
    const names = branchNames(n);
    const outCount = flow.edges.filter((e) => e.source === n.id).length;
    if (dynamicOf(n) && outCount < names.length)
      problems.push({
        level: "error",
        nodeId: n.id,
        message: `${title} needs at least ${names.length} branches.`,
      });
    else if (
      !dynamicOf(n) &&
      names.length &&
      !names.every((h) =>
        flow.edges.some((e) => e.source === n.id && e.sourceHandle === h),
      )
    )
      problems.push({
        level: "error",
        nodeId: n.id,
        message:
          names.length === 2
            ? `${title} needs both a ${names[0]} and a ${names[1]} branch.`
            : `${title} needs a branch for each of ${names.join(", ")}.`,
      });
    const ctx: NodeCtx = { label: def.label, tests, groups };
    problems.push(...(def.validate?.(withDefaults(def, n), ctx) ?? []));
    if (
      options.handled &&
      (def.shape === "step" || def.shape === "branches") &&
      !options.handled.has(n.kind)
    ) {
      problems.push(
        options.unsupported === "fail"
          ? {
              level: "error",
              nodeId: n.id,
              message: `${def.label} can't run yet.`,
            }
          : {
              level: "warning",
              nodeId: n.id,
              message: `${def.label} nodes can't run yet. They are skipped.`,
            },
      );
    }
  }

  const seen = new Map<string, string>();
  for (const n of flow.nodes) {
    if (!n.key) continue;
    if (!KEY_PATTERN.test(n.key))
      problems.push({
        level: "error",
        nodeId: n.id,
        message: `"${n.key}" isn't a valid key. Use lowercase letters, digits and _, starting with a letter.`,
      });
    else if (seen.has(n.key))
      problems.push({
        level: "error",
        nodeId: n.id,
        message: `The key "${n.key}" is used by another node.`,
      });
    else seen.set(n.key, n.id);
  }

  problems.push(...emptyExpressions(flow));
  if (options.environment)
    problems.push(...expressionProblems(flow, options.environment));

  const nodeCount = flow.nodes.filter((n) => {
    const s = shapeOf(n);
    return s !== "start" && s !== "end";
  }).length;
  if (
    nodeCount > 0 &&
    flow.edges.some(
      (e) =>
        shapeOf(flow.nodes.find((n) => n.id === e.source) ?? ({} as never)) ===
          "start" &&
        shapeOf(flow.nodes.find((n) => n.id === e.target) ?? ({} as never)) ===
          "end",
    )
  )
    problems.push({
      level: "error",
      message: "Start connects straight to End, skipping the nodes in between.",
    });
  return problems;
}

/** Every expression field left empty: it would stop the run at its node */
function emptyExpressions(flow: FlowFile): FlowProblem[] {
  return flow.nodes.flatMap((n) => {
    const def = defOf(n.kind);
    if (!def) return [];
    return def.fields
      .filter((f) => f.type === "expression")
      .filter((f) => {
        const text = getPath(n, f.path);
        return (
          text === undefined || (typeof text === "string" && text.trim() === "")
        );
      })
      .map(() => ({
        level: "error" as const,
        nodeId: n.id,
        message: `${def.label}: Write an expression`,
      }));
  });
}

/** Every expression field that doesn't check out, as "Label: message" */
export function expressionProblems(
  flow: FlowFile,
  environment: { name: string; variables: Record<string, unknown> },
): FlowProblem[] {
  return flow.nodes.flatMap((n) => {
    const def = defOf(n.kind);
    if (!def) return [];
    return def.fields
      .filter((f) => f.type === "expression")
      .flatMap((f) => {
        const text = getPath(n, f.path);
        if (typeof text !== "string" || text.trim() === "") return [];
        const problem = problemOf(text, scopeAt(flow, n.id, environment));
        return problem
          ? [
              {
                level: "error" as const,
                nodeId: n.id,
                message: `${def.label}: ${problem.message}`,
              },
            ]
          : [];
      });
  });
}
