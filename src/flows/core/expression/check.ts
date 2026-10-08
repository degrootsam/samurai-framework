import { HELPER_ARGS, HELPERS } from "./evaluate.js";
import { parseExpression, type ExpressionError, type Parsed } from "./parse.js";

export interface ExpressionScope {
  /** The flow environment's name and its variable names */
  env: { name: string; variables: string[] };
  /** Variables set before this node, on every path */
  vars: string[];
  /** Keys of nodes before this node (on some path) */
  before: string[];
  /** Keys of nodes after this node */
  after: string[];
  /** Every key in the flow */
  all: string[];
}

export const NODE_FIELDS = ["status", "durationMs", "error"] as const;
export const RUN_FIELDS = ["environment", "trigger", "startedAt"] as const;

const list = (items: readonly string[]) =>
  items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;

function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array<number>(b.length).fill(0),
  ]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return d[a.length]![b.length]!;
}

/** The closest name, when it's a likely typo */
const closest = (name: string, options: readonly string[]) =>
  options.find((o) => o.toLowerCase() === name.toLowerCase()) ??
  options
    .filter((o) => distance(o, name) <= 2)
    .sort((a, b) => distance(a, name) - distance(b, name))[0];

export function checkExpression(
  parsed: Parsed,
  scope: ExpressionScope,
): ExpressionError | undefined {
  if (!parsed.ok) return parsed.error;
  for (const call of parsed.calls) {
    if (!(HELPERS as readonly string[]).includes(call.name)) {
      const near = closest(call.name, HELPERS);
      return {
        message: near
          ? `${call.name}() doesn't exist. Did you mean ${near}()?`
          : `${call.name}() doesn't exist. Use ${list(HELPERS)}.`,
        at: call.start,
      };
    }
    const want = HELPER_ARGS[call.name as keyof typeof HELPER_ARGS];
    if (call.args !== want)
      return {
        message: `${call.name}() takes ${want} ${want === 1 ? "value" : "values"}`,
        at: call.start,
      };
  }
  for (const { path, start: at } of parsed.refs) {
    const [root, name, field] = path;
    if (!["env", "vars", "nodes", "run"].includes(root!))
      return {
        message: `${root} isn't available. Use env., vars., nodes. or run.`,
        at,
      };
    if (name === undefined)
      return {
        message: `Use ${root}.<${root === "nodes" ? "key" : root === "run" ? "field" : "name"}>`,
        at,
      };
    if (root === "env" && !scope.env.variables.includes(name))
      return { message: `${name} isn't a variable of ${scope.env.name}`, at };
    if (root === "vars" && !scope.vars.includes(name))
      return { message: `vars.${name} isn't set before this node`, at };
    if (root === "run" && !(RUN_FIELDS as readonly string[]).includes(name))
      return {
        message: `run.${name} doesn't exist. Use ${list(RUN_FIELDS)}`,
        at,
      };
    if (root === "nodes") {
      if (!scope.all.includes(name)) {
        const near = closest(name, scope.all);
        return {
          message: `No node with key "${name}"${near ? `. Did you mean ${near}?` : ""}`,
          at,
        };
      }
      if (scope.after.includes(name))
        return {
          message: `${name} runs after this node, so it has no result yet`,
          at,
        };
      if (!scope.before.includes(name))
        return {
          message: `${name} is on another branch, so it has no result here`,
          at,
        };
      if (
        field !== undefined &&
        !(NODE_FIELDS as readonly string[]).includes(field)
      )
        return {
          message: `nodes.${name}.${field} doesn't exist. Use ${list(NODE_FIELDS)}`,
          at,
        };
    }
  }
  return undefined;
}

/** Parse + check in one: the first problem, if any */
export const problemOf = (text: string, scope: ExpressionScope) =>
  checkExpression(parseExpression(text), scope);
