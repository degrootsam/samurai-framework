import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ContextTree } from "../browser/context-tree.js";
import { autoReply, FakeWebSocket, tick } from "../testing/fake-websocket.js";
import { BiDiConnector } from "../transport/bidi-connection.js";
import { WaitTimeoutError } from "../wait/wait-until.js";
import { NetworkIdleTimeoutError, NetworkTracker, type NetworkRequest } from "./network-tracker.js";

const TREE = [
  { context: "top", parent: null, children: [{ context: "frame", parent: "top", children: [] }] },
  { context: "other", parent: null, children: [] },
];

const stops: Array<() => void> = [];
afterEach(() => stops.splice(0).forEach((stop) => stop()));

async function setup(options?: { ignore?: (r: NetworkRequest) => boolean }) {
  const ws = new FakeWebSocket();
  const connector = new BiDiConnector(ws as unknown as WebSocket);
  stops.push(autoReply(ws, { "browsingContext.getTree": () => ({ contexts: TREE }) }));
  const tree = await ContextTree.create(connector);
  const tracker = await NetworkTracker.start(connector, tree, "top", options);
  return { ws, tracker };
}

function requestData(id: string, url = `https://example.test/${id}`, extra: object = {}) {
  return {
    request: id,
    url,
    method: "GET",
    headers: [{ name: "Accept", value: { type: "string", value: "text/html" } }],
    cookies: [],
    headersSize: 0,
    bodySize: null,
    destination: "script",
    initiatorType: "script",
    timings: {},
    ...extra,
  };
}
const base = (id: string, context: string | null, extra: { redirectCount?: number; url?: string; isBlocked?: boolean } = {}) => ({
  context,
  isBlocked: extra.isBlocked ?? false,
  navigation: null,
  redirectCount: extra.redirectCount ?? 0,
  request: requestData(id, extra.url),
  timestamp: 0,
});
const response = (status = 200, headers: Array<{ name: string; value: object }> = []) => ({
  url: "https://example.test/x",
  protocol: "http/1.1",
  status,
  statusText: "OK",
  fromCache: false,
  headers,
  mimeType: "text/plain",
  bytesReceived: 0,
  headersSize: 0,
  bodySize: 0,
  content: { size: 0 },
});
const start = (ws: FakeWebSocket, id: string, context: string | null = "top", extra = {}) =>
  ws.emitEvent("network.beforeRequestSent", base(id, context, extra));
const done = (ws: FakeWebSocket, id: string, context: string | null = "top", extra: { redirectCount?: number; status?: number; headers?: Array<{ name: string; value: object }> } = {}) =>
  ws.emitEvent("network.responseCompleted", {
    ...base(id, context, extra),
    response: response(extra.status, extra.headers),
  });
const fail = (ws: FakeWebSocket, id: string, context: string | null = "top", extra = {}) =>
  ws.emitEvent("network.fetchError", { ...base(id, context, extra), errorText: "NS_ERROR_NET_RESET" });

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
    const { ws, tracker } = await setup({ ignore: (request: NetworkRequest) => request.url.endsWith("/events") });
    ws.emitEvent("network.beforeRequestSent", base("s", "top", { url: "https://example.test/events" }));
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

describe("NetworkTracker.waitForIdle", () => {
  it("resolves after idleTime on a page that is already quiet", async () => {
    const { tracker } = await setup();
    const started = Date.now();
    await tracker.waitForIdle({ idleTime: 40, timeout: 1000 });
    assert.ok(Date.now() - started >= 35);
  });

  it("waits for requests in flight, then for idleTime after the last one", async () => {
    const { ws, tracker } = await setup();
    start(ws, "1");
    let resolved = false;
    const idle = tracker.waitForIdle({ idleTime: 60, timeout: 2000 }).then(() => (resolved = true));
    await tick(80);
    assert.equal(resolved, false, "a request is still in flight");
    done(ws, "1");
    const finished = Date.now();
    await tick(30);
    assert.equal(resolved, false, "idleTime has not passed yet");
    await idle;
    assert.ok(Date.now() - finished >= 55);
  });

  it("restarts the idle timer when a new request starts", async () => {
    const { ws, tracker } = await setup();
    let resolved = false;
    const idle = tracker.waitForIdle({ idleTime: 60, timeout: 2000 }).then(() => (resolved = true));
    await tick(40);
    start(ws, "1");
    await tick(60);
    assert.equal(resolved, false);
    done(ws, "1");
    await idle;
    assert.equal(resolved, true);
  });

  it("times out with the URLs still in flight", async () => {
    const { ws, tracker } = await setup();
    for (let i = 0; i < 7; i++) start(ws, `r${i}`);
    await assert.rejects(tracker.waitForIdle({ idleTime: 20, timeout: 60 }), (err: unknown) => {
      assert.ok(err instanceof NetworkIdleTimeoutError);
      assert.ok(err instanceof WaitTimeoutError);
      assert.equal(err.timeout, 60);
      assert.equal(err.last?.length, 5, "at most five URLs");
      assert.match(err.message, /waitForNetworkIdle\(\): still 7 request\(s\) in flight after 60ms: https:\/\/example\.test\/r0/);
      return true;
    });
  });

  it("stops listening after it resolves or times out", async () => {
    const { ws, tracker } = await setup();
    await tracker.waitForIdle({ idleTime: 10, timeout: 500 });
    start(ws, "1");
    done(ws, "1");
    assert.equal(tracker.waiting, 0);
  });

  it("rejects pending waits with page closed when disposed", async () => {
    const { ws, tracker } = await setup();
    start(ws, "1");
    const idle = tracker.waitForIdle({ idleTime: 20, timeout: 5000 });
    const rejection = assert.rejects(idle, /page closed/);
    await tracker.dispose();
    await rejection;
  });
});

