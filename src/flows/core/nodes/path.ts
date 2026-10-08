import type { FlowNodeModel } from "../schema.js";

/** Splits `config.expr` into `["config", "expr"]`; `title` is a top-level key */
function split(path: string): [string, string | undefined] {
  const i = path.indexOf(".");
  return i < 0 ? [path, undefined] : [path.slice(0, i), path.slice(i + 1)];
}

/** Reads a field's value from the node: `title`, `subtitle`, `continueSession`, `config.*` or `ref.*` */
export function getPath(node: FlowNodeModel, path: string): unknown {
  const [head, rest] = split(path);
  const top = (node as unknown as Record<string, unknown>)[head];
  if (rest === undefined) return top;
  return (top as Record<string, unknown> | undefined)?.[rest];
}

/** The patch that writes a field's value, keeping the other keys of `config` and `ref` */
export function setPath(
  node: FlowNodeModel,
  path: string,
  value: unknown,
): Partial<FlowNodeModel> {
  const [head, rest] = split(path);
  if (rest === undefined) return { [head]: value };
  const top = (node as unknown as Record<string, unknown>)[head];
  return { [head]: { ...(top as object | undefined), [rest]: value } };
}
