import ts from "typescript";
import type { ParsedStep, ParsedTest } from "./model.js";
import { stringOf } from "./parse/literals.js";
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

/** `describe.skip`, `describe.fixme` and `describe.only`: tests written inside keep their place in the title */
function isDescribeWithModifier(expression: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "describe" &&
    ["skip", "fixme", "only"].includes(expression.name.text)
  );
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

  const visit = (node: ts.Node, titles: string[]) => {
    if (ts.isCallExpression(node) && isDescribeWithModifier(node.expression)) {
      // `describe.skip("Old", () => ...)`: a describe block for the names of the tests inside it
      const title = stringOf(node.arguments[0]);
      const body = callbackBody(node.arguments[1]);
      if (title !== undefined && body) {
        ts.forEachChild(body, (child) => visit(child, [...titles, title]));
        return;
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const title = stringOf(node.arguments[0]);
      const body = callbackBody(node.arguments[1]);
      if (title !== undefined && body && node.expression.text === "test") {
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
            node.arguments[1] as ts.ArrowFunction | ts.FunctionExpression,
            sourceFile,
          ),
        });
        return;
      }
      if (title !== undefined && body && node.expression.text === "describe") {
        ts.forEachChild(body, (child) => visit(child, [...titles, title]));
        return;
      }
    }
    ts.forEachChild(node, (child) => visit(child, titles));
  };
  visit(sourceFile, []);
  return tests;
}
