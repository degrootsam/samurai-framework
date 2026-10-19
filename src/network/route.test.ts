import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import logger from "../logger/index.js";
import type { NetworkRequest } from "./network-types.js";
import { PendingRoute, Route, type PendingRouteControl } from "./route.js";

const info: NetworkRequest = {
  id: "r1",
  url: "https://example.test/x",
  method: "GET",
  headers: {},
  resourceType: "fetch",
  navigation: null,
  redirectedFrom: null,
  isBlocked: true,
};

function control() {
  const sent: Array<{ method: string; params: unknown }> = [];
  const settled: PendingRoute[] = [];
  const ctl: PendingRouteControl = {
    send: (async (method: string, params: unknown) => {
      sent.push({ method, params });
      return {};
    }) as never,
    next: async () => {},
    sendsContentLength: true,
    onSettled: (pending) => settled.push(pending),
  };
  return { ctl, sent, settled };
}

describe("Route", () => {
  it("shows a handler only what it may use", () => {
    const { ctl } = control();
    const { route } = new PendingRoute(info, ctl);
    const members = Object.getOwnPropertyNames(Route.prototype)
      .filter((name) => name !== "constructor")
      .sort();
    assert.deepEqual(
      members.filter((name) => !name.startsWith("#")),
      [
        "abort",
        "answer",
        "claim",
        "continue",
        "fallback",
        "fulfill",
        "request",
      ],
    );
    // `answer` and `claim` are private in the types; nothing else is reachable
    assert.equal("timer" in route, false);
    assert.equal("entry" in route, false);
    assert.equal("isAnswered" in route, false);
    assert.equal("release" in route, false);
    assert.equal("failQuietly" in route, false);
  });
});

describe("PendingRoute", () => {
  it("is answered once its route is, and says so to the router", async () => {
    const { ctl, settled } = control();
    const pending = new PendingRoute(info, ctl);
    assert.equal(pending.isAnswered, false);
    await pending.route.abort();
    assert.equal(pending.isAnswered, true);
    assert.deepEqual(settled, [pending]);
  });

  it("release continues an open request and leaves an answered one alone", async () => {
    const open = control();
    await new PendingRoute(info, open.ctl).release();
    assert.deepEqual(
      open.sent.map((m) => m.method),
      ["network.continueRequest"],
    );

    const answered = control();
    const pending = new PendingRoute(info, answered.ctl);
    await pending.route.abort();
    await pending.release();
    assert.deepEqual(
      answered.sent.map((m) => m.method),
      ["network.failRequest"],
    );
  });

  it("failQuietly fails an open request, and a refusal by the browser is logged, not thrown", async () => {
    const debug = mock.method(logger, "debug", () => logger);
    const { ctl, sent } = control();
    await new PendingRoute(info, ctl).failQuietly();
    assert.deepEqual(
      sent.map((m) => m.method),
      ["network.failRequest"],
    );

    const refusing: PendingRouteControl = {
      ...ctl,
      send: (async () => {
        throw new Error("no such request");
      }) as never,
    };
    await new PendingRoute(info, refusing).failQuietly();
    assert.ok(debug.mock.calls.length >= 1);
    mock.restoreAll();
  });

  it("calls onLate after the time when nothing answered, and not after an answer", async () => {
    const late: string[] = [];
    const slow = new PendingRoute(info, control().ctl);
    slow.startTimer(10, () => late.push("slow"));
    const quick = new PendingRoute(info, control().ctl);
    quick.startTimer(10, () => late.push("quick"));
    await quick.route.abort();
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.deepEqual(late, ["slow"]);
  });
});
