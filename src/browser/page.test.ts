import { describe, test } from "node:test";
import assert from "node:assert/strict";
import Page from "./page.js";
import { stubConnector } from "../testing/stub-connector.js";
import {
  autoReply,
  FakeWebSocket,
  makeConnector,
} from "../testing/fake-websocket.js";

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
  function realPage(
    handlers: Record<string, (params: any) => object | Error> = {},
  ) {
    const ws = new FakeWebSocket();
    const connector = makeConnector(ws);
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
      "browsingContext.getTree": () => ({
        contexts: [{ context: "ctx-1", parent: null, children: [] }],
      }),
    });
    assert.equal(ws.sent.length, 0);
    const [a, b] = await Promise.all([page.tree(), page.tree()]);
    assert.equal(a, b);
    assert.equal(
      ws.sent.filter((m) => m.method === "browsingContext.getTree").length,
      1,
    );
    assert.equal(a.isWithin("ctx-1", "ctx-1"), true);
    await a.dispose();
    stop();
  });
});
