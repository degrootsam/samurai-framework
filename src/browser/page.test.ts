import { describe, test } from "node:test";
import assert from "node:assert/strict";
import Page from "./page.js";
import { stubConnector } from "../testing/stub-connector.js";
import { autoReply, FakeWebSocket, tick } from "../testing/fake-websocket.js";
import { BiDiConnector } from "../transport/bidi-connection.js";
import { LoadStateTimeoutError, NavigationError } from "./navigation-error.js";
import { ResponseTimeoutError } from "../network/network-wait.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { UnsupportedOperationError } from "../locator/selector-errors.js";
import { ActionTimeoutError } from "../locator/action-timeout-error.js";

test("navigateTo keeps URLs that have a scheme and prefixes bare hosts", async () => {
  const { connector, sent } = stubConnector({ type: "undefined" });
  const page = new Page(connector, "ctx");
  await page.navigateTo("about:blank");
  await page.navigateTo("https://itmetsam.nl/contact");
  await page.navigateTo("itmetsam.nl");
  await page.navigateTo("localhost:3000/login");
  await page.navigateTo("itmetsam.nl", undefined, "http");
  assert.deepEqual(
    sent.map(({ params }) => (params as { url: string }).url),
    [
      "about:blank",
      "https://itmetsam.nl/contact",
      "https://itmetsam.nl",
      "https://localhost:3000/login",
      "http://itmetsam.nl",
    ],
  );
});

describe("Page foundation", () => {
  function realPage(handlers: Record<string, (params: any) => object | Error> = {}) {
    const ws = new FakeWebSocket();
    const connector = new BiDiConnector(ws as unknown as WebSocket);
    const stop = autoReply(ws, handlers);
    return { ws, connector, page: new Page(connector, "ctx-1"), stop };
  }

  test("exposes its context id", () => {
    const { page, stop } = realPage();
    assert.equal(page.contextId, "ctx-1");
    stop();
  });

  test("shares one lazily created ContextTree", async () => {
    const { ws, page, stop } = realPage({
      "browsingContext.getTree": () => ({ contexts: [{ context: "ctx-1", parent: null, children: [] }] }),
    });
    assert.equal(ws.sent.length, 0);
    const [a, b] = await Promise.all([page.tree(), page.tree()]);
    assert.equal(a, b);
    assert.equal(ws.sent.filter((m) => m.method === "browsingContext.getTree").length, 1);
    assert.equal(a.isWithin("ctx-1", "ctx-1"), true);
    await a.dispose();
    stop();
  });

});

describe("Page init scripts", () => {
  const ok = { type: "success", realm: "r", result: { type: "undefined" } };
  function initPage() {
    const ws = new FakeWebSocket();
    const connector = new BiDiConnector(ws as unknown as WebSocket);
    let scripts = 0;
    const stop = autoReply(ws, {
      "script.addPreloadScript": () => ({ script: `preload-${++scripts}` }),
      "browsingContext.getTree": () => ({ contexts: [{ context: "ctx-1", parent: null, children: [] }] }),
      "script.callFunction": () => ok,
      "browsingContext.locateNodes": () => ({ nodes: [{ type: "node", sharedId: "n1" }] }),
    });
    const page = new Page(connector, "ctx-1");
    const sent = (method: string) => ws.sent.filter((m) => m.method === method);
    return { ws, page, stop, sent };
  }

  /** Runs a wrapped init script against a fake global and returns what it recorded */
  function run(functionDeclaration: string) {
    const recorded: unknown[] = [];
    const record = (value: unknown) => recorded.push(value);
    (globalThis as any).record = record;
    try {
      new Function("record", `(${functionDeclaration})()`)(record);
    } finally {
      delete (globalThis as any).record;
    }
    return recorded;
  }

  test("a function is registered for the page's context, in the page realm", async () => {
    const { page, sent, stop } = initPage();
    const handle = await page.addInitScript(() => {
      (globalThis as any).__flag = true;
    });
    const params = sent("script.addPreloadScript")[0]!.params as any;
    assert.deepEqual(params.contexts, ["ctx-1"]);
    assert.equal(params.sandbox, undefined);
    assert.match(params.functionDeclaration, /__flag/);
    assert.equal(handle.id, "preload-1");
    stop();
  });

  test("it also runs in the document that is already loaded", async () => {
    const { page, sent, stop } = initPage();
    await page.addInitScript(() => {});
    const call = sent("script.callFunction")[0]!.params as any;
    assert.deepEqual(call.target, { context: "ctx-1" });
    stop();
  });

  test("the argument is embedded as JSON and passed as the function's first argument", async () => {
    const { page, sent, stop } = initPage();
    await page.addInitScript((arg: { a: number; s: string }) => (globalThis as any).record(arg), {
      a: 1,
      s: `q"uote `,
    });
    const declaration = (sent("script.addPreloadScript")[0]!.params as any).functionDeclaration;
    assert.deepEqual(run(declaration), [{ a: 1, s: `q"uote ` }]);
    stop();
  });

  test("a function without an argument is called with undefined", async () => {
    const { page, sent, stop } = initPage();
    await page.addInitScript((arg?: unknown) => (globalThis as any).record(arg));
    const declaration = (sent("script.addPreloadScript")[0]!.params as any).functionDeclaration;
    assert.deepEqual(run(declaration), [undefined]);
    stop();
  });

  test("a string is script source and runs as statements", async () => {
    const { page, sent, stop } = initPage();
    await page.addInitScript(`record("a"); record("b");`);
    const declaration = (sent("script.addPreloadScript")[0]!.params as any).functionDeclaration;
    assert.deepEqual(run(declaration), ["a", "b"]);
    stop();
  });

  test("a string cannot take an argument, and the argument must be JSON", async () => {
    const { page, sent, stop } = initPage();
    await assert.rejects(page.addInitScript("1", { a: 1 }), TypeError);
    await assert.rejects(page.addInitScript(() => {}, 10n), TypeError);
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    await assert.rejects(page.addInitScript(() => {}, loop), TypeError);
    assert.equal(sent("script.addPreloadScript").length, 0);
    stop();
  });

  test("a function that needs the transpiler's __name helper is rejected", async () => {
    const { page, stop } = initPage();
    await assert.rejects(
      page.addInitScript(() => {
        function inner() {}
        inner();
      }),
      { name: "ScriptSerializationError" },
    );
    stop();
  });

  test("a throwing init script does not fail the registration in the loaded document", async () => {
    const ws = new FakeWebSocket();
    const connector = new BiDiConnector(ws as unknown as WebSocket);
    const stop = autoReply(ws, {
      "script.addPreloadScript": () => ({ script: "p" }),
      "browsingContext.getTree": () => ({ contexts: [{ context: "ctx-1", parent: null, children: [] }] }),
      "script.callFunction": () => ({
        type: "exception",
        realm: "r",
        exceptionDetails: { text: "boom", stackTrace: { callFrames: [] } },
      }),
    });
    const page = new Page(connector, "ctx-1");
    await assert.doesNotReject(page.addInitScript(() => {}));
    stop();
  });

  test("dispose() on the handle removes it, and page.dispose() removes the rest", async () => {
    const { page, sent, stop } = initPage();
    const first = await page.addInitScript(() => {});
    await page.addInitScript(() => {});
    await first.dispose();
    assert.equal(sent("script.removePreloadScript").length, 1);
    await page.dispose();
    const removed = sent("script.removePreloadScript").map((m) => (m.params as any).script);
    assert.deepEqual(removed.sort(), ["preload-1", "preload-2"]);
    await page.dispose(); // nothing left to remove
    assert.equal(sent("script.removePreloadScript").length, 2);
    stop();
  });

  test("locators created by the page share its helper realm", async () => {
    const { page, sent, stop } = initPage();
    const a = page.locator("//a");
    const b = page.locator("//b");
    await Promise.all([a.isEnabled().catch(() => {}), b.isEnabled().catch(() => {})]);
    // one registration of the framework helpers however many locators probe
    const helperRegistrations = sent("script.addPreloadScript").filter(
      (m) => (m.params as any).sandbox === "samurai",
    );
    assert.equal(helperRegistrations.length, 1);
    stop();
  });
});

