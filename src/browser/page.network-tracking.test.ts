import { describe, test } from "node:test";
import assert from "node:assert/strict";
import Page from "./page.js";
import {
  autoReply,
  FakeWebSocket,
  tick,
  makeConnector,
} from "../testing/fake-websocket.js";

describe("Page network tracking", () => {
  const TREE = [{ context: "ctx-1", parent: null, children: [] }];
  function trackedPage(settings?: ConstructorParameters<typeof Page>[2]) {
    const ws = new FakeWebSocket();
    const connector = makeConnector(ws);
    const stop = autoReply(ws, {
      "browsingContext.getTree": () => ({ contexts: TREE }),
    });
    const page = new Page(connector, "ctx-1", settings);
    const subscribes = () =>
      ws.sent.filter((m) => m.method === "session.subscribe").length;
    return { ws, page, stop, subscribes };
  }
  const requestParams = (id: string, context = "ctx-1") => ({
    context,
    isBlocked: false,
    navigation: null,
    redirectCount: 0,
    timestamp: 0,
    request: {
      request: id,
      url: `https://example.test/${id}`,
      method: "GET",
      headers: [],
      cookies: [],
      headersSize: 0,
      bodySize: null,
      destination: "",
      initiatorType: "fetch",
      timings: {},
    },
  });
  const completed = (id: string) => ({
    ...requestParams(id),
    response: {
      url: "",
      protocol: "",
      status: 200,
      statusText: "OK",
      fromCache: false,
      headers: [],
      mimeType: "",
      bytesReceived: 0,
      headersSize: 0,
      bodySize: 0,
      content: { size: 0 },
    },
  });

  test("waitForNetworkIdle resolves on a quiet page after idleTime", async () => {
    const { page, stop } = trackedPage();
    const started = Date.now();
    await page.waitForNetworkIdle({ idleTime: 40, timeout: 2000 });
    assert.ok(Date.now() - started >= 35);
    stop();
  });

  test("waitForNetworkIdle waits for requests in flight", async () => {
    const { ws, page, stop } = trackedPage();
    await page.startNetworkTracking();
    ws.emitEvent("network.beforeRequestSent", requestParams("1"));
    let idle = false;
    const waiting = page
      .waitForNetworkIdle({ idleTime: 20, timeout: 2000 })
      .then(() => (idle = true));
    await tick(60);
    assert.equal(idle, false);
    ws.emitEvent("network.responseCompleted", completed("1"));
    await waiting;
    stop();
  });

  test("waitForNetworkIdle names the requests still in flight on timeout", async () => {
    const { ws, page, stop } = trackedPage();
    await page.startNetworkTracking();
    ws.emitEvent("network.beforeRequestSent", requestParams("slow"));
    await assert.rejects(
      page.waitForNetworkIdle({ idleTime: 10, timeout: 50 }),
      /waitForNetworkIdle\(\): still 1 request\(s\) in flight after 50ms: https:\/\/example\.test\/slow/,
    );
    stop();
  });

  test("the idle time defaults to the config value", async () => {
    const { page, stop } = trackedPage({ network: { idleTime: 30 } });
    const started = Date.now();
    await page.waitForNetworkIdle();
    const took = Date.now() - started;
    assert.ok(took >= 25 && took < 400, `took ${took}ms`);
    stop();
  });

  test("one tracker serves every call; the network events are subscribed once", async () => {
    const { page, stop, subscribes } = trackedPage();
    await Promise.all([
      page.startNetworkTracking(),
      page.startNetworkTracking(),
    ]);
    await page.waitForNetworkIdle({ idleTime: 5, timeout: 1000 });
    // contextCreated + contextDestroyed for the tree; three network events and navigationCommitted for the network
    assert.equal(subscribes(), 6);
    stop();
  });

  test("startTracking sizes the page and starts every tracker once, in the browser's order", async () => {
    const { ws, page, stop } = trackedPage({
      use: { viewport: { width: 800, height: 600 } },
    });
    await page.startTracking();
    await page.startTracking();
    const events = ws.sent
      .filter((m) => m.method === "session.subscribe")
      .flatMap((m) => (m.params as { events: string[] }).events);
    // The tree first (everything attributes frames through it), then network, dialogs, logs, downloads, file pickers
    const first = (prefix: string) =>
      events.findIndex((event) => event.startsWith(prefix));
    assert.ok(first("network.") < first("browsingContext.userPrompt"));
    assert.ok(first("browsingContext.userPrompt") < first("log."));
    assert.ok(first("log.") < first("browsingContext.download"));
    assert.ok(first("browsingContext.download") < first("input."));
    for (const event of [
      "network.beforeRequestSent",
      "log.entryAdded",
      "input.fileDialogOpened",
    ]) {
      assert.equal(
        events.filter((e) => e === event).length,
        1,
        `${event} once`,
      );
    }
    assert.equal(
      ws.sent.filter((m) => m.method === "browsingContext.setViewport").length,
      2,
      "the size is applied on each call; the trackers only once",
    );
    stop();
  });

  test("request, response and requestfailed events reach page.on, and page.off stops them", async () => {
    const { ws, page, stop } = trackedPage();
    const seen: string[] = [];
    const onRequest = (r: { url: string }) => seen.push(`request ${r.url}`);
    page.on("request", onRequest);
    page.on("requestfailed", (r) => seen.push(`failed ${r.errorText}`));
    await page.startNetworkTracking();
    ws.emitEvent("network.beforeRequestSent", requestParams("1"));
    ws.emitEvent("network.fetchError", {
      ...requestParams("1"),
      errorText: "boom",
    });
    page.off("request", onRequest);
    ws.emitEvent("network.beforeRequestSent", requestParams("2"));
    assert.deepEqual(seen, ["request https://example.test/1", "failed boom"]);
    stop();
  });

  test("page.once fires a single time", async () => {
    const { ws, page, stop } = trackedPage();
    let count = 0;
    page.once("request", () => count++);
    await page.startNetworkTracking();
    ws.emitEvent("network.beforeRequestSent", requestParams("1"));
    ws.emitEvent("network.beforeRequestSent", requestParams("2"));
    assert.equal(count, 1);
    stop();
  });

  test("with tracking disabled, waitForNetworkIdle says so and nothing is subscribed", async () => {
    const { page, stop, subscribes } = trackedPage({
      network: { track: false },
    });
    await page.startNetworkTracking();
    await assert.rejects(
      page.waitForNetworkIdle(),
      /network tracking is disabled/,
    );
    assert.equal(subscribes(), 0);
    stop();
  });

  test("dispose stops tracking and releases the subscriptions", async () => {
    const { ws, page, stop } = trackedPage();
    await page.startNetworkTracking();
    await page.dispose();
    await tick(10);
    assert.ok(
      ws.sent.filter((m) => m.method === "session.unsubscribe").length >= 3,
    );
    stop();
  });
});
