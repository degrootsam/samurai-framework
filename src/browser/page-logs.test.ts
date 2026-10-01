import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { autoReply, FakeWebSocket, tick } from "../testing/fake-websocket.js";
import { BiDiConnector } from "../transport/bidi-connection.js";
import { ContextTree } from "./context-tree.js";
import { ConsoleMessage, PageError, PageLogs } from "./page-logs.js";

const TREE = [
  { context: "top", parent: null, children: [{ context: "frame", parent: "top", children: [] }] },
  { context: "other", parent: null, children: [] },
];
const stops: Array<() => void> = [];
afterEach(() => stops.splice(0).forEach((stop) => stop()));

async function setup(options?: { maxEntries?: number }) {
  const ws = new FakeWebSocket();
  const connector = new BiDiConnector(ws as unknown as WebSocket);
  stops.push(autoReply(ws, { "browsingContext.getTree": () => ({ contexts: TREE }) }));
  const tree = await ContextTree.create(connector);
  const logs = await PageLogs.start(connector, tree, "top", options);
  return { ws, logs };
}

const source = (context: string | undefined) => ({ realm: "r", userContext: "default", ...(context && { context }) });
const str = (value: string) => ({ type: "string", value });
const consoleEntry = (context: string | undefined, method: string, text: string, extra: object = {}) => ({
  type: "console",
  method,
  level: method === "error" ? "error" : method === "warn" ? "warn" : "info",
  text,
  args: [str(text)],
  timestamp: 1000,
  source: source(context),
  ...extra,
});
const errorEntry = (context: string | undefined, text: string, extra: object = {}) => ({
  type: "javascript",
  level: "error",
  text,
  timestamp: 2000,
  source: source(context),
  ...extra,
});
const emit = (ws: FakeWebSocket, entry: object) => ws.emitEvent("log.entryAdded", entry);

describe("PageLogs console messages", () => {
  it("turns a console entry into a ConsoleMessage with deserialized arguments", async () => {
    const { ws, logs } = await setup();
    const seen: ConsoleMessage[] = [];
    logs.on("console", (message) => seen.push(message));
    emit(ws, {
      ...consoleEntry("top", "log", "a 1 {…}", {
        args: [str("a"), { type: "number", value: 1 }, { type: "object", value: [["k", str("v")]] }],
        stackTrace: { callFrames: [{ functionName: "run", url: "https://x.test/app.js", lineNumber: 4, columnNumber: 2 }] },
      }),
    });
    assert.equal(seen.length, 1);
    const [message] = seen as [ConsoleMessage];
    assert.ok(message instanceof ConsoleMessage);
    assert.equal(message.type(), "log");
    assert.equal(message.text(), "a 1 {…}");
    assert.equal(message.level, "info");
    assert.deepEqual(message.args, ["a", 1, { k: "v" }]);
    assert.equal(message.timestamp, 1000);
    assert.deepEqual(message.location(), { url: "https://x.test/app.js", lineNumber: 4, columnNumber: 2 });
  });

  it("has no location without a stack, and an empty text for null", async () => {
    const { ws, logs } = await setup();
    let message!: ConsoleMessage;
    logs.on("console", (m) => (message = m));
    emit(ws, consoleEntry("top", "warn", "x", { text: null }));
    assert.equal(message.location(), undefined);
    assert.equal(message.text(), "");
    assert.equal(message.type(), "warn");
    assert.equal(message.level, "warn");
  });

  it("console.error is a log entry, not a page error", async () => {
    const { ws, logs } = await setup();
    emit(ws, consoleEntry("top", "error", "handled problem"));
    assert.equal(logs.entries.length, 1);
    assert.equal(logs.entries[0]!.level, "error");
    assert.equal(logs.errors.length, 0);
  });
});

describe("PageLogs page errors", () => {
  it("turns an uncaught exception into a PageError with a readable stack", async () => {
    const { ws, logs } = await setup();
    const seen: PageError[] = [];
    logs.on("pageerror", (error) => seen.push(error));
    emit(ws, errorEntry("top", "TypeError: x is null", {
      stackTrace: {
        callFrames: [
          { functionName: "click", url: "https://x.test/app.js", lineNumber: 10, columnNumber: 5 },
          { functionName: "", url: "https://x.test/app.js", lineNumber: 20, columnNumber: 1 },
        ],
      },
    }));
    assert.equal(seen.length, 1);
    const [error] = seen as [PageError];
    assert.ok(error instanceof Error);
    assert.ok(error instanceof PageError);
    assert.equal(error.message, "TypeError: x is null");
    assert.equal(error.name, "PageError");
    assert.equal(error.timestamp, 2000);
    assert.equal(
      error.stack,
      "TypeError: x is null\n    at click (https://x.test/app.js:10:5)\n    at https://x.test/app.js:20:1",
    );
    assert.deepEqual(logs.errors, [error]);
    assert.deepEqual(logs.entries.map((entry) => entry.type), ["javascript"]);
  });

  it("a PageError without a stack is just its text", async () => {
    const { ws, logs } = await setup();
    emit(ws, errorEntry("top", "Error: bare"));
    assert.equal(logs.errors[0]!.stack, "Error: bare");
  });
});