describe("Page network tracking", () => {
  const TREE = [{ context: "ctx-1", parent: null, children: [] }];
  function trackedPage(settings?: ConstructorParameters<typeof Page>[2]) {
    const ws = new FakeWebSocket();
    const connector = new BiDiConnector(ws as unknown as WebSocket);
    const stop = autoReply(ws, { "browsingContext.getTree": () => ({ contexts: TREE }) });
    const page = new Page(connector, "ctx-1", settings);
    const subscribes = () => ws.sent.filter((m) => m.method === "session.subscribe").length;
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
    response: { url: "", protocol: "", status: 200, statusText: "OK", fromCache: false, headers: [], mimeType: "", bytesReceived: 0, headersSize: 0, bodySize: 0, content: { size: 0 } },
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
    const waiting = page.waitForNetworkIdle({ idleTime: 20, timeout: 2000 }).then(() => (idle = true));
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
    await Promise.all([page.startNetworkTracking(), page.startNetworkTracking()]);
    await page.waitForNetworkIdle({ idleTime: 5, timeout: 1000 });
    // contextCreated + contextDestroyed for the tree, three for the network
    assert.equal(subscribes(), 5);
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
    ws.emitEvent("network.fetchError", { ...requestParams("1"), errorText: "boom" });
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
    const { page, stop, subscribes } = trackedPage({ network: { track: false } });
    await page.startNetworkTracking();
    await assert.rejects(page.waitForNetworkIdle(), /network tracking is disabled/);
    assert.equal(subscribes(), 0);
    stop();
  });

  test("dispose stops tracking and releases the subscriptions", async () => {
    const { ws, page, stop } = trackedPage();
    await page.startNetworkTracking();
    await page.dispose();
    await tick(10);
    assert.ok(ws.sent.filter((m) => m.method === "session.unsubscribe").length >= 3);
    stop();
  });
});

