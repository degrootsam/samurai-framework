import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FakeWebSocket, tick } from "../testing/fake-websocket.js";
import { BiDiConnector } from "../transport/bidi-connection.js";
import { ContextTree } from "./context-tree.js";

/** Answers subscribe/unsubscribe and getTree commands as they come in */
function setup(tree: object[] = [{ context: "root", parent: null, children: [{ context: "frame", parent: "root", children: [] }] }]) {
  const ws = new FakeWebSocket();
  const connector = new BiDiConnector(ws as unknown as WebSocket);
  let answered = 0;
  const pump = setInterval(() => {
    while (answered < ws.sent.length) {
      const message = ws.sent[answered++]!;
      if (message.method === "session.subscribe") ws.reply(message.id, { subscription: `s${answered}` });
      else if (message.method === "browsingContext.getTree") ws.reply(message.id, { contexts: tree });
      else ws.reply(message.id);
    }
  }, 1).unref();
  return { ws, connector, stop: () => clearInterval(pump) };
}

describe("ContextTree", () => {
  it("reads the initial tree, including nested frames", async () => {
    const { connector, stop } = setup();
    const tree = await ContextTree.create(connector);
    assert.equal(tree.parentOf("frame"), "root");
    assert.equal(tree.parentOf("root"), null);
    assert.equal(tree.rootOf("frame"), "root");
    assert.equal(tree.isWithin("frame", "root"), true);
    assert.equal(tree.isWithin("root", "root"), true);
    await tree.dispose();
    stop();
  });

  it("unknown contexts are not within anything", async () => {
    const { connector, stop } = setup();
    const tree = await ContextTree.create(connector);
    assert.equal(tree.isWithin("nope", "root"), false);
    assert.equal(tree.parentOf("nope"), null);
    assert.equal(tree.rootOf("nope"), "nope");
    await tree.dispose();
    stop();
  });

  it("tracks created contexts, also deeper than one level", async () => {
    const { ws, connector, stop } = setup();
    const tree = await ContextTree.create(connector);
    ws.emitEvent("browsingContext.contextCreated", { context: "grandchild", parent: "frame", children: [] });
    ws.emitEvent("browsingContext.contextCreated", { context: "other", parent: null, children: [] });
    assert.equal(tree.rootOf("grandchild"), "root");
    assert.equal(tree.isWithin("grandchild", "root"), true);
    assert.equal(tree.isWithin("other", "root"), false);
    await tree.dispose();
    stop();
  });

  it("still answers for destroyed contexts (late events)", async () => {
    const { ws, connector, stop } = setup();
    const tree = await ContextTree.create(connector);
    ws.emitEvent("browsingContext.contextDestroyed", { context: "frame", parent: "root", children: [] });
    assert.equal(tree.isWithin("frame", "root"), true);
    await tree.dispose();
    stop();
  });

  it("dispose removes listeners and unsubscribes", async () => {
    const { ws, connector, stop } = setup();
    const tree = await ContextTree.create(connector);
    await tree.dispose();
    await tick(5);
    ws.emitEvent("browsingContext.contextCreated", { context: "late", parent: "root", children: [] });
    assert.equal(tree.parentOf("late"), null);
    assert.equal(ws.sent.filter((m) => m.method === "session.unsubscribe").length, 2);
    stop();
  });

  it("subscribes before reading the tree so no creation is missed", async () => {
    const { ws, connector, stop } = setup();
    const tree = await ContextTree.create(connector);
    const order = ws.sent.map((m) => m.method).filter((m) => m !== "session.unsubscribe");
    assert.deepEqual(order, ["session.subscribe", "session.subscribe", "browsingContext.getTree"]);
    await tree.dispose();
    stop();
  });
});
