import ts from "typescript";

export type ConfigValue =
  string | number | boolean | ConfigValue[] | { [key: string]: ConfigValue };

/** The config can't be edited in place, e.g. it builds its object from variables or spreads */
export class ConfigEditError extends Error {}

const KEY = /^[A-Za-z_$][\w$]*$/;
const keyText = (key: string) => (KEY.test(key) ? key : JSON.stringify(key));

function emit(value: ConfigValue, indent: string, unit: string): string {
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const inner = indent + unit;
    return `[\n${value.map((v) => `${inner}${emit(v, inner, unit)},`).join("\n")}\n${indent}]`;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return "{}";
  const inner = indent + unit;
  return `{\n${entries
    .map(([k, v]) => `${inner}${keyText(k)}: ${emit(v, inner, unit)},`)
    .join("\n")}\n${indent}}`;
}

function nameOf(prop: ts.ObjectLiteralElementLike): string | undefined {
  if (
    !ts.isPropertyAssignment(prop) &&
    !ts.isShorthandPropertyAssignment(prop)
  ) {
    return undefined;
  }
  const n = prop.name;
  return ts.isIdentifier(n) ||
    ts.isStringLiteral(n) ||
    ts.isNoSubstitutionTemplateLiteral(n)
    ? n.text
    : undefined;
}

/** The object `defineConfig({...})` or `export default {...}` is given */
function rootObject(sf: ts.SourceFile): ts.ObjectLiteralExpression {
  for (const statement of sf.statements) {
    if (!ts.isExportAssignment(statement)) continue;
    let node: ts.Expression = statement.expression;
    for (;;) {
      if (
        ts.isParenthesizedExpression(node) ||
        ts.isSatisfiesExpression(node) ||
        ts.isAsExpression(node)
      ) {
        node = node.expression;
      } else break;
    }
    if (
      ts.isCallExpression(node) &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      return node.arguments[0];
    }
    if (ts.isObjectLiteralExpression(node)) return node;
  }
  throw new ConfigEditError(
    "samurai.config.ts doesn't export a plain object (defineConfig({ … })), so it can't be edited here.",
  );
}

const lineIndent = (source: string, pos: number) => {
  const start = source.lastIndexOf("\n", pos - 1) + 1;
  return /^[ \t]*/.exec(source.slice(start))![0];
};

interface Splice {
  start: number;
  end: number;
  text: string;
}

function unitOf(source: string, obj: ts.ObjectLiteralExpression) {
  const first = obj.properties[0];
  if (first) {
    const inner = lineIndent(source, first.getStart());
    const outer = lineIndent(source, obj.getStart());
    if (inner.length > outer.length) return inner.slice(outer.length);
  }
  return "  ";
}

function insertProperty(
  source: string,
  obj: ts.ObjectLiteralExpression,
  key: string,
  value: ConfigValue,
): Splice {
  const unit = unitOf(source, obj);
  const outer = lineIndent(source, obj.getStart());
  const inner = outer + unit;
  const multiline = obj.getText().includes("\n");
  const prop = `${keyText(key)}: ${emit(value, inner, unit)}`;
  const last = obj.properties[obj.properties.length - 1];

  if (!last) {
    return {
      start: obj.getStart(),
      end: obj.end,
      text: `{\n${inner}${prop},\n${outer}}`,
    };
  }
  const trailing = obj.properties.hasTrailingComma
    ? /^\s*,/.exec(source.slice(last.end))
    : null;
  if (!multiline) {
    return trailing
      ? {
          start: last.end + trailing[0].length,
          end: last.end + trailing[0].length,
          text: ` ${keyText(key)}: ${emit(value, outer, unit)},`,
        }
      : {
          start: last.end,
          end: last.end,
          text: `, ${keyText(key)}: ${emit(value, outer, unit)}`,
        };
  }
  return trailing
    ? {
        start: last.end + trailing[0].length,
        end: last.end + trailing[0].length,
        text: `\n${inner}${prop},`,
      }
    : { start: last.end, end: last.end, text: `,\n${inner}${prop}` };
}

