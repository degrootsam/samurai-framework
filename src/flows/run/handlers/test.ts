import { runNodeTests } from "./support.js";
import type { Handler } from "./types.js";

export const test: Handler = async (node, run) => {
  const list = run.nodeTests[node.id];
  if (!list || list.length === 0)
    return { status: "failed", error: "This test was deleted or moved." };
  return runNodeTests(node, run, list);
};
