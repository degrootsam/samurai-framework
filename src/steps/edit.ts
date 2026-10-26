import ts from "typescript";
import { stepToSource } from "./emit.js";
import type { ParsedTest, Step, TestInput } from "./model.js";
import { parseSpec } from "./parse.js";
import { declareList } from "./test-options.js";
import { indentOf, lineEnd, lineStart, splice } from "./text.js";

export type StepEdit =
  | { op: "replace"; test: number; index: number; step: Step }
  /** `index` may equal the number of steps, to append */
  | { op: "insert"; test: number; index: number; step: Step }
  | { op: "remove"; test: number; index: number }
  /** Moves a step so it ends up at position `to` */
  | { op: "move"; test: number; from: number; to: number }
  /**
   * Removes the whole test, with the comments and the blank line above it. For several tests, apply from the last index to the first.
   * It removes all leading trivia from the end of the previous statement, so comments above the test go with it: a
   * file-header comment when the test is the first statement, and a trailing `// comment` on the previous test's line.
   * Throws for a test that isn't `removable`
   */
  | { op: "remove-test"; test: number }
  /**
   * Sets the test's `inputs` and `outputs` in its options object: a given list replaces that list, one left out
   * stays. When both end up empty the options object goes, unless it holds a `reason`
   */
  | {
      op: "declare";
      test: number;
      inputs?: TestInput[];
      outputs?: string[];
    };

function pickTest(source: string, test: number): ParsedTest {
  const found = parseSpec(source)[test];
  if (!found) throw new RangeError(`There is no test ${test} in this file`);
  return found;
}

function pickStep(parsed: ParsedTest, index: number) {
  const step = parsed.steps[index];
  if (!step) throw new RangeError(`Test "${parsed.name}" has no step ${index}`);
  return step;
}

/** Inserts statement text so it becomes step `index`, copying the indentation of the steps around it */
function insertCode(
  source: string,
  parsed: ParsedTest,
  index: number,
  code: string,
): string {
  if (index < 0 || index > parsed.steps.length) {
    throw new RangeError(
      `Cannot insert at step ${index}: test "${parsed.name}" has ${parsed.steps.length}`,
    );
  }
  const before = parsed.steps[index];
  if (before) {
    // Goes above the step's own comments, which belong to it
    const at = lineStart(source, before.anchor);
    return splice(source, at, at, `${indentOf(source, before.start)}${code}\n`);
  }
  const last = parsed.steps[parsed.steps.length - 1];
  if (last) {
    const indent = indentOf(source, last.start);
    const next = lineEnd(source, last.end);
    // After the last statement's line, so a trailing comment stays with it
    if (next <= parsed.bodyEnd && source[next - 1] === "\n")
      return splice(source, next, next, `${indent}${code}\n`);
    return splice(source, last.end, last.end, `\n${indent}${code}`);
  }

  // Empty body: indent one level deeper than the line that closes it
  const closing = indentOf(source, parsed.bodyEnd);
  const rest = source.slice(parsed.bodyStart, parsed.bodyEnd);
  const tail = rest.includes("\n") ? "" : `\n${closing}`;
  return splice(
    source,
    parsed.bodyStart,
    parsed.bodyStart,
    `\n${closing}  ${code}${tail}`,
  );
}

function removeStep(source: string, parsed: ParsedTest, index: number): string {
  const { anchor, end } = pickStep(parsed, index);
  return splice(source, lineStart(source, anchor), lineEnd(source, end), "");
}

const VALUE_FIXTURES = { env: "env", secret: "secrets", input: "inputs" };

/** The fixtures a step's statement reads */
function fixturesOf(step: Step): string[] {
  if (step.kind === "saveOutput") return ["outputs"];
  if (step.kind !== "fill" || step.value.kind === "literal") return [];
  return [VALUE_FIXTURES[step.value.kind]];
}

/** The output a step saves, if any */
function outputOf(step: Step): string | undefined {
  if (step.kind === "saveOutput") return step.name;
  return step.kind === "fill" || step.kind === "expect"
    ? step.output
    : undefined;
}

/** Refuses a step that reads an input the test doesn't declare: the default has to be set first */
function checkInputs(parsed: ParsedTest, step: Step) {
  if (step.kind !== "fill" || step.value.kind !== "input") return;
  const { name } = step.value;
  if (!parsed.inputs?.some((input) => input.name === name))
    throw new Error(`applyEdit(): input "${name}" is not declared`);
}

