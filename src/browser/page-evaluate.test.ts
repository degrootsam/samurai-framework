import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ScriptError,
  ScriptSerializationError,
} from "../script/call-function.js";
import { ElementHandle } from "../script/element-handle.js";
import { RemoteObject } from "../script/serialize.js";
import { remote, stubConnector } from "../testing/stub-connector.js";
import { isFunctionSource } from "./page-evaluate.js";
import Page from "./page.js";

function pageWith(...responses: Parameters<typeof stubConnector>) {
  const stub = stubConnector(...responses);
  return { page: new Page(stub.connector, "ctx"), ...stub };
}

describe("isFunctionSource", () => {
  test("recognises function declarations, expressions and arrows", () => {
    for (const source of [
      "() => 1",
      "  (a, b) => a + b",
      "x => x",
      "async () => 1",
      "async x => x",
      "function () { return 1; }",
      "function named(a) { return a; }",
      "async function () {}",
    ]) {
      assert.equal(isFunctionSource(source), true, source);
    }
  });

  test("treats everything else as an expression", () => {
    for (const source of [
      "document.title",
      "1 + 1",
      "(1 + 1)",
      "(() => 1)()",
      "functional()",
      "asyncValue",
      "[1, 2].map((x) => x)",
    ]) {
      assert.equal(isFunctionSource(source), false, source);
    }
  });
});

describe("page.evaluate", () => {
  test("calls a function with the argument and waits for a promise", async () => {
    const { page, sent } = pageWith(remote(5));
    const increment = (n: number) => n + 1;
    const result = await page.evaluate(increment, 4);
    assert.equal(result, 5);
    assert.deepEqual(sent[0], {
      method: "script.callFunction",
      params: {
        functionDeclaration: increment.toString(),
        awaitPromise: true,
        target: { context: "ctx" },
        arguments: [{ type: "number", value: 4 }],
        resultOwnership: "none",
      },
    });
  });

  test("sends no argument when there is none", async () => {
    const { page, sent } = pageWith(remote(1));
    await page.evaluate(() => 1);
    assert.equal(
      (sent[0]!.params as { arguments?: unknown }).arguments,
      undefined,
    );
  });

  test("a string with a function source is called, with the argument", async () => {
    const { page, sent, calls } = pageWith(remote("ok"));
    await page.evaluate("async (a) => a.name", { name: "x" });
    assert.equal(sent[0]!.method, "script.callFunction");
    assert.deepEqual(calls[0]!.args, [{ name: "x" }]);
  });

  test("any other string is an expression for script.evaluate", async () => {
    const { page, sent } = pageWith(remote("Title"));
    assert.equal(await page.evaluate("document.title"), "Title");
    assert.deepEqual(sent[0], {
      method: "script.evaluate",
      params: {
        expression: "document.title",
        awaitPromise: true,
        target: { context: "ctx" },
        resultOwnership: "none",
      },
    });
  });

  test("an expression takes no argument", async () => {
    const { page, sent } = pageWith(remote(1));
    await assert.rejects(
      page.evaluate("1 + 1", { a: 1 }),
      /evaluate\(\): an expression takes no argument/,
    );
    assert.equal(sent.length, 0);
  });

  test("an argument that cannot be serialized fails before anything is sent", async () => {
    const { page, sent } = pageWith(remote(1));
    await assert.rejects(
      page.evaluate(
        (fn: unknown) => fn,
        () => 1,
      ),
      TypeError,
    );
    assert.equal(sent.length, 0);
  });

  test("the page's error message is kept, for functions and expressions", async () => {
    const { page } = pageWith({ exception: "Error: kaboom" });
    for (const run of [
      () => page.evaluate(() => 1),
      () => page.evaluate("missing.thing"),
    ]) {
      await assert.rejects(run(), (err: Error) => {
        assert.ok(err instanceof ScriptError);
        assert.match(err.message, /kaboom/);
        assert.doesNotMatch(err.message, /Failed to locate/);
        return true;
      });
    }
  });

  test("a function that needs the transpiler's __name helper says so and how to avoid it", async () => {
    const { page, sent } = pageWith(remote(1));
    const fake = Object.assign(() => 1, {
      toString: () => "() => { __name(inner, 'inner'); }",
    });
    await assert.rejects(page.evaluate(fake), (err: Error) => {
      assert.ok(err instanceof ScriptSerializationError);
      assert.match(err.message, /__name/);
      assert.match(err.message, /tsx/);
      assert.match(err.message, /string/);
      return true;
    });
    assert.equal(sent.length, 0);
  });

  test("values come back as plain JavaScript", async () => {
    const { page } = pageWith(
      { type: "date", value: "2026-01-02T03:04:05.000Z" },
      { type: "map", value: [["k", { type: "number", value: 1 }]] },
      { type: "set", value: [{ type: "string", value: "a" }] },
      { type: "number", value: "NaN" } as never,
      { type: "undefined" },
      { type: "bigint", value: "12345678901234567890" } as never,
      {
        type: "object",
        value: [
          ["gone", { type: "undefined" }],
          ["nested", { type: "array", value: [{ type: "null" }] }],
        ],
      },
    );
    assert.deepEqual(
      await page.evaluate("1"),
      new Date("2026-01-02T03:04:05.000Z"),
    );
    assert.deepEqual(await page.evaluate("2"), new Map([["k", 1]]));
    assert.deepEqual(await page.evaluate("3"), new Set(["a"]));
    assert.ok(Number.isNaN(await page.evaluate("4")));
    assert.equal(await page.evaluate("5"), undefined);
    assert.equal(await page.evaluate("6"), 12345678901234567890n);
    const object = (await page.evaluate("7")) as Record<string, unknown>;
    assert.deepEqual(Object.keys(object), ["gone", "nested"]);
    assert.deepEqual(object, { gone: undefined, nested: [null] });
  });

  test("a node comes back as an ElementHandle; what has no copy as a RemoteObject", async () => {
    const { page } = pageWith(
      { type: "node", sharedId: "n-1" },
      { type: "function" },
      { type: "window" } as never,
      { type: "error" },
      { type: "promise" },
    );
    const node = await page.evaluate("1");
    assert.ok(node instanceof ElementHandle);
    assert.equal((node as ElementHandle).sharedId, "n-1");
    for (const type of ["function", "window", "error", "promise"]) {
      const value = await page.evaluate("2");
      assert.ok(value instanceof RemoteObject);
      assert.equal((value as RemoteObject).type, type);
    }
  });
});
