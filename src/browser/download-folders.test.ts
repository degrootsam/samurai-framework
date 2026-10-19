import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  FakeWebSocket,
  autoReply,
  tick,
  makeConnector,
} from "../testing/fake-websocket.js";
import { ChromeDownloadFolders, uniqueName } from "./download-folders.js";

let dir: string;
beforeEach(() => (dir = mkdtempSync(path.join(tmpdir(), "samurai-dlf-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("uniqueName", () => {
  it("keeps a free name and numbers a taken one like Firefox does", () => {
    assert.equal(uniqueName(dir, "report.csv"), "report.csv");
    writeFileSync(path.join(dir, "report.csv"), "");
    assert.equal(uniqueName(dir, "report.csv"), "report(1).csv");
    writeFileSync(path.join(dir, "report(1).csv"), "");
    assert.equal(uniqueName(dir, "report.csv"), "report(2).csv");
    writeFileSync(path.join(dir, "noext"), "");
    assert.equal(uniqueName(dir, "noext"), "noext(1)");
  });
});

describe("ChromeDownloadFolders", () => {
  async function setup() {
    const ws = new FakeWebSocket();
    const connector = makeConnector(ws);
    const stop = autoReply(ws, {
      "session.subscribe": () => ({ subscription: "sub-1" }),
    });
    const folders = new ChromeDownloadFolders(connector, dir);
    await folders.start();
    const behaviors = () =>
      ws.sent
        .filter((m) => m.method === "browser.setDownloadBehavior")
        .map(
          (m) => (m.params as any).downloadBehavior.destinationFolder as string,
        );
    return { ws, folders, behaviors, stop };
  }
  const begin = (ws: FakeWebSocket, n: number) =>
    ws.emitEvent("browsingContext.downloadWillBegin", {
      context: "c",
      navigation: `n${n}`,
      timestamp: 0,
      url: "u",
      suggestedFilename: "report.csv",
    });
  const finishedFile = (staging: string, content: string) => {
    mkdirSync(staging, { recursive: true });
    const file = path.join(staging, "report.csv");
    writeFileSync(file, content);
    return file;
  };

  it("starts in a folder of its own and moves to a new one when a download begins", async () => {
    const { ws, behaviors, stop } = await setup();
    assert.equal(behaviors().length, 1);
    begin(ws, 1);
    await tick(20);
    assert.equal(behaviors().length, 2);
    assert.notEqual(behaviors()[0], behaviors()[1]);
    assert.ok(
      behaviors().every((b) => b.startsWith(path.join(dir, ".staging"))),
    );
    stop();
  });

  it("moves each finished file to a free name, so the second does not replace the first", async () => {
    const { ws, behaviors, stop } = await setup();
    begin(ws, 1);
    await tick(20);
    const first = finishedFile(behaviors()[0]!, "one");
    const ended = (file: string, n: number) => {
      const params = {
        context: "c",
        navigation: `n${n}`,
        timestamp: 0,
        url: "u",
        status: "complete",
        filepath: file,
      };
      ws.emitEvent("browsingContext.downloadEnd", params);
    };
    ended(first, 1);
    begin(ws, 2);
    await tick(20);
    const second = finishedFile(behaviors()[1]!, "two");
    ended(second, 2);
    assert.deepEqual(
      readdirSync(dir)
        .filter((f) => !f.startsWith("."))
        .sort(),
      ["report(1).csv", "report.csv"],
    );
    assert.equal(readFileSync(path.join(dir, "report.csv"), "utf8"), "one");
    assert.equal(readFileSync(path.join(dir, "report(1).csv"), "utf8"), "two");
    stop();
  });

  it("leaves no staging folders behind once disposed", async () => {
    const { folders, stop } = await setup();
    await folders.dispose();
    assert.equal(existsSync(path.join(dir, ".staging")), false);
    stop();
  });
});
