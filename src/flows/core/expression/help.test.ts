import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { problemOf, type ExpressionScope } from "./check.js";
import { helpEntries, insertAt } from "./help.js";

const scope: ExpressionScope = {
  env: { name: "staging", variables: ["region", "api-key"] },
  vars: ["orderId"],
  before: ["login"],
  after: ["checkout"],
  all: ["login", "checkout"],
};

describe("help", () => {
  test("lists exactly what the checker accepts", () => {
    const help = helpEntries(scope);
    const all = [...help.nodes, ...help.vars, ...help.env, ...help.run];
    for (const entry of all)
      assert.equal(problemOf(entry.insert, scope), undefined);
    assert.deepEqual(
      help.nodes.map((e) => e.insert),
      ["nodes.login.status", "nodes.login.durationMs", "nodes.login.error"],
    );
    assert.deepEqual(
      help.env.map((e) => e.insert),
      ["env.region", 'env["api-key"]'],
    );
    assert.deepEqual(
      help.vars.map((e) => e.insert),
      ["vars.orderId"],
    );
    assert.deepEqual(
      help.run.map((e) => e.insert),
      ["run.environment", "run.trigger", "run.startedAt"],
    );
  });
  test("insertAt puts text at the cursor", () => {
    assert.deepEqual(insertAt("a ==  ", 5, "vars.x"), {
      value: "a == vars.x ",
      cursor: 11,
    });
  });
});
