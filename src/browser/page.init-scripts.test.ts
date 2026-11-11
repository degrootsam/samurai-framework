import { describe, test } from "node:test";
import assert from "node:assert/strict";
import Page from "./page.js";
import {
  autoReply,
  FakeWebSocket,
  makeConnector,
} from "../testing/fake-websocket.js";

describe("Page init scripts", () => {
  const ok = { type: "success", realm: "r", result: { type: "undefined" } };
  function initPage() {
    const ws = new FakeWebSocket();
    const connector = makeConnector(ws);
    let scripts = 0;
    const stop = autoReply(ws, {
      "script.addPreloadScript": () => ({ script: `preload-${++scripts}` }),
      "browsingContext.getTree": () => ({
        contexts: [{ context: "ctx-1", parent: null, children: [] }],
      }),
      "script.callFunction": () => ok,
      "browsingContext.locateNodes": () => ({
        nodes: [{ type: "node", sharedId: "n1" }],
      }),
    });
    const page = new Page(connector, "ctx-1");
    const sent = (method: string) => ws.sent.filter((m) => m.method === method);
    return { ws, page, stop, sent };
  }

  /** Runs a wrapped init script against a fake global and returns what it recorded */
  function run(functionDeclaration: string) {
    const recorded: unknown[] = [];
    const record = (value: unknown) => recorded.push(value);
    (globalThis as any).record = record;
    try {
      new Function("record", `(${functionDeclaration})()`)(record);
    } finally {
      delete (globalThis as any).record;
    }
    return recorded;
  }

  test("a function is registered for the page's context, in the page realm", async () => {
    const { page, sent, stop } = initPage();
    const handle = await page.addInitScript(() => {
      (globalThis as any).__flag = true;
    });
    const params = sent("script.addPreloadScript")[0]!.params as any;
    assert.deepEqual(params.contexts, ["ctx-1"]);
    assert.equal(params.sandbox, undefined);
    assert.match(params.functionDeclaration, /__flag/);
    assert.equal(handle.id, "preload-1");
    stop();
  });

  test("it also runs in the document that is already loaded", async () => {
    const { page, sent, stop } = initPage();
    await page.addInitScript(() => {});
    const call = sent("script.callFunction")[0]!.params as any;
    assert.deepEqual(call.target, { context: "ctx-1" });
    stop();
  });

  test("the argument is embedded as JSON and passed as the function's first argument", async () => {
    const { page, sent, stop } = initPage();
    await page.addInitScript(
      (arg: { a: number; s: string }) => (globalThis as any).record(arg),
      {
        a: 1,
        s: `q"uote `,
      },
    );
    const declaration = (sent("script.addPreloadScript")[0]!.params as any)
      .functionDeclaration;
    assert.deepEqual(run(declaration), [{ a: 1, s: `q"uote ` }]);
    stop();
  });

  test("a function without an argument is called with undefined", async () => {
    const { page, sent, stop } = initPage();
    await page.addInitScript((arg?: unknown) =>
      (globalThis as any).record(arg),
    );
    const declaration = (sent("script.addPreloadScript")[0]!.params as any)
      .functionDeclaration;
    assert.deepEqual(run(declaration), [undefined]);
    stop();
  });

  test("a string is script source and runs as statements", async () => {
    const { page, sent, stop } = initPage();
    await page.addInitScript(`record("a"); record("b");`);
    const declaration = (sent("script.addPreloadScript")[0]!.params as any)
      .functionDeclaration;
    assert.deepEqual(run(declaration), ["a", "b"]);
    stop();
  });

  test("a string cannot take an argument, and the argument must be JSON", async () => {
    const { page, sent, stop } = initPage();
    await assert.rejects(page.addInitScript("1", { a: 1 }), TypeError);
    await assert.rejects(
      page.addInitScript(() => {}, 10n),
      TypeError,
    );
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    await assert.rejects(
      page.addInitScript(() => {}, loop),
      TypeError,
    );
    assert.equal(sent("script.addPreloadScript").length, 0);
    stop();
  });

  test("a function that needs the transpiler's __name helper is rejected", async () => {
    const { page, stop } = initPage();
    await assert.rejects(
      page.addInitScript(() => {
        function inner() {}
        inner();
      }),
      { name: "ScriptSerializationError" },
    );
    stop();
  });

  test("a throwing init script does not fail the registration in the loaded document", async () => {
    const ws = new FakeWebSocket();
    const connector = makeConnector(ws);
    const stop = autoReply(ws, {
      "script.addPreloadScript": () => ({ script: "p" }),
      "browsingContext.getTree": () => ({
        contexts: [{ context: "ctx-1", parent: null, children: [] }],
      }),
      "script.callFunction": () => ({
        type: "exception",
        realm: "r",
        exceptionDetails: { text: "boom", stackTrace: { callFrames: [] } },
      }),
    });
    const page = new Page(connector, "ctx-1");
    await assert.doesNotReject(page.addInitScript(() => {}));
    stop();
  });

  test("dispose() on the handle removes it, and page.dispose() removes the rest", async () => {
    const { page, sent, stop } = initPage();
    const first = await page.addInitScript(() => {});
    await page.addInitScript(() => {});
    await first.dispose();
    assert.equal(sent("script.removePreloadScript").length, 1);
    await page.dispose();
    const removed = sent("script.removePreloadScript").map(
      (m) => (m.params as any).script,
    );
    assert.deepEqual(removed.sort(), ["preload-1", "preload-2"]);
    await page.dispose(); // nothing left to remove
    assert.equal(sent("script.removePreloadScript").length, 2);
    stop();
  });

  test("locators created by the page share its helper realm", async () => {
    const { page, sent, stop } = initPage();
    const a = page.locator("//a");
    const b = page.locator("//b");
    await Promise.all([
      a.isEnabled().catch(() => {}),
      b.isEnabled().catch(() => {}),
    ]);
    // one registration of the framework helpers however many locators probe
    const helperRegistrations = sent("script.addPreloadScript").filter(
      (m) => (m.params as any).sandbox === "samurai",
    );
    assert.equal(helperRegistrations.length, 1);
    stop();
  });
});
