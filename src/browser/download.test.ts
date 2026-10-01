import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { autoReply, FakeWebSocket, tick } from "../testing/fake-websocket.js";
import { BiDiConnector } from "../transport/bidi-connection.js";
import { ContextTree } from "./context-tree.js";
import { Download, DownloadError, DownloadTracker } from "./download.js";

const TREE = [
  { context: "top", parent: null, children: [{ context: "frame", parent: "top", children: [] }] },
  { context: "other", parent: null, children: [] },
];
const stops: Array<() => void> = [];
afterEach(() => stops.splice(0).forEach((stop) => stop()));

async function setup(options: { timeout?: number } = {}) {
  const ws = new FakeWebSocket();
  const connector = new BiDiConnector(ws as unknown as WebSocket);
  stops.push(autoReply(ws, { "browsingContext.getTree": () => ({ contexts: TREE }) }));
  const tree = await ContextTree.create(connector);
  const tracker = await DownloadTracker.start(connector, tree, "top", { timeout: options.timeout ?? 1000 });
  const seen: Download[] = [];
  tracker.on("download", (download) => seen.push(download));
  const begin = (navigation: string, extra: { context?: string; url?: string; filename?: string } = {}) =>
    ws.emitEvent("browsingContext.downloadWillBegin", {
      context: extra.context ?? "top",
      navigation,
      timestamp: 1,
      url: extra.url ?? `https://example.test/${navigation}`,
      suggestedFilename: extra.filename ?? `${navigation}.csv`,
    });
  const complete = (navigation: string, filepath = `/tmp/dl/${navigation}.csv`, context = "top") =>
    ws.emitEvent("browsingContext.downloadEnd", { context, navigation, timestamp: 2, url: "u", status: "complete", filepath });
  const cancel = (navigation: string, context = "top") =>
    ws.emitEvent("browsingContext.downloadEnd", { context, navigation, timestamp: 2, url: "u", status: "canceled" });
  return { ws, tracker, seen, begin, complete, cancel };
}

describe("DownloadTracker", () => {
  it("announces a download with its url and suggested file name", async () => {
    const { seen, begin } = await setup();
    begin("n1", { url: "https://example.test/file", filename: "report.csv" });
    assert.equal(seen.length, 1);
    assert.ok(seen[0] instanceof Download);
    assert.equal(seen[0]!.url(), "https://example.test/file");
    assert.equal(seen[0]!.suggestedFilename(), "report.csv");
  });

  it("path() resolves with the file the browser wrote once the download completed", async () => {
    const { seen, begin, complete } = await setup();
    begin("n1");
    const pending = seen[0]!.path();
    complete("n1", "/tmp/dl/report.csv");
    assert.equal(await pending, "/tmp/dl/report.csv");
    assert.equal(await seen[0]!.failure(), null);
  });

  it("path() also works when the download finished before it was asked", async () => {
    const { seen, begin, complete } = await setup();
    begin("n1");
    complete("n1", "/tmp/dl/a.csv");
    await tick(5);
    assert.equal(await seen[0]!.path(), "/tmp/dl/a.csv");
    assert.equal(await seen[0]!.path(), "/tmp/dl/a.csv", "and again");
  });

  it("a cancelled download rejects path() with a DownloadError and reports the failure", async () => {
    const { seen, begin, cancel } = await setup();
    begin("n1", { url: "https://example.test/big" });
    const pending = seen[0]!.path();
    const rejection = assert.rejects(pending, (err: unknown) => {
      assert.ok(err instanceof DownloadError);
      assert.equal(err.url, "https://example.test/big");
      assert.equal(err.reason, "canceled");
      assert.match(err.message, /^Download of https:\/\/example\.test\/big failed: canceled/);
      return true;
    });
    cancel("n1");
    await rejection;
    assert.equal(await seen[0]!.failure(), "canceled");
  });

  it("failure() waits for the end, too", async () => {
    const { seen, begin, cancel } = await setup();
    begin("n1");
    let failure: string | null | undefined;
    void seen[0]!.failure().then((value) => (failure = value));
    await tick(10);
    assert.equal(failure, undefined);
    cancel("n1");
    await tick(10);
    assert.equal(failure, "canceled");
  });

  it("path() times out when the download never ends", async () => {
    const { seen, begin } = await setup({ timeout: 50 });
    begin("n1", { url: "https://example.test/slow" });
    await assert.rejects(seen[0]!.path(), /Download of https:\/\/example\.test\/slow did not finish within 50ms/);
    await assert.rejects(seen[0]!.path({ timeout: 20 }), /did not finish within 20ms/);
  });

  it("matches ends to downloads by navigation, however they interleave", async () => {
    const { seen, begin, complete, cancel } = await setup();
    begin("a");
    begin("b");
    cancel("b");
    complete("a", "/tmp/dl/a.csv");
    assert.equal(await seen[0]!.path(), "/tmp/dl/a.csv");
    await assert.rejects(seen[1]!.path(), DownloadError);
  });

  it("an end without a beginning is ignored", async () => {
    const { seen, complete } = await setup();
    complete("ghost");
    assert.equal(seen.length, 0);
  });

  it("takes downloads of iframes, ignores those of other pages", async () => {
    const { seen, begin } = await setup();
    begin("f", { context: "frame" });
    begin("x", { context: "other" });
    assert.deepEqual(seen.map((d) => d.suggestedFilename()), ["f.csv"]);
  });

  it("a throwing listener does not stop the others, and off removes one", async () => {
    const { tracker, begin } = await setup();
    let second = 0;
    let removed = 0;
    const gone = () => removed++;
    tracker.on("download", () => {
      throw new Error("listener failed");
    });
    tracker.on("download", () => second++);
    tracker.on("download", gone);
    tracker.off("download", gone);
    begin("n1");
    assert.equal(second, 1);
    assert.equal(removed, 0);
  });

  it("subscribes to both events and lets go of them on dispose", async () => {
    const { ws, tracker, begin, seen } = await setup();
    const subscribed = ws.sent.filter((m) => m.method === "session.subscribe").map((m) => (m.params as any).events[0]);
    assert.ok(subscribed.includes("browsingContext.downloadWillBegin"));
    assert.ok(subscribed.includes("browsingContext.downloadEnd"));
    await tracker.dispose();
    await tick(10);
    begin("late");
    assert.equal(seen.length, 0);
    assert.ok(ws.sent.filter((m) => m.method === "session.unsubscribe").length >= 2);
    await assert.doesNotReject(tracker.dispose());
  });

  it("dispose rejects downloads still in progress", async () => {
    const { seen, begin, tracker } = await setup();
    begin("n1");
    const pending = seen[0]!.path();
    const rejection = assert.rejects(pending, /page closed/);
    await tracker.dispose();
    await rejection;
  });
});
