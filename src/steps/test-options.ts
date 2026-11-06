import ts from "typescript";
import { isIoName } from "../flows/core/steps.js";
import type { Modifier, TestAnnotation } from "../types/test.js";
import { IDENTIFIER } from "./emit.js";
import type { ParsedTest, TestInput } from "./model.js";
import { stringOf } from "./parse/literals.js";
import { indentOf, splice } from "./text.js";

/** What a `test()` or `describe()` options object says, as far as the codec reads it */
export interface TestOptionsRead {
  reason?: string;
  inputs?: TestInput[];
  outputs?: string[];
  annotations?: TestAnnotation[];
}

type ListKey = "inputs" | "outputs" | "annotations";
type ListValue = TestInput[] | string[] | TestAnnotation[];

function keyOf(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name)
    ? name.text
    : undefined;
}

/** `{ name: "default", … }`; undefined for anything but string literals under plain keys */
function readInputs(node: ts.Expression): TestInput[] | undefined {
  if (!ts.isObjectLiteralExpression(node)) return undefined;
  const inputs: TestInput[] = [];
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) return undefined;
    const name = keyOf(property.name);
    const value = stringOf(property.initializer);
    if (name === undefined || value === undefined) return undefined;
    inputs.push({ name, default: value });
  }
  return inputs;
}

/** `["name", …]`; undefined for anything but string literals */
function readOutputs(node: ts.Expression): string[] | undefined {
  if (!ts.isArrayLiteralExpression(node)) return undefined;
  const names = node.elements.map(stringOf);
  return names.every((name) => name !== undefined)
    ? (names as string[])
    : undefined;
}

/** `[{ type: "plan", description: "…" }, …]`; undefined for anything but string literals under those two keys */
function readAnnotations(node: ts.Expression): TestAnnotation[] | undefined {
  if (!ts.isArrayLiteralExpression(node)) return undefined;
  const notes: TestAnnotation[] = [];
  for (const element of node.elements) {
    if (!ts.isObjectLiteralExpression(element)) return undefined;
    const note: Partial<TestAnnotation> = {};
    for (const property of element.properties) {
      if (!ts.isPropertyAssignment(property)) return undefined;
      const key = keyOf(property.name);
      const value = stringOf(property.initializer);
      if (value === undefined) return undefined;
      if (key === "type") note.type = value;
      else if (key === "description") note.description = value;
      else return undefined;
    }
    if (note.type === undefined || note.type === "") return undefined;
    notes.push(note as TestAnnotation);
  }
  return notes;
}

/**
 * The options object of a test or describe call: a describe takes only `reason`, a test also `inputs` and
 * `outputs`. Undefined when the object isn't a literal the codec can read, so the call is left unparsed. An
 * empty list is left out, as the runtime leaves it out. A `reason` counts only for skip and fixme, and one that
 * isn't a string literal is passed over, as before
 */
export function readTestOptions(
  node: ts.Expression,
  kind: "test" | "describe",
  modifier: Modifier | undefined,
): TestOptionsRead | undefined {
  if (!ts.isObjectLiteralExpression(node)) return undefined;
  const read: TestOptionsRead = {};
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) return undefined;
    const key = keyOf(property.name);
    const value = property.initializer;
    if (key === "reason") {
      const reason = stringOf(value);
      if (reason !== undefined && (modifier === "skip" || modifier === "fixme"))
        read.reason = reason;
    } else if (kind === "test" && key === "inputs") {
      const inputs = readInputs(value);
      if (!inputs) return undefined;
      if (inputs.length > 0) read.inputs = inputs;
    } else if (kind === "test" && key === "outputs") {
      const outputs = readOutputs(value);
      if (!outputs) return undefined;
      if (outputs.length > 0) read.outputs = outputs;
    } else if (kind === "test" && key === "annotations") {
      const annotations = readAnnotations(value);
      if (!annotations) return undefined;
      if (annotations.length > 0) read.annotations = annotations;
    } else return undefined;
  }
  return read;
}

const str = (value: string) => JSON.stringify(value);

function annotationToSource(note: TestAnnotation): string {
  return note.description === undefined
    ? `{ type: ${str(note.type)} }`
    : `{ type: ${str(note.type)}, description: ${str(note.description)} }`;
}

