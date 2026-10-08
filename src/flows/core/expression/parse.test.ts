import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseExpression } from "./parse.js";

const ok = (text: string) => {
  const p = parseExpression(text);
  if (!p.ok) throw new Error(p.error.message);
  return p;
};
const err = (text: string) => {
  const p = parseExpression(text);
  if (p.ok) throw new Error("expected an error");
  return p.error;
};

describe("parseExpression", () => {
  test("precedence: && binds tighter than ||, comparison tighter than &&", () => {
    assert.partialDeepStrictEqual(ok("a.x == 1 || b.y == 2 && c.z").expr, {
      type: "binary",
      op: "||",
      right: { type: "binary", op: "&&" },
    });
  });
  test("arithmetic precedence and parentheses", () => {
    assert.partialDeepStrictEqual(ok("(1 + 2) * 3").expr, {
      type: "binary",
      op: "*",
      left: { type: "binary", op: "+" },
    });
  });
  test("literals", () => {
    assert.partialDeepStrictEqual(ok(`'a' + "b"`).expr, {
      left: { value: "a" },
      right: { value: "b" },
    });
    assert.partialDeepStrictEqual(ok("true").expr, {
      type: "literal",
      value: true,
    });
    assert.partialDeepStrictEqual(ok("null").expr, {
      type: "literal",
      value: null,
    });
    assert.partialDeepStrictEqual(ok("1.5").expr, {
      type: "literal",
      value: 1.5,
    });
  });
  test("references: static chains, bracket strings included", () => {
    assert.deepEqual(
      ok('nodes.login.status == "passed" && env["api-key"]').refs,
      [
        { path: ["nodes", "login", "status"], start: 0 },
        { path: ["env", "api-key"], start: 34 },
      ],
    );
  });
  test("calls and their argument count", () => {
    assert.deepEqual(ok('contains(vars.tags, "x")').calls, [
      { name: "contains", args: 2, start: 0 },
    ]);
  });
  test("regex literal as an argument", () => {
    assert.partialDeepStrictEqual(ok("matches(env.url, /^https:/i)").expr, {
      type: "call",
      args: [
        { type: "member" },
        { type: "regex", pattern: "^https:", flags: "i" },
      ],
    });
  });
  test("division is not a regex", () => {
    assert.partialDeepStrictEqual(ok("vars.a / 2").expr, {
      type: "binary",
      op: "/",
    });
  });
  test("errors say what's wrong and where", () => {
    assert.deepEqual(err(""), { message: "Write an expression", at: 0 });
    assert.deepEqual(err("(nodes.login.status"), {
      message: 'Expected ")" after "nodes.login.status"',
      at: 19,
    });
    assert.deepEqual(err("vars.a = 1"), {
      message: "Use == to compare",
      at: 7,
    });
    assert.deepEqual(err('"open'), { message: "Missing closing quote", at: 0 });
    assert.deepEqual(err("vars.a #"), { message: 'Unexpected "#"', at: 7 });
    assert.deepEqual(err("env.x.y(1)"), {
      message: "Only helpers can be called, like contains(x, y)",
      at: 0,
    });
    assert.deepEqual(err("1 2"), { message: 'Unexpected "2"', at: 2 });
  });
  test("malformed numbers are rejected", () => {
    assert.deepEqual(err("1.2.3"), { message: "Invalid number", at: 0 });
    assert.deepEqual(err("1..2"), { message: "Invalid number", at: 0 });
    assert.deepEqual(err("vars.a > 1."), { message: "Invalid number", at: 9 });
    assert.partialDeepStrictEqual(ok("2.5").expr, {
      type: "literal",
      value: 2.5,
    });
  });
  test("a trailing operator says the expression ends too early", () => {
    assert.deepEqual(err("vars.n -"), {
      message: "The expression ends too early",
      at: 8,
    });
  });
});
