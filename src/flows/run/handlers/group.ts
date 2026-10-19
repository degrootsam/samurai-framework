import { runNodeTests } from "./support.js";
import type { Handler } from "./types.js";

export const group: Handler = async (node, run) => {
  const list = run.nodeTests[node.id] ?? [];
  if (list.length === 0)
    return { status: "passed", note: "This group has no tests." };
  return runNodeTests(node, run, list);
};
