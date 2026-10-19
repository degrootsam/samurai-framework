import {
  inFillOrder,
  meetOf,
  type AnyNodeDefinition,
  type ExpressionContext,
  type FlowFile,
  type FlowNodeModel,
} from "../core/index.js";
import { forkContext, mergeForks, type Fork } from "./branch-context.js";
import type { FlowEvent, NodeResult } from "./events.js";
import type { Handler, HandlerRun } from "./handlers/index.js";
import { definitionOf, dynamicBranches, shapeError } from "./prepare-flow.js";

/** What the walker needs of the run: the flow, who handles each kind, and where results and events go */
export interface WalkerInput {
  flow: FlowFile;
  signal: AbortSignal;
  handlers: Readonly<Record<string, Handler>>;
  nodes: readonly AnyNodeDefinition[];
  /** What the handlers get for a context and a signal; the walker also writes each result into `context.nodes` */
  handlerRunFor: (
    context: ExpressionContext,
    signal: AbortSignal,
  ) => HandlerRun;
  context: ExpressionContext;
  onEvent: (event: FlowEvent) => void;
}

/**
 * Walks the flow from Start by the shape of each node's kind: a step runs and follows its one way out; a node
 * with a fixed list of branches follows the one its handler names and skips the others; a node with a dynamic
 * list walks every branch at the same time, each with its own copy of the variables (see `BranchWalk`); an end
 * stops. Branches meet again at `meetOf`.
 */
export class FlowWalker {
  /** Why the walk stopped early: a failed node that stops the flow, or an abort */
  public stopped: "failed" | "cancelled" | undefined;
  /** The result of every node that ran or was skipped, by node id; shared with the walks of the branches */
  public readonly results: Record<string, NodeResult>;
  /** Nodes already entered, so a node reached twice is a shape error; shared with the walks of the branches */
  private readonly visited: Set<string>;
  private readonly byId: Map<string, FlowNodeModel>;
  private readonly handlerRun: HandlerRun;

  constructor(
    private readonly input: WalkerInput,
    shared: {
      results: Record<string, NodeResult>;
      visited: Set<string>;
    } = { results: {}, visited: new Set() },
  ) {
    this.byId = new Map(input.flow.nodes.map((n) => [n.id, n]));
    this.results = shared.results;
    this.visited = shared.visited;
    this.handlerRun = input.handlerRunFor(input.context, input.signal);
  }

  /** The variables and node outputs this walk reads and writes */
  public get context(): ExpressionContext {
    return this.input.context;
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
    const { signal, handlers, onEvent } = this.input;
    const { handlerRun } = this;
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

  /**
   * Walks the branches of a node with a dynamic list at the same time, then reports the node: failed when anything
   * in them failed, or when two branches set a variable differently. A branch that fails and stops the flow cancels
   * the others.
   */
  private async walkBranches(
    node: FlowNodeModel,
    result: NodeResult,
    meet: string,
  ): Promise<void> {
    const { flow, onEvent } = this.input;
    const edges = this.out(node.id);
    const opened = Date.now();
    const cancel = new AbortController();
    const onAbort = () => cancel.abort();
    if (this.input.signal.aborted) onAbort();
    else this.input.signal.addEventListener("abort", onAbort, { once: true });
    const walks = inFillOrder(edges)
      .filter((e) => e.target !== meet)
      .map((e) => new BranchWalk(this, e.target, meet, cancel));
    const settled = await Promise.allSettled(walks.map((w) => w.done));
    this.input.signal.removeEventListener("abort", onAbort);
    const rejected = settled.find((r) => r.status === "rejected");
    if (rejected) throw (rejected as PromiseRejectedResult).reason;

    if (walks.some((w) => w.stopped === "failed")) this.stopped = "failed";
    if (this.input.signal.aborted) this.stopped = "cancelled";
    if (this.stopped === "cancelled") {
      // Stopped inside its branches: like any node cut short, it didn't run to the end
      delete this.results[node.id];
      return;
    }
    const { clash } = mergeForks(
      this.input.context,
      walks.map((w) => w.fork),
    );
    // The node fails when anything in its branches failed
    const failed = flow.nodes.some(
      (n) =>
        this.results[n.id]?.status === "failed" &&
        edges.some(
          (e) => e.target !== meet && this.reachesBefore(e.target, n.id, meet),
        ),
    );
    const durationMs = (result.durationMs ?? 0) + Date.now() - opened;
    const ended: NodeResult = clash
      ? {
          ...result,
          durationMs,
          status: "failed",
          error: `branches set ${clash} differently`,
        }
      : failed
        ? {
            ...result,
            durationMs,
            status: "failed",
            error: "A branch failed.",
          }
        : { ...result, durationMs };
    this.record(node, ended);
    onEvent({ type: "node-end", nodeId: node.id, result: ended });
    if (ended.status === "failed" && node.onFailure === "stop")
      this.stopped = "failed";
  }

  /** A walker for one branch: the same flow, results and visited nodes, but its own variables and its own signal */
  public forBranch(fork: Fork, signal: AbortSignal): FlowWalker {
    return new FlowWalker(
      { ...this.input, context: fork.context, signal },
      { results: this.results, visited: this.visited },
    );
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

/** One branch of a Parallel node, walking from its first node up to where the branches meet */
class BranchWalk {
  public readonly fork: Fork;
  private readonly walker: FlowWalker;
  /** Settles when the branch has ended; rejects when its shape can't run */
  public readonly done: Promise<void>;

  constructor(
    parent: FlowWalker,
    from: string,
    meet: string,
    cancel: AbortController,
  ) {
    this.fork = forkContext(parent.context);
    this.walker = parent.forBranch(this.fork, cancel.signal);
    this.done = this.walker.walk(from, meet).then(
      () => {
        // A failure that stops the flow cancels the branches still running
        if (this.walker.stopped === "failed") cancel.abort();
      },
      (error: unknown) => {
        cancel.abort();
        throw error;
      },
    );
  }

  public get stopped() {
    return this.walker.stopped;
  }
}
