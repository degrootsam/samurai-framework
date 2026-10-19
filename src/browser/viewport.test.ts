import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { autoReply, FakeWebSocket } from "../testing/fake-websocket.js";
import { BiDiConnector } from "../transport/bidi-connection.js";
import { applyViewport, validateViewport } from "./viewport.js";

const stops: Array<() => void> = [];
afterEach(() => stops.splice(0).forEach((stop) => stop()));

function setup(handlers: Record<string, (params: any) => object | Error> = {}) {
  const ws = new FakeWebSocket();
  const connector = new BiDiConnector(ws as unknown as WebSocket);
  stops.push(
    autoReply(ws, {
      "script.callFunction": () => ({
        type: "success",
        realm: "r",
        result: { type: "undefined" },
      }),
      ...handlers,
    }),
  );
  const commands = (method: string) =>
    ws.sent.filter((m) => m.method === method).map((m) => m.params as any);
  return { ws, connector, commands };
}

describe("validateViewport", () => {
  it("accepts positive integers and a positive ratio", () => {
    validateViewport({ width: 400, height: 300 });
    validateViewport({ width: 400, height: 300, devicePixelRatio: 2.5 });
  });

  it("names what is wrong", () => {
    assert.throws(
      () => validateViewport({ width: 0, height: 10 }),
      /width must be a positive integer, got 0/,
    );
    assert.throws(
      () => validateViewport({ width: 10, height: 1.5 }),
      /height must be a positive integer/,
    );
    assert.throws(
      () => validateViewport({ width: 10, height: 10, devicePixelRatio: 0 }),
      /devicePixelRatio must be a positive number/,
    );
  });
});

describe("applyViewport", () => {
  it("sends the size and the ratio for the context, only after validating", async () => {
    const { connector, commands } = setup();
    await applyViewport(connector, "ctx", {
      width: 800,
      height: 600,
      devicePixelRatio: 2,
    });
    assert.deepEqual(commands("browsingContext.setViewport"), [
      {
        context: "ctx",
        viewport: { width: 800, height: 600 },
        devicePixelRatio: 2,
      },
    ]);
    await assert.rejects(
      applyViewport(connector, "ctx", { width: -1, height: 5 }),
      RangeError,
    );
    assert.equal(commands("browsingContext.setViewport").length, 1);
  });

  it("null resets, between a watch for the page's resize and the wait for it", async () => {
    const { ws, connector } = setup();
    await applyViewport(connector, "ctx", null);
    assert.deepEqual(
      ws.sent
        .filter((m) =>
          ["script.callFunction", "browsingContext.setViewport"].includes(
            m.method,
          ),
        )
        .map((m) => m.method),
      [
        "script.callFunction",
        "browsingContext.setViewport",
        "script.callFunction",
      ],
    );
  });
});
