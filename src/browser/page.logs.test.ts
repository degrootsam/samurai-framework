import { describe, test } from "node:test";
import assert from "node:assert/strict";
import Page from "./page.js";
import {
  autoReply,
  FakeWebSocket,
  tick,
  makeConnector,
} from "../testing/fake-websocket.js";

describe("Page logs", () => {
  const TREE = [{ context: "ctx-1", parent: null, children: [] }];
  function logPage() {
    const ws = new FakeWebSocket();
    const connector = makeConnector(ws);
    const stop = autoReply(ws, {
      "browsingContext.getTree": () => ({ contexts: TREE }),
    });
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
    const onConsole = (message: { type(): string; text(): string }) =>
      seen.push(`${message.type()}: ${message.text()}`);
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
      [
        ["console", "warn", "hello"],
        ["javascript", "error", "Error: boom"],
      ],
    );
    assert.deepEqual(
      page.pageErrors().map((error) => error.message),
      ["Error: boom"],
    );
    page.clearLogs();
    assert.deepEqual(page.getLogs(), []);
    assert.deepEqual(page.pageErrors(), []);
    stop();
  });

  test("page.on starts collecting by itself, and startLogging is idempotent", async () => {
    const { ws, page, stop } = logPage();
    page.on("console", () => {});
    await Promise.all([page.startLogging(), page.startLogging()]);
    assert.equal(
      ws.sent.filter(
        (m) =>
          m.method === "session.subscribe" &&
          (m.params as any).events[0] === "log.entryAdded",
      ).length,
      1,
    );
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
