import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NetworkRequest } from "./network-tracker.js";
import { tick, type FakeWebSocket } from "../testing/fake-websocket.js";
import {
  base,
  installTrackerHooks,
  setup,
  start,
  done,
  fail,
} from "../testing/network-tracker-setup.js";

installTrackerHooks();

describe("NetworkTracker when a document is replaced", () => {
  const commit = (ws: FakeWebSocket, context: string, navigation: string) =>
    ws.emitEvent("browsingContext.navigationCommitted", {
      context,
      navigation,
      timestamp: 0,
      url: "https://example.test/next",
    });

  it("ends the requests of the old document that Chrome never reports as failed", async () => {
    const { ws, tracker } = await setup();
    const failed: string[] = [];
    tracker.on("requestfailed", (r) => failed.push(r.url));
    start(ws, "hang");
    start(ws, "frame-hang", "frame");
    assert.equal(tracker.inflight, 2);
    commit(ws, "top", "nav-2");
    assert.equal(
      tracker.inflight,
      0,
      "the frame belongs to the replaced document",
    );
    assert.deepEqual(failed.sort(), [
      "https://example.test/frame-hang",
      "https://example.test/hang",
    ]);
  });

  it("keeps the request of the navigation itself, and other pages' requests", async () => {
    const { ws, tracker } = await setup();
    ws.emitEvent("network.beforeRequestSent", {
      ...base("doc", "top"),
      navigation: "nav-2",
    });
    start(ws, "elsewhere", "other");
    commit(ws, "top", "nav-2");
    assert.equal(
      tracker.inflight,
      1,
      "only the document request is counted: the other page is not ours",
    );
    commit(ws, "other", "nav-9");
    assert.equal(tracker.inflight, 1);
  });

  it("ignores a commit of a page it does not track", async () => {
    const { ws, tracker } = await setup();
    start(ws, "hang");
    commit(ws, "other", "nav-2");
    assert.equal(tracker.inflight, 1);
  });
});

describe("NetworkTracker in-flight bookkeeping", () => {
  it("counts a request from beforeRequestSent until responseCompleted", async () => {
    const { ws, tracker } = await setup();
    start(ws, "1");
    start(ws, "2");
    assert.equal(tracker.inflight, 2);
    done(ws, "1");
    assert.equal(tracker.inflight, 1);
    done(ws, "2");
    assert.equal(tracker.inflight, 0);
  });

  it("fetchError ends a request too", async () => {
    const { ws, tracker } = await setup();
    start(ws, "1");
    fail(ws, "1");
    assert.equal(tracker.inflight, 0);
  });

  it("a redirect chain counts as one live request at a time", async () => {
    const { ws, tracker } = await setup();
    start(ws, "1", "top", { redirectCount: 0 });
    done(ws, "1", "top", { redirectCount: 0, status: 302 });
    assert.equal(tracker.inflight, 0);
    start(ws, "1", "top", { redirectCount: 1 });
    assert.equal(tracker.inflight, 1);
    done(ws, "1", "top", { redirectCount: 1 });
    assert.equal(tracker.inflight, 0);
  });

  it("ignores completions of requests it never saw", async () => {
    const { ws, tracker } = await setup();
    done(ws, "unknown");
    fail(ws, "unknown");
    assert.equal(tracker.inflight, 0);
  });

  it("counts iframe requests and ignores other pages and contextless requests", async () => {
    const { ws, tracker } = await setup();
    start(ws, "a", "frame");
    start(ws, "b", "other");
    start(ws, "c", null);
    assert.equal(tracker.inflight, 1);
    done(ws, "b", "other");
    assert.equal(tracker.inflight, 1);
    done(ws, "a", "frame");
    assert.equal(tracker.inflight, 0);
  });

  it("does not count requests the ignore predicate rejects, and not their completion either", async () => {
    const { ws, tracker } = await setup({
      ignore: (request: NetworkRequest) => request.url.endsWith("/events"),
    });
    ws.emitEvent(
      "network.beforeRequestSent",
      base("s", "top", { url: "https://example.test/events" }),
    );
    start(ws, "n");
    assert.equal(tracker.inflight, 1);
    assert.deepEqual(tracker.inflightUrls, ["https://example.test/n"]);
  });

  it("keeps a blocked request in flight until it completes", async () => {
    const { ws, tracker } = await setup();
    start(ws, "1", "top", { isBlocked: true });
    await tick(5);
    assert.equal(tracker.inflight, 1);
  });
});

describe("NetworkTracker lifecycle", () => {
  it("subscribes to the three network events and releases them on dispose", async () => {
    const { ws, tracker } = await setup();
    const subscribed = ws.sent
      .filter((m) => m.method === "session.subscribe")
      .map((m) => (m.params as any).events[0]);
    for (const event of [
      "network.beforeRequestSent",
      "network.responseCompleted",
      "network.fetchError",
    ]) {
      assert.ok(subscribed.includes(event), event);
    }
    await tracker.dispose();
    await tick(10);
    const unsubscribed = ws.sent.filter(
      (m) => m.method === "session.unsubscribe",
    ).length;
    assert.ok(unsubscribed >= 3);
    start(ws, "1");
    assert.equal(tracker.inflight, 0, "listeners removed");
  });

  it("dispose is idempotent", async () => {
    const { tracker } = await setup();
    await tracker.dispose();
    await assert.doesNotReject(tracker.dispose());
  });
});
