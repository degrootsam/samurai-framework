import {
  inFillOrder,
  meetOf,
  type AnyNodeDefinition,
  type ExpressionContext,
  type FlowFile,
  type FlowNodeModel,
} from "../core/index.js";
import type { FlowEvent, NodeResult } from "./events.js";
import type { Handler, HandlerRun } from "./handlers/index.js";
import { definitionOf, dynamicBranches, shapeError } from "./prepare-flow.js";

/** What the walker needs of the run: the flow, who handles each kind, and where results and events go */
export interface WalkerInput {
  flow: FlowFile;
  signal: AbortSignal;
  handlers: Readonly<Record<string, Handler>>;
  nodes: readonly AnyNodeDefinition[];
  /** What the handlers get; the walker also writes each result into its `context.nodes` */
  handlerRun: HandlerRun;
  context: ExpressionContext;
  onEvent: (event: FlowEvent) => void;
}

/**
 * Walks the flow from Start by the shape of each node's kind: a step runs and follows its one way out; a node
 * with a fixed list of branches follows the one its handler names and skips the others; a node with a dynamic
 * list walks every branch in fill order; an end stops. Branches meet again at `meetOf`.
 */
export class FlowWalker {
  /** Why the walk stopped early: a failed node that stops the flow, or an abort */
  public stopped: "failed" | "cancelled" | undefined;
  /** The result of every node that ran or was skipped, by node id */
  public readonly results: Record<string, NodeResult> = {};
  /** Nodes already entered, so a node reached twice is a shape error */
  private readonly visited = new Set<string>();
  private readonly byId: Map<string, FlowNodeModel>;

  constructor(private readonly input: WalkerInput) {
    this.byId = new Map(input.flow.nodes.map((n) => [n.id, n]));
  }

  private definition(kind: string) {
    return definitionOf(this.input.nodes, kind);
  }

  private record(node: FlowNodeModel, result: NodeResult) {
    this.results[node.id] = result;
    if (node.key)
      this.input.context.nodes[node.key] = {
        ...result.outputs,
        status: result.status,
        durationMs: result.durationMs,
        error: result.error,
      };
  }

  private out(id: string) {
    return this.input.flow.edges.filter((e) => e.source === id);
  }

  /** Marks every node from `from` up to `stop` as skipped (a branch not taken) */
  private skip(from: string, stop: string) {
    const seen = new Set<string>();
    const visit = (id: string) => {
      if (id === stop || seen.has(id)) return;
      seen.add(id);
      const node = this.byId.get(id);
      if (node && !this.results[id]) {
        this.record(node, { status: "skipped" });
        this.input.onEvent({
          type: "node-end",
          nodeId: id,
          result: { status: "skipped" },
        });
      }
      for (const e of this.out(id)) visit(e.target);
    };
    visit(from);
  }

  private async runNode(
    node: FlowNodeModel,
    def: AnyNodeDefinition,
  ): Promise<NodeResult | undefined> {
    const { signal, handlers, handlerRun, onEvent } = this.input;
    if (this.visited.has(node.id))
      throw shapeError(`${node.key ?? node.id} is reached twice.`);
    this.visited.add(node.id);
    if (signal.aborted) {
      this.stopped = "cancelled";
      return undefined;
    }
    onEvent({ type: "node-start", nodeId: node.id });
    const began = Date.now();
    const handler = handlers[node.kind];
    const outcome = handler
      ? await handler(node, handlerRun)
      : ({ status: "skipped", note: "Not supported yet" } as const);
    if (outcome === "cancelled" || signal.aborted) {
      this.stopped = "cancelled";
      return undefined;
    }
    const result: NodeResult = { ...outcome, durationMs: Date.now() - began };
    this.record(node, result);
    // A node with a dynamic list of branches ends after them: walk() reports it then
    if (dynamicBranches(def)) return result;
    onEvent({ type: "node-end", nodeId: node.id, result });
    if (result.status === "failed" && node.onFailure === "stop")
      this.stopped = "failed";
    return result;
  }

  /** Whether `target` is on the chain from `from` before `stop` */
  private reachesBefore(from: string, target: string, stop: string) {
    const seen = new Set<string>();
    const visit = (id: string): boolean => {
      if (id === stop || seen.has(id)) return false;
      if (id === target) return true;
      seen.add(id);
      return this.out(id).some((e) => visit(e.target));
    };
    return visit(from);
  }

  /** Walks the branches of a node with a dynamic list, then reports the node: failed when anything in them failed */
  private async walkBranches(
    node: FlowNodeModel,
    result: NodeResult,
    meet: string,
  ): Promise<void> {
    const { flow, onEvent } = this.input;
    const edges = this.out(node.id);
    const opened = Date.now();
    for (const e of inFillOrder(edges)) {
      if (this.stopped) break;
      if (e.target !== meet) await this.walk(e.target, meet);
    }
    if (this.stopped === "cancelled") {
      // Stopped inside its branches: like any node cut short, it didn't run to the end
      delete this.results[node.id];
      return;
    }
    // The node fails when anything in its branches failed
    const failed = flow.nodes.some(
      (n) =>
        this.results[n.id]?.status === "failed" &&
        edges.some(
          (e) => e.target !== meet && this.reachesBefore(e.target, n.id, meet),
        ),
    );
    const durationMs = (result.durationMs ?? 0) + Date.now() - opened;
    const ended: NodeResult = failed
      ? { ...result, durationMs, status: "failed", error: "A branch failed." }
      : { ...result, durationMs };
    this.record(node, ended);
    onEvent({ type: "node-end", nodeId: node.id, result: ended });
    if (failed && node.onFailure === "stop") this.stopped = "failed";
  }

  /** Runs the chain from `from` up to `stop` (undefined: through End) */
  public async walk(from: string, stop?: string): Promise<void> {
    const { flow } = this.input;
    let at: string | undefined = from;
    while (at !== undefined && at !== stop && !this.stopped) {
      const node = this.byId.get(at);
      if (!node) throw shapeError("an edge leads to a missing node.");
      const def = this.definition(node.kind);
      if (!def)
        throw shapeError(
          `${node.key ?? node.id} has an unknown kind (${node.kind}).`,
        );
      const result = await this.runNode(node, def);
      if (!result || this.stopped) return;
      if (def.shape === "end") return;
      const edges = this.out(node.id);
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
          for (const e of edges) if (e !== taken) this.skip(e.target, meet);
          if (taken) await this.walk(taken.target, meet);
        } else {
          await this.walkBranches(node, result, meet);
          if (this.stopped) return;
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
}