describe("Page navigation", () => {
  const success = (value: string) => ({ type: "success", realm: "r", result: { type: "string", value } });
  const TREE = [{ context: "ctx-1", parent: null, children: [] }];

  function navPage(
    handlers: Record<string, (params: any) => object | Error> = {},
    settings?: ConstructorParameters<typeof Page>[2],
  ) {
    const ws = new FakeWebSocket();
    const connector = new BiDiConnector(ws as unknown as WebSocket);
    const stop = autoReply(ws, {
      "browsingContext.navigate": (params) => ({ navigation: "nav-1", url: params.url }),
      "browsingContext.getTree": () => ({ contexts: TREE }),
      "script.callFunction": () => success("complete"),
      ...handlers,
    });
    const page = new Page(connector, "ctx-1", settings);
    const navigates = () => ws.sent.filter((m) => m.method === "browsingContext.navigate").map((m) => m.params as any);
    return { ws, page, stop, navigates };
  }
  const navInfo = (context: string, navigation = "nav-1") => ({ context, navigation, url: "https://example.test/", timestamp: 0 });

  describe("navigateTo", () => {
    test("waits for complete by default, and returns the navigation and url", async () => {
      const { page, navigates, stop } = navPage();
      const result = await page.navigateTo("example.test");
      assert.deepEqual(result, { navigation: "nav-1", url: "https://example.test" });
      assert.equal(navigates()[0].wait, "complete");
      stop();
    });

    test("the wait comes from the options, or from config", async () => {
      const { page, navigates, stop } = navPage({}, { navigation: { waitUntil: "interactive" } });
      await page.navigateTo("example.test");
      await page.navigateTo("example.test", { wait: "none" });
      assert.deepEqual(navigates().map((n) => n.wait), ["interactive", "none"]);
      stop();
    });

    test("still accepts the positional wait and protocol", async () => {
      const { page, navigates, stop } = navPage();
      await page.navigateTo("example.test", "interactive", "http");
      await page.navigateTo("example.test", undefined, "http");
      await page.navigateTo("example.test", { protocol: "http" });
      assert.deepEqual(
        navigates().map((n) => [n.wait, n.url]),
        [
          ["interactive", "http://example.test"],
          ["complete", "http://example.test"],
          ["complete", "http://example.test"],
        ],
      );
      stop();
    });

    test("a same-document navigation has no navigation id", async () => {
      const { page, stop } = navPage({ "browsingContext.navigate": (p) => ({ navigation: null, url: p.url }) });
      assert.equal((await page.navigateTo("about:blank#x")).navigation, null);
      stop();
    });

    test("a browser error becomes a NavigationError naming the url and the reason", async () => {
      const ws = new FakeWebSocket();
      const connector = new BiDiConnector(ws as unknown as WebSocket);
      const timer = setInterval(() => {
        for (const m of ws.sent.splice(0)) ws.replyError(m.id, "unknown error", "NS_ERROR_CONNECTION_REFUSED");
      }, 1).unref();
      const page = new Page(connector, "ctx-1");
      await assert.rejects(page.navigateTo("http://127.0.0.1:1/"), (err: unknown) => {
        assert.ok(err instanceof NavigationError);
        assert.equal(err.url, "http://127.0.0.1:1/");
        assert.equal(err.code, "unknown error");
        assert.match(err.reason, /NS_ERROR_CONNECTION_REFUSED/);
        assert.match(err.message, /^navigateTo\(\): http:\/\/127\.0\.0\.1:1\/ failed: .*NS_ERROR_CONNECTION_REFUSED/);
        return true;
      });
      clearInterval(timer);
    });

    test("times out after the navigation timeout with a NavigationError", async () => {
      const ws = new FakeWebSocket();
      const connector = new BiDiConnector(ws as unknown as WebSocket);
      const page = new Page(connector, "ctx-1", { navigation: { timeout: 40 } });
      await assert.rejects(page.navigateTo("https://slow.test/"), (err: unknown) => {
        assert.ok(err instanceof NavigationError);
        assert.equal(err.reason, "timeout after 40ms");
        assert.equal(err.code, "timeout");
        return true;
      });
    });

    test("the timeout can be set per call", async () => {
      const ws = new FakeWebSocket();
      const connector = new BiDiConnector(ws as unknown as WebSocket);
      const page = new Page(connector, "ctx-1");
      await assert.rejects(page.navigateTo("https://slow.test/", { timeout: 30 }), /timeout after 30ms/);
    });
  });

  describe("waitForLoadState", () => {
    test("resolves at once when the document has already loaded", async () => {
      const { page, ws, stop } = navPage();
      await page.waitForLoadState("load", { timeout: 1000 });
      assert.equal(ws.sent.filter((m) => m.method === "script.callFunction").length, 1);
      stop();
    });

    test("domcontentloaded is reached at interactive as well", async () => {
      const { page, stop } = navPage({ "script.callFunction": () => success("interactive") });
      await page.waitForLoadState("domcontentloaded", { timeout: 1000 });
      stop();
    });

    test("load is not reached at interactive: it waits for this page's load event", async () => {
      const { page, ws, stop } = navPage({ "script.callFunction": () => success("interactive") });
      let loaded = false;
      const waiting = page.waitForLoadState("load", { timeout: 2000 }).then(() => (loaded = true));
      await tick(30);
      ws.emitEvent("browsingContext.load", navInfo("elsewhere"));
      await tick(10);
      assert.equal(loaded, false, "another page's load event does not count");
      ws.emitEvent("browsingContext.load", navInfo("ctx-1"));
      await waiting;
      stop();
    });

    test("an event that arrives while the state is being read is not lost", async () => {
      let ws!: FakeWebSocket;
      const built = navPage({
        "script.callFunction": () => {
          ws.emitEvent("browsingContext.load", navInfo("ctx-1"));
          return success("loading");
        },
      });
      ws = built.ws;
      await built.page.waitForLoadState("load", { timeout: 1000 });
      built.stop();
    });

    test("domcontentloaded waits for its own event", async () => {
      const { page, ws, stop } = navPage({ "script.callFunction": () => success("loading") });
      const waiting = page.waitForLoadState("domcontentloaded", { timeout: 2000 });
      await tick(30);
      ws.emitEvent("browsingContext.domContentLoaded", navInfo("ctx-1"));
      await waiting;
      stop();
    });

    test("a failed navigation of this page rejects with a NavigationError", async () => {
      const { page, ws, stop } = navPage({ "script.callFunction": () => success("loading") });
      const waiting = page.waitForLoadState("load", { timeout: 2000 });
      const rejection = assert.rejects(waiting, NavigationError);
      await tick(30);
      ws.emitEvent("browsingContext.navigationFailed", navInfo("ctx-1"));
      await rejection;
      stop();
    });

    test("after navigateTo, only failures of that navigation count", async () => {
      const { page, ws, stop } = navPage({ "script.callFunction": () => success("loading") });
      await page.navigateTo("example.test", { wait: "none" }); // navigation id nav-1
      const waiting = page.waitForLoadState("load", { timeout: 300 });
      const outcome = waiting.then(
        () => "loaded",
        (err: Error) => err.name,
      );
      await tick(30);
      ws.emitEvent("browsingContext.navigationFailed", navInfo("ctx-1", "nav-0-old"));
      ws.emitEvent("browsingContext.navigationAborted", navInfo("other-context", "nav-1"));
      assert.equal(await outcome, "LoadStateTimeoutError", "unrelated failures are ignored, the wait times out");
      stop();
    });

    test("after navigateTo(wait none), failure of that navigation rejects the wait", async () => {
      const { page, ws, stop } = navPage({ "script.callFunction": () => success("loading") });
      await page.navigateTo("example.test", { wait: "none" });
      const rejection = assert.rejects(page.waitForLoadState("load", { timeout: 2000 }), NavigationError);
      await tick(30);
      ws.emitEvent("browsingContext.navigationAborted", navInfo("ctx-1", "nav-1"));
      await rejection;
      stop();
    });

    test("after navigateTo(wait none) the old document does not count: it waits for that navigation's load", async () => {
      const { page, ws, stop } = navPage(); // readyState answers "complete": the document that is still showing
      await page.navigateTo("example.test", { wait: "none" });
      let loaded = false;
      const waiting = page.waitForLoadState("load", { timeout: 2000 }).then(() => (loaded = true));
      await tick(40);
      assert.equal(loaded, false);
      ws.emitEvent("browsingContext.load", navInfo("ctx-1", "some-other-navigation"));
      await tick(10);
      ws.emitEvent("browsingContext.load", navInfo("ctx-1", "nav-1"));
      await waiting;
      stop();
    });

    test("a navigation that already loaded before the wait started is not waited for again", async () => {
      let ws!: FakeWebSocket;
      const built = navPage({
        "browsingContext.navigate": (params) => {
          ws.emitEvent("browsingContext.domContentLoaded", navInfo("ctx-1"));
          ws.emitEvent("browsingContext.load", navInfo("ctx-1"));
          return { navigation: "nav-1", url: params.url };
        },
        "script.callFunction": () => success("complete"),
      });
      ws = built.ws;
      await built.page.navigateTo("example.test", { wait: "none" });
      await built.page.waitForLoadState("load", { timeout: 500 });
      await built.page.waitForLoadState("domcontentloaded", { timeout: 500 });
      built.stop();
    });

    test("after navigateTo(wait interactive) domcontentloaded is there, load is not", async () => {
      const { page, ws, stop } = navPage();
      await page.navigateTo("example.test", { wait: "interactive" });
      await page.waitForLoadState("domcontentloaded", { timeout: 500 });
      let loaded = false;
      const waiting = page.waitForLoadState("load", { timeout: 2000 }).then(() => (loaded = true));
      await tick(40);
      assert.equal(loaded, false);
      ws.emitEvent("browsingContext.load", navInfo("ctx-1", "nav-1"));
      await waiting;
      stop();
    });

    test("after navigateTo(wait complete) the document state is read as usual", async () => {
      const { page, stop } = navPage();
      await page.navigateTo("example.test");
      await page.waitForLoadState("load", { timeout: 500 });
      stop();
    });

    test("a browser without the navigationAborted event still works, and is not asked again", async () => {
      const unsupported = Object.assign(new Error("browsingContext.navigationAborted is not a valid event name"), {
        code: "invalid argument",
      });
      const { page, ws, stop } = navPage({
        "session.subscribe": (params) => (params.events.includes("browsingContext.navigationAborted") ? unsupported : {}),
      });
      await page.waitForLoadState("load", { timeout: 1000 });
      await page.waitForLoadState("load", { timeout: 1000 });
      const asked = ws.sent
        .filter((m) => m.method === "session.subscribe")
        .filter((m) => (m.params as any).events.includes("browsingContext.navigationAborted"));
      assert.equal(asked.length, 1, "asked once, then remembered");
      stop();
    });

    test("without the aborted event a failed navigation still rejects the wait", async () => {
      const unsupported = Object.assign(new Error("not a valid event name"), { code: "invalid argument" });
      const { page, ws, stop } = navPage({
        "script.callFunction": () => success("loading"),
        "session.subscribe": (params) => (params.events.includes("browsingContext.navigationAborted") ? unsupported : {}),
      });
      const rejection = assert.rejects(page.waitForLoadState("load", { timeout: 2000 }), NavigationError);
      await tick(40);
      ws.emitEvent("browsingContext.navigationFailed", navInfo("ctx-1"));
      await rejection;
      stop();
    });

    test("times out with a LoadStateTimeoutError", async () => {
      const { page, stop } = navPage({ "script.callFunction": () => success("loading") });
      await assert.rejects(page.waitForLoadState("load", { timeout: 60 }), (err: unknown) => {
        assert.ok(err instanceof LoadStateTimeoutError);
        assert.match(err.message, /waitForLoadState\("load"\) did not finish within 60ms/);
        return true;
      });
      stop();
    });

    test("the default timeout comes from config navigation.timeout", async () => {
      const { page, stop } = navPage({ "script.callFunction": () => success("loading") }, { navigation: { timeout: 50 } });
      await assert.rejects(page.waitForLoadState(), /did not finish within 50ms/);
      stop();
    });

    test("networkidle waits for the load and then for the network to go quiet", async () => {
      const { page, ws, stop } = navPage({}, { network: { idleTime: 30 } });
      await page.startNetworkTracking();
      ws.emitEvent("network.beforeRequestSent", {
        context: "ctx-1", isBlocked: false, navigation: null, redirectCount: 0, timestamp: 0,
        request: { request: "r1", url: "https://example.test/r1", method: "GET", headers: [], cookies: [], headersSize: 0, bodySize: null, destination: "", initiatorType: "fetch", timings: {} },
      });
      let idle = false;
      const waiting = page.waitForLoadState("networkidle", { timeout: 2000 }).then(() => (idle = true));
      await tick(80);
      assert.equal(idle, false, "a request is in flight");
      ws.emitEvent("network.fetchError", {
        context: "ctx-1", isBlocked: false, navigation: null, redirectCount: 0, timestamp: 0, errorText: "x",
        request: { request: "r1", url: "https://example.test/r1", method: "GET", headers: [], cookies: [], headersSize: 0, bodySize: null, destination: "", initiatorType: "fetch", timings: {} },
      });
      await waiting;
      stop();
    });

    test("releases its subscriptions when it is done", async () => {
      const { page, ws, stop } = navPage();
      await page.waitForLoadState("load", { timeout: 1000 });
      await tick(20);
      const subscribed = ws.sent.filter((m) => m.method === "session.subscribe").length;
      const unsubscribed = ws.sent.filter((m) => m.method === "session.unsubscribe").length;
      assert.equal(unsubscribed, subscribed);
      stop();
    });
  });
});

