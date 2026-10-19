import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  autoReply,
  FakeWebSocket,
  makeConnector,
  tick,
} from "../testing/fake-websocket.js";
import { DocumentWatcher } from "./document-watcher.js";
import { NavigationError } from "./navigation-error.js";

const stops: Array<() => void> = [];
afterEach(() => stops.splice(0).forEach((stop) => stop()));

function setup(readyState: string) {
  const ws = new FakeWebSocket();
  const connector = makeConnector(ws);
  stops.push(
    autoReply(ws, {
      "session.subscribe": () => ({ subscription: "sub-1" }),
      "session.unsubscribe": () => ({}),
      "script.callFunction": () => ({
        type: "success",
        realm: "r",
        result: { type: "string", value: readyState },
      }),
    }),
  );
  return { ws, watcher: new DocumentWatcher(connector, "top") };
}

describe("DocumentWatcher.progressOf", () => {
  it("keeps one progress per navigation and forgets the oldest past twenty", () => {
    const { watcher } = setup("complete");
    const first = watcher.progressOf("nav-0");
    assert.equal(watcher.progressOf("nav-0"), first);
    for (let i = 1; i <= 20; i++) watcher.progressOf(`nav-${i}`);
    assert.notEqual(watcher.progressOf("nav-0"), first, "nav-0 was forgotten");
  });
});

describe("DocumentWatcher.waitForState", () => {
  it("resolves at once when the document is already there", async () => {
    const { watcher } = setup("complete");
    await watcher.waitForState("load", 1000, undefined);
    await watcher.waitForState("domcontentloaded", 1000, undefined);
  });

  it("an interactive document counts for domcontentloaded, not for load", async () => {
    const { ws, watcher } = setup("interactive");
    await watcher.waitForState("domcontentloaded", 1000, undefined);
    const waiting = watcher.waitForState("load", 1000, undefined);
    await tick(20);
    ws.emitEvent("browsingContext.load", {
      context: "top",
      navigation: "nav-1",
      timestamp: 0,
      url: "https://example.test/",
    });
    await waiting;
  });

  it("a navigation we saw fall short of the state beats the document that is showing", async () => {
    const { ws, watcher } = setup("complete");
    watcher.progressOf("nav-1"); // started, nothing reached yet
    const waiting = watcher.waitForState("load", 1000, "nav-1");
    await tick(20);
    ws.emitEvent("browsingContext.load", {
      context: "top",
      navigation: "nav-1",
      timestamp: 0,
      url: "https://example.test/",
    });
    await waiting;
  });

  it("rejects with a NavigationError when the awaited navigation fails", async () => {
    const { ws, watcher } = setup("loading");
    const waiting = watcher.waitForState("load", 1000, "nav-1");
    await tick(20);
    ws.emitEvent("browsingContext.navigationFailed", {
      context: "top",
      navigation: "nav-1",
      timestamp: 0,
      url: "https://example.test/gone",
    });
    await assert.rejects(waiting, (err: unknown) => {
      assert.ok(err instanceof NavigationError);
      assert.match(
        err.message,
        /waitForLoadState\(\): https:\/\/example.test\/gone failed: navigation failed/,
      );
      return true;
    });
  });

  it("ignores the failure of another navigation or another page", async () => {
    const { ws, watcher } = setup("loading");
    const waiting = watcher.waitForState("load", 1000, "nav-2");
    await tick(20);
    ws.emitEvent("browsingContext.navigationFailed", {
      context: "top",
      navigation: "nav-1",
      timestamp: 0,
      url: "https://example.test/old",
    });
    ws.emitEvent("browsingContext.navigationFailed", {
      context: "other",
      navigation: "nav-2",
      timestamp: 0,
      url: "https://example.test/else",
    });
    await tick(20);
    ws.emitEvent("browsingContext.load", {
      context: "top",
      navigation: "nav-2",
      timestamp: 0,
      url: "https://example.test/",
    });
    await waiting;
  });
});

describe("DocumentWatcher.watch", () => {
  it("subscribes once however often it is asked, and dispose releases it once", async () => {
    const { ws, watcher } = setup("complete");
    const count = (method: string) =>
      ws.sent.filter((m) => m.method === method).length;
    await watcher.watch();
    const subscribed = count("session.subscribe");
    await watcher.watch();
    assert.equal(
      count("session.subscribe"),
      subscribed,
      "the second ask is free",
    );
    await watcher.dispose();
    const unsubscribed = count("session.unsubscribe");
    assert.ok(unsubscribed > 0);
    await watcher.dispose();
    assert.equal(
      count("session.unsubscribe"),
      unsubscribed,
      "a second dispose does nothing",
    );
  });

  it("records which navigations reached DOMContentLoaded and load", async () => {
    const { ws, watcher } = setup("complete");
    await watcher.watch();
    const params = (navigation: string | null, context = "top") => ({
      context,
      navigation,
      timestamp: 0,
      url: "https://example.test/",
    });
    ws.emitEvent("browsingContext.domContentLoaded", params("nav-1"));
    assert.deepEqual(watcher.progressOf("nav-1"), {
      domContentLoaded: true,
      load: false,
    });
    ws.emitEvent("browsingContext.load", params("nav-1"));
    assert.deepEqual(watcher.progressOf("nav-1"), {
      domContentLoaded: true,
      load: true,
    });
    ws.emitEvent("browsingContext.load", params("nav-2", "other"));
    ws.emitEvent("browsingContext.load", params(null));
    assert.deepEqual(watcher.progressOf("nav-2"), {
      domContentLoaded: false,
      load: false,
    });
  });
});
