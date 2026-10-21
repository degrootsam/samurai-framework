import ts from "typescript";
import type { Modifier } from "../types/test.js";
import type { ParsedStep, ParsedTest } from "./model.js";
import { readObject, stringOf } from "./parse/literals.js";
import { readStep } from "./parse/step.js";

function parseStatement(
  source: string,
  statement: ts.Statement,
  sourceFile: ts.SourceFile,
): ParsedStep {
  const start = statement.getStart(sourceFile);
  const end = statement.end;
  const comments = ts.getLeadingCommentRanges(source, statement.getFullStart());
  return {
    step: readStep(statement) ?? {
      kind: "custom",
      code: source.slice(start, end),
    },
    start,
    end,
    anchor: comments?.[0]?.pos ?? start,
  };
}

function callbackFixtures(
  callback: ts.ArrowFunction | ts.FunctionExpression,
  sourceFile: ts.SourceFile,
): ParsedTest["fixtures"] {
  const [first] = callback.parameters;
  if (!first) {
    const open = callback
      .getChildren(sourceFile)
      .find((child) => child.kind === ts.SyntaxKind.OpenParenToken);
    return open ? { names: [], at: open.end, shape: "none" } : undefined;
  }
  const pattern = first.name;
  if (!ts.isObjectBindingPattern(pattern)) return undefined;
  if (pattern.elements.some((element) => element.dotDotDotToken))
    return undefined;
  const last = pattern.elements[pattern.elements.length - 1];
  if (!last)
    return { names: [], at: pattern.getStart(sourceFile) + 1, shape: "empty" };
  return {
    names: pattern.elements.map(({ propertyName, name }) =>
      (propertyName ?? name).getText(sourceFile),
    ),
    at: last.end,
    shape: "list",
  };
}

function callbackBody(node: ts.Expression | undefined): ts.Block | undefined {
  return node &&
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    ts.isBlock(node.body)
    ? node.body
    : undefined;
}

/** `test(...)` or `describe(...)` with its modifier: `test.skip(...)` gives `{ name: "test", modifier: "skip" }` */
function calleeOf(
  expression: ts.Expression,
): { name: string; modifier?: Modifier } | undefined {
  if (ts.isIdentifier(expression)) return { name: expression.text };
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    ["skip", "fixme", "only"].includes(expression.name.text)
  )
    return {
      name: expression.expression.text,
      modifier: expression.name.text as Modifier,
    };
  return undefined;
}

/** A modifier and the `{ reason }` written with it */
interface Mark {
  modifier?: Modifier;
  reason?: string;
}

/**
 * The callback of `test(title, fn)` and `describe(title, fn)`, and for a skip or fixme also of
 * `(title, { reason }, fn)` with the reason when it is a literal
 */
function callbackOf(
  node: ts.CallExpression,
  modifier: Modifier | undefined,
): { callback: ts.Expression | undefined; reason?: string } {
  const [, second, third] = node.arguments;
  if (
    (modifier === "skip" || modifier === "fixme") &&
    second &&
    ts.isObjectLiteralExpression(second)
  ) {
    const reason = readObject(second, ["reason"])?.reason;
    return {
      callback: third,
      ...(typeof reason === "string" && { reason }),
    };
  }
  return { callback: second };
}

/** What the runner applies to a test (see `modifierOf` in the runner): the innermost `skip` or `fixme` with its reason, else `only` */
function effectiveMark(own: Mark, describes: Mark[]): Mark {
  const chain = [own, ...[...describes].reverse()];
  const skip = chain.find(
    (m) => m.modifier === "skip" || m.modifier === "fixme",
  );
  if (skip)
    return {
      modifier: skip.modifier!,
      ...(skip.reason !== undefined && { reason: skip.reason }),
    };
  return chain.some((m) => m.modifier === "only") ? { modifier: "only" } : {};
}

/** The tests in a spec file, with their steps and where each statement sits */
export function parseSpec(source: string): ParsedTest[] {
  const sourceFile = ts.createSourceFile(
    "spec.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const tests: ParsedTest[] = [];

  const visit = (node: ts.Node, titles: string[], describes: Mark[]) => {
    const callee = ts.isCallExpression(node)
      ? calleeOf(node.expression)
      : undefined;
    if (ts.isCallExpression(node) && callee) {
      const title = stringOf(node.arguments[0]);
      const { callback, reason } = callbackOf(node, callee.modifier);
      const body = callbackBody(callback);
      const mark: Mark = {
        ...(callee.modifier && { modifier: callee.modifier }),
        ...(reason !== undefined && { reason }),
      };
      if (title !== undefined && body && callee.name === "test") {
        // `test.skip(condition, reason)` has no title and no body, so it stays a step of the test it is in
        const titlePath = [...titles, title];
        tests.push({
          titlePath,
          name: titlePath.join(" > "),
          steps: body.statements.map((statement) =>
            parseStatement(source, statement, sourceFile),
          ),
          bodyStart: body.getStart(sourceFile) + 1,
          bodyEnd: body.end - 1,
          fixtures: callbackFixtures(
            callback as ts.ArrowFunction | ts.FunctionExpression,
            sourceFile,
          ),
          ...effectiveMark(mark, describes),
        });
        return;
      }
      if (title !== undefined && body && callee.name === "describe") {
        ts.forEachChild(body, (child) =>
          visit(child, [...titles, title], [...describes, mark]),
        );
        return;
      }
    }
    ts.forEachChild(node, (child) => visit(child, titles, describes));
  };
  visit(sourceFile, [], []);
  return tests;
}
