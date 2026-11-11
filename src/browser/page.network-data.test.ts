import { describe, test } from "node:test";
import assert from "node:assert/strict";
import Page from "./page.js";
import {
  autoReply,
  FakeWebSocket,
  tick,
  makeConnector,
} from "../testing/fake-websocket.js";
import { ResponseTimeoutError } from "../network/network-wait.js";

describe("Page network data", () => {
  const TREE = [{ context: "ctx-1", parent: null, children: [] }];
  function dataPage(
    settings?: ConstructorParameters<typeof Page>[2],
    body = '{"ok":true}',
  ) {
    const ws = new FakeWebSocket();
    const connector = makeConnector(ws);
    const stop = autoReply(ws, {
      "browsingContext.getTree": () => ({ contexts: TREE }),
      "network.addDataCollector": () => ({ collector: "c1" }),
      "network.getData": () => ({ bytes: { type: "string", value: body } }),
    });
    const page = new Page(connector, "ctx-1", settings);
    const commands = (method: string) =>
      ws.sent.filter((m) => m.method === method).map((m) => m.params as any);
    const base = (id: string, url: string, context = "ctx-1") => ({
      context,
      isBlocked: false,
      navigation: null,
      redirectCount: 0,
      timestamp: 0,
      request: {
        request: id,
        url,
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
    /** A request that starts and completes */
    const respond = (
      id: string,
      url: string,
      status = 200,
      context = "ctx-1",
    ) => {
      ws.emitEvent("network.beforeRequestSent", base(id, url, context));
      ws.emitEvent("network.responseCompleted", {
        ...base(id, url, context),
        response: {
          url,
          protocol: "http/1.1",
          status,
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
    };
    const request = (id: string, url: string) =>
      ws.emitEvent("network.beforeRequestSent", base(id, url));
    return { ws, page, stop, commands, respond, request };
  }

  test("setCacheDisabled sends bypass for this page, default to turn it back on", async () => {
    const { page, stop, commands } = dataPage();
    await page.setCacheDisabled(true);
    await page.setCacheDisabled(false);
    assert.deepEqual(commands("network.setCacheBehavior"), [
      { cacheBehavior: "bypass", contexts: ["ctx-1"] },
      { cacheBehavior: "default", contexts: ["ctx-1"] },
    ]);
    stop();
  });

  test("waitForResponse resolves with a Response whose body can be read", async () => {
    const { page, stop, respond, commands } = dataPage();
    // The trigger runs once tracking and body collection are set up and the wait is registered: no timing guess
    const response = await page.waitForResponse("**/api/users", {
      timeout: 5000,
      trigger: async () => {
        respond("r1", "https://example.test/api/other");
        respond("r2", "https://example.test/api/users", 201);
      },
    });
    assert.equal(response.status, 201);
    assert.equal(response.url, "https://example.test/api/users");
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(commands("network.getData"), [
      { dataType: "response", request: "r2", collector: "c1" },
    ]);
    stop();
  });

  test("with a trigger, the wait is registered before the trigger runs", async () => {
    const { page, stop, respond } = dataPage();
    await page.startNetworkTracking();
    const response = await page.waitForResponse(/users$/, {
      timeout: 1000,
      trigger: async () => respond("r1", "https://example.test/users"),
    });
    assert.equal(response.request.id, "r1");
    stop();
  });

  test("a function decides what matches", async () => {
    const { page, stop, respond } = dataPage();
    await page.startNetworkTracking();
    const response = await page.waitForResponse((r) => r.status === 404, {
      timeout: 1000,
      trigger: async () => {
        respond("r1", "https://example.test/a", 200);
        respond("r2", "https://example.test/b", 404);
      },
    });
    assert.equal(response.url, "https://example.test/b");
    stop();
  });

  test("a trigger that throws rejects with its error and leaves nothing listening", async () => {
    const { page, stop, respond } = dataPage();
    await page.startNetworkTracking();
    await assert.rejects(
      page.waitForResponse("**", {
        timeout: 1000,
        trigger: async () => {
          throw new Error("click failed");
        },
      }),
      /click failed/,
    );
    let count = 0;
    page.on("response", () => count++);
    respond("r1", "https://example.test/x");
    assert.equal(count, 1, "only our own listener");
    stop();
  });

  test("waitForResponse times out naming what it waited for", async () => {
    const { page, stop } = dataPage();
    await assert.rejects(
      page.waitForResponse("**/api/users", { timeout: 40 }),
      (err: unknown) => {
        assert.ok(err instanceof ResponseTimeoutError);
        assert.equal(
          err.message,
          'waitForResponse(): no response matching "**/api/users" within 40ms',
        );
        return true;
      },
    );
    await assert.rejects(
      page.waitForResponse(/users/, { timeout: 20 }),
      /no response matching \/users\/ within 20ms/,
    );
    await assert.rejects(
      page.waitForResponse(() => false, { timeout: 20 }),
      /no response matching the given function within 20ms/,
    );
    stop();
  });

  test("waitForRequest resolves with the request", async () => {
    const { page, stop, request } = dataPage();
    await page.startNetworkTracking();
    const found = await page.waitForRequest("**/api/**", {
      timeout: 1000,
      trigger: async () => {
        request("r1", "https://example.test/static.css");
        request("r2", "https://example.test/api/users");
      },
    });
    assert.equal(found.url, "https://example.test/api/users");
    await assert.rejects(
      page.waitForRequest("**/never", { timeout: 20 }),
      /waitForRequest\(\): no request matching "\*\*\/never" within 20ms/,
    );
    stop();
  });

  test("page.on(response) hands out Responses with bodies, one instance for every listener", async () => {
    const { page, stop, respond, commands } = dataPage();
    const seen: unknown[] = [];
    page.on("response", (response) => seen.push(response));
    page.on("response", (response) => seen.push(response));
    await tick(40);
    respond("r1", "https://example.test/x");
    assert.equal(seen[0], seen[1]);
    const [response] = seen as [Awaited<ReturnType<Page["waitForResponse"]>>];
    await response.text();
    await (seen[1] as typeof response).text();
    assert.equal(
      commands("network.getData").length,
      1,
      "read from the browser once",
    );
    assert.equal(commands("network.disownData").length, 1, "and released");
    stop();
  });

  test("one collector serves the page, created once", async () => {
    const { page, stop, commands } = dataPage();
    await Promise.all([page.startBodyCollection(), page.startBodyCollection()]);
    await page.waitForResponse("**", { timeout: 20 }).catch(() => {});
    assert.equal(commands("network.addDataCollector").length, 1);
    assert.deepEqual(commands("network.addDataCollector")[0], {
      dataTypes: ["response"],
      maxEncodedDataSize: 10 * 1024 * 1024,
      contexts: ["ctx-1"],
    });
    stop();
  });

  test("config collectBodies starts collecting with the page, maxBodySize sets the limit", async () => {
    const { page, stop, commands } = dataPage({
      network: { collectBodies: true, maxBodySize: 4096 },
    });
    await page.startNetworkTracking();
    assert.equal(
      commands("network.addDataCollector")[0].maxEncodedDataSize,
      4096,
    );
    stop();
  });

  test("bodies are not collected unless something asks for responses", async () => {
    const { page, stop, commands } = dataPage();
    await page.startNetworkTracking();
    assert.equal(commands("network.addDataCollector").length, 0);
    stop();
  });

  test("dispose removes the collector", async () => {
    const { page, stop, commands } = dataPage();
    await page.startBodyCollection();
    await page.dispose();
    assert.deepEqual(commands("network.removeDataCollector"), [
      { collector: "c1" },
    ]);
    stop();
  });
});
