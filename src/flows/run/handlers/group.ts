import { runWiredTests } from "../node-inputs.js";
import { notInBrowser } from "./support.js";
import type { Handler } from "./types.js";

export const group: Handler = async (node, run) => {
  const skipped = notInBrowser(node, run);
  if (skipped) return skipped;
  const list = run.nodeTests[node.id] ?? [];
  if (list.length === 0)
    return { status: "passed", note: "This group has no tests." };
  return runWiredTests(node, run, list);
};
