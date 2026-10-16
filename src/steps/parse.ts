import ts from "typescript";
import { parseSize } from "./files.js";
import type {
  Expectation,
  FileEntry,
  LocatorCall,
  LocatorSpec,
  ParsedStep,
  ParsedTest,
  Step,
  TextMatcher,
  TextValue,
} from "./model.js";

const TEXT_MATCHERS = ["toHaveText", "toContainText", "toHaveValue"] as const;

function stringOf(node: ts.Node | undefined): string | undefined {
  return node &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

/** `{ key: literal, … }` with only the allowed keys, or undefined when it has anything else */
function readObject(
  node: ts.Node | undefined,
  allowed: readonly string[],
): Record<string, string | boolean> | undefined {
  if (!node || !ts.isObjectLiteralExpression(node)) return undefined;
  const result: Record<string, string | boolean> = {};
  for (const property of node.properties) {
    if (
      !ts.isPropertyAssignment(property) ||
      !allowed.includes(property.name.getText())
    )
      return undefined;
    const value = stringOf(property.initializer);
    if (value !== undefined) result[property.name.getText()] = value;
    else if (property.initializer.kind === ts.SyntaxKind.TrueKeyword)
      result[property.name.getText()] = true;
    else if (property.initializer.kind === ts.SyntaxKind.FalseKeyword)
      result[property.name.getText()] = false;
    else return undefined;
  }
  return result;
}

function readCall(
  method: string,
  args: readonly ts.Expression[],
): LocatorCall | undefined {
  const first = stringOf(args[0]);
  if (first === undefined) return undefined;
  switch (method) {
    case "locator":
      return args.length === 1 ? { method, xpath: first } : undefined;
    case "getByCss":
      return args.length === 1 ? { method, css: first } : undefined;
    case "getByTestId":
      return args.length === 1 ? { method, testId: first } : undefined;
    case "getByText":
    case "getByLabel": {
      if (args.length > 2) return undefined;
      const options =
        args.length === 2 ? readObject(args[1], ["match", "ignoreCase"]) : {};
      if (!options) return undefined;
      const { match, ignoreCase } = options;
      if (
        (match !== undefined && match !== "full" && match !== "partial") ||
        (ignoreCase !== undefined && typeof ignoreCase !== "boolean")
      ) {
        return undefined;
      }
      return {
        method,
        text: first,
        ...(match !== undefined && { match: match as "full" | "partial" }),
        ...(ignoreCase !== undefined && { ignoreCase: ignoreCase as boolean }),
      };
    }
    case "getByRole": {
      if (args.length > 2) return undefined;
      const options = args.length === 2 ? readObject(args[1], ["name"]) : {};
      if (
        !options ||
        (options.name !== undefined && typeof options.name !== "string")
      )
        return undefined;
      return {
        method,
        role: first,
        ...(options.name !== undefined && { name: options.name as string }),
      };
    }
    default:
      return undefined;
  }
}

/** `page.a(…).b(…)` as calls in order; undefined when it is anything else */
function readChain(node: ts.Expression): LocatorCall[] | undefined {
  const calls: LocatorCall[] = [];
  let current = node;
  while (ts.isCallExpression(current)) {
    if (!ts.isPropertyAccessExpression(current.expression)) return undefined;
    const call = readCall(current.expression.name.text, current.arguments);
    if (!call) return undefined;
    calls.unshift(call);
    current = current.expression.expression;
  }
  return ts.isIdentifier(current) && current.text === "page" && calls.length > 0
    ? calls
    : undefined;
}

function readLocator(node: ts.Expression): LocatorSpec | undefined {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "withFallbacks"
  ) {
    const chain = readChain(node.expression.expression);
    const fallbacks = node.arguments.map(readChain);
    if (
      !chain ||
      node.arguments.length === 0 ||
      fallbacks.some((fallback) => !fallback)
    )
      return undefined;
    return { chain, fallbacks: fallbacks as LocatorCall[][] };
  }
  const chain = readChain(node);
  return chain && { chain, fallbacks: [] };
}

/** `env.NAME`, `env["NAME"]`, `secrets.NAME`, `secrets["NAME"]` or a string literal */
function readValue(node: ts.Expression | undefined): TextValue | undefined {
  if (!node) return undefined;
  const literal = stringOf(node);
  if (literal !== undefined) return { kind: "literal", value: literal };
  let object: ts.Expression;
  let name: string | undefined;
  if (ts.isPropertyAccessExpression(node)) {
    object = node.expression;
    name = node.name.text;
  } else if (ts.isElementAccessExpression(node)) {
    object = node.expression;
    name = stringOf(node.argumentExpression);
  } else return undefined;
  if (name === undefined || !ts.isIdentifier(object)) return undefined;
  if (object.text === "env") return { kind: "env", name };
  if (object.text === "secrets") return { kind: "secret", name };
  return undefined;
}

function readTextMatcher(
  node: ts.Expression | undefined,
): TextMatcher | undefined {
  if (!node) return undefined;
  const literal = stringOf(node);
  if (literal !== undefined) return literal;
  if (ts.isRegularExpressionLiteral(node)) {
    const end = node.text.lastIndexOf("/");
    return {
      regex: {
        source: node.text.slice(1, end),
        flags: node.text.slice(end + 1),
      },
    };
  }
  return undefined;
}

