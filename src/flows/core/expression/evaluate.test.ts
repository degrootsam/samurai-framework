import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  EvaluationError,
  evaluateText,
  type ExpressionContext,
} from "./evaluate.js";

const ctx: ExpressionContext = {
  env: { region: "eu", "api-key": "k", retries: 3 },
  vars: { tags: ["a", "b"], name: "Ann" },
  nodes: { login: { status: "passed", durationMs: 1200 } },
  run: {
    environment: "staging",
    trigger: "manual",
    startedAt: "2026-10-07T10:00:00Z",
  },
};
const run = (text: string) => evaluateText(text, ctx);

describe("evaluate", () => {
  test("comparisons are strict", () => {
    assert.equal(run('env.region == "eu"'), true);
    assert.equal(run('env.retries == "3"'), false);
    assert.equal(run("env.retries >= 3 && env.retries < 4"), true);
    assert.equal(run('"b" > "a"'), true);
    assert.equal(run('env.retries > "2"'), false);
  });
  test("logic and arithmetic", () => {
    assert.equal(run("!false || false"), true);
    assert.equal(run("1 + 2 * 3 - 4 / 2 % 3"), 5);
    assert.equal(run('"order-" + run.environment'), "order-staging");
    assert.equal(run('"n" + 2'), "n2");
    assert.throws(() => run("vars.name - 1"), EvaluationError);
  });
  test("bracket access works for any name", () => {
    assert.equal(run('env["api-key"]'), "k");
  });
  test("missing values are undefined and compare false", () => {
    assert.equal(run("vars.nope"), undefined);
    assert.equal(run("vars.nope.deeper"), undefined);
    assert.equal(run("vars.nope == 1"), false);
    assert.equal(run("exists(vars.nope)"), false);
    assert.equal(run("exists(nodes.login)"), true);
  });
  test("helpers", () => {
    assert.equal(run('contains(vars.tags, "b")'), true);
    assert.equal(run('contains(vars.name, "nn")'), true);
    assert.equal(run('startsWith(run.environment, "stag")'), true);
    assert.equal(run("matches(run.environment, /^STAG/i)"), true);
    assert.equal(run("len(vars.tags) + len(vars.name)"), 5);
  });
  test("nothing outside the context is reachable", () => {
    assert.equal(run("run.constructor"), undefined);
    assert.equal(run('env["__proto__"]'), undefined);
    assert.equal(run("vars.toString"), undefined);
    assert.equal(run("vars.tags.length"), undefined);
    assert.throws(
      () => run("process"),
      (e: Error) => e.message.includes("process isn't available"),
    );
  });
  test("syntax errors throw with the parser's message", () => {
    assert.throws(
      () => run("(1"),
      (e: Error) => e.message.includes('Expected ")" after "1"'),
    );
  });
  test("only helpers can be called", () => {
    for (const text of ["constructor()", "toString()", 'hasOwnProperty("a")'])
      assert.throws(
        () => run(text),
        (e: Error) => e.message.includes("doesn't exist"),
      );
    assert.throws(() => run("constructor()"), EvaluationError);
  });
  test("bad patterns throw EvaluationError", () => {
    assert.throws(() => run('matches("a", "(")'), EvaluationError);
    assert.throws(() => run('matches("a", /(/)'), EvaluationError);
  });
  test("&& returns a boolean", () => {
    assert.equal(run("true && vars.name"), true);
  });
});
