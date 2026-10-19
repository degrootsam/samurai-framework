import ts from "typescript";
import type { Step } from "../model.js";
import { readLocator } from "./call.js";
import { readExpectation, readValue } from "./expectation.js";
import { readFiles } from "./file-entry.js";
import { readObject, stringOf } from "./literals.js";

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
