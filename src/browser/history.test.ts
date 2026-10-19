import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  autoReply,
  FakeWebSocket,
  tick,
  makeConnector,
} from "../testing/fake-websocket.js";
import { traverseHistory } from "./history.js";

const stops: Array<() => void> = [];
afterEach(() => stops.splice(0).forEach((stop) => stop()));

const bool = (value: boolean) => ({
  type: "success",
  realm: "r",
  result: { type: "boolean", value },
});
const failing = (code: string) => Object.assign(new Error(code), { code });

function setup(handlers: Record<string, (params: any) => object | Error> = {}) {
  const ws = new FakeWebSocket();
  const connector = makeConnector(ws);
  stops.push(
    autoReply(ws, {
      "script.callFunction": () => bool(false),
      "browsingContext.traverseHistory": () => ({}),
      ...handlers,
    }),
  );
  const commands = (method: string) =>
    ws.sent.filter((m) => m.method === method).map((m) => m.params as any);
  const committed = (context = "ctx") =>
    ws.emitEvent("browsingContext.navigationCommitted", {
      context,
      navigation: "nav",
      url: "https://example.test/",
      timestamp: 0,
    });
  return { ws, connector, commands, committed };
}

describe("traverseHistory", () => {
  it("asks for the entry and resolves once this context committed it, not another's", async () => {
    const { connector, commands, committed } = setup();
    let done = false;
    const pending = traverseHistory(connector, "ctx", -1).then(
      (r) => ((done = true), r),
    );
    await tick(30);
    committed("other");
    await tick(30);
    assert.equal(done, false);
    committed();
    assert.equal(await pending, true);
    assert.deepEqual(commands("browsingContext.traverseHistory"), [
      { context: "ctx", delta: -1 },
    ]);
  });

  it("says false without asking when only the tab's blank page is behind", async () => {
    const { connector, commands } = setup({
      "script.callFunction": () => bool(true),
    });
    assert.equal(await traverseHistory(connector, "ctx", -1), false);
    assert.equal(commands("browsingContext.traverseHistory").length, 0);
  });

  it("says false when the browser has no such entry; other errors are thrown", async () => {
    const none = setup({
      "browsingContext.traverseHistory": () => failing("no such history entry"),
    });
    assert.equal(await traverseHistory(none.connector, "ctx", 1), false);
    const broken = setup({
      "browsingContext.traverseHistory": () => failing("no such frame"),
    });
    await assert.rejects(traverseHistory(broken.connector, "ctx", 1), {
      code: "no such frame",
    });
  });
});
