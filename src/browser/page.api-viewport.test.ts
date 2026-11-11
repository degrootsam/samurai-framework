import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { apiPage, bidiError } from "../testing/page-api-fixture.js";

describe("Page API", () => {
  describe("viewport", () => {
    test("setViewport sends the size and the pixel ratio for this page", async () => {
      const { page, stop, commands } = apiPage();
      await page.setViewport({ width: 400, height: 300 });
      await page.setViewport({ width: 800, height: 600, devicePixelRatio: 2 });
      assert.deepEqual(commands("browsingContext.setViewport"), [
        { context: "ctx-1", viewport: { width: 400, height: 300 } },
        {
          context: "ctx-1",
          viewport: { width: 800, height: 600 },
          devicePixelRatio: 2,
        },
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

    test("null waits for the page to stop resizing: watch first, reset, then wait", async () => {
      const { ws, page, stop } = apiPage();
      await page.setViewport(null);
      assert.deepEqual(
        ws.sent
          .filter((m) =>
            ["script.callFunction", "browsingContext.setViewport"].includes(
              m.method,
            ),
          )
          .map((m) => m.method),
        [
          "script.callFunction",
          "browsingContext.setViewport",
          "script.callFunction",
        ],
      );
      stop();
    });

    test("null still resets a page that cannot be watched", async () => {
      const { page, stop, commands } = apiPage({
        "script.callFunction": () => bidiError("no such frame"),
      });
      await page.setViewport(null);
      assert.equal(commands("browsingContext.setViewport").length, 1);
      stop();
    });

    test("rejects sizes that are not positive integers before sending", async () => {
      const { page, stop, commands } = apiPage();
      for (const bad of [
        { width: 0, height: 10 },
        { width: 10, height: -1 },
        { width: 1.5, height: 10 },
        { width: NaN, height: 10 },
      ]) {
        await assert.rejects(page.setViewport(bad), RangeError);
      }
      await assert.rejects(
        page.setViewport({ width: 10, height: 10, devicePixelRatio: 0 }),
        RangeError,
      );
      assert.equal(commands("browsingContext.setViewport").length, 0);
      stop();
    });

    test("applyDefaultViewport uses config use.viewport, 1280x720 without one", async () => {
      const { page, stop, commands } = apiPage(
        {},
        { use: { viewport: { width: 640, height: 480 } } },
      );
      await page.applyDefaultViewport();
      const other = apiPage();
      await other.page.applyDefaultViewport();
      assert.deepEqual(commands("browsingContext.setViewport"), [
        { context: "ctx-1", viewport: { width: 640, height: 480 } },
      ]);
      assert.deepEqual(other.commands("browsingContext.setViewport"), [
        { context: "ctx-1", viewport: { width: 1280, height: 720 } },
      ]);
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
});
