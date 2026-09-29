import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import logger from "../logger/index.js";
import { autoReply, FakeWebSocket, tick } from "../testing/fake-websocket.js";
import { BiDiConnector } from "../transport/bidi-connection.js";
import { SESSION_CAPABILITIES } from "./browser.js";
import type { Dialog } from "./dialog.js";
import Page from "./page.js";

const TREE = [
  { context: "ctx-1", parent: null, children: [{ context: "frame", parent: "ctx-1", children: [] }] },
  { context: "other", parent: null, children: [] },
];

const stops: Array<() => void> = [];
let warn: ReturnType<typeof mock.method>;
let error: ReturnType<typeof mock.method>;
beforeEach(() => {
  warn = mock.method(logger, "warn", () => logger);
  error = mock.method(logger, "error", () => logger);
});
afterEach(() => {
  mock.restoreAll();
  stops.splice(0).forEach((stop) => stop());
});

function setup(handlers: Record<string, (params: any) => object | Error> = {}) {
  const ws = new FakeWebSocket();
  const connector = new BiDiConnector(ws as unknown as WebSocket);
  stops.push(
    autoReply(ws, {
      "browsingContext.getTree": () => ({ contexts: TREE }),
      "browsingContext.handleUserPrompt": () => ({}),
      ...handlers,
    }),
  );
  const page = new Page(connector, "ctx-1");
  const opened = (extra: object = {}) =>
    ws.emitEvent("browsingContext.userPromptOpened", {
      context: "ctx-1",
      handler: "ignore",
      message: "Are you sure?",
      type: "confirm",
      ...extra,
    });
  const closed = (extra: object = {}) =>
    ws.emitEvent("browsingContext.userPromptClosed", { context: "ctx-1", accepted: true, type: "confirm", ...extra });
  const handled = () =>
    ws.sent.filter((m) => m.method === "browsingContext.handleUserPrompt").map((m) => m.params as any);
  return { ws, page, opened, closed, handled };
}

describe("session capability", () => {
  it("asks the browser to leave prompts open until the framework answers", () => {
    assert.deepEqual(SESSION_CAPABILITIES, {
      alwaysMatch: { unhandledPromptBehavior: { default: "ignore" } },
    });
  });
});

describe("Dialog", () => {
  it("describes the prompt", async () => {
    const { page, opened } = setup();
    let seen!: Dialog;
    page.on("dialog", (dialog) => {
      seen = dialog;
      return dialog.dismiss();
    });
    await page.startDialogHandling();
    opened({ type: "prompt", message: "Name?", defaultValue: "Sam" });
    await tick(20);
    assert.equal(seen.type(), "prompt");
    assert.equal(seen.message(), "Name?");
    assert.equal(seen.defaultValue(), "Sam");
  });

  it("defaultValue is empty for other prompts", async () => {
    const { page, opened } = setup();
    let seen!: Dialog;
    page.on("dialog", (dialog) => {
      seen = dialog;
      return dialog.dismiss();
    });
    await page.startDialogHandling();
    opened({ type: "alert" });
    await tick(20);
    assert.equal(seen.defaultValue(), "");
  });

  it("accept sends the text, dismiss does not accept", async () => {
    const { page, opened, handled } = setup();
    page.on("dialog", (dialog) => (dialog.type() === "prompt" ? dialog.accept("Sam") : dialog.dismiss()));
    await page.startDialogHandling();
    opened({ type: "prompt" });
    opened({ type: "confirm" });
    await tick(30);
    assert.deepEqual(handled(), [
      { context: "ctx-1", accept: true, userText: "Sam" },
      { context: "ctx-1", accept: false },
    ]);
  });

  it("accept without text sends no userText", async () => {
    const { page, opened, handled } = setup();
    page.on("dialog", (dialog) => dialog.accept());
    await page.startDialogHandling();
    opened({ type: "confirm" });
    await tick(20);
    assert.deepEqual(handled(), [{ context: "ctx-1", accept: true }]);
  });

  it("can be handled once; a second call throws", async () => {
    const { page, opened } = setup();
    let second: unknown;
    page.on("dialog", async (dialog) => {
      await dialog.accept();
      second = await dialog.dismiss().catch((err: Error) => err);
    });
    await page.startDialogHandling();
    opened();
    await tick(30);
    assert.match((second as Error).message, /dialog already handled/);
  });

  it("swallows no such alert: the dialog is gone, which is what the caller wanted", async () => {
    const gone = Object.assign(new Error("no alert open"), { code: "no such alert" });
    const { page, opened } = setup({ "browsingContext.handleUserPrompt": () => gone });
    let outcome = "not run";
    page.on("dialog", async (dialog) => {
      await dialog.accept();
      outcome = "accepted";
    });
    await page.startDialogHandling();
    opened();
    await tick(30);
    assert.equal(outcome, "accepted");
  });

  it("other browser errors reach the caller", async () => {
    const broken = Object.assign(new Error("boom"), { code: "unknown error" });
    const { page, opened } = setup({ "browsingContext.handleUserPrompt": () => broken });
    let outcome: unknown;
    page.on("dialog", async (dialog) => {
      outcome = await dialog.accept().catch((err: Error) => err);
    });
    await page.startDialogHandling();
    opened();
    await tick(30);
    assert.equal((outcome as Error).name, "BiDiError");
  });

  it("closed resolves with the answer from userPromptClosed", async () => {
    const { page, opened, closed } = setup();
    let seen!: Dialog;
    page.on("dialog", (dialog) => {
      seen = dialog;
    });
    await page.startDialogHandling();
    opened({ type: "prompt" });
    await tick(20);
    let result: unknown;
    void seen.closed.then((value) => (result = value));
    closed({ type: "prompt", accepted: true, userText: "typed" });
    await tick(10);
    assert.deepEqual(result, { accepted: true, userText: "typed" });
  });
});

