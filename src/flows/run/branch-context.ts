import { isDeepStrictEqual } from "node:util";
import type { ExpressionContext } from "../core/index.js";

/** The outputs each node saved in a run, by node id: what later nodes' inputs are wired from */
export type OutputsById = Record<string, Record<string, unknown>>;

/**
 * A branch of a Parallel node: its own copy of the variables and node outputs (by key and by id), and the
 * variables as they were when it forked
 */
export interface Fork {
  context: ExpressionContext;
  outputsById: OutputsById;
  base: Record<string, unknown>;
}

export function forkContext(
  context: ExpressionContext,
  outputsById: OutputsById,
): Fork {
  return {
    context: {
      ...context,
      vars: { ...context.vars },
      nodes: { ...context.nodes },
    },
    outputsById: { ...outputsById },
    base: { ...context.vars },
  };
}

/**
 * Takes what the branches wrote into `into` and `intoOutputs`: every node output, and every variable a branch changed. A variable
 * two branches changed to different values is a clash and is not taken; the first clash is returned.
 */
export function mergeForks(
  into: ExpressionContext,
  intoOutputs: OutputsById,
  forks: readonly Fork[],
): { clash?: string } {
  const changed = new Map<string, unknown>();
  const clashes = new Set<string>();
  for (const { context, outputsById, base } of forks) {
    Object.assign(into.nodes, context.nodes);
    Object.assign(intoOutputs, outputsById);
    for (const [name, value] of Object.entries(context.vars)) {
      if (name in base && isDeepStrictEqual(base[name], value)) continue;
      if (changed.has(name) && !isDeepStrictEqual(changed.get(name), value))
        clashes.add(name);
      else changed.set(name, value);
    }
  }
  for (const [name, value] of changed)
    if (!clashes.has(name)) into.vars[name] = value;
  const [clash] = clashes;
  return clash === undefined ? {} : { clash };
}