function readExpectation(
  matcher: string,
  args: readonly ts.Expression[],
): Expectation | undefined {
  if (matcher === "toBeVisible")
    return args.length === 0 ? { matcher } : undefined;
  if (matcher === "toHaveCount") {
    const [count] = args;
    return args.length === 1 && count && ts.isNumericLiteral(count)
      ? { matcher, expected: Number(count.text) }
      : undefined;
  }
  if (matcher === "toHaveAttribute") {
    const name = stringOf(args[0]);
    const expected = readTextMatcher(args[1]);
    return args.length === 2 && name !== undefined && expected !== undefined
      ? { matcher, name, expected }
      : undefined;
  }
  if ((TEXT_MATCHERS as readonly string[]).includes(matcher)) {
    const expected = readTextMatcher(args[0]);
    return args.length === 1 && expected !== undefined
      ? { matcher: matcher as (typeof TEXT_MATCHERS)[number], expected }
      : undefined;
  }
  return undefined;
}

/** The step a statement stands for, or undefined when it is outside the recorder's set */
/** `"path"` or `generatedFile({ name, size, type? })`; undefined for anything else */
function readFileEntry(node: ts.Expression): FileEntry | undefined {
  const path = stringOf(node);
  if (path !== undefined) return { path };
  if (
    !ts.isCallExpression(node) ||
    !ts.isIdentifier(node.expression) ||
    node.expression.text !== "generatedFile" ||
    node.arguments.length !== 1 ||
    !ts.isObjectLiteralExpression(node.arguments[0]!)
  )
    return undefined;
  let name: string | undefined;
  let type: string | undefined;
  let size: number | undefined;
  let sizeSource: string | undefined;
  for (const property of node.arguments[0].properties) {
    if (!ts.isPropertyAssignment(property)) return undefined;
    const value = property.initializer;
    switch (property.name.getText()) {
      case "name":
        name = stringOf(value);
        if (name === undefined) return undefined;
        break;
      case "type":
        type = stringOf(value);
        if (type === undefined) return undefined;
        break;
      case "size": {
        const text = stringOf(value);
        size =
          text !== undefined
            ? parseSize(text)
            : ts.isNumericLiteral(value)
              ? parseSize(Number(value.text))
              : undefined;
        if (size === undefined) return undefined;
        sizeSource = value.getText();
        break;
      }
      default:
        return undefined;
    }
  }
  if (name === undefined || size === undefined) return undefined;
  return {
    generate: {
      name,
      size,
      ...(type !== undefined && { type }),
      ...(sizeSource !== undefined && { sizeSource }),
    },
  };
}

/** One file entry, or an array of them */
function readFiles(node: ts.Expression | undefined): FileEntry[] | undefined {
  if (!node) return undefined;
  if (ts.isArrayLiteralExpression(node)) {
    const entries = node.elements.map(readFileEntry);
    return entries.every((entry) => entry !== undefined)
      ? (entries as FileEntry[])
      : undefined;
  }
  const entry = readFileEntry(node);
  return entry && [entry];
}

function readStep(statement: ts.Statement): Step | undefined {
  if (
    !ts.isExpressionStatement(statement) ||
    !ts.isAwaitExpression(statement.expression)
  )
    return undefined;
  const call = statement.expression.expression;
  if (
    !ts.isCallExpression(call) ||
    !ts.isPropertyAccessExpression(call.expression)
  )
    return undefined;
  const { expression: target, name } = call.expression;
  const args = call.arguments;

  if (ts.isIdentifier(target) && target.text === "page") {
    if (name.text === "goto" && args.length === 1) {
      const url = stringOf(args[0]);
      return url === undefined ? undefined : { kind: "goto", url };
    }
    if (name.text === "waitForNetworkIdle" && args.length === 0)
      return { kind: "waitForNetworkIdle" };
    if (
      name.text === "waitForTimeout" &&
      args.length === 1 &&
      ts.isNumericLiteral(args[0]!)
    ) {
      const ms = Number(args[0].text);
      return Number.isInteger(ms) ? { kind: "waitForTimeout", ms } : undefined;
    }
    if (name.text === "screenshot" && args.length === 1) {
      const options = readObject(args[0], ["name", "fullPage"]);
      if (!options || typeof options.name !== "string") return undefined;
      if (
        options.fullPage !== undefined &&
        typeof options.fullPage !== "boolean"
      )
        return undefined;
      return {
        kind: "screenshot",
        name: options.name,
        fullPage: options.fullPage === true,
      };
    }
    return undefined;
  }

  // expect(locator).matcher(…) and expect(locator).not.matcher(…)
  const negated =
    ts.isPropertyAccessExpression(target) && target.name.text === "not";
  const subject = negated
    ? (target as ts.PropertyAccessExpression).expression
    : target;
  if (
    ts.isCallExpression(subject) &&
    ts.isIdentifier(subject.expression) &&
    subject.expression.text === "expect" &&
    subject.arguments.length === 1
  ) {
    const locator = readLocator(subject.arguments[0]!);
    const expectation = readExpectation(name.text, args);
    return locator && expectation
      ? { kind: "expect", locator, not: negated, expectation }
      : undefined;
  }

  const locator = readLocator(target);
  if (!locator) return undefined;
  if (name.text === "click" && args.length === 0)
    return { kind: "click", locator };
  if (name.text === "press" && args.length === 1) {
    const key = stringOf(args[0]);
    return key === undefined ? undefined : { kind: "press", locator, key };
  }
  if (name.text === "fill" && args.length === 1) {
    const value = readValue(args[0]);
    return value ? { kind: "fill", locator, value } : undefined;
  }
  if (
    (name.text === "setInputFiles" || name.text === "dropFiles") &&
    args.length === 1
  ) {
    const files = readFiles(args[0]);
    return files
      ? { kind: name.text as "setInputFiles" | "dropFiles", locator, files }
      : undefined;
  }
  return undefined;
}

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