describe("default policy", () => {
  it("dismisses an alert nobody handled and says so", async () => {
    const { page, opened, handled } = setup();
    await page.startDialogHandling();
    opened({ type: "alert", message: "Saved!" });
    await tick(30);
    assert.deepEqual(handled(), [{ context: "ctx-1", accept: false }]);
    assert.equal(warn.mock.callCount(), 1);
    const [template, message, outcome] = warn.mock.calls[0]!.arguments as string[];
    assert.match(template!, /Dialog "%s" was %s automatically; add page\.on\("dialog"\) to handle it/);
    assert.deepEqual([message, outcome], ["Saved!", "dismissed"]);
  });

  it("dismisses confirm and prompt too", async () => {
    const { page, opened, handled } = setup();
    await page.startDialogHandling();
    opened({ type: "confirm" });
    opened({ type: "prompt" });
    await tick(30);
    assert.deepEqual(handled().map((h) => h.accept), [false, false]);
  });

  it("accepts beforeunload so navigation can go on", async () => {
    const { page, opened, handled } = setup();
    await page.startDialogHandling();
    opened({ type: "beforeunload", message: "" });
    await tick(30);
    assert.deepEqual(handled(), [{ context: "ctx-1", accept: true }]);
    assert.equal((warn.mock.calls[0]!.arguments as string[])[2], "accepted");
  });

  it("applies when a listener returns without handling the dialog", async () => {
    const { page, opened, handled } = setup();
    page.on("dialog", () => {});
    await page.startDialogHandling();
    opened({ type: "confirm" });
    await tick(30);
    assert.deepEqual(handled(), [{ context: "ctx-1", accept: false }]);
  });

  it("waits for an async listener before applying, and not at all if it handled the dialog", async () => {
    const { page, opened, handled } = setup();
    page.on("dialog", async (dialog) => {
      await tick(40);
      await dialog.accept();
    });
    await page.startDialogHandling();
    opened({ type: "confirm" });
    await tick(15);
    assert.deepEqual(handled(), [], "still waiting for the listener");
    await tick(60);
    assert.deepEqual(handled(), [{ context: "ctx-1", accept: true }]);
    assert.equal(warn.mock.callCount(), 0);
  });

  it("applies after a listener threw, and logs the error", async () => {
    const { page, opened, handled } = setup();
    page.on("dialog", () => {
      throw new Error("listener failed");
    });
    await page.startDialogHandling();
    opened({ type: "confirm" });
    await tick(30);
    assert.deepEqual(handled(), [{ context: "ctx-1", accept: false }]);
    assert.ok(error.mock.callCount() >= 1);
  });

  it("does not answer a prompt the browser already handled, but still tells the listeners", async () => {
    const { page, opened, handled } = setup();
    let notified: Dialog | undefined;
    page.on("dialog", (dialog) => {
      notified = dialog;
    });
    await page.startDialogHandling();
    opened({ handler: "dismiss" });
    await tick(30);
    assert.deepEqual(handled(), []);
    assert.ok(notified);
    await assert.rejects(notified.accept(), /dialog already handled/);
  });
});

describe("which prompts belong to the page", () => {
  it("handles a prompt from an iframe, answering through the top-level context", async () => {
    const { page, opened, handled } = setup();
    page.on("dialog", (dialog) => dialog.accept());
    await page.startDialogHandling();
    opened({ context: "frame" });
    await tick(20);
    assert.deepEqual(handled(), [{ context: "ctx-1", accept: true }]);
  });

  it("ignores prompts of other pages", async () => {
    const { page, opened, handled } = setup();
    let count = 0;
    page.on("dialog", () => count++);
    await page.startDialogHandling();
    opened({ context: "other" });
    await tick(30);
    assert.equal(count, 0);
    assert.deepEqual(handled(), []);
  });
});

describe("listener management", () => {
  it("off removes a listener, once fires a single time", async () => {
    const { page, opened } = setup();
    let onceCount = 0;
    let offCount = 0;
    const off = () => {
      offCount++;
    };
    page.on("dialog", off);
    page.off("dialog", off);
    page.once("dialog", (dialog) => {
      onceCount++;
      return dialog.dismiss();
    });
    await page.startDialogHandling();
    opened();
    await tick(20);
    opened();
    await tick(20);
    assert.equal(onceCount, 1);
    assert.equal(offCount, 0);
  });

  it("page.on starts dialog handling by itself", async () => {
    const { ws, page } = setup();
    page.on("dialog", () => {});
    await tick(40);
    assert.ok(ws.sent.some((m) => m.method === "session.subscribe" && (m.params as any).events.includes("browsingContext.userPromptOpened")));
  });

  it("dispose stops handling and unsubscribes", async () => {
    const { ws, page, opened, handled } = setup();
    await page.startDialogHandling();
    await page.dispose();
    await tick(20);
    opened();
    await tick(20);
    assert.deepEqual(handled(), []);
    assert.ok(ws.sent.filter((m) => m.method === "session.unsubscribe").length >= 2);
  });

  it("startDialogHandling is idempotent", async () => {
    const { ws, page } = setup();
    await Promise.all([page.startDialogHandling(), page.startDialogHandling()]);
    const prompts = ws.sent.filter(
      (m) => m.method === "session.subscribe" && (m.params as any).events[0].startsWith("browsingContext.userPrompt"),
    );
    assert.equal(prompts.length, 2, "opened + closed, once");
  });
});
