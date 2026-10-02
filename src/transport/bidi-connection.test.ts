import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FakeWebSocket, tick } from "../testing/fake-websocket.js";
import { WaitTimeoutError } from "../wait/wait-until.js";
import { BiDiError } from "./bidi-error.js";
import { BiDiConnector, ConnectionClosedError } from "./bidi-connection.js";

function setup(options?: { commandTimeout?: number }) {
  const ws = new FakeWebSocket();
  const connector = new BiDiConnector(ws as unknown as WebSocket, options);
  return { ws, connector };
}

describe("BiDiConnector error replies", () => {
  it("rejects only the matching command with a BiDiError", async () => {
    const { ws, connector } = setup();
    const first = connector.send("session.status", {});
    const second = connector.send("browser.close", {});
    ws.replyError(0, "no such frame", "frame is gone", "stack…");
    await assert.rejects(first, (err: unknown) => {
      assert.ok(err instanceof BiDiError);
      assert.equal(err.code, "no such frame");
      assert.equal(err.command, "session.status");
      assert.equal(err.remoteStack, "stack…");
      assert.match(err.message, /frame is gone/);
      return true;
    });
    ws.reply(1);
    assert.deepEqual(await second, {});
  });

  it("ignores an error reply for an unknown or null id", async () => {
    const { ws, connector } = setup();
    ws.replyError(99, "unknown error");
    ws.replyError(null, "invalid session id");
    const pending = connector.send("session.status", {});
    ws.reply(0, { ready: true });
    assert.deepEqual(await pending, { ready: true });
  });
});

describe("BiDiConnector timeouts", () => {
  it("rejects with code timeout and ignores a late reply", async () => {
    const { ws, connector } = setup();
    const pending = connector.send("session.status", {}, { timeout: 20 });
    await assert.rejects(pending, (err: unknown) => {
      assert.ok(err instanceof BiDiError);
      assert.equal(err.code, "timeout");
      assert.equal(err.command, "session.status");
      return true;
    });
    assert.doesNotThrow(() => ws.reply(0));
  });

  it("uses the constructor commandTimeout by default", async () => {
    const { connector } = setup({ commandTimeout: 15 });
    await assert.rejects(connector.send("session.status", {}), {
      code: "timeout",
    });
  });

  it("does not leave a timer running after a reply", async () => {
    const { ws, connector } = setup({ commandTimeout: 30 });
    const pending = connector.send("session.status", {});
    ws.reply(0);
    await pending;
    await tick(60); // an uncleared timer would try to reject a settled command: harmless, but must not throw
  });
});

describe("BiDiConnector socket close", () => {
  it("rejects pending commands and names them", async () => {
    const { ws, connector } = setup();
    const pending = connector.send("script.evaluate", {} as never);
    ws.drop();
    await assert.rejects(pending, /Websocket closed.*script\.evaluate/);
  });
});

describe("BiDiConnector after the socket closed", () => {
  it("rejects a new command at once instead of waiting for its timeout", async () => {
    const { ws, connector } = setup({ commandTimeout: 5000 });
    ws.drop();
    const started = Date.now();
    await assert.rejects(connector.send("session.status", {}), (err) => {
      assert.ok(err instanceof ConnectionClosedError);
      assert.match(
        err.message,
        /Websocket closed: cannot send session\.status/,
      );
      return true;
    });
    assert.ok(
      Date.now() - started < 500,
      "no waiting for the 5s command timeout",
    );
    assert.equal(ws.sent.length, 0, "nothing was written to the closed socket");
  });

  it("rejects pending commands with the same error type", async () => {
    const { ws, connector } = setup();
    const pending = connector.send("session.status", {});
    ws.drop();
    await assert.rejects(pending, ConnectionClosedError);
  });

  it("also after kill()", async () => {
    const { connector } = setup();
    connector.kill();
    await assert.rejects(
      connector.send("session.status", {}),
      ConnectionClosedError,
    );
  });
});

describe("BiDiConnector.waitForEvent", () => {
  it("resolves with the params of the first matching event and removes its listener", async () => {
    const { ws, connector } = setup();
    const waiting = connector.waitForEvent(
      "browsingContext.load",
      (p) => p.context === "b",
      { timeout: 1000 },
    );
    ws.emitEvent("browsingContext.load", { context: "a" });
    ws.emitEvent("browsingContext.load", { context: "b", url: "x" });
    assert.deepEqual(await waiting, { context: "b", url: "x" });
    // listener gone: further events do not throw or leak
    ws.emitEvent("browsingContext.load", { context: "b" });
  });

  it("is registered before it returns, so an event emitted right after is seen", async () => {
    const { ws, connector } = setup();
    const waiting = connector.waitForEvent("browsingContext.load", () => true, {
      timeout: 1000,
    });
    ws.emitEvent("browsingContext.load", { context: "a" });
    assert.deepEqual(await waiting, { context: "a" });
  });

  it("rejects with WaitTimeoutError on timeout", async () => {
    const { connector } = setup();
    await assert.rejects(
      connector.waitForEvent("browsingContext.load", () => true, {
        timeout: 15,
      }),
      (err: unknown) => err instanceof WaitTimeoutError && err.timeout === 15,
    );
  });

  it("rejects with the abort reason and stops listening", async () => {
    const { ws, connector } = setup();
    const controller = new AbortController();
    const waiting = connector.waitForEvent("browsingContext.load", () => true, {
      timeout: 1000,
      signal: controller.signal,
    });
    controller.abort(new Error("stop"));
    await assert.rejects(waiting, /stop/);
    ws.emitEvent("browsingContext.load", { context: "a" });
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const { connector } = setup();
    const signal = AbortSignal.abort(new Error("already"));
    await assert.rejects(
      connector.waitForEvent("browsingContext.load", () => true, {
        timeout: 1000,
        signal,
      }),
      /already/,
    );
  });
});

describe("BiDiConnector.subscribe", () => {
  it("sends session.subscribe once for two subscribers and unsubscribes after both leave", async () => {
    const { ws, connector } = setup();
    const answer = async () => {
      await tick();
      const last = ws.sent[ws.sent.length - 1]!;
      ws.reply(
        last.id,
        last.method === "session.subscribe" ? { subscription: "s1" } : {},
      );
    };

    const a = connector.subscribe(["browsingContext.load"]);
    await answer();
    const subA = await a;
    const subB = await connector.subscribe(["browsingContext.load"]);
    assert.equal(
      ws.sent.filter((m) => m.method === "session.subscribe").length,
      1,
    );

    await subA.unsubscribe();
    assert.equal(
      ws.sent.filter((m) => m.method === "session.unsubscribe").length,
      0,
    );

    const leaving = subB.unsubscribe();
    await answer();
    await leaving;
    const unsub = ws.sent.filter((m) => m.method === "session.unsubscribe");
    assert.equal(unsub.length, 1);
    assert.deepEqual(unsub[0]!.params, { subscriptions: ["s1"] });
  });
});
