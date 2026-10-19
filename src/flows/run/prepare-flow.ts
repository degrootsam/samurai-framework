import {
  nodeDef,
  type AnyNodeDefinition,
  type FlowFile,
} from "../core/index.js";
import type { Handler } from "./handlers/index.js";

/** The flow's shape can't be walked (no Start, a node reached twice, a branch that never meets): the run ends with this message */
export class ShapeError extends Error {}

export const shapeError = (message: string) =>
  new ShapeError(`This flow's shape can't run: ${message}`);

/** Waits `ms`, or rejects at once when `signal` aborts */
export const defaultSleep = (ms: number, signal: AbortSignal) =>
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

/** Whether a node of this kind has a list of branches that is only known at run time (a Parallel node) */
export const dynamicBranches = (def: AnyNodeDefinition) =>
  def.shape === "branches" && !!def.branches && !Array.isArray(def.branches);

/** The definition of a kind: the project's own steps first, then the built-in kinds; undefined for a kind nobody knows */
export function definitionOf(
  nodes: readonly AnyNodeDefinition[],
  kind: string,
): AnyNodeDefinition | undefined {
  const own = nodes.find((d) => d.kind === kind);
  if (own) return own;
  try {
    return nodeDef(kind);
  } catch {
    return undefined;
  }
}

/** Throws when the flow has a step or branching node whose kind has no handler: the run would not know what to do */
export function assertRunnable(
  flow: FlowFile,
  nodes: readonly AnyNodeDefinition[],
  handlers: Readonly<Record<string, Handler>>,
): void {
  const problems = flow.nodes
    .map((n) => ({ n, def: definitionOf(nodes, n.kind) }))
    .filter(
      ({ n, def }) =>
        def &&
        (def.shape === "step" || def.shape === "branches") &&
        !handlers[n.kind],
    )
    .map(({ def }) => `${def!.label} can't run yet.`);
  if (problems.length)
    throw new Error(`This flow can't run: ${[...new Set(problems)].join(" ")}`);
}
