import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, describe, it } from "node:test";
import { autoReply, FakeWebSocket } from "../testing/fake-websocket.js";
import { BiDiConnector } from "../transport/bidi-connection.js";
import { prepareDownloadsDir, removeIfEmpty } from "./downloads-dir.js";

const stops: Array<() => void> = [];
afterEach(() => stops.splice(0).forEach((stop) => stop()));
const base = mkdtempSync(path.join(tmpdir(), "samurai-downloads-"));
after(() => rmSync(base, { recursive: true, force: true }));

function setup(handlers: Record<string, (params: any) => object | Error> = {}) {
  const ws = new FakeWebSocket();
  const connector = new BiDiConnector(ws as unknown as WebSocket);
  stops.push(autoReply(ws, { "browser.setDownloadBehavior": () => ({}), ...handlers }));
  return { ws, connector };
}
const failing = (code: string) => Object.assign(new Error(code), { code });

describe("prepareDownloadsDir", () => {
  it("makes a folder below the base and tells the browser to save there", async () => {
    const { ws, connector } = setup();
    const dir = await prepareDownloadsDir(connector, path.join(base, "a"));
    assert.ok(dir);
    assert.equal(path.dirname(dir), path.join(base, "a"));
    assert.ok(existsSync(dir));
    assert.deepEqual(ws.sent[0]!.params, { downloadBehavior: { type: "allowed", destinationFolder: dir } });
  });

  it("every call gets a folder of its own", async () => {
    const { connector } = setup();
    const first = await prepareDownloadsDir(connector, path.join(base, "b"));
    const second = await prepareDownloadsDir(connector, path.join(base, "b"));
    assert.notEqual(first, second);
  });

  it("a browser that cannot be told gets no folder, and none is left behind", async () => {
    const { connector } = setup({ "browser.setDownloadBehavior": () => failing("unknown command") });
    const target = path.join(base, "c");
    assert.equal(await prepareDownloadsDir(connector, target), undefined);
    assert.deepEqual(readdirSync(target), []);
  });

  it("other errors are thrown, folder removed", async () => {
    const { connector } = setup({ "browser.setDownloadBehavior": () => failing("invalid argument") });
    const target = path.join(base, "d");
    await assert.rejects(prepareDownloadsDir(connector, target), { name: "BiDiError", code: "invalid argument" });
    assert.deepEqual(readdirSync(target), []);
  });
});

describe("removeIfEmpty", () => {
  it("removes an empty folder, keeps one that has files", () => {
    const empty = path.join(base, "empty");
    const full = path.join(base, "full");
    for (const dir of [empty, full]) {
      rmSync(dir, { recursive: true, force: true });
    }
    mkdirSync(empty);
    mkdirSync(full);
    writeFileSync(path.join(full, "report.csv"), "x");
    removeIfEmpty(empty);
    removeIfEmpty(full);
    assert.equal(existsSync(empty), false);
    assert.equal(existsSync(path.join(full, "report.csv")), true);
  });

  it("does nothing for a missing folder or no folder", () => {
    assert.doesNotThrow(() => removeIfEmpty(path.join(base, "never-existed")));
    assert.doesNotThrow(() => removeIfEmpty(undefined));
  });
});
