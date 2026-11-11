import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { apiPage, PDF, bidiError, tmp } from "../testing/page-api-fixture.js";

describe("Page API", () => {
  describe("pdf", () => {
    test("returns the PDF as a Buffer; defaults send only the context", async () => {
      const { page, stop, commands } = apiPage();
      const pdf = await page.pdf();
      assert.deepEqual([...pdf], [...PDF]);
      assert.deepEqual(commands("browsingContext.print"), [
        { context: "ctx-1" },
      ]);
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
      await assert.rejects(
        page.pdf({ format: "Tabloid-ish" as never }),
        /unknown paper format/,
      );
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
      assert.deepEqual(commands("browsingContext.close"), [
        { context: "ctx-1" },
      ]);
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
      const { page, stop, commands } = apiPage({
        "browsingContext.close": () => ({}),
      });
      await page.close({ runBeforeUnload: true });
      assert.deepEqual(commands("browsingContext.close"), [
        { context: "ctx-1", promptUnload: true },
      ]);
      stop();
    });

    test("closing twice is fine and sends nothing more", async () => {
      const { page, stop, commands } = apiPage({
        "browsingContext.close": () => ({}),
      });
      await page.close();
      await page.close();
      assert.equal(commands("browsingContext.close").length, 1);
      stop();
    });

    test("a page that is already gone is closed all the same", async () => {
      const { page, stop } = apiPage({
        "browsingContext.close": () => bidiError("no such frame"),
      });
      await assert.doesNotReject(page.close());
      assert.equal(page.closed, true);
      stop();
    });

    test("other close errors are thrown, and the page stays usable", async () => {
      const { page, stop } = apiPage({
        "browsingContext.close": () => bidiError("unable to close browser"),
      });
      await assert.rejects(page.close(), { code: "unable to close browser" });
      assert.equal(page.closed, false);
      stop();
    });
  });
});