describe("Page logs", () => {
  const TREE = [{ context: "ctx-1", parent: null, children: [] }];
  function logPage() {
    const ws = new FakeWebSocket();
    const connector = new BiDiConnector(ws as unknown as WebSocket);
    const stop = autoReply(ws, { "browsingContext.getTree": () => ({ contexts: TREE }) });
    const page = new Page(connector, "ctx-1");
    const entry = (extra: object) =>
      ws.emitEvent("log.entryAdded", {
        level: "info",
        text: "hello",
        timestamp: 5,
        source: { realm: "r", context: "ctx-1", userContext: "default" },
        ...extra,
      });
    return { ws, page, stop, entry };
  }

  test("console messages and page errors reach page.on, and page.off stops them", async () => {
    const { page, stop, entry } = logPage();
    const seen: string[] = [];
    const onConsole = (message: { type(): string; text(): string }) => seen.push(`${message.type()}: ${message.text()}`);
    page.on("console", onConsole);
    page.on("pageerror", (error) => seen.push(`error: ${error.message}`));
    await page.startLogging();
    entry({ type: "console", method: "log", args: [] });
    entry({ type: "javascript", level: "error", text: "TypeError: x" });
    page.off("console", onConsole);
    entry({ type: "console", method: "log", text: "after off", args: [] });
    assert.deepEqual(seen, ["log: hello", "error: TypeError: x"]);
    stop();
  });

  test("getLogs, pageErrors and clearLogs read what was collected", async () => {
    const { page, stop, entry } = logPage();
    assert.deepEqual(page.getLogs(), [], "nothing before logging started");
    assert.deepEqual(page.pageErrors(), []);
    await page.startLogging();
    entry({ type: "console", method: "warn", level: "warn", args: [] });
    entry({ type: "javascript", level: "error", text: "Error: boom" });
    assert.deepEqual(
      page.getLogs().map((log) => [log.type, log.level, log.text]),
      [["console", "warn", "hello"], ["javascript", "error", "Error: boom"]],
    );
    assert.deepEqual(page.pageErrors().map((error) => error.message), ["Error: boom"]);
    page.clearLogs();
    assert.deepEqual(page.getLogs(), []);
    assert.deepEqual(page.pageErrors(), []);
    stop();
  });

  test("page.on starts collecting by itself, and startLogging is idempotent", async () => {
    const { ws, page, stop } = logPage();
    page.on("console", () => {});
    await Promise.all([page.startLogging(), page.startLogging()]);
    assert.equal(ws.sent.filter((m) => m.method === "session.subscribe" && (m.params as any).events[0] === "log.entryAdded").length, 1);
    stop();
  });

  test("syncLogs makes sure everything logged so far has arrived", async () => {
    const { ws, page, stop } = logPage();
    await page.startLogging();
    await page.syncLogs();
    assert.ok(ws.sent.some((m) => m.method === "session.status"));
    stop();
  });

  test("page errors can be allowed for a test", async () => {
    const { page, stop } = logPage();
    assert.equal(page.pageErrorsAllowed, false);
    page.allowPageErrors();
    assert.equal(page.pageErrorsAllowed, true);
    stop();
  });

  test("dispose stops collecting", async () => {
    const { ws, page, stop, entry } = logPage();
    await page.startLogging();
    await page.dispose();
    await tick(10);
    entry({ type: "console", method: "log", args: [] });
    assert.deepEqual(page.getLogs(), []);
    assert.ok(ws.sent.some((m) => m.method === "session.unsubscribe"));
    stop();
  });
});

