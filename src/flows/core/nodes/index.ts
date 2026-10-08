import { api } from "./api.js";
import { condition } from "./condition.js";
import { database } from "./database.js";
import type { AnyNodeDefinition, Branch, DynamicBranches } from "./define.js";
import { email } from "./email.js";
import { end } from "./end.js";
import { group } from "./group.js";
import { parallel } from "./parallel.js";
import { script } from "./script.js";
import { setVariable } from "./set-variable.js";
import { start } from "./start.js";
import { test } from "./test.js";
import { wait } from "./wait.js";

// Library order
const registered = [
  start,
  end,
  test,
  group,
  condition,
  parallel,
  wait,
  setVariable,
  api,
  database,
  email,
  script,
] as const;

export type NodeKind = (typeof registered)[number]["kind"];

export const NODES: readonly AnyNodeDefinition[] = registered;

/** The definition of a kind; throws for an unknown one */
export function nodeDef(kind: string): AnyNodeDefinition {
  const def = NODES.find((d) => d.kind === kind);
  if (!def) throw new Error(`Unknown node kind: ${kind}`);
  return def;
}

/** How a run treats a node in the graph */
export const shapeOf = (node: { kind: string }) => nodeDef(node.kind).shape;

/** The branch names a dynamic list gives its branches: branch-0, branch-1, ... */
export const dynamicName = (index: number) => `branch-${index}`;

/** The dynamic branch settings of a `branches` node; undefined for a fixed list and any other shape */
export const dynamicOf = (node: {
  kind: string;
}): DynamicBranches | undefined => {
  const def = nodeDef(node.kind);
  return def.shape === "branches" &&
    def.branches &&
    !Array.isArray(def.branches)
    ? (def.branches as DynamicBranches)
    : undefined;
};

/**
 * The branches a new `branches` node starts with, in order: its fixed list, or
 * `min` empty ones for a dynamic list. Empty for any other shape.
 */
export const branchesOf = (node: { kind: string }): readonly Branch[] => {
  const def = nodeDef(node.kind);
  if (def.shape !== "branches" || !def.branches) return [];
  if (Array.isArray(def.branches)) return def.branches as readonly Branch[];
  return Array.from(
    { length: (def.branches as DynamicBranches).min },
    (_, i) => ({ name: dynamicName(i) }),
  );
};

/** The branch an edge out of a `branches` node leaves by (a dynamic list has no labels or colours) */
export const branchOf = (
  node: { kind: string },
  handle: string | undefined,
): Branch | undefined =>
  dynamicOf(node)
    ? handle
      ? { name: handle }
      : undefined
    : branchesOf(node).find((b) => b.name === handle);

/** The names of the branches `branchesOf` lists */
export const branchNames = (node: { kind: string }): string[] =>
  branchesOf(node).map((b) => b.name);

export * from "./define.js";
export * from "./path.js";
