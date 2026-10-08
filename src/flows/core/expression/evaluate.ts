import { parseExpression, type Expr } from "./parse.js";

export interface ExpressionContext {
  env: Record<string, unknown>;
  vars: Record<string, unknown>;
  nodes: Record<
    string,
    { status: string; durationMs?: number; error?: string }
  >;
  run: { environment: string; trigger: string; startedAt: string };
}

export const HELPERS = [
  "contains",
  "startsWith",
  "matches",
  "len",
  "exists",
] as const;
export const HELPER_ARGS: Record<(typeof HELPERS)[number], number> = {
  contains: 2,
  startsWith: 2,
  matches: 2,
  len: 1,
  exists: 1,
};

export class EvaluationError extends Error {}

const ROOTS = ["env", "vars", "nodes", "run"] as const;

/** Own, plain values only: nothing from prototypes, nothing named like an internal */
function read(object: unknown, key: unknown): unknown {
  if (object === null || typeof object !== "object") return undefined;
  const name = String(key);
  if (name.startsWith("__") || name === "constructor" || name === "prototype")
    return undefined;
  if (Array.isArray(object))
    return /^\d+$/.test(name) ? object[Number(name)] : undefined;
  return Object.prototype.hasOwnProperty.call(object, name)
    ? (object as Record<string, unknown>)[name]
    : undefined;
}

const typeName = (v: unknown) =>
  v === null ? "null" : Array.isArray(v) ? "a list" : typeof v;

function arithmetic(op: string, l: unknown, r: unknown): number | string {
  if (op === "+" && (typeof l === "string" || typeof r === "string")) {
    const ok = (v: unknown) => typeof v === "string" || typeof v === "number";
    if (ok(l) && ok(r)) return String(l) + String(r);
  }
  if (typeof l !== "number" || typeof r !== "number")
    throw new EvaluationError(
      `Can't use ${op} on ${typeName(typeof l !== "number" ? l : r)}`,
    );
  switch (op) {
    case "+":
      return l + r;
    case "-":
      return l - r;
    case "*":
      return l * r;
    case "/":
      return l / r;
    default:
      return l % r;
  }
}

function compare(op: string, l: unknown, r: unknown): boolean {
  const same =
    (typeof l === "number" && typeof r === "number") ||
    (typeof l === "string" && typeof r === "string");
  if (!same) return false;
  const a = l as number | string;
  const b = r as number | string;
  return op === "<"
    ? a < b
    : op === "<="
      ? a <= b
      : op === ">"
        ? a > b
        : a >= b;
}

function makeRegExp(pattern: string, flags?: string): RegExp {
  try {
    return new RegExp(pattern, flags);
  } catch (e) {
    throw new EvaluationError(
      `Invalid pattern: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

const helpers = {
  contains: (x: unknown, y: unknown) =>
    typeof x === "string"
      ? typeof y === "string" && x.includes(y)
      : Array.isArray(x) && x.includes(y),
  startsWith: (s: unknown, p: unknown) =>
    typeof s === "string" && typeof p === "string" && s.startsWith(p),
  matches: (s: unknown, re: unknown) =>
    typeof s === "string" &&
    (re instanceof RegExp
      ? re.test(s)
      : typeof re === "string" && makeRegExp(re).test(s)),
  len: (x: unknown) =>
    typeof x === "string" || Array.isArray(x)
      ? x.length
      : x && typeof x === "object"
        ? Object.keys(x).length
        : 0,
  exists: (x: unknown) => x !== undefined && x !== null,
};

export function evaluate(expr: Expr, context: ExpressionContext): unknown {
  const go = (e: Expr): unknown => {
    switch (e.type) {
      case "literal":
        return e.value;
      case "regex":
        return makeRegExp(e.pattern, e.flags);
      case "name":
        if (!(ROOTS as readonly string[]).includes(e.name))
          throw new EvaluationError(
            `${e.name} isn't available. Use env., vars., nodes. or run.`,
          );
        return context[e.name as (typeof ROOTS)[number]];
      case "member":
        return read(
          go(e.object),
          typeof e.property === "string" ? e.property : go(e.property),
        );
      case "unary":
        return e.op === "!" ? !go(e.arg) : arithmetic("-", 0, go(e.arg));
      case "binary": {
        if (e.op === "&&") return go(e.left) ? Boolean(go(e.right)) : false;
        if (e.op === "||") return go(e.left) ? true : Boolean(go(e.right));
        const l = go(e.left);
        const r = go(e.right);
        if (e.op === "==") return l === r;
        if (e.op === "!=") return l !== r;
        if (["<", "<=", ">", ">="].includes(e.op)) return compare(e.op, l, r);
        return arithmetic(e.op, l, r);
      }
      case "call": {
        const fn = Object.prototype.hasOwnProperty.call(helpers, e.callee)
          ? helpers[e.callee as keyof typeof helpers]
          : undefined;
        if (!fn) throw new EvaluationError(`${e.callee}() doesn't exist`);
        return (fn as (...a: unknown[]) => unknown)(...e.args.map(go));
      }
    }
  };
  return go(expr);
}

/** Parses and evaluates; a syntax error throws an EvaluationError with the parser's message */
export function evaluateText(
  text: string,
  context: ExpressionContext,
): unknown {
  const parsed = parseExpression(text);
  if (!parsed.ok) throw new EvaluationError(parsed.error.message);
  return evaluate(parsed.expr, context);
}
