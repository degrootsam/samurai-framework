import assert from "node:assert/strict";
import EventEmitter from "node:events";
import { afterEach, describe, it } from "node:test";
import {
  autoReply,
  FakeWebSocket,
  makeConnector,
  tick,
} from "../testing/fake-websocket.js";
import type { ContextTree } from "./context-tree.js";
import { DialogHandling } from "./dialog-handling.js";
import type { Dialog } from "./dialog.js";

const stops: Array<() => void> = [];
afterEach(() => stops.splice(0).forEach((stop) => stop()));

function setup() {
  const ws = new FakeWebSocket();
  const connector = makeConnector(ws);
  stops.push(
    autoReply(ws, {
      "session.subscribe": () => ({ subscription: "sub-1" }),
      "session.unsubscribe": () => ({}),
      "browsingContext.handleUserPrompt": () => ({}),
    }),
  );
  const emitter = new EventEmitter();
  // The page "top" owns itself and its frame, nothing else
  const tree = {
    isWithin: (context: string, root: string) =>
      root === "top" && (context === "top" || context === "frame"),
  } as ContextTree;
  const handling = new DialogHandling(
    connector,
    "top",
    { ensure: async () => tree, peek: () => tree },
    emitter,
  );
  const answers = () =>
    ws.sent
      .filter((m) => m.method === "browsingContext.handleUserPrompt")
      .map((m) => m.params as { context: string; accept: boolean });
  const open = (type: string, context = "top") =>
    ws.emitEvent("browsingContext.userPromptOpened", {
      context,
      handler: "ignore",
      message: "Sure?",
      type,
      userContext: "default",
    });
  return { ws, handling, emitter, answers, open };
}

describe("DialogHandling", () => {
  it("hands a dialog to the listeners, which answer it", async () => {
    const { handling, emitter, answers, open } = setup();
    await handling.start();
    const seen: string[] = [];
    emitter.on("dialog", async (dialog: Dialog) => {
      seen.push(`${dialog.type()}: ${dialog.message()}`);
      await dialog.accept();
    });
    open("confirm");
    await tick(20);
    assert.deepEqual(seen, ["confirm: Sure?"]);
    assert.deepEqual(answers(), [{ context: "top", accept: true }]);
  });

  it("dismisses a dialog nobody answers, and accepts a beforeunload prompt", async () => {
    const { handling, answers, open } = setup();
    await handling.start();
    open("alert");
    open("beforeunload");
    await tick(20);
    assert.deepEqual(
      answers().map((a) => a.accept),
      [false, true],
    );
  });

  it("takes dialogs of the page's frames and ignores other pages", async () => {
    const { handling, answers, open } = setup();
    await handling.start();
    open("alert", "frame");
    open("alert", "elsewhere");
    await tick(20);
    // The answer goes to the page's top-level context, where the prompt belongs
    assert.deepEqual(answers(), [{ context: "top", accept: false }]);
  });

  it("a listener that throws does not stop the answer", async () => {
    const { handling, emitter, answers, open } = setup();
    await handling.start();
    emitter.on("dialog", () => {
      throw new Error("listener bug");
    });
    open("alert");
    await tick(20);
    assert.equal(answers().length, 1, "still dismissed");
  });

  it("starts once and stops listening on dispose, also when disposed twice", async () => {
    const { ws, handling, answers, open } = setup();
    await Promise.all([handling.start(), handling.start()]);
    const subscribes = ws.sent.filter(
      (m) => m.method === "session.subscribe",
    ).length;
    await handling.start();
    assert.equal(
      ws.sent.filter((m) => m.method === "session.subscribe").length,
      subscribes,
    );
    await handling.dispose();
    await handling.dispose();
    open("alert");
    await tick(20);
    assert.deepEqual(answers(), [], "nothing listens any more");
  });
});
