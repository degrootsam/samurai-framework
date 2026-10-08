import type { FlowFile, FlowNodeModel } from "./schema.js";

export const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

const slug = (text: string) => {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return !s ? "" : /^[a-z]/.test(s) ? s : `n${s}`;
};

/** What a node's key is made from: its title, else its test's name (last part), else its group, else its kind */
export function keyBase(node: FlowNodeModel): string {
  const testName = node.ref?.testId?.split("::").pop()?.split(" > ").pop();
  return (
    slug(node.title ?? "") ||
    slug(testName ?? "") ||
    slug(node.ref?.group ?? "") ||
    slug(node.kind) ||
    "node"
  );
}

/** `base`, or `base_2`, `base_3` … when taken */
export function uniqueKey(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

/** Gives every node a valid, unique key; nodes that have one keep it (the first of a duplicate keeps it) */
export function withKeys(flow: FlowFile): FlowFile {
  const taken = new Set<string>();
  const keeps = new Set<FlowNodeModel>();
  for (const node of flow.nodes)
    if (node.key && KEY_PATTERN.test(node.key) && !taken.has(node.key)) {
      taken.add(node.key);
      keeps.add(node);
    }
  if (keeps.size === flow.nodes.length) return flow;
  const nodes = flow.nodes.map((node) => {
    if (keeps.has(node)) return node;
    const key = uniqueKey(keyBase(node), taken);
    taken.add(key);
    return { ...node, key };
  });
  return { ...flow, nodes };
}
