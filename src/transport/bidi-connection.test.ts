import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Writable } from "node:stream";
import { transports } from "winston";
import logger from "../logger/index.js";
import { FakeWebSocket, tick } from "../testing/fake-websocket.js";
import { WaitTimeoutError } from "../wait/wait-until.js";
import { BiDiError } from "./bidi-error.js";
import {
  BiDiConnector,
  ConnectionClosedError,
  forLog,
} from "./bidi-connection.js";

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

describe("BiDiConnector onClosed", () => {
  it("fires once when the socket closes", () => {
    const { ws, connector } = setup();
    let calls = 0;
    connector.onClosed(() => calls++);
    ws.drop();
    ws.drop();
    assert.equal(calls, 1);
  });

  it("fires when the socket fails", () => {
    const { ws, connector } = setup();
    let calls = 0;
    connector.onClosed(() => calls++);
    ws.dispatchEvent(new Event("error"));
    assert.equal(calls, 1);
  });

  it("does not fire when the connector is killed on purpose", () => {
    const { connector } = setup();
    let calls = 0;
    connector.onClosed(() => calls++);
    connector.kill();
    assert.equal(calls, 0);
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

describe("BiDiConnector debug log", () => {
  /** Everything the real logger writes while `work` runs */
  async function logged(work: () => Promise<void> | void): Promise<string> {
    let out = "";
    const transport = new transports.Stream({
      stream: new Writable({
        write(chunk, _enc, done) {
          out += String(chunk);
          done();
        },
      }),
    });
    logger.add(transport);
    try {
      await work();
    } finally {
      logger.remove(transport);
    }
    return out;
  }

  const str = (value: string) => ({ type: "string", value });

  it("logs a recorder or toolbar script.message by channel and action, without its data", async () => {
    const { ws } = setup();
    const toolbar = "samurai-toolbar-1234";
    const capture = "samurai-recorder-5678";
    const out = await logged(() => {
      ws.emitEvent("script.message", {
        channel: toolbar,
        data: {
          type: "object",
          value: [
            ["type", str("toolbar")],
            ["action", str("add-insertable")],
            ["name", str("CARD")],
            ["value", str("TOPSECRET-4242")],
          ],
        },
        source: { realm: "r1", context: "c1" },
      });
      ws.emitEvent("script.message", {
        channel: capture,
        data: {
          type: "object",
          value: [
            ["type", str("input")],
            ["value", str("typed-in-the-page")],
          ],
        },
        source: { realm: "r2", context: "c1" },
      });
    });
    assert.ok(!out.includes("TOPSECRET-4242"), out);
    assert.ok(!out.includes("typed-in-the-page"), out);
    assert.ok(out.includes(toolbar), out);
    assert.ok(out.includes("add-insertable"), out);
    assert.ok(out.includes(capture), out);
  });

  it("delivers the full message to listeners and logs other channels as they are", async () => {
    const { ws, connector } = setup();
    const seen: unknown[] = [];
    connector.onEvent("script.message", (params) => seen.push(params.data));
    const data = { type: "object", value: [["value", str("v-1")]] };
    const out = await logged(() => {
      ws.emitEvent("script.message", {
        channel: "samurai-toolbar-1",
        data,
        source: { realm: "r", context: "c" },
      });
      ws.emitEvent("script.message", {
        channel: "someone-else",
        data: { type: "string", value: "plain-data" },
        source: { realm: "r", context: "c" },
      });
    });
    assert.deepEqual(seen[0], data);
    assert.ok(out.includes("plain-data"), out);
  });
});

describe("forLog", () => {
  it("cuts a long string to its start and length, so a 1 MB file chunk is not logged whole", () => {
    const chunk = "A".repeat(1_400_000);
    const logged = forLog({
      type: "success",
      result: { result: { type: "string", value: chunk } },
    } as never) as { result: { result: { value: string } } };
    assert.ok(logged.result.result.value.length < 300);
    assert.match(
      logged.result.result.value,
      /^A{200}… \(1400000 characters\)$/,
    );
  });

  it("leaves short values, numbers, nulls and the original message alone", () => {
    const message = { id: 1, result: { list: ["a", 2, null], text: "short" } };
    assert.deepEqual(forLog(message as never), message);
    const long = { result: "B".repeat(5000) };
    forLog(long as never);
    assert.equal(long.result.length, 5000, "the message itself is not changed");
  });

  it("still hides the private channels' messages", () => {
    const logged = forLog({
      type: "event",
      method: "script.message",
      params: {
        channel: "samurai-recorder-x",
        data: {
          type: "object",
          value: [
            ["type", { type: "string", value: "toolbar" }],
            ["action", { type: "string", value: "fill" }],
          ],
        },
      },
    } as never) as { params: { data: object } };
    assert.deepEqual(logged.params.data, {
      type: "toolbar",
      action: "fill",
      redacted: true,
    });
  });
});
