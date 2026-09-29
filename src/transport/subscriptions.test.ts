import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tick } from "../testing/fake-websocket.js";
import { SubscriptionManager, type SessionCommands } from "./subscriptions.js";

function setup(options: { failSubscribe?: boolean; delay?: number } = {}) {
  const calls: Array<{ command: "subscribe" | "unsubscribe"; params: any }> = [];
  let next = 0;
  const commands: SessionCommands = {
    async subscribe(params) {
      calls.push({ command: "subscribe", params });
      await tick(options.delay ?? 0);
      if (options.failSubscribe) throw new Error("subscribe failed");
      return { subscription: `s${++next}` };
    },
    async unsubscribe(params) {
      calls.push({ command: "unsubscribe", params });
      await tick(options.delay ?? 0);
      return {};
    },
  };
  return { calls, manager: new SubscriptionManager(commands) };
}

describe("SubscriptionManager", () => {
  it("shares one subscribe between concurrent first subscribers", async () => {
    const { calls, manager } = setup({ delay: 5 });
    const [a, b] = await Promise.all([
      manager.subscribe(["browsingContext.load"]),
      manager.subscribe(["browsingContext.load"]),
    ]);
    assert.equal(calls.filter((c) => c.command === "subscribe").length, 1);
    await a.unsubscribe();
    await b.unsubscribe();
    assert.deepEqual(calls[calls.length - 1], { command: "unsubscribe", params: { subscriptions: ["s1"] } });
  });

  it("subscribes each event separately and releases them together", async () => {
    const { calls, manager } = setup();
    const sub = await manager.subscribe(["network.beforeRequestSent", "network.fetchError"]);
    assert.deepEqual(
      calls.map((c) => c.params.events),
      [["network.beforeRequestSent"], ["network.fetchError"]],
    );
    await sub.unsubscribe();
    assert.equal(calls.filter((c) => c.command === "unsubscribe").length, 2);
  });

  it("keeps an event subscribed while another subscriber still needs it", async () => {
    const { calls, manager } = setup();
    const a = await manager.subscribe(["network.fetchError", "network.responseCompleted"]);
    const b = await manager.subscribe(["network.fetchError"]);
    await a.unsubscribe();
    // only responseCompleted was released
    assert.deepEqual(
      calls.filter((c) => c.command === "unsubscribe").map((c) => c.params.subscriptions),
      [["s2"]],
    );
    await b.unsubscribe();
    assert.equal(calls.filter((c) => c.command === "unsubscribe").length, 2);
  });

  it("keeps the subscription when a new subscriber arrives while the last one is leaving", async () => {
    const { calls, manager } = setup({ delay: 5 });
    const first = await manager.subscribe(["log.entryAdded"]);
    const leaving = first.unsubscribe();
    const again = manager.subscribe(["log.entryAdded"]); // arrives before the queued unsubscribe runs
    const second = await again;
    await leaving;
    assert.deepEqual(calls.map((c) => c.command), ["subscribe"]);
    await second.unsubscribe();
    assert.deepEqual(calls.map((c) => c.command), ["subscribe", "unsubscribe"]);
  });

  it("resubscribes when a subscriber arrives after the last one fully left", async () => {
    const { calls, manager } = setup();
    const first = await manager.subscribe(["log.entryAdded"]);
    await first.unsubscribe();
    const again = await manager.subscribe(["log.entryAdded"]);
    assert.deepEqual(calls.map((c) => c.command), ["subscribe", "unsubscribe", "subscribe"]);
    await again.unsubscribe();
  });

  it("unsubscribe is idempotent", async () => {
    const { calls, manager } = setup();
    const a = await manager.subscribe(["log.entryAdded"]);
    const b = await manager.subscribe(["log.entryAdded"]);
    await a.unsubscribe();
    await a.unsubscribe();
    assert.equal(calls.filter((c) => c.command === "unsubscribe").length, 0); // b still holds it
    await b.unsubscribe();
    assert.equal(calls.filter((c) => c.command === "unsubscribe").length, 1);
  });

  it("scoped subscriptions send their own command and are not shared", async () => {
    const { calls, manager } = setup();
    const a = await manager.subscribe(["log.entryAdded"], { contexts: ["c1"] });
    const b = await manager.subscribe(["log.entryAdded"], { contexts: ["c1"] });
    assert.equal(calls.filter((c) => c.command === "subscribe").length, 2);
    assert.deepEqual(calls[0]!.params, { events: ["log.entryAdded"], contexts: ["c1"] });
    await a.unsubscribe();
    await a.unsubscribe();
    assert.deepEqual(
      calls.filter((c) => c.command === "unsubscribe").map((c) => c.params.subscriptions),
      [["s1"]],
    );
    await b.unsubscribe();
  });

  it("a failed subscribe rolls back and lets a later subscribe try again", async () => {
    const { calls, manager } = setup({ failSubscribe: true });
    await assert.rejects(manager.subscribe(["log.entryAdded"]), /subscribe failed/);
    await assert.rejects(manager.subscribe(["log.entryAdded"]), /subscribe failed/);
    assert.equal(calls.filter((c) => c.command === "subscribe").length, 2);
    assert.equal(calls.filter((c) => c.command === "unsubscribe").length, 0);
  });

  it("rolls back events already acquired when a later one fails", async () => {
    const calls: Array<{ command: string; params: any }> = [];
    let count = 0;
    const flaky = new SubscriptionManager({
      async subscribe(params) {
        calls.push({ command: "subscribe", params });
        if (++count === 2) throw new Error("second failed");
        return { subscription: "ok" };
      },
      async unsubscribe(params) {
        calls.push({ command: "unsubscribe", params });
        return {};
      },
    });
    await assert.rejects(
      flaky.subscribe(["network.fetchError", "network.responseCompleted"]),
      /second failed/,
    );
    assert.deepEqual(calls.filter((c) => c.command === "unsubscribe").map((c) => c.params), [
      { subscriptions: ["ok"] },
    ]);
  });
});
