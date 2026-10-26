import { runWiredTests } from "../node-inputs.js";
import { notInBrowser } from "./support.js";
import type { Handler } from "./types.js";

export const test: Handler = async (node, run) => {
  const skipped = notInBrowser(node, run);
  if (skipped) return skipped;
  const list = run.nodeTests[node.id];
  if (!list || list.length === 0)
    return { status: "failed", error: "This test was deleted or moved." };
  return runWiredTests(node, run, list);
};
