import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { ActionTimeoutError } from "../locator/action-timeout-error.js";
import { Evidence } from "./evidence.js";
import { apiPage, PNG, bidiError, tmp } from "../testing/page-api-fixture.js";

describe("Page API", () => {
  describe("screenshot", () => {
    test("returns the image as a Buffer; nothing but the context is sent by default", async () => {
      const { page, stop, commands } = apiPage();
      const image = await page.screenshot();
      assert.deepEqual([...image], [...PNG]);
      assert.deepEqual(commands("browsingContext.captureScreenshot"), [
        { context: "ctx-1" },
      ]);
      stop();
    });

    test("fullPage captures the document, clip a box", async () => {
      const { page, stop, commands } = apiPage();
      await page.screenshot({ fullPage: true });
      await page.screenshot({ clip: { x: 1, y: 2, width: 30, height: 40 } });
      await page.screenshot({
        fullPage: true,
        clip: { x: 0, y: 100, width: 50, height: 60 },
      });
      assert.deepEqual(commands("browsingContext.captureScreenshot"), [
        { context: "ctx-1", origin: "document" },
        {
          context: "ctx-1",
          clip: { type: "box", x: 1, y: 2, width: 30, height: 40 },
        },
        {
          context: "ctx-1",
          origin: "document",
          clip: { type: "box", x: 0, y: 100, width: 50, height: 60 },
        },
      ]);
      stop();
    });

    test("types are sent as MIME types, jpeg quality as a fraction", async () => {
      const { page, stop, commands } = apiPage();
      await page.screenshot({ type: "png" });
      await page.screenshot({ type: "jpeg" });
      await page.screenshot({ type: "jpeg", quality: 80 });
      assert.deepEqual(
        commands("browsingContext.captureScreenshot").map((c) => c.format),
        [
          { type: "image/png" },
          { type: "image/jpeg" },
          { type: "image/jpeg", quality: 0.8 },
        ],
      );
      stop();
    });

    test("rejects a quality outside 0–100, or without jpeg, before sending", async () => {
      const { page, stop, commands } = apiPage();
      await assert.rejects(
        page.screenshot({ type: "jpeg", quality: 101 }),
        RangeError,
      );
      await assert.rejects(
        page.screenshot({ type: "jpeg", quality: -1 }),
        RangeError,
      );
      await assert.rejects(
        page.screenshot({ quality: 50 }),
        /quality only applies to jpeg/,
      );
      await assert.rejects(
        page.screenshot({ type: "png", quality: 50 }),
        /quality only applies to jpeg/,
      );
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

    test("a named jpeg screenshot is saved as .jpg, a png one as .png", async () => {
      const { page, stop } = apiPage();
      const dir = tmp();
      try {
        const evidence = new Evidence(dir, "t");
        page.setEvidence(evidence);
        await page.screenshot({ name: "home", type: "jpeg" });
        await page.screenshot({ name: "home" });
        assert.deepEqual(evidence.screenshots, [
          { name: "home", path: "screenshots/t/home.jpg" },
          { name: "home-2", path: "screenshots/t/home-2.png" },
        ]);
        assert.deepEqual(
          [...readFileSync(path.join(dir, "screenshots", "t", "home.jpg"))],
          [...PNG],
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      stop();
    });

    test("a browser refusal is a BiDiError", async () => {
      const { page, stop } = apiPage({
        "browsingContext.captureScreenshot": () =>
          bidiError("unable to capture screen"),
      });
      await assert.rejects(page.screenshot(), {
        name: "BiDiError",
        code: "unable to capture screen",
      });
      stop();
    });
  });

  describe("Locator.screenshot", () => {
    const state = (extra: object = {}) => ({
      type: "success",
      realm: "r",
      result: {
        type: "object",
        value: Object.entries({
          attached: true,
          visible: true,
          enabled: true,
          editable: false,
          box: null,
          hitTarget: null,
          ...extra,
        }).map(([k, v]) => [
          k,
          v === null
            ? { type: "null" }
            : { type: typeof v === "boolean" ? "boolean" : "string", value: v },
        ]),
      },
    });
    const located = {
      "browsingContext.locateNodes": () => ({
        nodes: [{ type: "node", sharedId: "node-9" }],
      }),
    };

    /** The probe answers with the element's state; the box lookup (it reads `scrollX`) with a box in the document */
    const calls = (params: any) =>
      String(params.functionDeclaration).includes("scrollX")
        ? {
            type: "success",
            realm: "r",
            result: {
              type: "object",
              value: [
                ["x", { type: "number", value: 8 }],
                ["y", { type: "number", value: 2008 }],
                ["width", { type: "number", value: 90 }],
                ["height", { type: "number", value: 50 }],
              ],
            },
          }
        : state();

    test("captures just the element, after waiting until it is attached and visible", async () => {
      const { page, stop, commands } = apiPage({
        ...located,
        "script.callFunction": calls,
      });
      const image = await page
        .locator("div[@id='card']")
        .screenshot({ timeout: 1000 });
      assert.deepEqual([...image], [...PNG]);
      assert.deepEqual(commands("browsingContext.captureScreenshot"), [
        {
          context: "ctx-1",
          origin: "document",
          clip: { type: "box", x: 8, y: 2008, width: 90, height: 50 },
        },
      ]);
      stop();
    });

    test("scrolls the element into view first", async () => {
      const { page, stop, ws } = apiPage({
        ...located,
        "script.callFunction": calls,
      });
      await page.locator("div").screenshot({ timeout: 1000 });
      const probe = ws.sent.find(
        (m) =>
          m.method === "script.callFunction" && (m.params as any).arguments,
      )!.params as any;
      assert.deepEqual(
        probe.arguments[1].value.find(([k]: [string]) => k === "scroll")[1],
        { type: "boolean", value: true },
      );
      stop();
    });

    test("times out naming the checks when the element is not visible", async () => {
      const { page, stop, commands } = apiPage({
        ...located,
        "script.callFunction": () => state({ visible: false }),
      });
      await assert.rejects(
        page.locator("//div").screenshot({ timeout: 150 }),
        (err: unknown) => {
          assert.ok(err instanceof ActionTimeoutError);
          assert.equal(err.action, "screenshot");
          assert.match(
            err.message,
            /^screenshot\(\): \/\/div was not actionable within 150ms\n  attached ✓  visible ✗/,
          );
          return true;
        },
      );
      assert.equal(commands("browsingContext.captureScreenshot").length, 0);
      stop();
    });

    test("takes a type, a quality and a path like the page does", async () => {
      const { page, stop, commands } = apiPage({
        ...located,
        "script.callFunction": calls,
      });
      const dir = tmp();
      try {
        const file = path.join(dir, "el.jpg");
        await page
          .locator("div")
          .screenshot({ type: "jpeg", quality: 50, path: file, timeout: 1000 });
        assert.deepEqual(
          commands("browsingContext.captureScreenshot")[0].format,
          { type: "image/jpeg", quality: 0.5 },
        );
        assert.deepEqual([...readFileSync(file)], [...PNG]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      stop();
    });
  });
});
