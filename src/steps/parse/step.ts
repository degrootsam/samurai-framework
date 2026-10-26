import ts from "typescript";
import type { Step } from "../model.js";
import { readLocator } from "./call.js";
import {
  OUTPUT_MATCHERS,
  readExpectation,
  readPageExpectation,
  readRegex,
  readValue,
} from "./expectation.js";
import { readFiles } from "./file-entry.js";
import { readObject, stringOf } from "./literals.js";

/**
 * The name in a trailing `{ output: "name" }`: undefined without one, null when the argument is there but
 * isn't exactly that
 */
function outputOf(node: ts.Expression | undefined): string | undefined | null {
  if (!node) return undefined;
  const output = readObject(node, ["output"])?.output;
  return typeof output === "string" ? output : null;
}

/** `outputs.save("name", locator)` or `outputs.save("name", locator, /pattern/)` */
function readSaveOutput(args: readonly ts.Expression[]): Step | undefined {
  const name = stringOf(args[0]);
  const locator = args[1] && readLocator(args[1]);
  const pattern = readRegex(args[2]);
  if (
    name === undefined ||
    !locator ||
    args.length > 3 ||
    (args.length === 3 && !pattern)
  )
    return undefined;
  return {
    kind: "saveOutput",
    name,
    locator,
    ...(pattern && { pattern }),
  };
}

/** `expect(locator)…matcher(…)`, with a trailing `{ output }` only on the matchers that take one and never with `not` */
function readLocatorExpect(
  subject: ts.Expression,
  negated: boolean,
  matcher: string,
  args: readonly ts.Expression[],
): Step | undefined {
  const locator = readLocator(subject);
  if (!locator) return undefined;
  const last = args[args.length - 1];
  const takesOutput =
    OUTPUT_MATCHERS.includes(matcher) &&
    !!last &&
    ts.isObjectLiteralExpression(last);
  const output = takesOutput ? outputOf(last) : undefined;
  if (output === null || (output !== undefined && negated)) return undefined;
  const expectation = readExpectation(
    matcher,
    takesOutput ? args.slice(0, -1) : args,
  );
  return expectation
    ? {
        kind: "expect",
        locator,
        not: negated,
        expectation,
        ...(output !== undefined && { output }),
      }
    : undefined;
}

/** The step a statement stands for, or undefined when it is outside the recorder's set */
export function readStep(statement: ts.Statement): Step | undefined {
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
    const arg = subject.arguments[0]!;
    if (ts.isIdentifier(arg) && arg.text === "page") {
      const expectation = readPageExpectation(name.text, args);
      return expectation
        ? { kind: "expectPage", not: negated, expectation }
        : undefined;
    }
    return readLocatorExpect(arg, negated, name.text, args);
  }

  if (ts.isIdentifier(target) && target.text === "outputs")
    return name.text === "save" ? readSaveOutput(args) : undefined;

  const locator = readLocator(target);
  if (!locator) return undefined;
  if (name.text === "click" && args.length === 0)
    return { kind: "click", locator };
  if (name.text === "press" && args.length === 1) {
    const key = stringOf(args[0]);
    return key === undefined ? undefined : { kind: "press", locator, key };
  }
  if (name.text === "fill" && (args.length === 1 || args.length === 2)) {
    const value = readValue(args[0]);
    const output = outputOf(args[1]);
    return value && output !== null
      ? {
          kind: "fill",
          locator,
          value,
          ...(output !== undefined && { output }),
        }
      : undefined;
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
