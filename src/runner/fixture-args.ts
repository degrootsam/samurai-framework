/** What a function asks for in the destructuring of its first parameter */
export type Requested =
  | { kind: "names"; names: string[]; rest: boolean }
  /** No destructuring pattern: the function takes the fixtures object whole, or none */
  | { kind: "opaque" };

const OPAQUE: Requested = { kind: "opaque" };

/** Where the `}` or `)` that closes the bracket at `from` is, skipping strings; -1 when there is none */
function closing(text: string, from: number): number {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      i = endOfString(text, i);
      if (i < 0) return -1;
    } else if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function endOfString(text: string, from: number): number {
  const quote = text[from];
  for (let i = from + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === quote) return i;
  }
  return -1;
}

/** Splits at the commas that sit outside brackets and strings */
function topLevelParts(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      const end = endOfString(text, i);
      if (end < 0) break;
      i = end;
    } else if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

/** The property a destructuring entry reads: `a`, `a: b`, `a = 1`, `"a-b": c`; undefined for a computed key */
function keyOf(entry: string): string | undefined {
  const quoted = /^(["'])(.*?)\1/.exec(entry);
  if (quoted) return quoted[2];
  return /^[\w$]+/.exec(entry)?.[0];
}

/**
 * The fixture names a function destructures from its first parameter (`async ({ page, user }) => ...`), read
 * from its source. A `...rest` entry asks for everything.
 */
export function requestedBy(fn: (...args: never[]) => unknown): Requested {
  const text = Function.prototype.toString.call(fn);
  if (/^(async\s+)?[\w$]+\s*=>/.test(text)) return OPAQUE;
  const open = text.indexOf("(");
  if (open < 0) return OPAQUE;
  let at = open + 1;
  while (/\s/.test(text[at] ?? "")) at++;
  if (text[at] === ")") return { kind: "names", names: [], rest: false };
  if (text[at] !== "{") return OPAQUE;
  const end = closing(text, at);
  if (end < 0) return OPAQUE;
  const names: string[] = [];
  let rest = false;
  for (const entry of topLevelParts(text.slice(at + 1, end))) {
    const key = entry.startsWith("...") ? undefined : keyOf(entry);
    if (key === undefined) rest = true;
    else names.push(key);
  }
  return { kind: "names", names, rest };
}