describe("Page routing", () => {
  const TREE = [{ context: "ctx-1", parent: null, children: [] }];
  function routedPage(settings?: ConstructorParameters<typeof Page>[2]) {
    const ws = new FakeWebSocket();
    const connector = new BiDiConnector(ws as unknown as WebSocket);
    let intercepts = 0;
    const stop = autoReply(ws, {
      "browsingContext.getTree": () => ({ contexts: TREE }),
      "network.addIntercept": () => ({ intercept: `i${++intercepts}` }),
    });
    const page = new Page(connector, "ctx-1", settings);
    const commands = (method: string) => ws.sent.filter((m) => m.method === method).map((m) => m.params as any);
    const blocked = (id: string, url: string) =>
      ws.emitEvent("network.beforeRequestSent", {
        context: "ctx-1", isBlocked: true, intercepts: ["i1"], navigation: null, redirectCount: 0, timestamp: 0,
        request: { request: id, url, method: "GET", headers: [], cookies: [], headersSize: 0, bodySize: null, destination: "", initiatorType: "fetch", timings: {} },
      });
    return { ws, page, stop, commands, blocked };
  }

  test("route intercepts this page's requests and answers them", async () => {
    const { page, stop, commands, blocked } = routedPage();
    await page.route("**/api/users", (route) => route.fulfill({ json: [{ id: 1 }] }));
    assert.deepEqual(commands("network.addIntercept"), [{ phases: ["beforeRequestSent"], contexts: ["ctx-1"] }]);
    blocked("r1", "https://example.test/api/users");
    await tick(30);
    assert.equal(commands("network.provideResponse")[0].statusCode, 200);
    stop();
  });

  test("unroute and unrouteAll take routes away; before any route they do nothing", async () => {
    const { ws, page, stop, commands } = routedPage();
    await page.unroute("**/nothing");
    await page.unrouteAll();
    assert.equal(ws.sent.length, 0, "no router was created for that");
    await page.route("**/a", () => {});
    await page.unroute("**/a");
    assert.equal(commands("network.removeIntercept").length, 1);
    await page.route("**/b", () => {});
    await page.unrouteAll();
    assert.equal(commands("network.removeIntercept").length, 2);
    stop();
  });

  test("errors thrown by route handlers are available from routeErrors", async () => {
    const { page, stop, blocked } = routedPage();
    assert.deepEqual(page.routeErrors(), []);
    await page.route("**", () => {
      throw new Error("handler bug");
    });
    blocked("r1", "https://example.test/x");
    await tick(30);
    assert.equal(page.routeErrors().length, 1);
    assert.match(page.routeErrors()[0]!.message, /handler bug/);
    stop();
  });

  test("the route timeout comes from config network.routeTimeout", async () => {
    const { page, stop, commands, blocked } = routedPage({ network: { routeTimeout: 40 } });
    await page.route("**", async () => {
      await tick(300);
    });
    blocked("r1", "https://example.test/x");
    await tick(120);
    assert.deepEqual(commands("network.continueRequest"), [{ request: "r1" }]);
    stop();
  });

  test("dispose removes the intercept and lets held requests continue", async () => {
    const { page, stop, commands, blocked } = routedPage();
    await page.route("**", async () => {
      await tick(500);
    });
    blocked("r1", "https://example.test/x");
    await tick(20);
    await page.dispose();
    assert.deepEqual(commands("network.continueRequest"), [{ request: "r1" }]);
    assert.equal(commands("network.removeIntercept").length, 1);
    stop();
  });
});

describe("Page network data", () => {
  const TREE = [{ context: "ctx-1", parent: null, children: [] }];
  function dataPage(settings?: ConstructorParameters<typeof Page>[2], body = '{"ok":true}') {
    const ws = new FakeWebSocket();
    const connector = new BiDiConnector(ws as unknown as WebSocket);
    const stop = autoReply(ws, {
      "browsingContext.getTree": () => ({ contexts: TREE }),
      "network.addDataCollector": () => ({ collector: "c1" }),
      "network.getData": () => ({ bytes: { type: "string", value: body } }),
    });
    const page = new Page(connector, "ctx-1", settings);
    const commands = (method: string) => ws.sent.filter((m) => m.method === method).map((m) => m.params as any);
    const base = (id: string, url: string, context = "ctx-1") => ({
      context, isBlocked: false, navigation: null, redirectCount: 0, timestamp: 0,
      request: { request: id, url, method: "GET", headers: [], cookies: [], headersSize: 0, bodySize: null, destination: "", initiatorType: "fetch", timings: {} },
    });
    /** A request that starts and completes */
    const respond = (id: string, url: string, status = 200, context = "ctx-1") => {
      ws.emitEvent("network.beforeRequestSent", base(id, url, context));
      ws.emitEvent("network.responseCompleted", {
        ...base(id, url, context),
        response: { url, protocol: "http/1.1", status, statusText: "OK", fromCache: false, headers: [], mimeType: "", bytesReceived: 0, headersSize: 0, bodySize: 0, content: { size: 0 } },
      });
    };
    const request = (id: string, url: string) => ws.emitEvent("network.beforeRequestSent", base(id, url));
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
    const waiting = page.waitForResponse("**/api/users", { timeout: 1000 });
    await tick(30); // tracking and body collection are set up first
    respond("r1", "https://example.test/api/other");
    respond("r2", "https://example.test/api/users", 201);
    const response = await waiting;
    assert.equal(response.status, 201);
    assert.equal(response.url, "https://example.test/api/users");
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(commands("network.getData"), [{ dataType: "response", request: "r2", collector: "c1" }]);
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
    await assert.rejects(page.waitForResponse("**/api/users", { timeout: 40 }), (err: unknown) => {
      assert.ok(err instanceof ResponseTimeoutError);
      assert.equal(err.message, 'waitForResponse(): no response matching "**/api/users" within 40ms');
      return true;
    });
    await assert.rejects(page.waitForResponse(/users/, { timeout: 20 }), /no response matching \/users\/ within 20ms/);
    await assert.rejects(page.waitForResponse(() => false, { timeout: 20 }), /no response matching the given function within 20ms/);
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
    await assert.rejects(page.waitForRequest("**/never", { timeout: 20 }), /waitForRequest\(\): no request matching "\*\*\/never" within 20ms/);
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
    assert.equal(commands("network.getData").length, 1, "read from the browser once");
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
    const { page, stop, commands } = dataPage({ network: { collectBodies: true, maxBodySize: 4096 } });
    await page.startNetworkTracking();
    assert.equal(commands("network.addDataCollector")[0].maxEncodedDataSize, 4096);
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
    assert.deepEqual(commands("network.removeDataCollector"), [{ collector: "c1" }]);
    stop();
  });
});

