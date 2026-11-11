import { describe, test } from "node:test";
import assert from "node:assert/strict";
import Page from "./page.js";
import {
  autoReply,
  FakeWebSocket,
  tick,
  makeConnector,
} from "../testing/fake-websocket.js";

describe("Page downloads and file choosers", () => {
  const TREE = [{ context: "ctx-1", parent: null, children: [] }];
  function transferPage(settings?: ConstructorParameters<typeof Page>[2]) {
    const ws = new FakeWebSocket();
    const connector = makeConnector(ws);
    const stop = autoReply(ws, {
      "browsingContext.getTree": () => ({ contexts: TREE }),
      "input.setFiles": () => ({}),
    });
    const page = new Page(connector, "ctx-1", settings);
    const begin = (navigation: string, filename = "report.csv") =>
      ws.emitEvent("browsingContext.downloadWillBegin", {
        context: "ctx-1",
        navigation,
        timestamp: 1,
        url: `https://example.test/${filename}`,
        suggestedFilename: filename,
      });
    const end = (navigation: string, filepath = "/tmp/dl/report.csv") =>
      ws.emitEvent("browsingContext.downloadEnd", {
        context: "ctx-1",
        navigation,
        timestamp: 2,
        url: "u",
        status: "complete",
        filepath,
      });
    const chooser = (multiple = false) =>
      ws.emitEvent("input.fileDialogOpened", {
        context: "ctx-1",
        multiple,
        element: { type: "node", sharedId: "input-1" },
      });
    return { ws, page, stop, begin, end, chooser };
  }

  test("waitForDownload resolves when the download starts, and path() when it ends", async () => {
    const { page, stop, begin, end } = transferPage();
    await page.startDownloadTracking();
    const download = await page.waitForDownload({
      timeout: 1000,
      trigger: async () => begin("n1", "report.csv"),
    });
    assert.equal(download.suggestedFilename(), "report.csv");
    assert.equal(download.url(), "https://example.test/report.csv");
    const pending = download.path();
    end("n1", "/tmp/dl/report.csv");
    assert.equal(await pending, "/tmp/dl/report.csv");
    stop();
  });

  test("waitForDownload sets up tracking itself, and takes the first download after it", async () => {
    const { page, stop, begin } = transferPage();
    const waiting = page.waitForDownload({ timeout: 1000 });
    await tick(40);
    begin("n1", "first.csv");
    begin("n2", "second.csv");
    assert.equal((await waiting).suggestedFilename(), "first.csv");
    stop();
  });

  test("a trigger that throws rejects the wait with its error and leaves nothing listening", async () => {
    const { page, stop, begin } = transferPage();
    await page.startDownloadTracking();
    await assert.rejects(
      page.waitForDownload({
        timeout: 1000,
        trigger: async () => {
          throw new Error("click failed");
        },
      }),
      /click failed/,
    );
    const seen: string[] = [];
    page.on("download", (d) => seen.push(d.suggestedFilename()));
    begin("n1", "x.csv");
    assert.deepEqual(seen, ["x.csv"], "only our own listener");
    stop();
  });

  test("waitForDownload times out with a message of its own", async () => {
    const { page, stop } = transferPage();
    await assert.rejects(
      page.waitForDownload({ timeout: 40 }),
      /waitForDownload\(\): no download started within 40ms/,
    );
    stop();
  });

  test("the time path() may take defaults to the navigation timeout in config", async () => {
    const { page, stop, begin } = transferPage({ navigation: { timeout: 40 } });
    await page.startDownloadTracking();
    const download = await page.waitForDownload({
      trigger: async () => begin("n1"),
    });
    await assert.rejects(download.path(), /did not finish within 40ms/);
    stop();
  });

  test("page.on(download) starts tracking by itself; page.off stops it", async () => {
    const { page, stop, begin } = transferPage();
    const seen: string[] = [];
    const listener = (d: { suggestedFilename(): string }) =>
      seen.push(d.suggestedFilename());
    page.on("download", listener);
    await tick(40);
    begin("n1", "a.csv");
    page.off("download", listener);
    begin("n2", "b.csv");
    assert.deepEqual(seen, ["a.csv"]);
    stop();
  });

  test("waitForFileChooser resolves with a chooser that can pick files", async () => {
    const { ws, page, stop, chooser } = transferPage();
    await page.startFileChooserTracking();
    const picked = await page.waitForFileChooser({
      timeout: 1000,
      trigger: async () => chooser(true),
    });
    assert.equal(picked.isMultiple(), true);
    await picked.setFiles([]);
    const sent = ws.sent
      .filter((m) => m.method === "input.setFiles")
      .map((m) => m.params as any);
    assert.deepEqual(sent, [
      { context: "ctx-1", element: { sharedId: "input-1" }, files: [] },
    ]);
    stop();
  });

  test("waitForFileChooser sets up tracking itself and times out with a message of its own", async () => {
    const { page, stop } = transferPage();
    await assert.rejects(
      page.waitForFileChooser({ timeout: 40 }),
      /waitForFileChooser\(\): no file chooser opened within 40ms/,
    );
    stop();
  });

  test("waitForEvent(filechooser) works like waitForFileChooser, without or with trigger", async () => {
    const { page, stop, chooser } = transferPage();
    const pending = page.waitForEvent("filechooser", { timeout: 1000 });
    await tick(40);
    chooser(true);
    assert.equal((await pending).isMultiple(), true);
    const viaTrigger = await page.waitForEvent("filechooser", {
      timeout: 1000,
      predicate: (c) => !c.isMultiple(),
      trigger: async () => {
        chooser(true);
        chooser(false);
      },
    });
    assert.equal(viaTrigger.isMultiple(), false);
    await assert.rejects(
      page.waitForEvent("filechooser", { timeout: 40, predicate: () => false }),
      /no file chooser opened within 40ms/,
    );
    stop();
  });

  test("waitForEvent rejects events it cannot wait for", async () => {
    const { page, stop } = transferPage();
    await assert.rejects(
      page.waitForEvent("dialog" as never),
      /"dialog" is not supported/,
    );
    stop();
  });

  test("page.on(filechooser) starts tracking by itself", async () => {
    const { page, stop, chooser } = transferPage();
    let count = 0;
    page.on("filechooser", () => count++);
    await tick(40);
    chooser();
    assert.equal(count, 1);
    stop();
  });

  test("tracking is set up once, however it is asked for", async () => {
    const { ws, page, stop } = transferPage();
    await Promise.all([
      page.startDownloadTracking(),
      page.startDownloadTracking(),
      page.startFileChooserTracking(),
      page.startFileChooserTracking(),
    ]);
    const events = ws.sent
      .filter((m) => m.method === "session.subscribe")
      .map((m) => (m.params as any).events[0]);
    assert.equal(
      events.filter((e: string) => e === "browsingContext.downloadWillBegin")
        .length,
      1,
    );
    assert.equal(
      events.filter((e: string) => e === "input.fileDialogOpened").length,
      1,
    );
    stop();
  });

  test("dispose stops both and fails downloads still going on", async () => {
    const { page, stop, begin, chooser } = transferPage();
    await page.startFileChooserTracking();
    const download = await page.waitForDownload({
      timeout: 1000,
      trigger: async () => begin("n1"),
    });
    const pending = download.path();
    const rejection = assert.rejects(pending, /page closed/);
    await page.dispose();
    await rejection;
    let count = 0;
    page.on("filechooser", () => count++);
    chooser();
    assert.equal(count, 0, "the old tracker is gone");
    stop();
  });
});
