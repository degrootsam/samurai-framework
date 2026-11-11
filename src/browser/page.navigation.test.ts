import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { navPage } from "../testing/page-navigation-fixture.js";
import { FakeWebSocket, makeConnector } from "../testing/fake-websocket.js";
import Page from "./page.js";
import { NavigationError } from "./navigation-error.js";

describe("Page navigation", () => {
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
});
