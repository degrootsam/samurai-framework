import ts from "typescript";
import type {
  Expectation,
  PageExpectation,
  TextMatcher,
  TextValue,
} from "../model.js";
import { stringOf } from "./literals.js";

const TEXT_MATCHERS = ["toHaveText", "toContainText", "toHaveValue"] as const;

/** `env.NAME`, `env["NAME"]`, `secrets.NAME`, `secrets["NAME"]` or a string literal */
export function readValue(
  node: ts.Expression | undefined,
): TextValue | undefined {
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

export function readExpectation(
  matcher: string,
  args: readonly ts.Expression[],
): Expectation | undefined {
  if (
    matcher === "toBeVisible" ||
    matcher === "toBeHidden" ||
    matcher === "toBeEnabled" ||
    matcher === "toBeChecked"
  )
    return args.length === 0 ? { matcher } : undefined;
  if (matcher === "toHaveClass") {
    const expected = readTextMatcher(args[0]);
    return args.length === 1 && expected !== undefined
      ? { matcher, expected }
      : undefined;
  }
  if (matcher === "toHaveCSS") {
    const name = stringOf(args[0]);
    const expected = readTextMatcher(args[1]);
    return args.length === 2 && name !== undefined && expected !== undefined
      ? { matcher, name, expected }
      : undefined;
  }
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

export function readPageExpectation(
  matcher: string,
  args: readonly ts.Expression[],
): PageExpectation | undefined {
  if (matcher !== "toHaveURL" && matcher !== "toHaveTitle") return undefined;
  const expected = readTextMatcher(args[0]);
  return args.length === 1 && expected !== undefined
    ? { matcher, expected }
    : undefined;
}
