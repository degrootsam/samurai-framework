import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  autoReply,
  FakeWebSocket,
  makeConnector,
} from "../testing/fake-websocket.js";
import Page from "./page.js";

function setup(use: object = {}) {
  const ws = new FakeWebSocket();
  const stop = autoReply(ws, {
    "browsingContext.setViewport": () => ({}),
    "script.callFunction": () => ({
      type: "success",
      realm: "r",
      result: { type: "undefined" },
    }),
  });
  const page = new Page(makeConnector(ws), "ctx-1", {
    network: {},
    navigation: {},
    use,
  } as never);
  return { page, ws, stop };
}

describe("page.viewportSize", () => {
  it("is null until a size is known", () => {
    const { page, stop } = setup();
    assert.equal(page.viewportSize(), null);
    stop();
  });

  it("is synchronous and follows setViewportSize and setViewport", async () => {
    const { page, ws, stop } = setup();
    await page.setViewportSize({ width: 400, height: 300 });
    assert.deepEqual(page.viewportSize(), { width: 400, height: 300 });
    await page.setViewport({ width: 800, height: 600, devicePixelRatio: 2 });
    assert.deepEqual(page.viewportSize(), { width: 800, height: 600 });
    assert.deepEqual(
      ws.sent
        .filter((m) => m.method === "browsingContext.setViewport")
        .map((m) => m.params),
      [
        { context: "ctx-1", viewport: { width: 400, height: 300 } },
        {
          context: "ctx-1",
          viewport: { width: 800, height: 600 },
          devicePixelRatio: 2,
        },
      ],
    );
    stop();
  });

  it("returns a copy: changing it does not change the page's answer", async () => {
    const { page, stop } = setup();
    await page.setViewportSize({ width: 400, height: 300 });
    page.viewportSize()!.width = 1;
    assert.equal(page.viewportSize()!.width, 400);
    stop();
  });

  it("is null again after the browser's own size is put back", async () => {
    const { page, stop } = setup();
    await page.setViewportSize({ width: 400, height: 300 });
    await page.setViewport(null);
    assert.equal(page.viewportSize(), null);
    stop();
  });

  it("keeps the old size when the new one is refused", async () => {
    const { page, stop } = setup();
    await page.setViewportSize({ width: 400, height: 300 });
    await assert.rejects(
      page.setViewportSize({ width: 0, height: 10 }),
      RangeError,
    );
    assert.deepEqual(page.viewportSize(), { width: 400, height: 300 });
    stop();
  });

  it("takes the default from config use.viewport when the page is set up", async () => {
    const { page, stop } = setup({ viewport: { width: 1024, height: 768 } });
    assert.equal(page.viewportSize(), null);
    await page.applyDefaultViewport();
    assert.deepEqual(page.viewportSize(), { width: 1024, height: 768 });
    stop();
  });

  it("is the built-in 1280x720 without config, and null when config turns the viewport off", async () => {
    const a = setup();
    await a.page.applyDefaultViewport();
    assert.deepEqual(a.page.viewportSize(), { width: 1280, height: 720 });
    const b = setup({ viewport: null });
    await b.page.applyDefaultViewport();
    assert.equal(b.page.viewportSize(), null);
    a.stop();
    b.stop();
  });
});