function listToSource(key: ListKey, list: ListValue): string {
  if (key === "annotations")
    return `[${(list as TestAnnotation[]).map(annotationToSource).join(", ")}]`;
  if (key === "outputs") return `[${(list as string[]).map(str).join(", ")}]`;
  const entries = (list as TestInput[]).map(
    ({ name, default: value }) =>
      `${IDENTIFIER.test(name) ? name : str(name)}: ${str(value)}`,
  );
  return `{ ${entries.join(", ")} }`;
}

const sameList = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Throws for a list the runtime's `test()` would reject: a name that isn't valid, a name twice, a default that isn't text */
function checkList(key: ListKey, list: ListValue): void {
  if (key === "annotations") {
    for (const note of list as TestAnnotation[])
      if (typeof note.type !== "string" || note.type === "")
        throw new Error(`applyEdit(): an annotation needs a non-empty type`);
    return;
  }
  const kind = key === "inputs" ? "input" : "output";
  const seen = new Set<string>();
  for (const entry of list as (TestInput | string)[]) {
    const name = typeof entry === "string" ? entry : entry.name;
    if (!isIoName(name))
      throw new Error(
        `applyEdit(): ${kind} ${JSON.stringify(name)} is not a valid name`,
      );
    if (seen.has(name))
      throw new Error(`applyEdit(): ${kind} "${name}" is listed twice`);
    seen.add(name);
    if (typeof entry !== "string" && typeof entry.default !== "string")
      throw new Error(`applyEdit(): input "${name}" needs a string default`);
  }
}

/** The options object at `range`, parsed on its own, with offsets mapped back into the source */
function optionsObject(source: string, range: { start: number; end: number }) {
  const file = ts.createSourceFile(
    "options.ts",
    `(${source.slice(range.start, range.end)})`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const statement = file.statements[0] as ts.ExpressionStatement;
  const object = (statement.expression as ts.ParenthesizedExpression)
    .expression as ts.ObjectLiteralExpression;
  const at = (offset: number) => offset - 1 + range.start;
  return object.properties.map((property) => {
    const assignment = property as ts.PropertyAssignment;
    return {
      key: keyOf(assignment.name),
      start: at(assignment.getStart(file)),
      end: at(assignment.end),
      valueStart: at(assignment.initializer.getStart(file)),
      emptyList:
        (ts.isObjectLiteralExpression(assignment.initializer) &&
          assignment.initializer.properties.length === 0) ||
        (ts.isArrayLiteralExpression(assignment.initializer) &&
          assignment.initializer.elements.length === 0),
    };
  });
}

/**
 * Sets one list of the test's options object: replaces it, adds it (making the object when there is none) or,
 * for an empty list, removes it, and the whole object when nothing but empty lists would be left. The rest of
 * the object, its layout and a `reason`, stays as it is; an unchanged list leaves the source as it is. Throws for
 * names the runtime rejects, before writing
 */
export function declareList(
  source: string,
  parsed: ParsedTest,
  key: ListKey,
  list: ListValue,
): string {
  checkList(key, list);
  if (list.length > 0 && sameList(parsed[key], list)) return source;
  const text = `${key}: ${listToSource(key, list)}`;
  if (!parsed.options)
    return list.length === 0
      ? source
      : splice(source, parsed.titleEnd, parsed.titleEnd, `, { ${text} }`);
  const properties = optionsObject(source, parsed.options);
  const index = properties.findIndex((property) => property.key === key);
  const property = properties[index];
  if (list.length === 0) {
    // An empty list that is there still goes (the parse leaves it out), so an object of only empty lists is removed
    if (!property) return source;
    const others = properties.filter((_, i) => i !== index);
    if (others.every((other) => other.emptyList))
      return splice(source, parsed.titleEnd, parsed.options.end, "");
    return index > 0
      ? splice(source, properties[index - 1]!.end, property!.end, "")
      : splice(source, property!.start, properties[1]!.start, "");
  }
  if (property)
    return splice(
      source,
      property.valueStart,
      property.end,
      listToSource(key, list),
    );
  const last = properties[properties.length - 1];
  if (!last)
    return splice(
      source,
      parsed.options.start,
      parsed.options.end,
      `{ ${text} }`,
    );
  const multiline = source
    .slice(parsed.options.start, properties[0]!.start)
    .includes("\n");
  const separator = multiline ? `\n${indentOf(source, last.start)}` : " ";
  return splice(source, last.end, last.end, `,${separator}${text}`);
}
