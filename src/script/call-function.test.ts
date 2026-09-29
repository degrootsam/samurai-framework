import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FakeWebSocket, tick } from "../testing/fake-websocket.js";
import { BiDiConnector } from "../transport/bidi-connection.js";
import { callFunction, disown, ScriptError, ScriptSerializationError } from "./call-function.js";
import { ElementHandle } from "./element-handle.js";
import { RemoteObject } from "./serialize.js";

function setup(reply: (params: any) => object | Error) {
  const ws = new FakeWebSocket();
  const connector = new BiDiConnector(ws as unknown as WebSocket);
  let answered = 0;
  const pump = setInterval(() => {
    while (answered < ws.sent.length) {
      const { id, method, params } = ws.sent[answered++]!;
      const result = method === "script.callFunction" || method === "script.disown" ? reply(params) : {};
      if (result instanceof Error) ws.replyError(id, "no such handle", result.message);
      else ws.reply(id, result);
    }
  }, 1);
  return { ws, connector, stop: () => clearInterval(pump) };
}

const success = (result: object) => ({ type: "success", realm: "r", result });

describe("callFunction", () => {
  it("sends the declaration, serialized arguments, target and defaults", async () => {
    const { ws, connector, stop } = setup(() => success({ type: "number", value: 3 }));
    const result = await callFunction(connector, "ctx", "(a, b) => a + b", [1, "x"]);
    assert.equal(result, 3);
    assert.deepEqual(ws.sent[0]!.params, {
      functionDeclaration: "(a, b) => a + b",
      awaitPromise: true,
      target: { context: "ctx" },
      arguments: [
        { type: "number", value: 1 },
        { type: "string", value: "x" },
      ],
      resultOwnership: "none",
    });
    stop();
  });

  it("omits arguments when there are none and passes options through", async () => {
    const { ws, connector, stop } = setup(() => success({ type: "undefined" }));
    await callFunction(connector, "ctx", "function() { return this; }", [], {
      awaitPromise: false,
      sandbox: "samurai",
      ownership: "root",
      thisArg: { a: 1 },
    });
    assert.deepEqual(ws.sent[0]!.params, {
      functionDeclaration: "function() { return this; }",
      awaitPromise: false,
      target: { context: "ctx", sandbox: "samurai" },
      resultOwnership: "root",
      this: { type: "object", value: [["a", { type: "number", value: 1 }]] },
    });
    stop();
  });

  it("serializes an ElementHandle argument as a shared reference", async () => {
    const { ws, connector, stop } = setup(() => success({ type: "null" }));
    await callFunction(connector, "ctx", "(el) => el.id", [new ElementHandle("n1")]);
    assert.deepEqual((ws.sent[0]!.params as any).arguments, [{ sharedId: "n1" }]);
    stop();
  });

  it("accepts a function and sends its source", async () => {
    const { ws, connector, stop } = setup(() => success({ type: "number", value: 2 }));
    await callFunction(connector, "ctx", (n: number) => n * 2, [1]);
    assert.match((ws.sent[0]!.params as any).functionDeclaration, /n\s*\*\s*2/);
    stop();
  });

  it("rejects a function whose source depends on the transpiler's __name helper", async () => {
    const { connector, stop } = setup(() => success({ type: "null" }));
    const named = () => {
      function inner() {
        return 1;
      }
      return inner();
    };
    // Under tsx (keepNames) `inner` is wrapped in __name(); the guard turns that into a clear error
    if (named.toString().includes("__name(")) {
      await assert.rejects(callFunction(connector, "ctx", named), ScriptSerializationError);
    }
    const guarded = "(x) => { __name(x, 'x'); }";
    // A string is used as written, the guard is only for function objects
    await assert.doesNotReject(callFunction(connector, "ctx", guarded));
    const fake = Object.assign(() => 1, { toString: () => "() => { __name(a, 'a'); }" });
    await assert.rejects(callFunction(connector, "ctx", fake), ScriptSerializationError);
    stop();
  });

  it("fails before sending when an argument cannot be serialized", async () => {
    const { ws, connector, stop } = setup(() => success({ type: "null" }));
    await assert.rejects(callFunction(connector, "ctx", "(f) => f", [() => 1]), TypeError);
    assert.equal(ws.sent.length, 0);
    stop();
  });

  it("maps an exception result to ScriptError", async () => {
    const { connector, stop } = setup(() => ({
      type: "exception",
      realm: "r",
      exceptionDetails: {
        text: "TypeError: x is null",
        lineNumber: 1,
        columnNumber: 2,
        exception: { type: "error" },
        stackTrace: { callFrames: [] },
      },
    }));
    const longSource = "() => {" + " ".repeat(300) + "}";
    await assert.rejects(callFunction(connector, "ctx", longSource), (err: unknown) => {
      assert.ok(err instanceof ScriptError);
      assert.equal(err.text, "TypeError: x is null");
      assert.deepEqual(err.stackTrace, { callFrames: [] });
      assert.ok(err.functionSource.length <= 201);
      assert.match(err.message, /TypeError: x is null/);
      return true;
    });
    stop();
  });

  it("returns nodes as ElementHandles", async () => {
    const { connector, stop } = setup(() => success({ type: "node", sharedId: "n9", value: {} }));
    const result = await callFunction<ElementHandle>(connector, "ctx", "() => document.body");
    assert.ok(result instanceof ElementHandle);
    assert.equal(result.sharedId, "n9");
    stop();
  });

  it("keeps handles for ownership root", async () => {
    const { connector, stop } = setup(() =>
      success({ type: "object", handle: "h1", value: [["a", { type: "number", value: 1 }]] }),
    );
    const result = await callFunction<RemoteObject>(connector, "ctx", "() => ({a: 1})", [], { ownership: "root" });
    assert.ok(result instanceof RemoteObject);
    assert.equal(result.handle, "h1");
    assert.deepEqual(result.value, { a: 1 });
    stop();
  });

  it("does not keep handles for ownership none", async () => {
    const { connector, stop } = setup(() => success({ type: "object", value: [["a", { type: "number", value: 1 }]] }));
    assert.deepEqual(await callFunction(connector, "ctx", "() => ({a: 1})"), { a: 1 });
    stop();
  });
});

describe("disown", () => {
  it("sends the handles for the context", async () => {
    const { ws, connector, stop } = setup(() => ({}));
    await disown(connector, "ctx", ["h1", "h2"]);
    assert.deepEqual(ws.sent[0]!.params, { handles: ["h1", "h2"], target: { context: "ctx" } });
    stop();
  });

  it("sends nothing for no handles", async () => {
    const { ws, connector, stop } = setup(() => ({}));
    await disown(connector, "ctx", []);
    await tick(5);
    assert.equal(ws.sent.length, 0);
    stop();
  });

  it("swallows no such handle", async () => {
    const { connector, stop } = setup(() => new Error("gone"));
    await assert.doesNotReject(disown(connector, "ctx", ["h1"]));
    stop();
  });
});
