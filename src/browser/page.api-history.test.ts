import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FakeWebSocket, tick } from "../testing/fake-websocket.js";
import { NavigationError } from "./navigation-error.js";
import { UnsupportedOperationError } from "../transport/unsupported.js";
import { apiPage, str, bidiError } from "../testing/page-api-fixture.js";

describe("Page API", () => {
  describe("reload and history", () => {
    test("reload waits for complete by default and returns the navigation", async () => {
      const { page, stop, commands } = apiPage();
      const result = await page.reload();
      assert.deepEqual(result, {
        navigation: "nav-2",
        url: "https://example.test/",
      });
      assert.deepEqual(commands("browsingContext.reload"), [
        { context: "ctx-1", wait: "complete" },
      ]);
      stop();
    });

    test("reload takes the wait from options or config", async () => {
      const { page, stop, commands } = apiPage(
        {},
        { navigation: { waitUntil: "interactive" } },
      );
      await page.reload();
      await page.reload({ wait: "none" });
      assert.deepEqual(
        commands("browsingContext.reload").map((c) => c.wait),
        ["interactive", "none"],
      );
      stop();
    });

    test("reload passes ignoreCache, and says when the browser cannot do it", async () => {
      const { page, stop, commands } = apiPage();
      await page.reload({ ignoreCache: true });
      assert.equal(commands("browsingContext.reload")[0].ignoreCache, true);
      stop();
      const refused = apiPage({
        "browsingContext.reload": () =>
          bidiError(
            "unsupported operation",
            'Argument "ignoreCache" is not supported yet.',
          ),
      });
      await assert.rejects(
        refused.page.reload({ ignoreCache: true }),
        (err: unknown) => {
          assert.ok(err instanceof UnsupportedOperationError);
          assert.match(
            err.message,
            /reload\(\): ignoreCache is not supported by the browser/,
          );
          return true;
        },
      );
      refused.stop();
    });

    test("reload failures are NavigationErrors that name the page", async () => {
      const { page, stop } = apiPage({
        "browsingContext.reload": () =>
          bidiError("unknown error", "NS_ERROR_NET_TIMEOUT"),
        "script.callFunction": () => str("https://example.test/here"),
      });
      await assert.rejects(page.reload(), (err: unknown) => {
        assert.ok(err instanceof NavigationError);
        assert.match(
          err.message,
          /^reload\(\): https:\/\/example\.test\/here failed: .*NS_ERROR_NET_TIMEOUT/,
        );
        return true;
      });
      stop();
    });

    const committed = (ws: FakeWebSocket) =>
      ws.emitEvent("browsingContext.navigationCommitted", {
        context: "ctx-1",
        navigation: "nav",
        url: "https://example.test/",
        timestamp: 0,
      });

    test("goBack and goForward move one entry and say true", async () => {
      const { ws, page, stop, commands } = apiPage({
        "browsingContext.traverseHistory": () => ({}),
      });
      for (const go of [() => page.goBack(), () => page.goForward()]) {
        const pending = go();
        await tick(10);
        committed(ws);
        assert.equal(await pending, true);
      }
      assert.deepEqual(commands("browsingContext.traverseHistory"), [
        { context: "ctx-1", delta: -1 },
        { context: "ctx-1", delta: 1 },
      ]);
      stop();
    });

    test("they wait until the new entry is committed, and not for other pages", async () => {
      const { ws, page, stop } = apiPage({
        "browsingContext.traverseHistory": () => ({}),
      });
      let done = false;
      const pending = page.goBack().then((result) => {
        done = true;
        return result;
      });
      await tick(30);
      ws.emitEvent("browsingContext.navigationCommitted", {
        context: "ctx-other",
        navigation: "nav",
        url: "https://example.test/",
        timestamp: 0,
      });
      await tick(30);
      assert.equal(done, false, "another page's navigation is no sign");
      committed(ws);
      assert.equal(await pending, true);
      stop();
    });

    test("goBack says false without asking when only the tab's blank page is behind (Chrome's Navigation API)", async () => {
      const { page, stop, commands } = apiPage({
        "script.callFunction": () => ({
          type: "success",
          realm: "r",
          result: { type: "boolean", value: true },
        }),
        "browsingContext.traverseHistory": () => ({}),
      });
      assert.equal(await page.goBack(), false);
      assert.equal(commands("browsingContext.traverseHistory").length, 0);
      stop();
    });

    test("with no entry to go to they say false; other errors are thrown", async () => {
      const none = apiPage({
        "browsingContext.traverseHistory": () =>
          bidiError("no such history entry"),
      });
      assert.equal(await none.page.goBack(), false);
      assert.equal(await none.page.goForward(), false);
      none.stop();
      const broken = apiPage({
        "browsingContext.traverseHistory": () => bidiError("no such frame"),
      });
      await assert.rejects(broken.page.goBack(), { code: "no such frame" });
      broken.stop();
    });
  });

  describe("url and title", () => {
    test("read location.href and document.title", async () => {
      const { page, stop, ws } = apiPage({
        "script.callFunction": (params) =>
          str(
            params.functionDeclaration.includes("title")
              ? "My title"
              : "https://example.test/x",
          ),
      });
      assert.equal(await page.url(), "https://example.test/x");
      assert.equal(await page.title(), "My title");
      assert.equal(
        ws.sent.filter((m) => m.method === "script.callFunction").length,
        2,
      );
      stop();
    });
  });
});