describe("NetworkTracker events", () => {
  it("emits request, response and requestfailed with plain wrappers", async () => {
    const { ws, tracker } = await setup();
    const seen: string[] = [];
    let request!: NetworkRequest;
    tracker.on("request", (r) => {
      request = r;
      seen.push(`request ${r.method} ${r.url}`);
    });
    tracker.on("response", (r) => seen.push(`response ${r.status} ${r.request.url}`));
    tracker.on("requestfailed", (r) => seen.push(`failed ${r.errorText}`));
    start(ws, "1");
    done(ws, "1", "top", { headers: [{ name: "Content-Type", value: { type: "string", value: "text/plain" } }] });
    start(ws, "2");
    fail(ws, "2");
    assert.deepEqual(seen, [
      "request GET https://example.test/1",
      "response 200 https://example.test/1",
      "request GET https://example.test/2",
      "failed NS_ERROR_NET_RESET",
    ]);
    assert.deepEqual(request.headers, { accept: "text/html" });
    assert.equal(request.resourceType, "script");
    assert.equal(request.redirectedFrom, null);
  });

  it("decodes base64 header values and joins repeated headers", async () => {
    const { ws, tracker } = await setup();
    let headers: Record<string, string> = {};
    tracker.on("response", (r) => (headers = r.headers));
    start(ws, "1");
    done(ws, "1", "top", {
      headers: [
        { name: "X-B64", value: { type: "base64", value: Buffer.from("héllo").toString("base64") } },
        { name: "Set-Cookie", value: { type: "string", value: "a=1" } },
        { name: "set-cookie", value: { type: "string", value: "b=2" } },
      ],
    });
    assert.deepEqual(headers, { "x-b64": "héllo", "set-cookie": "a=1, b=2" });
  });

  it("links a redirect to the request it came from", async () => {
    const { ws, tracker } = await setup();
    const requests: NetworkRequest[] = [];
    tracker.on("request", (r) => requests.push(r));
    start(ws, "1", "top", { redirectCount: 0, url: "https://example.test/old" });
    done(ws, "1", "top", { redirectCount: 0, status: 301 });
    start(ws, "1", "top", { redirectCount: 1, url: "https://example.test/new" });
    assert.equal(requests[1]!.redirectedFrom, requests[0]);
    assert.equal(requests[0]!.redirectedFrom, null);
  });

  it("events of other pages are not emitted", async () => {
    const { ws, tracker } = await setup();
    let count = 0;
    tracker.on("request", () => count++);
    start(ws, "1", "other");
    assert.equal(count, 0);
  });

  it("a throwing listener does not break tracking or other listeners", async () => {
    const { ws, tracker } = await setup();
    let second = 0;
    tracker.on("request", () => {
      throw new Error("listener failed");
    });
    tracker.on("request", () => second++);
    start(ws, "1");
    assert.equal(second, 1);
    assert.equal(tracker.inflight, 1);
  });

  it("off removes a listener", async () => {
    const { ws, tracker } = await setup();
    let count = 0;
    const listener = () => count++;
    tracker.on("request", listener);
    tracker.off("request", listener);
    start(ws, "1");
    assert.equal(count, 0);
  });
});

describe("NetworkTracker lifecycle", () => {
  it("subscribes to the three network events and releases them on dispose", async () => {
    const { ws, tracker } = await setup();
    const subscribed = ws.sent.filter((m) => m.method === "session.subscribe").map((m) => (m.params as any).events[0]);
    for (const event of ["network.beforeRequestSent", "network.responseCompleted", "network.fetchError"]) {
      assert.ok(subscribed.includes(event), event);
    }
    await tracker.dispose();
    await tick(10);
    const unsubscribed = ws.sent.filter((m) => m.method === "session.unsubscribe").length;
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
