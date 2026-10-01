import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { autoReply, FakeWebSocket } from "../testing/fake-websocket.js";
import { BiDiConnector } from "../transport/bidi-connection.js";
import { addPreload } from "./preload.js";
import { ScriptError } from "./call-function.js";

const ok = { type: "success", realm: "r", result: { type: "undefined" } };
const frame = (context: string, children: object[] = []) => ({ context, parent: null, children });

interface Setup {
  tree?: (params: any) => object[];
  callFunction?: (params: any) => object | Error;
  removePreload?: () => object | Error;
}

function setup({ tree, callFunction, removePreload }: Setup = {}) {
  const ws = new FakeWebSocket();
  const connector = new BiDiConnector(ws as unknown as WebSocket);
  const stop = autoReply(ws, {
    "script.addPreloadScript": () => ({ script: "preload-1" }),
    "browsingContext.getTree": (params) => ({ contexts: tree?.(params) ?? [] }),
    "script.callFunction": callFunction ?? (() => ok),
    "script.removePreloadScript": removePreload ?? (() => ({})),
  });
  const methods = () => ws.sent.map((m) => m.method);
  return { ws, connector, stop, methods };
}

describe("addPreload", () => {
  it("registers the script with its contexts and sandbox", async () => {
    const { ws, connector, stop } = setup();
    const handle = await addPreload(connector, {
      source: "() => { globalThis.x = 1 }",
      contexts: ["top"],
      sandbox: "samurai",
    });
    assert.equal(handle.id, "preload-1");
    assert.deepEqual(ws.sent[0]!.params, {
      functionDeclaration: "() => { globalThis.x = 1 }",
      contexts: ["top"],
      sandbox: "samurai",
    });
    stop();
  });

  it("omits contexts and sandbox when not given", async () => {
    const { ws, connector, stop } = setup();
    await addPreload(connector, { source: "() => {}" });
    assert.deepEqual(ws.sent[0]!.params, { functionDeclaration: "() => {}" });
    stop();
  });

  it("also runs the source in every loaded context under the given roots, same sandbox", async () => {
    const { ws, connector, stop, methods } = setup({
      tree: (params) =>
        params.root === "top" ? [frame("top", [frame("child", [frame("grandchild")])])] : [],
    });
    await addPreload(connector, { source: "() => 1", contexts: ["top"], sandbox: "samurai" });
    // registered first, so a document created meanwhile is not missed
    assert.equal(methods()[0], "script.addPreloadScript");
    const getTrees = ws.sent.filter((m) => m.method === "browsingContext.getTree");
    assert.deepEqual(getTrees.map((m) => m.params), [{ root: "top" }]);
    const calls = ws.sent.filter((m) => m.method === "script.callFunction").map((m) => m.params as any);
    assert.deepEqual(calls.map((c) => c.target).sort((a, b) => a.context.localeCompare(b.context)), [
      { context: "child", sandbox: "samurai" },
      { context: "grandchild", sandbox: "samurai" },
      { context: "top", sandbox: "samurai" },
    ]);
    assert.ok(calls.every((c) => c.functionDeclaration === "() => 1" && c.awaitPromise === false));
    stop();
  });

  it("without contexts it covers every top-level context", async () => {
    const { ws, connector, stop } = setup({ tree: () => [frame("a"), frame("b", [frame("b-frame")])] });
    await addPreload(connector, { source: "() => 1" });
    assert.deepEqual(ws.sent.find((m) => m.method === "browsingContext.getTree")!.params, {});
    const targets = ws.sent
      .filter((m) => m.method === "script.callFunction")
      .map((m) => (m.params as any).target.context)
      .sort();
    assert.deepEqual(targets, ["a", "b", "b-frame"]);
    stop();
  });

  it("ignores a context that disappeared while running", async () => {
    const ws = new FakeWebSocket();
    const connector = new BiDiConnector(ws as unknown as WebSocket);
    const timer = setInterval(() => {
      for (const m of ws.sent.splice(0)) {
        if (m.method === "script.addPreloadScript") ws.reply(m.id, { script: "p" });
        else if (m.method === "browsingContext.getTree") ws.reply(m.id, { contexts: [frame("top")] });
        else ws.replyError(m.id, "no such frame", "frame is gone");
      }
    }, 1).unref();
    await assert.doesNotReject(addPreload(connector, { source: "() => 1", contexts: ["top"] }));
    clearInterval(timer);
  });

  it("throws a ScriptError from the immediate run by default", async () => {
    const { connector, stop } = setup({
      tree: () => [frame("top")],
      callFunction: () => ({
        type: "exception",
        realm: "r",
        exceptionDetails: { text: "ReferenceError: nope", stackTrace: { callFrames: [] } },
      }),
    });
    await assert.rejects(addPreload(connector, { source: "() => nope" }), ScriptError);
    stop();
  });

  it("removes the registration again when the immediate run throws", async () => {
    const { ws, connector, stop, methods } = setup({
      tree: () => [frame("top")],
      callFunction: () => ({
        type: "exception",
        realm: "r",
        exceptionDetails: { text: "boom", stackTrace: { callFrames: [] } },
      }),
    });
    await assert.rejects(addPreload(connector, { source: "() => 1" }), ScriptError);
    assert.ok(methods().includes("script.removePreloadScript"));
    assert.deepEqual(
      ws.sent.find((m) => m.method === "script.removePreloadScript")!.params,
      { script: "preload-1" },
    );
    stop();
  });

  it("with onRunError log the immediate run's exception does not fail the registration", async () => {
    const { connector, stop } = setup({
      tree: () => [frame("top")],
      callFunction: () => ({
        type: "exception",
        realm: "r",
        exceptionDetails: { text: "boom", stackTrace: { callFrames: [] } },
      }),
    });
    const handle = await addPreload(connector, { source: "() => 1", onRunError: "log" });
    assert.equal(handle.id, "preload-1");
    stop();
  });

  it("rethrows when registering fails", async () => {
    const ws = new FakeWebSocket();
    const connector = new BiDiConnector(ws as unknown as WebSocket);
    const timer = setInterval(() => {
      for (const m of ws.sent.splice(0)) ws.replyError(m.id, "invalid argument", "bad script");
    }, 1).unref();
    await assert.rejects(addPreload(connector, { source: "not a function" }), { code: "invalid argument" });
    clearInterval(timer);
  });

  it("dispose removes the registration once, however often it is called", async () => {
    const { ws, connector, stop } = setup();
    const handle = await addPreload(connector, { source: "() => 1" });
    await handle.dispose();
    await handle.dispose();
    const removals = ws.sent.filter((m) => m.method === "script.removePreloadScript");
    assert.equal(removals.length, 1);
    assert.deepEqual(removals[0]!.params, { script: "preload-1" });
    stop();
  });

  it("dispose swallows no such script", async () => {
    const ws = new FakeWebSocket();
    const connector = new BiDiConnector(ws as unknown as WebSocket);
    const timer = setInterval(() => {
      for (const m of ws.sent.splice(0)) {
        if (m.method === "script.addPreloadScript") ws.reply(m.id, { script: "p" });
        else if (m.method === "browsingContext.getTree") ws.reply(m.id, { contexts: [] });
        else ws.replyError(m.id, "no such script", "already removed");
      }
    }, 1).unref();
    const handle = await addPreload(connector, { source: "() => 1" });
    await assert.doesNotReject(handle.dispose());
    clearInterval(timer);
  });
});
