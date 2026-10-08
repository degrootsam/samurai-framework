export type BinaryOp =
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "&&"
  | "||"
  | "+"
  | "-"
  | "*"
  | "/"
  | "%";

export type Expr =
  | { type: "literal"; value: string | number | boolean | null; start: number }
  | { type: "regex"; pattern: string; flags: string; start: number }
  | { type: "name"; name: string; start: number }
  | { type: "member"; object: Expr; property: string | Expr; start: number }
  | { type: "unary"; op: "!" | "-"; arg: Expr; start: number }
  | { type: "binary"; op: BinaryOp; left: Expr; right: Expr; start: number }
  | { type: "call"; callee: string; args: Expr[]; start: number };

/** A name chain with static parts: nodes.login.status → ["nodes", "login", "status"] */
export interface Reference {
  path: string[];
  start: number;
}
export interface CallRef {
  name: string;
  args: number;
  start: number;
}
export interface ExpressionError {
  message: string;
  at: number;
}
export type Parsed =
  | { ok: true; expr: Expr; refs: Reference[]; calls: CallRef[] }
  | { ok: false; error: ExpressionError };

type Token =
  | { kind: "num"; value: number; start: number; end: number }
  | { kind: "str"; value: string; start: number; end: number }
  | {
      kind: "regex";
      pattern: string;
      flags: string;
      start: number;
      end: number;
    }
  | { kind: "ident"; value: string; start: number; end: number }
  | { kind: "punct"; value: string; start: number; end: number }
  | { kind: "end"; start: number; end: number };

class Fail extends Error {
  constructor(
    message: string,
    public at: number,
  ) {
    super(message);
  }
}

const PUNCT = [
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "<",
  ">",
  "!",
  "+",
  "-",
  "*",
  "/",
  "%",
  "(",
  ")",
  "[",
  "]",
  ".",
  ",",
];

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  // A "/" starts a regex only where a value is expected: after "(" or ","
  const valueExpected = () => {
    const last = tokens[tokens.length - 1];
    return last?.kind === "punct" && (last.value === "(" || last.value === ",");
  };
  while (i < text.length) {
    const c = text[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const start = i;
    if (/[0-9]/.test(c)) {
      while (/[0-9]/.test(text[i] ?? "")) i++;
      if (text[i] === "." && /[0-9]/.test(text[i + 1] ?? "")) {
        i++;
        while (/[0-9]/.test(text[i] ?? "")) i++;
      }
      if (text[i] === ".") throw new Fail("Invalid number", start);
      tokens.push({
        kind: "num",
        value: Number(text.slice(start, i)),
        start,
        end: i,
      });
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      while (/[\w$]/.test(text[i] ?? "")) i++;
      tokens.push({
        kind: "ident",
        value: text.slice(start, i),
        start,
        end: i,
      });
      continue;
    }
    if (c === '"' || c === "'") {
      let value = "";
      i++;
      while (i < text.length && text[i] !== c) {
        if (text[i] === "\\" && i + 1 < text.length) i++;
        value += text[i++];
      }
      if (i >= text.length) throw new Fail("Missing closing quote", start);
      i++;
      tokens.push({ kind: "str", value, start, end: i });
      continue;
    }
    if (c === "/" && valueExpected()) {
      i++;
      let pattern = "";
      while (i < text.length && text[i] !== "/") {
        if (text[i] === "\\" && i + 1 < text.length) pattern += text[i++];
        pattern += text[i++];
      }
      if (i >= text.length) throw new Fail("Missing closing /", start);
      i++;
      let flags = "";
      while (/[gimsuy]/.test(text[i] ?? "")) flags += text[i++];
      tokens.push({ kind: "regex", pattern, flags, start, end: i });
      continue;
    }
    if (c === "=" && text[i + 1] !== "=")
      throw new Fail("Use == to compare", start);
    const p = PUNCT.find((x) => text.startsWith(x, i));
    if (!p) throw new Fail(`Unexpected "${c}"`, start);
    i += p.length;
    tokens.push({ kind: "punct", value: p, start, end: i });
  }
  tokens.push({ kind: "end", start: text.length, end: text.length });
  return tokens;
}

const BINARY: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  "<": 4,
  "<=": 4,
  ">": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
};

