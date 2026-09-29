import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, describe, it } from "node:test";
import { autoReply, FakeWebSocket, tick } from "../testing/fake-websocket.js";
import { BiDiConnector } from "../transport/bidi-connection.js";
import { ContextTree } from "./context-tree.js";
import { FileChooser, FileChooserTracker } from "./file-chooser.js";

const TREE = [
  { context: "top", parent: null, children: [{ context: "frame", parent: "top", children: [] }] },
  { context: "other", parent: null, children: [] },
];
const stops: Array<() => void> = [];
afterEach(() => stops.splice(0).forEach((stop) => stop()));
const dir = mkdtempSync(path.join(tmpdir(), "samurai-chooser-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const file = (name: string) => {
  const full = path.join(dir, name);
  writeFileSync(full, name);
  return full;
};

async function setup(handlers: Record<string, (params: any) => object | Error> = {}) {
  const ws = new FakeWebSocket();
  const connector = new BiDiConnector(ws as unknown as WebSocket);
  stops.push(autoReply(ws, { "browsingContext.getTree": () => ({ contexts: TREE }), "input.setFiles": () => ({}), ...handlers }));
  const tree = await ContextTree.create(connector);
  const tracker = await FileChooserTracker.start(connector, tree, "top");
  const seen: FileChooser[] = [];
  tracker.on("filechooser", (chooser) => seen.push(chooser));
  const open = (extra: { context?: string; multiple?: boolean; element?: object | null } = {}) =>
    ws.emitEvent("input.fileDialogOpened", {
      context: extra.context ?? "top",
      multiple: extra.multiple ?? false,
      ...(extra.element !== null && { element: extra.element ?? { type: "node", sharedId: "input-1", value: {} } }),
    });
  const setFiles = () => ws.sent.filter((m) => m.method === "input.setFiles").map((m) => m.params as any);
  return { ws, tracker, seen, open, setFiles };
}

describe("FileChooserTracker", () => {
  it("announces a chooser for this page, with what the browser says about it", async () => {
    const { seen, open } = await setup();
    open({ multiple: true });
    open({ multiple: false });
    assert.equal(seen.length, 2);
    assert.ok(seen[0] instanceof FileChooser);
    assert.deepEqual(seen.map((chooser) => chooser.isMultiple()), [true, false]);
  });

  it("takes iframes, ignores other pages", async () => {
    const { seen, open } = await setup();
    open({ context: "frame" });
    open({ context: "other" });
    assert.equal(seen.length, 1);
  });

  it("a throwing listener does not stop the others; off removes one", async () => {
    const { tracker, open } = await setup();
    let second = 0;
    let removed = 0;
    const gone = () => removed++;
    tracker.on("filechooser", () => {
      throw new Error("listener failed");
    });
    tracker.on("filechooser", () => second++);
    tracker.on("filechooser", gone);
    tracker.off("filechooser", gone);
    open();
    assert.equal(second, 1);
    assert.equal(removed, 0);
  });

  it("subscribes to the event and lets go of it on dispose", async () => {
    const { ws, tracker, open, seen } = await setup();
    assert.ok(ws.sent.some((m) => m.method === "session.subscribe" && (m.params as any).events[0] === "input.fileDialogOpened"));
    await tracker.dispose();
    await tick(10);
    open();
    assert.equal(seen.length, 0);
    await assert.doesNotReject(tracker.dispose());
  });
});

describe("FileChooser.setFiles", () => {
  it("sets the files on the element the browser named, in the frame that opened the dialog", async () => {
    const { seen, open, setFiles } = await setup();
    open({ context: "frame", element: { type: "node", sharedId: "in-frame" } });
    const a = file("a.txt");
    await seen[0]!.setFiles(a);
    assert.deepEqual(setFiles(), [{ context: "frame", element: { sharedId: "in-frame" }, files: [a] }]);
  });

  it("takes a list, and resolves relative paths", async () => {
    const { seen, open, setFiles } = await setup();
    open({ multiple: true });
    const [a, b] = [file("m1.txt"), file("m2.txt")];
    await seen[0]!.setFiles([path.relative(process.cwd(), a), b]);
    assert.deepEqual(setFiles()[0].files, [a, b]);
  });

  it("refuses several files for a chooser that takes one, and sends nothing", async () => {
    const { seen, open, setFiles } = await setup();
    open({ multiple: false });
    await assert.rejects(seen[0]!.setFiles([file("x1.txt"), file("x2.txt")]), /file chooser does not accept multiple files/);
    assert.deepEqual(setFiles(), []);
  });

  it("an empty list clears the selection", async () => {
    const { seen, open, setFiles } = await setup();
    open();
    await seen[0]!.setFiles([]);
    assert.deepEqual(setFiles()[0].files, []);
  });

  it("checks the files exist first, before sending", async () => {
    const { seen, open, setFiles } = await setup();
    open();
    const missing = path.join(dir, "nope.txt");
    await assert.rejects(seen[0]!.setFiles(missing), new Error(`setFiles(): file not found: ${missing}`));
    const folder = path.join(dir, "folder");
    mkdirSync(folder);
    await assert.rejects(seen[0]!.setFiles(folder), new Error(`setFiles(): not a file: ${folder}`));
    assert.deepEqual(setFiles(), []);
  });

  it("without an element reference it cannot set anything", async () => {
    const { seen, open, setFiles } = await setup();
    open({ element: null });
    await assert.rejects(seen[0]!.setFiles(file("e.txt")), /file chooser has no element reference/);
    assert.deepEqual(setFiles(), []);
  });

  it("rethrows what the browser answers", async () => {
    const failing = Object.assign(new Error("read-only"), { code: "unable to set file input" });
    const { seen, open } = await setup({ "input.setFiles": () => failing });
    open();
    await assert.rejects(seen[0]!.setFiles(file("f.txt")), { name: "BiDiError", code: "unable to set file input" });
  });
});
