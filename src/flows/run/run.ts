import {
  inFillOrder,
  meetOf,
  nodeDef,
  type AnyNodeDefinition,
  type ExpressionContext,
  type FlowFile,
  type FlowNodeModel,
} from "../core/index.js";
import type { RunEvent } from "../../runner/reporter.js";
import type { FlowEvent, FlowSummary, NodeResult, NodeTest } from "./events.js";
import { HANDLERS, type Handler, type HandlerRun } from "./handlers/index.js";

export interface RunFlowOptions {
  flow: FlowFile;
  /** The tests of each Test and Group node, by node id */
  nodeTests: Record<string, NodeTest[]>;
  environment: {
    name: string;
    variables: Record<string, string | number | boolean>;
  };
  /** @default "manual" */
  trigger?: "manual";
  /** @default now */
  startedAt?: string;
  signal?: AbortSignal;
  onEvent?: (event: FlowEvent) => void;
  runTests: (input: {
    tests: NodeTest[];
    onEvent: (e: RunEvent) => void;
    signal: AbortSignal;
  }) => Promise<"passed" | "failed" | "cancelled">;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /**
   * What a node of a kind with no handler does:
   *  - `"fail"` (default): the run does not start (an error is thrown)
   *  - `"skip"`: the node is skipped with the note "Not supported yet"
   */
  unsupported?: "fail" | "skip";
  /** The handlers by kind. @default HANDLERS */
  handlers?: Readonly<Record<string, Handler>>;
  /** Definitions of kinds beyond the ones `flows/core` registers (a handler needs one to be walked) */
  nodes?: readonly AnyNodeDefinition[];
}

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new Error("aborted"));
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });

class ShapeError extends Error {}

const dynamicBranches = (def: AnyNodeDefinition) =>
  def.shape === "branches" && !!def.branches && !Array.isArray(def.branches);

/**
 * Walks the flow from Start by the shape of each node's kind: a step runs and
 * follows its one way out; a node with a fixed list of branches follows the one its
 * handler names and skips the others; a node with a dynamic list walks every branch in
 * fill order; an end stops. Branches meet again at `meetOf`.
 */