describe("Page API", () => {
  const TREE = [{ context: "ctx-1", parent: null, children: [] }];
  const str = (value: string) => ({ type: "success", realm: "r", result: { type: "string", value } });
  const PNG = Buffer.from("PNG-bytes");
  const PDF = Buffer.from("%PDF-1.7 fake");

  function apiPage(handlers: Record<string, (params: any) => object | Error> = {}, settings?: ConstructorParameters<typeof Page>[2]) {
    const ws = new FakeWebSocket();
    const connector = new BiDiConnector(ws as unknown as WebSocket);
    const stop = autoReply(ws, {
      "browsingContext.getTree": () => ({ contexts: TREE }),
      "browsingContext.captureScreenshot": () => ({ data: PNG.toString("base64") }),
      "browsingContext.print": () => ({ data: PDF.toString("base64") }),
      "browsingContext.reload": () => ({ navigation: "nav-2", url: "https://example.test/" }),
      ...handlers,
    });
    const page = new Page(connector, "ctx-1", settings);
    const commands = (method: string) => ws.sent.filter((m) => m.method === method).map((m) => m.params as any);
    return { ws, page, stop, commands };
  }
  const bidiError = (code: string, message = "nope") => Object.assign(new Error(message), { code });
  const tmp = () => mkdtempSync(path.join(tmpdir(), "samurai-page-api-"));

  describe("viewport", () => {
    test("setViewport sends the size and the pixel ratio for this page", async () => {
      const { page, stop, commands } = apiPage();
      await page.setViewport({ width: 400, height: 300 });
      await page.setViewport({ width: 800, height: 600, devicePixelRatio: 2 });
      assert.deepEqual(commands("browsingContext.setViewport"), [
        { context: "ctx-1", viewport: { width: 400, height: 300 } },
        { context: "ctx-1", viewport: { width: 800, height: 600 }, devicePixelRatio: 2 },
      ]);
      stop();
    });

    test("null resets both", async () => {
      const { page, stop, commands } = apiPage();
      await page.setViewport(null);
      assert.deepEqual(commands("browsingContext.setViewport"), [
        { context: "ctx-1", viewport: null, devicePixelRatio: null },
      ]);
      stop();
    });

    test("rejects sizes that are not positive integers before sending", async () => {
      const { page, stop, commands } = apiPage();
      for (const bad of [{ width: 0, height: 10 }, { width: 10, height: -1 }, { width: 1.5, height: 10 }, { width: NaN, height: 10 }]) {
        await assert.rejects(page.setViewport(bad), RangeError);
      }
      await assert.rejects(page.setViewport({ width: 10, height: 10, devicePixelRatio: 0 }), RangeError);
      assert.equal(commands("browsingContext.setViewport").length, 0);
      stop();
    });

    test("applyDefaultViewport uses config use.viewport, 1280x720 without one", async () => {
      const { page, stop, commands } = apiPage({}, { use: { viewport: { width: 640, height: 480 } } });
      await page.applyDefaultViewport();
      const other = apiPage();
      await other.page.applyDefaultViewport();
      assert.deepEqual(commands("browsingContext.setViewport"), [{ context: "ctx-1", viewport: { width: 640, height: 480 } }]);
      assert.deepEqual(other.commands("browsingContext.setViewport"), [{ context: "ctx-1", viewport: { width: 1280, height: 720 } }]);
      stop();
      other.stop();
    });

    test("viewport null in config keeps the browser's own size", async () => {
      const { page, stop, commands } = apiPage({}, { use: { viewport: null } });
      await page.applyDefaultViewport();
      assert.equal(commands("browsingContext.setViewport").length, 0);
      stop();
    });
  });

  describe("reload and history", () => {
    test("reload waits for complete by default and returns the navigation", async () => {
      const { page, stop, commands } = apiPage();
      const result = await page.reload();
      assert.deepEqual(result, { navigation: "nav-2", url: "https://example.test/" });
      assert.deepEqual(commands("browsingContext.reload"), [{ context: "ctx-1", wait: "complete" }]);
      stop();
    });

    test("reload takes the wait from options or config", async () => {
      const { page, stop, commands } = apiPage({}, { navigation: { waitUntil: "interactive" } });
      await page.reload();
      await page.reload({ wait: "none" });
      assert.deepEqual(commands("browsingContext.reload").map((c) => c.wait), ["interactive", "none"]);
      stop();
    });

    test("reload passes ignoreCache, and says when the browser cannot do it", async () => {
      const { page, stop, commands } = apiPage();
      await page.reload({ ignoreCache: true });
      assert.equal(commands("browsingContext.reload")[0].ignoreCache, true);
      stop();
      const refused = apiPage({ "browsingContext.reload": () => bidiError("unsupported operation", 'Argument "ignoreCache" is not supported yet.') });
      await assert.rejects(refused.page.reload({ ignoreCache: true }), (err: unknown) => {
        assert.ok(err instanceof UnsupportedOperationError);
        assert.match(err.message, /reload\(\{ ignoreCache \}\) is not supported by the browser/);
        return true;
      });
      refused.stop();
    });

    test("reload failures are NavigationErrors that name the page", async () => {
      const { page, stop } = apiPage({
        "browsingContext.reload": () => bidiError("unknown error", "NS_ERROR_NET_TIMEOUT"),
        "script.callFunction": () => str("https://example.test/here"),
      });
      await assert.rejects(page.reload(), (err: unknown) => {
        assert.ok(err instanceof NavigationError);
        assert.match(err.message, /^reload\(\): https:\/\/example\.test\/here failed: .*NS_ERROR_NET_TIMEOUT/);
        return true;
      });
      stop();
    });

    test("goBack and goForward move one entry and say true", async () => {
      const { page, stop, commands } = apiPage({ "browsingContext.traverseHistory": () => ({}) });
      assert.equal(await page.goBack(), true);
      assert.equal(await page.goForward(), true);
      assert.deepEqual(commands("browsingContext.traverseHistory"), [
        { context: "ctx-1", delta: -1 },
        { context: "ctx-1", delta: 1 },
      ]);
      stop();
    });

    test("with no entry to go to they say false; other errors are thrown", async () => {
      const none = apiPage({ "browsingContext.traverseHistory": () => bidiError("no such history entry") });
      assert.equal(await none.page.goBack(), false);
      assert.equal(await none.page.goForward(), false);
      none.stop();
      const broken = apiPage({ "browsingContext.traverseHistory": () => bidiError("no such frame") });
      await assert.rejects(broken.page.goBack(), { code: "no such frame" });
      broken.stop();
    });
  });

  describe("url and title", () => {
    test("read location.href and document.title", async () => {
      const { page, stop, ws } = apiPage({ "script.callFunction": (params) => str(params.functionDeclaration.includes("title") ? "My title" : "https://example.test/x") });
      assert.equal(await page.url(), "https://example.test/x");
      assert.equal(await page.title(), "My title");
      assert.equal(ws.sent.filter((m) => m.method === "script.callFunction").length, 2);
      stop();
    });
  });

  describe("screenshot", () => {
    test("returns the image as a Buffer; nothing but the context is sent by default", async () => {
      const { page, stop, commands } = apiPage();
      const image = await page.screenshot();
      assert.deepEqual([...image], [...PNG]);
      assert.deepEqual(commands("browsingContext.captureScreenshot"), [{ context: "ctx-1" }]);
      stop();
    });

    test("fullPage captures the document, clip a box", async () => {
      const { page, stop, commands } = apiPage();
      await page.screenshot({ fullPage: true });
      await page.screenshot({ clip: { x: 1, y: 2, width: 30, height: 40 } });
      await page.screenshot({ fullPage: true, clip: { x: 0, y: 100, width: 50, height: 60 } });
      assert.deepEqual(commands("browsingContext.captureScreenshot"), [
        { context: "ctx-1", origin: "document" },
        { context: "ctx-1", clip: { type: "box", x: 1, y: 2, width: 30, height: 40 } },
        { context: "ctx-1", origin: "document", clip: { type: "box", x: 0, y: 100, width: 50, height: 60 } },
      ]);
      stop();
    });

    test("types are sent as MIME types, jpeg quality as a fraction", async () => {
      const { page, stop, commands } = apiPage();
      await page.screenshot({ type: "png" });
      await page.screenshot({ type: "jpeg" });
      await page.screenshot({ type: "jpeg", quality: 80 });
      assert.deepEqual(commands("browsingContext.captureScreenshot").map((c) => c.format), [
        { type: "image/png" },
        { type: "image/jpeg" },
        { type: "image/jpeg", quality: 0.8 },
      ]);
      stop();
    });

    test("rejects a quality outside 0–100, or without jpeg, before sending", async () => {
      const { page, stop, commands } = apiPage();
      await assert.rejects(page.screenshot({ type: "jpeg", quality: 101 }), RangeError);
      await assert.rejects(page.screenshot({ type: "jpeg", quality: -1 }), RangeError);
      await assert.rejects(page.screenshot({ quality: 50 }), /quality only applies to jpeg/);
      await assert.rejects(page.screenshot({ type: "png", quality: 50 }), /quality only applies to jpeg/);
      assert.equal(commands("browsingContext.captureScreenshot").length, 0);
      stop();
    });

    test("path writes the file, making the folders, and still returns the image", async () => {
      const { page, stop } = apiPage();
      const dir = tmp();
      try {
        const file = path.join(dir, "deep", "er", "shot.png");
        const image = await page.screenshot({ path: file });
        assert.deepEqual([...readFileSync(file)], [...PNG]);
        assert.deepEqual([...image], [...PNG]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      stop();
    });

    test("a browser refusal is a BiDiError", async () => {
      const { page, stop } = apiPage({ "browsingContext.captureScreenshot": () => bidiError("unable to capture screen") });
      await assert.rejects(page.screenshot(), { name: "BiDiError", code: "unable to capture screen" });
      stop();
    });
  });

  describe("Locator.screenshot", () => {
    const state = (extra: object = {}) => ({
      type: "success", realm: "r",
      result: { type: "object", value: Object.entries({ attached: true, visible: true, enabled: true, editable: false, box: null, hitTarget: null, ...extra }).map(([k, v]) => [k, v === null ? { type: "null" } : { type: typeof v === "boolean" ? "boolean" : "string", value: v }]) },
    });
    const located = { "browsingContext.locateNodes": () => ({ nodes: [{ type: "node", sharedId: "node-9" }] }) };

    test("captures just the element, after waiting until it is attached and visible", async () => {
      const { page, stop, commands } = apiPage({ ...located, "script.callFunction": () => state() });
      const image = await page.locator("div[@id='card']").screenshot({ timeout: 1000 });
      assert.deepEqual([...image], [...PNG]);
      assert.deepEqual(commands("browsingContext.captureScreenshot"), [
        { context: "ctx-1", clip: { type: "element", element: { sharedId: "node-9" } } },
      ]);
      stop();
    });

    test("scrolls the element into view first", async () => {
      const { page, stop, ws } = apiPage({ ...located, "script.callFunction": () => state() });
      await page.locator("div").screenshot({ timeout: 1000 });
      const probe = ws.sent.find((m) => m.method === "script.callFunction" && (m.params as any).arguments)!.params as any;
      assert.deepEqual(probe.arguments[1].value.find(([k]: [string]) => k === "scroll")[1], { type: "boolean", value: true });
      stop();
    });

    test("times out naming the checks when the element is not visible", async () => {
      const { page, stop, commands } = apiPage({ ...located, "script.callFunction": () => state({ visible: false }) });
      await assert.rejects(page.locator("//div").screenshot({ timeout: 150 }), (err: unknown) => {
        assert.ok(err instanceof ActionTimeoutError);
        assert.equal(err.action, "screenshot");
        assert.match(err.message, /^screenshot\(\): \/\/div was not actionable within 150ms\n  attached ✓  visible ✗/);
        return true;
      });
      assert.equal(commands("browsingContext.captureScreenshot").length, 0);
      stop();
    });

    test("takes a type, a quality and a path like the page does", async () => {
      const { page, stop, commands } = apiPage({ ...located, "script.callFunction": () => state() });
      const dir = tmp();
      try {
        const file = path.join(dir, "el.jpg");
        await page.locator("div").screenshot({ type: "jpeg", quality: 50, path: file, timeout: 1000 });
        assert.deepEqual(commands("browsingContext.captureScreenshot")[0].format, { type: "image/jpeg", quality: 0.5 });
        assert.deepEqual([...readFileSync(file)], [...PNG]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      stop();
    });
  });

  describe("pdf", () => {
    test("returns the PDF as a Buffer; defaults send only the context", async () => {
      const { page, stop, commands } = apiPage();
      const pdf = await page.pdf();
      assert.deepEqual([...pdf], [...PDF]);
      assert.deepEqual(commands("browsingContext.print"), [{ context: "ctx-1" }]);
      stop();
    });

    test("maps the options: landscape, scale, ranges, margins, background and paper size", async () => {
      const { page, stop, commands } = apiPage();
      await page.pdf({
        landscape: true,
        scale: 0.5,
        pageRanges: ["1-2", 4],
        margin: { top: 1, bottom: 1.5, left: 2, right: 2.5 },
        printBackground: true,
        format: "A4",
      });
      await page.pdf({ format: "Letter" });
      assert.deepEqual(commands("browsingContext.print"), [
        {
          context: "ctx-1",
          orientation: "landscape",
          scale: 0.5,
          pageRanges: ["1-2", 4],
          margin: { top: 1, bottom: 1.5, left: 2, right: 2.5 },
          background: true,
          page: { width: 21, height: 29.7 },
        },
        { context: "ctx-1", page: { width: 21.59, height: 27.94 } },
      ]);
      stop();
    });

    test("validates the scale and the paper format before sending", async () => {
      const { page, stop, commands } = apiPage();
      await assert.rejects(page.pdf({ scale: 0.05 }), RangeError);
      await assert.rejects(page.pdf({ scale: 2.5 }), RangeError);
      await assert.rejects(page.pdf({ format: "Tabloid-ish" as never }), /unknown paper format/);
      assert.equal(commands("browsingContext.print").length, 0);
      stop();
    });

    test("path writes the file", async () => {
      const { page, stop } = apiPage();
      const dir = tmp();
      try {
        const file = path.join(dir, "out", "page.pdf");
        await page.pdf({ path: file });
        assert.deepEqual([...readFileSync(file)], [...PDF]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      stop();
    });
  });

  describe("close", () => {
    test("closes the tab, releases everything the page registered, and refuses further use", async () => {
      const { page, stop, commands } = apiPage({
        "browsingContext.close": () => ({}),
        "network.addIntercept": () => ({ intercept: "i1" }),
      });
      await page.route("**", () => {});
      await page.close();
      assert.deepEqual(commands("browsingContext.close"), [{ context: "ctx-1" }]);
      assert.equal(commands("network.removeIntercept").length, 1, "disposed");
      for (const use of [
        () => page.navigateTo("https://example.test"),
        () => page.reload(),
        () => page.goBack(),
        () => page.goForward(),
        () => page.screenshot(),
        () => page.pdf(),
        () => page.url(),
        () => page.title(),
        () => page.setViewport({ width: 1, height: 1 }),
        () => page.waitForLoadState(),
        () => page.addInitScript("1"),
        () => page.route("**", () => {}),
      ]) {
        await assert.rejects(use(), new Error("page closed"));
      }
      assert.throws(() => page.locator("//a"), /page closed/);
      assert.equal(page.closed, true);
      stop();
    });

    test("runBeforeUnload asks the page to run its beforeunload handlers", async () => {
      const { page, stop, commands } = apiPage({ "browsingContext.close": () => ({}) });
      await page.close({ runBeforeUnload: true });
      assert.deepEqual(commands("browsingContext.close"), [{ context: "ctx-1", promptUnload: true }]);
      stop();
    });

    test("closing twice is fine and sends nothing more", async () => {
      const { page, stop, commands } = apiPage({ "browsingContext.close": () => ({}) });
      await page.close();
      await page.close();
      assert.equal(commands("browsingContext.close").length, 1);
      stop();
    });

    test("a page that is already gone is closed all the same", async () => {
      const { page, stop } = apiPage({ "browsingContext.close": () => bidiError("no such frame") });
      await assert.doesNotReject(page.close());
      assert.equal(page.closed, true);
      stop();
    });

    test("other close errors are thrown, and the page stays usable", async () => {
      const { page, stop } = apiPage({ "browsingContext.close": () => bidiError("unable to close browser") });
      await assert.rejects(page.close(), { code: "unable to close browser" });
      assert.equal(page.closed, false);
      stop();
    });
  });
});

describe("Page downloads and file choosers", () => {
  const TREE = [{ context: "ctx-1", parent: null, children: [] }];
  function transferPage(settings?: ConstructorParameters<typeof Page>[2]) {
    const ws = new FakeWebSocket();
    const connector = new BiDiConnector(ws as unknown as WebSocket);
    const stop = autoReply(ws, {
      "browsingContext.getTree": () => ({ contexts: TREE }),
      "input.setFiles": () => ({}),
    });
    const page = new Page(connector, "ctx-1", settings);
    const begin = (navigation: string, filename = "report.csv") =>
      ws.emitEvent("browsingContext.downloadWillBegin", { context: "ctx-1", navigation, timestamp: 1, url: `https://example.test/${filename}`, suggestedFilename: filename });
    const end = (navigation: string, filepath = "/tmp/dl/report.csv") =>
      ws.emitEvent("browsingContext.downloadEnd", { context: "ctx-1", navigation, timestamp: 2, url: "u", status: "complete", filepath });
    const chooser = (multiple = false) =>
      ws.emitEvent("input.fileDialogOpened", { context: "ctx-1", multiple, element: { type: "node", sharedId: "input-1" } });
    return { ws, page, stop, begin, end, chooser };
  }

  test("waitForDownload resolves when the download starts, and path() when it ends", async () => {
    const { page, stop, begin, end } = transferPage();
    await page.startDownloadTracking();
    const download = await page.waitForDownload({
      timeout: 1000,
      trigger: async () => begin("n1", "report.csv"),
    });
    assert.equal(download.suggestedFilename(), "report.csv");
    assert.equal(download.url(), "https://example.test/report.csv");
    const pending = download.path();
    end("n1", "/tmp/dl/report.csv");
    assert.equal(await pending, "/tmp/dl/report.csv");
    stop();
  });

  test("waitForDownload sets up tracking itself, and takes the first download after it", async () => {
    const { page, stop, begin } = transferPage();
    const waiting = page.waitForDownload({ timeout: 1000 });
    await tick(40);
    begin("n1", "first.csv");
    begin("n2", "second.csv");
    assert.equal((await waiting).suggestedFilename(), "first.csv");
    stop();
  });

  test("a trigger that throws rejects the wait with its error and leaves nothing listening", async () => {
    const { page, stop, begin } = transferPage();
    await page.startDownloadTracking();
    await assert.rejects(
      page.waitForDownload({
        timeout: 1000,
        trigger: async () => {
          throw new Error("click failed");
        },
      }),
      /click failed/,
    );
    const seen: string[] = [];
    page.on("download", (d) => seen.push(d.suggestedFilename()));
    begin("n1", "x.csv");
    assert.deepEqual(seen, ["x.csv"], "only our own listener");
    stop();
  });

  test("waitForDownload times out with a message of its own", async () => {
    const { page, stop } = transferPage();
    await assert.rejects(page.waitForDownload({ timeout: 40 }), /waitForDownload\(\): no download started within 40ms/);
    stop();
  });

  test("the time path() may take defaults to the navigation timeout in config", async () => {
    const { page, stop, begin } = transferPage({ navigation: { timeout: 40 } });
    await page.startDownloadTracking();
    const download = await page.waitForDownload({ trigger: async () => begin("n1") });
    await assert.rejects(download.path(), /did not finish within 40ms/);
    stop();
  });

  test("page.on(download) starts tracking by itself; page.off stops it", async () => {
    const { page, stop, begin } = transferPage();
    const seen: string[] = [];
    const listener = (d: { suggestedFilename(): string }) => seen.push(d.suggestedFilename());
    page.on("download", listener);
    await tick(40);
    begin("n1", "a.csv");
    page.off("download", listener);
    begin("n2", "b.csv");
    assert.deepEqual(seen, ["a.csv"]);
    stop();
  });

  test("waitForFileChooser resolves with a chooser that can pick files", async () => {
    const { ws, page, stop, chooser } = transferPage();
    await page.startFileChooserTracking();
    const picked = await page.waitForFileChooser({ timeout: 1000, trigger: async () => chooser(true) });
    assert.equal(picked.isMultiple(), true);
    await picked.setFiles([]);
    const sent = ws.sent.filter((m) => m.method === "input.setFiles").map((m) => m.params as any);
    assert.deepEqual(sent, [{ context: "ctx-1", element: { sharedId: "input-1" }, files: [] }]);
    stop();
  });

  test("waitForFileChooser sets up tracking itself and times out with a message of its own", async () => {
    const { page, stop } = transferPage();
    await assert.rejects(page.waitForFileChooser({ timeout: 40 }), /waitForFileChooser\(\): no file chooser opened within 40ms/);
    stop();
  });

  test("page.on(filechooser) starts tracking by itself", async () => {
    const { page, stop, chooser } = transferPage();
    let count = 0;
    page.on("filechooser", () => count++);
    await tick(40);
    chooser();
    assert.equal(count, 1);
    stop();
  });

  test("tracking is set up once, however it is asked for", async () => {
    const { ws, page, stop } = transferPage();
    await Promise.all([page.startDownloadTracking(), page.startDownloadTracking(), page.startFileChooserTracking(), page.startFileChooserTracking()]);
    const events = ws.sent.filter((m) => m.method === "session.subscribe").map((m) => (m.params as any).events[0]);
    assert.equal(events.filter((e: string) => e === "browsingContext.downloadWillBegin").length, 1);
    assert.equal(events.filter((e: string) => e === "input.fileDialogOpened").length, 1);
    stop();
  });

  test("dispose stops both and fails downloads still going on", async () => {
    const { page, stop, begin, chooser } = transferPage();
    await page.startFileChooserTracking();
    const download = await page.waitForDownload({ timeout: 1000, trigger: async () => begin("n1") });
    const pending = download.path();
    const rejection = assert.rejects(pending, /page closed/);
    await page.dispose();
    await rejection;
    let count = 0;
    page.on("filechooser", () => count++);
    chooser();
    assert.equal(count, 0, "the old tracker is gone");
    stop();
  });
});
