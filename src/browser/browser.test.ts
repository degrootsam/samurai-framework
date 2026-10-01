import assert from "node:assert/strict";
import { test } from "node:test";
import { autoReply, FakeWebSocket } from "../testing/fake-websocket.js";
import { BiDiConnector } from "../transport/bidi-connection.js";
import { Browser } from "./browser.js";

function fakeBrowser(handlers: Record<string, (params: any) => object | Error> = {}) {
  const ws = new FakeWebSocket();
  const connector = new BiDiConnector(ws as unknown as WebSocket);
  const stop = autoReply(ws, { "browsingContext.getTree": () => ({ contexts: [] }), ...handlers });
  const browser = new Browser({ browserProc: {} as never, biDiConnector: connector });
  return { ws, browser, stop };
}

test("newPage returns a page bound to the created context", async () => {
  const { ws, browser, stop } = fakeBrowser({
    "browsingContext.create": () => ({ context: "ctx-42", userContext: "default" }),
  });
  const page = await browser.newPage({ type: "tab" });
  assert.equal(page.contextId, "ctx-42");
  assert.deepEqual(
    ws.sent.find((m) => m.method === "browsingContext.create")!.params,
    { type: "tab" },
  );
  stop();
});

test("newPage passes background and userContext through", async () => {
  const { ws, browser, stop } = fakeBrowser({
    "browsingContext.create": () => ({ context: "c", userContext: "u1" }),
  });
  await browser.newPage({ type: "window", background: true, userContext: "u1" });
  assert.deepEqual(ws.sent[0]!.params, { type: "window", background: true, userContext: "u1" });
  stop();
});

test("newPage surfaces a failing create as a BiDiError", async () => {
  const { browser, stop } = fakeBrowser({
    "browsingContext.create": () => new Error("no window"),
  });
  await assert.rejects(browser.newPage({ type: "tab" }), { name: "BiDiError", code: "unknown error" });
  stop();
});