describe("PageLogs scope", () => {
  it("keeps entries of iframes, drops other pages and entries without a context", async () => {
    const { ws, logs } = await setup();
    emit(ws, consoleEntry("frame", "log", "from frame"));
    emit(ws, consoleEntry("other", "log", "from another page"));
    emit(ws, consoleEntry(undefined, "log", "from a worker"));
    assert.deepEqual(logs.entries.map((entry) => entry.text), ["from frame"]);
  });

  it("records entries of other types without emitting an event", async () => {
    const { ws, logs } = await setup();
    let events = 0;
    logs.on("console", () => events++);
    logs.on("pageerror", () => events++);
    emit(ws, { type: "deprecation", level: "warn", text: "old api", timestamp: 3, source: source("top") });
    assert.equal(events, 0);
    assert.deepEqual(logs.entries.map((entry) => [entry.type, entry.text]), [["deprecation", "old api"]]);
  });
});

describe("PageLogs buffer", () => {
  it("keeps the newest entries and counts what it dropped", async () => {
    const { ws, logs } = await setup({ maxEntries: 3 });
    for (let i = 1; i <= 5; i++) emit(ws, consoleEntry("top", "log", `m${i}`));
    assert.deepEqual(logs.entries.map((entry) => entry.text), ["m3", "m4", "m5"]);
    assert.equal(logs.dropped, 2);
  });

  it("records level, type, method, text and timestamp", async () => {
    const { ws, logs } = await setup();
    emit(ws, consoleEntry("top", "warn", "careful"));
    assert.deepEqual(logs.entries[0], { level: "warn", type: "console", method: "warn", text: "careful", timestamp: 1000 });
    emit(ws, errorEntry("top", "Error: x"));
    assert.deepEqual(logs.entries[1], { level: "error", type: "javascript", text: "Error: x", timestamp: 2000 });
  });

  it("clear empties entries, errors and the dropped count", async () => {
    const { ws, logs } = await setup({ maxEntries: 1 });
    emit(ws, consoleEntry("top", "log", "a"));
    emit(ws, consoleEntry("top", "log", "b"));
    emit(ws, errorEntry("top", "Error: x"));
    logs.clear();
    assert.equal(logs.entries.length, 0);
    assert.equal(logs.errors.length, 0);
    assert.equal(logs.dropped, 0);
  });

  it("entries is a snapshot: later entries do not change what was read", async () => {
    const { ws, logs } = await setup();
    emit(ws, consoleEntry("top", "log", "a"));
    const before = logs.entries;
    emit(ws, consoleEntry("top", "log", "b"));
    assert.equal(before.length, 1);
  });
});

describe("PageLogs lifecycle", () => {
  it("a throwing listener does not stop the others or the recording", async () => {
    const { ws, logs } = await setup();
    let second = 0;
    logs.on("console", () => {
      throw new Error("listener failed");
    });
    logs.on("console", () => second++);
    emit(ws, consoleEntry("top", "log", "a"));
    assert.equal(second, 1);
    assert.equal(logs.entries.length, 1);
  });

  it("off removes a listener", async () => {
    const { ws, logs } = await setup();
    let count = 0;
    const listener = () => count++;
    logs.on("console", listener);
    logs.off("console", listener);
    emit(ws, consoleEntry("top", "log", "a"));
    assert.equal(count, 0);
  });

  it("subscribes to log.entryAdded and releases it on dispose", async () => {
    const { ws, logs } = await setup();
    assert.ok(ws.sent.some((m) => m.method === "session.subscribe" && (m.params as any).events[0] === "log.entryAdded"));
    await logs.dispose();
    await tick(10);
    emit(ws, consoleEntry("top", "log", "late"));
    assert.equal(logs.entries.length, 0);
    assert.ok(ws.sent.some((m) => m.method === "session.unsubscribe"), "the log subscription was released");
    await assert.doesNotReject(logs.dispose());
  });
});