export async function runFlow(options: RunFlowOptions): Promise<FlowSummary> {
  const { flow, onEvent = () => {} } = options;
  const signal = options.signal ?? new AbortController().signal;
  const handlers = options.handlers ?? HANDLERS;
  const defOf = (kind: string): AnyNodeDefinition | undefined =>
    options.nodes?.find((d) => d.kind === kind) ??
    (() => {
      try {
        return nodeDef(kind);
      } catch {
        return undefined;
      }
    })();

  if ((options.unsupported ?? "fail") === "fail") {
    const problems = flow.nodes
      .map((n) => ({ n, def: defOf(n.kind) }))
      .filter(
        ({ n, def }) =>
          def &&
          (def.shape === "step" || def.shape === "branches") &&
          !handlers[n.kind],
      )
      .map(({ def }) => `${def!.label} can't run yet.`);
    if (problems.length)
      throw new Error(
        `This flow can't run: ${[...new Set(problems)].join(" ")}`,
      );
  }

  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const results: Record<string, NodeResult> = {};
  const context: ExpressionContext = {
    env: { ...options.environment.variables },
    vars: {},
    nodes: {},
    run: {
      environment: options.environment.name,
      trigger: options.trigger ?? "manual",
      startedAt: options.startedAt ?? new Date().toISOString(),
    },
  };
  const handlerRun: HandlerRun = {
    flow,
    environment: options.environment,
    context,
    nodeTests: options.nodeTests,
    signal,
    sleep: options.sleep ?? defaultSleep,
    runTests: (tests, onTestEvent) =>
      options.runTests({ tests, onEvent: onTestEvent, signal }),
    onTestEvent: (nodeId, event) => onEvent({ type: "test", nodeId, event }),
  };
  let stopped: "failed" | "cancelled" | undefined;
  const visited = new Set<string>();

  const record = (node: FlowNodeModel, result: NodeResult) => {
    results[node.id] = result;
    if (node.key)
      context.nodes[node.key] = {
        status: result.status,
        durationMs: result.durationMs,
        error: result.error,
      };
  };

  const out = (id: string) => flow.edges.filter((e) => e.source === id);

  /** Marks every node from `from` up to `stop` as skipped (a branch not taken) */
  const skip = (from: string, stop: string) => {
    const seen = new Set<string>();
    const visit = (id: string) => {
      if (id === stop || seen.has(id)) return;
      seen.add(id);
      const node = byId.get(id);
      if (node && !results[id]) {
        record(node, { status: "skipped" });
        onEvent({
          type: "node-end",
          nodeId: id,
          result: { status: "skipped" },
        });
      }
      for (const e of out(id)) visit(e.target);
    };
    visit(from);
  };

  const shapeError = (message: string) =>
    new ShapeError(`This flow's shape can't run: ${message}`);

  async function runNode(
    node: FlowNodeModel,
    def: AnyNodeDefinition,
  ): Promise<NodeResult | undefined> {
    if (visited.has(node.id))
      throw shapeError(`${node.key ?? node.id} is reached twice.`);
    visited.add(node.id);
    if (signal.aborted) {
      stopped = "cancelled";
      return undefined;
    }
    onEvent({ type: "node-start", nodeId: node.id });
    const began = Date.now();
    const handler = handlers[node.kind];
    const outcome = handler
      ? await handler(node, handlerRun)
      : ({ status: "skipped", note: "Not supported yet" } as const);
    if (outcome === "cancelled" || signal.aborted) {
      stopped = "cancelled";
      return undefined;
    }
    const result: NodeResult = { ...outcome, durationMs: Date.now() - began };
    record(node, result);
    // A node with a dynamic list of branches ends after them: walk() reports it then
    if (dynamicBranches(def)) return result;
    onEvent({ type: "node-end", nodeId: node.id, result });
    if (result.status === "failed" && node.onFailure === "stop")
      stopped = "failed";
    return result;
  }

  /** Whether `target` is on the chain from `from` before `stop` */
  const reachesBefore = (from: string, target: string, stop: string) => {
    const seen = new Set<string>();
    const visit = (id: string): boolean => {
      if (id === stop || seen.has(id)) return false;
      if (id === target) return true;
      seen.add(id);
      return out(id).some((e) => visit(e.target));
    };
    return visit(from);
  };

  /** Runs the chain from `from` up to `stop` (undefined: through End) */
  async function walk(from: string, stop?: string): Promise<void> {
    let at: string | undefined = from;
    while (at !== undefined && at !== stop && !stopped) {
      const node = byId.get(at);
      if (!node) throw shapeError("an edge leads to a missing node.");
      const def = defOf(node.kind);
      if (!def)
        throw shapeError(
          `${node.key ?? node.id} has an unknown kind (${node.kind}).`,
        );
      const result = await runNode(node, def);
      if (!result || stopped) return;
      if (def.shape === "end") return;
      const edges = out(node.id);
      if (def.shape === "branches") {
        const meet = meetOf(flow, node.id);
        if (!meet)
          throw shapeError(
            `the branches of ${node.key ?? node.id} never meet.`,
          );
        if (!dynamicBranches(def)) {
          const taken =
            result.status === "passed"
              ? edges.find((e) => e.sourceHandle === result.branch)
              : undefined;
          for (const e of edges) if (e !== taken) skip(e.target, meet);
          if (taken) await walk(taken.target, meet);
        } else {
          const opened = Date.now();
          for (const e of inFillOrder(edges)) {
            if (stopped) break;
            if (e.target !== meet) await walk(e.target, meet);
          }
          if (stopped === "cancelled") {
            // Stopped inside its branches: like any node cut short, it didn't run to the end
            delete results[node.id];
            return;
          }
          // The node fails when anything in its branches failed
          const failed = flow.nodes.some(
            (n) =>
              results[n.id]?.status === "failed" &&
              edges.some(
                (e) => e.target !== meet && reachesBefore(e.target, n.id, meet),
              ),
          );
          const durationMs = (result.durationMs ?? 0) + Date.now() - opened;
          const ended: NodeResult = failed
            ? {
                ...result,
                durationMs,
                status: "failed",
                error: "A branch failed.",
              }
            : { ...result, durationMs };
          record(node, ended);
          onEvent({ type: "node-end", nodeId: node.id, result: ended });
          if (failed && node.onFailure === "stop") stopped = "failed";
          if (stopped) return;
        }
        at = meet;
        continue;
      }
      if (edges.length !== 1)
        throw shapeError(
          `${node.key ?? node.id} has ${edges.length} ways out.`,
        );
      at = edges[0]!.target;
    }
  }

  onEvent({ type: "flow-start", environment: options.environment.name });
  let error: string | undefined;
  const start = flow.nodes.find((n) => defOf(n.kind)?.shape === "start");
  try {
    if (!start) throw shapeError("it has no Start.");
    await walk(start.id);
  } catch (e) {
    if (!(e instanceof ShapeError)) throw e;
    error = e.message;
  }
  for (const node of flow.nodes)
    if (!results[node.id]) results[node.id] = { status: "not-run" };
  const status: FlowSummary["status"] =
    stopped === "cancelled"
      ? "cancelled"
      : error || Object.values(results).some((r) => r.status === "failed")
        ? "failed"
        : "passed";
  const summary: FlowSummary = {
    status,
    nodes: results,
    vars: context.vars,
    ...(error ? { error } : {}),
  };
  onEvent({ type: "flow-end", summary });
  return summary;
}
