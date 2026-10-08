import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { problemOf, type ExpressionScope } from "./check.js";

const scope: ExpressionScope = {
  env: { name: "staging", variables: ["region", "api-key"] },
  vars: ["orderId"],
  before: ["login", "start"],
  after: ["checkout"],
  all: ["login", "start", "checkout", "refund"],
};
const message = (text: string) => problemOf(text, scope)?.message;

describe("checkExpression", () => {
  test("a valid expression has no problem", () => {
    assert.equal(
      problemOf(
        'nodes.login.status == "passed" && env["api-key"] && exists(vars.orderId) && run.environment',
        scope,
      ),
      undefined,
    );
  });
  test("syntax errors come first", () => {
    assert.equal(
      message("(nodes.login.status"),
      'Expected ")" after "nodes.login.status"',
    );
  });
  test("unknown helper, with a suggestion", () => {
    assert.equal(
      message('startswith(run.environment, "s")'),
      "startswith() doesn't exist. Did you mean startsWith()?",
    );
    assert.equal(
      message("foo(1)"),
      "foo() doesn't exist. Use contains, startsWith, matches, len or exists.",
    );
    assert.equal(message("len(1, 2)"), "len() takes 1 value");
  });
  test("unknown root", () => {
    assert.equal(
      message("order.id"),
      "order isn't available. Use env., vars., nodes. or run.",
    );
    assert.equal(message("env"), "Use env.<name>");
  });
  test("node keys", () => {
    assert.equal(
      message("nodes.logn.status"),
      'No node with key "logn". Did you mean login?',
    );
    assert.equal(message("nodes.zzz.status"), 'No node with key "zzz"');
    assert.equal(
      message("nodes.checkout.status"),
      "checkout runs after this node, so it has no result yet",
    );
    assert.equal(
      message("nodes.refund.status"),
      "refund is on another branch, so it has no result here",
    );
    assert.equal(
      message("nodes.login.stat"),
      "nodes.login.stat doesn't exist. Use status, durationMs or error",
    );
  });
  test("variables and environment", () => {
    assert.equal(
      message("vars.total"),
      "vars.total isn't set before this node",
    );
    assert.equal(message("env.country"), "country isn't a variable of staging");
    assert.equal(
      message("run.trigr"),
      "run.trigr doesn't exist. Use environment, trigger or startedAt",
    );
  });
});