/** Adds the output a step saves to the test's `outputs`, when it isn't there yet */
function withOutput(source: string, parsed: ParsedTest, step: Step): string {
  const name = outputOf(step);
  const outputs = parsed.outputs ?? [];
  if (name === undefined || outputs.includes(name)) return source;
  return declareList(source, parsed, "outputs", [...outputs, name]);
}

/**
 * Puts a step's statement in at `[from, to)` of the body, then what it needs: its fixtures, its output and
 * the `generatedFile` import. Each goes before the last in the file, so the parsed offsets stay valid
 */
function withStep(
  source: string,
  parsed: ParsedTest,
  step: Step,
  place: (source: string, code: string) => string,
): string {
  checkInputs(parsed, step);
  const next = withOutput(
    withFixtures(place(source, stepToSource(step)), parsed, step),
    parsed,
    step,
  );
  // Last: the import shifts every offset
  return usesGeneratedFile(step) ? withGeneratedFileImport(next) : next;
}

/** Adds the fixtures the step reads to the test's parameters, when they aren't there yet */
function withFixtures(source: string, parsed: ParsedTest, step: Step): string {
  const { fixtures } = parsed;
  if (!fixtures) return source;
  const missing = fixturesOf(step).filter(
    (name) => !fixtures.names.includes(name),
  );
  if (missing.length === 0) return source;
  const list = missing.join(", ");
  const text =
    fixtures.shape === "list"
      ? `, ${list}`
      : fixtures.shape === "empty"
        ? ` ${list} `
        : `{ ${list} }`;
  return splice(source, fixtures.at, fixtures.at, text);
}

const usesGeneratedFile = (step: Step) =>
  (step.kind === "setInputFiles" || step.kind === "dropFiles") &&
  step.files.some((file) => "generate" in file);

const FRAMEWORK = "@itmetsam/samurai-framework";

/** Adds `generatedFile` to the framework import (or a new one) unless the file already imports it under its own name */
function withGeneratedFileImport(source: string): string {
  const file = ts.createSourceFile(
    "spec.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let frameworkImport: ts.NamedImports | undefined;
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== FRAMEWORK
    )
      continue;
    const named = statement.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    if (
      named.elements.some(
        (e) =>
          e.name.text === "generatedFile" &&
          (!e.propertyName || e.propertyName.text === e.name.text),
      )
    )
      return source;
    frameworkImport ??= named;
  }
  if (!frameworkImport || frameworkImport.elements.length === 0)
    return `import { generatedFile } from "${FRAMEWORK}";\n${source}`;
  const last = frameworkImport.elements[frameworkImport.elements.length - 1]!;
  return splice(source, last.end, last.end, ", generatedFile");
}

/**
 * Applies one edit and returns the new source. Only the touched statement changes, plus the test's parameters
 * when the step reads a fixture (`env`, `secrets`, `inputs`, `outputs`) they don't have yet, and its `outputs`
 * when the step saves one not declared yet: everything else, formatting and comments included, stays byte for
 * byte. A step that reads an undeclared input is refused: `declare` it, with its default, first.
 */
export function applyEdit(source: string, edit: StepEdit): string {
  const parsed = pickTest(source, edit.test);
  switch (edit.op) {
    case "replace": {
      const { start, end } = pickStep(parsed, edit.index);
      return withStep(source, parsed, edit.step, (text, code) =>
        splice(text, start, end, code),
      );
    }
    case "insert":
      return withStep(source, parsed, edit.step, (text, code) =>
        insertCode(text, parsed, edit.index, code),
      );
    case "declare": {
      let next = source;
      for (const key of ["inputs", "outputs"] as const) {
        const list = edit[key];
        if (list)
          next = declareList(next, pickTest(next, edit.test), key, list);
      }
      return next;
    }
    case "remove":
      return removeStep(source, parsed, edit.index);
    case "remove-test":
      if (!parsed.removable)
        throw new Error(
          `Cannot remove test "${parsed.name}": it is not a statement of its own`,
        );
      return splice(source, parsed.start, parsed.end, "");
    case "move": {
      const { start, end } = pickStep(parsed, edit.from);
      if (edit.to < 0 || edit.to >= parsed.steps.length)
        throw new RangeError(`Cannot move to step ${edit.to}`);
      if (edit.to === edit.from) return source;
      const code = source.slice(start, end);
      const removed = removeStep(source, parsed, edit.from);
      return insertCode(removed, pickTest(removed, edit.test), edit.to, code);
    }
  }
}