function parser(text: string, tokens: Token[]) {
  let pos = 0;
  const peek = () => tokens[pos]!;
  const next = () => tokens[pos++]!;
  const isPunct = (v: string) =>
    peek().kind === "punct" && (peek() as { value: string }).value === v;
  const show = (t: Token) =>
    t.kind === "end" ? "the end" : `"${text.slice(t.start, t.end)}"`;

  function expect(v: string, after: Expr) {
    if (!isPunct(v)) {
      const shown = text.slice(after.start, peek().start).trim();
      throw new Fail(`Expected "${v}" after "${shown}"`, peek().start);
    }
    next();
  }

  function primary(): Expr {
    const t = next();
    switch (t.kind) {
      case "num":
        return { type: "literal", value: t.value, start: t.start };
      case "str":
        return { type: "literal", value: t.value, start: t.start };
      case "regex":
        return {
          type: "regex",
          pattern: t.pattern,
          flags: t.flags,
          start: t.start,
        };
      case "ident": {
        if (t.value === "true" || t.value === "false")
          return { type: "literal", value: t.value === "true", start: t.start };
        if (t.value === "null")
          return { type: "literal", value: null, start: t.start };
        if (isPunct("(")) {
          next();
          const args: Expr[] = [];
          if (!isPunct(")")) {
            do args.push(expression(0));
            while (isPunct(",") && next());
          }
          const call: Expr = {
            type: "call",
            callee: t.value,
            args,
            start: t.start,
          };
          expect(")", call);
          return call;
        }
        return { type: "name", name: t.value, start: t.start };
      }
      case "punct":
        if (t.value === "(") {
          const inner = expression(0);
          expect(")", { ...inner, start: t.start + 1 });
          return inner;
        }
        if (t.value === "!" || t.value === "-")
          return {
            type: "unary",
            op: t.value,
            arg: postfix(primary()),
            start: t.start,
          };
        throw new Fail(`Unexpected ${show(t)}`, t.start);
      case "end":
        throw new Fail(
          pos === 1 ? "Write an expression" : "The expression ends too early",
          t.start,
        );
    }
  }

  function postfix(expr: Expr): Expr {
    for (;;) {
      if (isPunct(".")) {
        next();
        const name = next();
        if (name.kind !== "ident")
          throw new Fail(`Expected a name after "."`, name.start);
        expr = {
          type: "member",
          object: expr,
          property: name.value,
          start: expr.start,
        };
      } else if (isPunct("[")) {
        next();
        const property = expression(0);
        expect("]", property);
        expr = { type: "member", object: expr, property, start: expr.start };
      } else if (isPunct("(")) {
        throw new Fail(
          "Only helpers can be called, like contains(x, y)",
          expr.start,
        );
      } else return expr;
    }
  }

  function expression(min: number): Expr {
    let left = postfix(primary());
    for (;;) {
      const t = peek();
      const prec = t.kind === "punct" ? BINARY[t.value] : undefined;
      if (prec === undefined || prec <= min) {
        if (
          min === 0 &&
          t.kind !== "end" &&
          !(t.kind === "punct" && [")", "]", ","].includes(t.value))
        )
          throw new Fail(`Unexpected ${show(t)}`, t.start);
        return left;
      }
      next();
      const right = expression(prec);
      left = {
        type: "binary",
        op: (t as { value: string }).value as BinaryOp,
        left,
        right,
        start: left.start,
      };
    }
  }

  return { expression, peek };
}

/** A member chain with only static parts, as a path; undefined otherwise */
function chainOf(e: Expr): Reference | undefined {
  if (e.type === "name") return { path: [e.name], start: e.start };
  if (e.type !== "member") return undefined;
  const inner = chainOf(e.object);
  if (!inner) return undefined;
  const prop =
    typeof e.property === "string"
      ? e.property
      : e.property.type === "literal" &&
          (typeof e.property.value === "string" ||
            typeof e.property.value === "number")
        ? String(e.property.value)
        : undefined;
  return prop === undefined
    ? undefined
    : { path: [...inner.path, prop], start: inner.start };
}

function collect(e: Expr, refs: Reference[], calls: CallRef[]) {
  switch (e.type) {
    case "name":
      refs.push({ path: [e.name], start: e.start });
      return;
    case "member": {
      const chain = chainOf(e);
      if (chain) refs.push(chain);
      else {
        collect(e.object, refs, calls);
        if (typeof e.property !== "string") collect(e.property, refs, calls);
      }
      return;
    }
    case "unary":
      return collect(e.arg, refs, calls);
    case "binary":
      collect(e.left, refs, calls);
      return collect(e.right, refs, calls);
    case "call":
      calls.push({ name: e.callee, args: e.args.length, start: e.start });
      for (const a of e.args) collect(a, refs, calls);
      return;
  }
}

/** Parses an expression into its syntax tree, the references it reads and the helpers it calls */
export function parseExpression(text: string): Parsed {
  try {
    const tokens = tokenize(text);
    const { expression, peek } = parser(text, tokens);
    const expr = expression(0);
    if (peek().kind !== "end")
      throw new Fail(
        `Unexpected "${text.slice(peek().start, peek().end)}"`,
        peek().start,
      );
    const refs: Reference[] = [];
    const calls: CallRef[] = [];
    collect(expr, refs, calls);
    return { ok: true, expr, refs, calls };
  } catch (e) {
    if (e instanceof Fail)
      return { ok: false, error: { message: e.message, at: e.at } };
    throw e;
  }
}