function removeProperty(
  source: string,
  prop: ts.ObjectLiteralElementLike,
): Splice {
  const s = prop.getStart();
  let e = prop.end;
  const comma = /^[ \t]*,/.exec(source.slice(e));
  if (comma) e += comma[0].length;
  const lineStart = source.lastIndexOf("\n", s - 1) + 1;
  const aloneBefore = /^[ \t]*$/.test(source.slice(lineStart, s));
  const rest = /^[ \t]*(\r?\n)/.exec(source.slice(e));
  if (aloneBefore && rest)
    return { start: lineStart, end: e + rest[0].length, text: "" };
  const space = /^[ \t]*/.exec(source.slice(e))![0];
  return { start: s, end: e + space.length, text: "" };
}

/**
 * Sets (or with `undefined`, removes) one value in samurai.config.ts, addressed by its path, e.g.
 * ["environments", "staging", "baseURL"]. Only that property's text changes; missing objects on the way are
 * created. Throws ConfigEditError when the file isn't shaped so that this is safe.
 */
export function editConfig(
  source: string,
  path: string[],
  value: ConfigValue | undefined,
): string {
  if (path.length === 0) throw new ConfigEditError("No setting given.");
  const sf = ts.createSourceFile(
    "samurai.config.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  let obj = rootObject(sf);

  for (let i = 0; i < path.length; i++) {
    const key = path[i];
    const prop = obj.properties.find((p) => nameOf(p) === key);
    const isLast = i === path.length - 1;

    if (prop && !ts.isPropertyAssignment(prop)) {
      throw new ConfigEditError(
        `"${key}" in samurai.config.ts isn't a plain value (shorthand or spread), so it can't be edited here.`,
      );
    }

    if (isLast) {
      let splice: Splice;
      if (value === undefined) {
        if (!prop) return source;
        splice = removeProperty(source, prop);
      } else if (prop && ts.isPropertyAssignment(prop)) {
        const init = prop.initializer;
        const unit = unitOf(source, obj);
        splice = {
          start: init.getStart(),
          end: init.end,
          text: emit(value, lineIndent(source, prop.getStart()), unit),
        };
      } else {
        splice = insertProperty(source, obj, key, value);
      }
      return (
        source.slice(0, splice.start) + splice.text + source.slice(splice.end)
      );
    }

    if (!prop) {
      if (value === undefined) return source;
      // Build the rest of the path as one nested object and add it here
      let nested: ConfigValue = value;
      for (let j = path.length - 1; j > i; j--) nested = { [path[j]]: nested };
      const splice = insertProperty(source, obj, key, nested);
      return (
        source.slice(0, splice.start) + splice.text + source.slice(splice.end)
      );
    }

    if (!ts.isObjectLiteralExpression(prop.initializer)) {
      throw new ConfigEditError(
        `"${key}" in samurai.config.ts isn't a plain object, so it can't be edited here.`,
      );
    }
    obj = prop.initializer;
  }
  return source;
}

/** The text of one property (`staging: { … }`), indentation removed, for showing a part of the file; undefined when missing */
export function propertyText(
  source: string,
  path: string[],
): string | undefined {
  const sf = ts.createSourceFile(
    "samurai.config.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  let obj: ts.ObjectLiteralExpression;
  try {
    obj = rootObject(sf);
  } catch {
    return undefined;
  }
  for (let i = 0; i < path.length; i++) {
    const prop = obj.properties.find((p) => nameOf(p) === path[i]);
    if (!prop) return undefined;
    if (i === path.length - 1) {
      const indent = lineIndent(source, prop.getStart());
      return prop
        .getText()
        .split("\n")
        .map((line, n) =>
          n === 0
            ? line
            : line.startsWith(indent)
              ? line.slice(indent.length)
              : line.trimStart(),
        )
        .join("\n");
    }
    if (
      !ts.isPropertyAssignment(prop) ||
      !ts.isObjectLiteralExpression(prop.initializer)
    )
      return undefined;
    obj = prop.initializer;
  }
  return undefined;
}

/** Whether the property at this path exists in the file's source, walking the same object literals `editConfig` does */
export function hasConfigPath(source: string, path: string[]): boolean {
  return propertyText(source, path) !== undefined;
}
