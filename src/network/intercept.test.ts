import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  autoReply,
  FakeWebSocket,
  makeConnector,
  tick,
} from "../testing/fake-websocket.js";
import { BiDiError } from "../transport/bidi-error.js";
import { Intercept } from "./intercept.js";

const stops: Array<() => void> = [];
afterEach(() => stops.splice(0).forEach((stop) => stop()));

function setup(handlers: Record<string, (params: any) => object | Error> = {}) {
  const ws = new FakeWebSocket();
  const connector = makeConnector(ws);
  let n = 0;
  stops.push(
    autoReply(ws, {
      "network.addIntercept": () => ({ intercept: `i${++n}` }),
      "session.subscribe": () => ({ subscription: "sub" }),
      ...handlers,
    }),
  );
  const blocked: unknown[] = [];
  const intercept = new Intercept(connector, "top", (params) =>
    blocked.push(params),
  );
  const commands = (method: string) =>
    ws.sent.filter((m) => m.method === method).map((m) => m.params as any);
  return { ws, intercept, commands, blocked };
}

describe("Intercept", () => {
  it("adds one intercept for the exact URLs and none for no patterns", async () => {
    const { intercept, commands } = setup();
    await intercept.sync([]);
    assert.equal(commands("network.addIntercept").length, 0);
    await intercept.sync(["https://example.test/a", "https://example.test/a"]);
    assert.deepEqual(commands("network.addIntercept")[0].urlPatterns, [
      { type: "string", pattern: "https://example.test/a" },
    ]);
  });

  it("says which intercept ids are its own", async () => {
    const { intercept } = setup();
    await intercept.sync(["https://example.test/a"]);
    assert.equal(intercept.holds(["i1"]), true);
    assert.equal(intercept.holds(["other"]), false);
    assert.equal(intercept.holds(undefined), false);
  });

  it("runs changes one after the other, in the order they were asked for", async () => {
    const order: string[] = [];
    const { intercept } = setup({
      "network.addIntercept": (params) => {
        order.push(params.urlPatterns ? "exact" : "all");
        return { intercept: `i${order.length}` };
      },
    });
    const first = intercept.sync(["https://example.test/a"]);
    const second = intercept.sync(["**/*.png"]);
    await Promise.all([first, second]);
    assert.deepEqual(order, ["exact", "all"]);
  });

  it("a failed change does not block the next one", async () => {
    let fail = true;
    const { intercept, commands } = setup({
      "network.addIntercept": () => {
        if (fail) {
          fail = false;
          return new BiDiError("network.addIntercept", "unknown error", "boom");
        }
        return { intercept: "ok" };
      },
    });
    await assert.rejects(intercept.sync(["https://example.test/a"]), /boom/);
    await intercept.sync(["https://example.test/a"]);
    assert.equal(commands("network.addIntercept").length, 2);
  });

  it("stops listening and removes the intercept when the last pattern goes", async () => {
    const { ws, intercept, commands } = setup();
    await intercept.sync(["https://example.test/a"]);
    await intercept.sync([]);
    await tick(10);
    assert.deepEqual(commands("network.removeIntercept"), [
      { intercept: "i1" },
    ]);
    assert.equal(
      ws.sent.some((m) => m.method === "session.unsubscribe"),
      true,
    );
  });
});
