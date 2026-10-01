import { stepToSource } from "./emit.js";
import type { ParsedTest, Step } from "./model.js";
import { parseSpec } from "./parse.js";

export type StepEdit =
  | { op: "replace"; test: number; index: number; step: Step }
  /** `index` may equal the number of steps, to append */
  | { op: "insert"; test: number; index: number; step: Step }
  | { op: "remove"; test: number; index: number }
  /** Moves a step so it ends up at position `to` */
  | { op: "move"; test: number; from: number; to: number };

const lineStart = (source: string, offset: number) =>
  source.lastIndexOf("\n", offset - 1) + 1;

function lineEnd(source: string, offset: number): number {
  const newline = source.indexOf("\n", offset);
  return newline === -1 ? source.length : newline + 1;
}

const indentOf = (source: string, offset: number) =>
  /^[ \t]*/.exec(source.slice(lineStart(source, offset)))![0];

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

function splice(
  source: string,
  from: number,
  to: number,
  text: string,
): string {
  return source.slice(0, from) + text + source.slice(to);
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

/**
 * Applies one edit and returns the new source. Only the touched statement changes: everything else,
 * formatting and comments included, stays byte for byte.
 */
export function applyEdit(source: string, edit: StepEdit): string {
  const parsed = pickTest(source, edit.test);
  switch (edit.op) {
    case "replace": {
      const { start, end } = pickStep(parsed, edit.index);
      return splice(source, start, end, stepToSource(edit.step));
    }
    case "insert":
      return insertCode(source, parsed, edit.index, stepToSource(edit.step));
    case "remove":
      return removeStep(source, parsed, edit.index);
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
