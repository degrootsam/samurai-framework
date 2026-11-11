import { describe, test } from "node:test";
import assert from "node:assert/strict";
import Page from "./page.js";
import {
  autoReply,
  FakeWebSocket,
  tick,
  makeConnector,
} from "../testing/fake-websocket.js";
import { LoadStateTimeoutError, NavigationError } from "./navigation-error.js";

describe("Page navigation", () => {
  const success = (value: string) => ({
    type: "success",
    realm: "r",
    result: { type: "string", value },
  });
  const TREE = [{ context: "ctx-1", parent: null, children: [] }];

  function navPage(
    handlers: Record<string, (params: any) => object | Error> = {},
    settings?: ConstructorParameters<typeof Page>[2],
  ) {
    const ws = new FakeWebSocket();
    const connector = makeConnector(ws);
    const stop = autoReply(ws, {
      "browsingContext.navigate": (params) => ({
        navigation: "nav-1",
        url: params.url,
      }),
      "browsingContext.getTree": () => ({ contexts: TREE }),
      "script.callFunction": () => success("complete"),
      ...handlers,
    });
    const page = new Page(connector, "ctx-1", settings);
    const navigates = () =>
      ws.sent
        .filter((m) => m.method === "browsingContext.navigate")
        .map((m) => m.params as any);
    return { ws, page, stop, navigates };
  }
  const navInfo = (context: string, navigation = "nav-1") => ({
    context,
    navigation,
    url: "https://example.test/",
    timestamp: 0,
  });

  describe("navigateTo", () => {
    test("waits for complete by default, and returns the navigation and url", async () => {
      const { page, navigates, stop } = navPage();
      const result = await page.navigateTo("example.test");
      assert.deepEqual(result, {
        navigation: "nav-1",
        url: "https://example.test",
      });
      assert.equal(navigates()[0].wait, "complete");
      stop();
    });

    test("the wait comes from the options, or from config", async () => {
      const { page, navigates, stop } = navPage(
        {},
        { navigation: { waitUntil: "interactive" } },
      );
      await page.navigateTo("example.test");
      await page.navigateTo("example.test", { wait: "none" });
      assert.deepEqual(
        navigates().map((n) => n.wait),
        ["interactive", "none"],
      );
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
      const { page, stop } = navPage({
        "browsingContext.navigate": (p) => ({ navigation: null, url: p.url }),
      });
      assert.equal((await page.navigateTo("about:blank#x")).navigation, null);
      stop();
    });

    test("a browser error becomes a NavigationError naming the url and the reason", async () => {
      const ws = new FakeWebSocket();
      const connector = makeConnector(ws);
      const timer = setInterval(() => {
        for (const m of ws.sent.splice(0))
          ws.replyError(m.id, "unknown error", "NS_ERROR_CONNECTION_REFUSED");
      }, 1).unref();
      const page = new Page(connector, "ctx-1");
      await assert.rejects(
        page.navigateTo("http://127.0.0.1:1/"),
        (err: unknown) => {
          assert.ok(err instanceof NavigationError);
          assert.equal(err.url, "http://127.0.0.1:1/");
          assert.equal(err.code, "unknown error");
          assert.match(err.reason, /NS_ERROR_CONNECTION_REFUSED/);
          assert.match(
            err.message,
            /^navigateTo\(\): http:\/\/127\.0\.0\.1:1\/ failed: .*NS_ERROR_CONNECTION_REFUSED/,
          );
          return true;
        },
      );
      clearInterval(timer);
    });

    test("times out after the navigation timeout with a NavigationError", async () => {
      const ws = new FakeWebSocket();
      const connector = makeConnector(ws);
      const page = new Page(connector, "ctx-1", {
        navigation: { timeout: 40 },
      });
      await assert.rejects(
        page.navigateTo("https://slow.test/"),
        (err: unknown) => {
          assert.ok(err instanceof NavigationError);
          assert.equal(err.reason, "timeout after 40ms");
          assert.equal(err.code, "timeout");
          return true;
        },
      );
    });

    test("the timeout can be set per call", async () => {
      const ws = new FakeWebSocket();
      const connector = makeConnector(ws);
      const page = new Page(connector, "ctx-1");
      await assert.rejects(
        page.navigateTo("https://slow.test/", { timeout: 30 }),
        /timeout after 30ms/,
      );
    });
  });

  describe("waitForLoadState", () => {
    test("resolves at once when the document has already loaded", async () => {
      const { page, ws, stop } = navPage();
      await page.waitForLoadState("load", { timeout: 1000 });
      assert.equal(
        ws.sent.filter((m) => m.method === "script.callFunction").length,
        1,
      );
      stop();
    });

    test("domcontentloaded is reached at interactive as well", async () => {
      const { page, stop } = navPage({
        "script.callFunction": () => success("interactive"),
      });
      await page.waitForLoadState("domcontentloaded", { timeout: 1000 });
      stop();
    });

    test("load is not reached at interactive: it waits for this page's load event", async () => {
      const { page, ws, stop } = navPage({
        "script.callFunction": () => success("interactive"),
      });
      let loaded = false;
      const waiting = page
        .waitForLoadState("load", { timeout: 2000 })
        .then(() => (loaded = true));
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
      const { page, ws, stop } = navPage({
        "script.callFunction": () => success("loading"),
      });
      const waiting = page.waitForLoadState("domcontentloaded", {
        timeout: 2000,
      });
      await tick(30);
      ws.emitEvent("browsingContext.domContentLoaded", navInfo("ctx-1"));
      await waiting;
      stop();
    });

    test("a failed navigation of this page rejects with a NavigationError", async () => {
      const { page, ws, stop } = navPage({
        "script.callFunction": () => success("loading"),
      });
      const waiting = page.waitForLoadState("load", { timeout: 2000 });
      const rejection = assert.rejects(waiting, NavigationError);
      await tick(30);
      ws.emitEvent("browsingContext.navigationFailed", navInfo("ctx-1"));
      await rejection;
      stop();
    });

    test("after navigateTo, only failures of that navigation count", async () => {
      const { page, ws, stop } = navPage({
        "script.callFunction": () => success("loading"),
      });
      await page.navigateTo("example.test", { wait: "none" }); // navigation id nav-1
      const waiting = page.waitForLoadState("load", { timeout: 300 });
      const outcome = waiting.then(
        () => "loaded",
        (err: Error) => err.name,
      );
      await tick(30);
      ws.emitEvent(
        "browsingContext.navigationFailed",
        navInfo("ctx-1", "nav-0-old"),
      );
      ws.emitEvent(
        "browsingContext.navigationAborted",
        navInfo("other-context", "nav-1"),
      );
      assert.equal(
        await outcome,
        "LoadStateTimeoutError",
        "unrelated failures are ignored, the wait times out",
      );
      stop();
    });

    test("after navigateTo(wait none), failure of that navigation rejects the wait", async () => {
      const { page, ws, stop } = navPage({
        "script.callFunction": () => success("loading"),
      });
      await page.navigateTo("example.test", { wait: "none" });
      const rejection = assert.rejects(
        page.waitForLoadState("load", { timeout: 2000 }),
        NavigationError,
      );
      await tick(30);
      ws.emitEvent(
        "browsingContext.navigationAborted",
        navInfo("ctx-1", "nav-1"),
      );
      await rejection;
      stop();
    });

    test("after navigateTo(wait none) the old document does not count: it waits for that navigation's load", async () => {
      const { page, ws, stop } = navPage(); // readyState answers "complete": the document that is still showing
      await page.navigateTo("example.test", { wait: "none" });
      let loaded = false;
      const waiting = page
        .waitForLoadState("load", { timeout: 2000 })
        .then(() => (loaded = true));
      await tick(40);
      assert.equal(loaded, false);
      ws.emitEvent(
        "browsingContext.load",
        navInfo("ctx-1", "some-other-navigation"),
      );
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
      const waiting = page
        .waitForLoadState("load", { timeout: 2000 })
        .then(() => (loaded = true));
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
      const unsupported = Object.assign(
        new Error(
          "browsingContext.navigationAborted is not a valid event name",
        ),
        {
          code: "invalid argument",
        },
      );
      const { page, ws, stop } = navPage({
        "session.subscribe": (params) =>
          params.events.includes("browsingContext.navigationAborted")
            ? unsupported
            : {},
      });
      await page.waitForLoadState("load", { timeout: 1000 });
      await page.waitForLoadState("load", { timeout: 1000 });
      const asked = ws.sent
        .filter((m) => m.method === "session.subscribe")
        .filter((m) =>
          (m.params as any).events.includes(
            "browsingContext.navigationAborted",
          ),
        );
      assert.equal(asked.length, 1, "asked once, then remembered");
      stop();
    });

    test("without the aborted event a failed navigation still rejects the wait", async () => {
      const unsupported = Object.assign(new Error("not a valid event name"), {
        code: "invalid argument",
      });
      const { page, ws, stop } = navPage({
        "script.callFunction": () => success("loading"),
        "session.subscribe": (params) =>
          params.events.includes("browsingContext.navigationAborted")
            ? unsupported
            : {},
      });
      const rejection = assert.rejects(
        page.waitForLoadState("load", { timeout: 2000 }),
        NavigationError,
      );
      await tick(40);
      ws.emitEvent("browsingContext.navigationFailed", navInfo("ctx-1"));
      await rejection;
      stop();
    });

    test("times out with a LoadStateTimeoutError", async () => {
      const { page, stop } = navPage({
        "script.callFunction": () => success("loading"),
      });
      await assert.rejects(
        page.waitForLoadState("load", { timeout: 60 }),
        (err: unknown) => {
          assert.ok(err instanceof LoadStateTimeoutError);
          assert.match(
            err.message,
            /waitForLoadState\("load"\) did not finish within 60ms/,
          );
          return true;
        },
      );
      stop();
    });

    test("the default timeout comes from config navigation.timeout", async () => {
      const { page, stop } = navPage(
        { "script.callFunction": () => success("loading") },
        { navigation: { timeout: 50 } },
      );
      await assert.rejects(
        page.waitForLoadState(),
        /did not finish within 50ms/,
      );
      stop();
    });

    test("networkidle waits for the load and then for the network to go quiet", async () => {
      const { page, ws, stop } = navPage({}, { network: { idleTime: 30 } });
      await page.startNetworkTracking();
      ws.emitEvent("network.beforeRequestSent", {
        context: "ctx-1",
        isBlocked: false,
        navigation: null,
        redirectCount: 0,
        timestamp: 0,
        request: {
          request: "r1",
          url: "https://example.test/r1",
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
      let idle = false;
      const waiting = page
        .waitForLoadState("networkidle", { timeout: 2000 })
        .then(() => (idle = true));
      await tick(80);
      assert.equal(idle, false, "a request is in flight");
      ws.emitEvent("network.fetchError", {
        context: "ctx-1",
        isBlocked: false,
        navigation: null,
        redirectCount: 0,
        timestamp: 0,
        errorText: "x",
        request: {
          request: "r1",
          url: "https://example.test/r1",
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
      await waiting;
      stop();
    });

    test("releases its subscriptions when it is done", async () => {
      const { page, ws, stop } = navPage();
      await page.waitForLoadState("load", { timeout: 1000 });
      await tick(20);
      const subscribed = ws.sent.filter(
        (m) => m.method === "session.subscribe",
      ).length;
      const unsubscribed = ws.sent.filter(
        (m) => m.method === "session.unsubscribe",
      ).length;
      assert.equal(unsubscribed, subscribed);
      stop();
    });
  });
});
