import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { remote, stubConnector, type StubResponse } from "../testing/stub-connector.js";
import { BiDiError } from "../transport/bidi-error.js";
import { ActionTimeoutError } from "./action-timeout-error.js";
import Locator from "./locator.js";

const dir = mkdtempSync(path.join(tmpdir(), "samurai-set-files-"));
after(() => rmSync(dir, { recursive: true, force: true }));
function file(name: string) {
  const full = path.join(dir, name);
  writeFileSync(full, name);
  return full;
}

const state = (overrides: object = {}): StubResponse =>
  remote({
    attached: true,
    visible: true,
    enabled: true,
    editable: true,
    box: { x: 0, y: 0, width: 10, height: 10 },
    hitTarget: null,
    ...overrides,
  });
const info = (overrides: object = {}): StubResponse =>
  remote({ tag: "input", type: "file", multiple: false, ...overrides });

function setup(...responses: StubResponse[]) {
  const stub = stubConnector(...responses);
  return { locator: new Locator("input[@type='file']", stub.connector, "ctx"), ...stub };
}
const methods = (sent: Array<{ method: string }>) => sent.map(({ method }) => method);
const setFilesParams = (sent: Array<{ method: string; params: unknown }>) =>
  sent.filter(({ method }) => method === "input.setFiles").map(({ params }) => params);

describe("setInputFiles", () => {
  it("checks the files, waits for the element, verifies it, then sets the files", async () => {
    const a = file("a.txt");
    const { locator, sent } = setup(state(), info());
    await locator.setInputFiles(a, { timeout: 1000 });
    assert.deepEqual(methods(sent), [
      "browsingContext.locateNodes", // the wait
      "script.callFunction", // its probe
      "browsingContext.locateNodes", // the element to use
      "script.callFunction", // what kind of element it is
      "input.setFiles",
    ]);
    assert.deepEqual(setFilesParams(sent), [
      { context: "ctx", element: { sharedId: "stub-node-0" }, files: [a] },
    ]);
  });

  it("waits only for attached and enabled: no scrolling, no hit test, hidden inputs are fine", async () => {
    const { locator, calls } = setup(state({ visible: false, box: null }), info());
    await locator.setInputFiles(file("hidden.txt"), { timeout: 1000 });
    assert.deepEqual(calls[0]!.args[1], { scroll: false, hitTest: false });
  });

  it("resolves relative paths against the working directory", async () => {
    const a = file("relative.txt");
    const { locator, sent } = setup(state(), info());
    await locator.setInputFiles(path.relative(process.cwd(), a), { timeout: 1000 });
    assert.deepEqual((setFilesParams(sent)[0] as { files: string[] }).files, [a]);
  });

  it("sends several files in order to an input that accepts them", async () => {
    const [a, b] = [file("m1.txt"), file("m2.txt")];
    const { locator, sent } = setup(state(), info({ multiple: true }));
    await locator.setInputFiles([a, b], { timeout: 1000 });
    assert.deepEqual((setFilesParams(sent)[0] as { files: string[] }).files, [a, b]);
  });

  it("refuses several files for an input without multiple, and sends nothing", async () => {
    const { locator, sent } = setup(state(), info({ multiple: false }));
    await assert.rejects(
      locator.setInputFiles([file("x1.txt"), file("x2.txt")], { timeout: 1000 }),
      /setInputFiles\(\): \/\/input\[@type='file'\] does not accept multiple files/,
    );
    assert.deepEqual(setFilesParams(sent), []);
  });

  it("an empty list clears the selection, also on an input without multiple, without touching the disk", async () => {
    const { locator, sent } = setup(state(), info({ multiple: false }));
    await locator.setInputFiles([], { timeout: 1000 });
    assert.deepEqual((setFilesParams(sent)[0] as { files: string[] }).files, []);
  });

  it("fails on a missing file before any command is sent", async () => {
    const missing = path.join(dir, "nope.txt");
    const { locator, sent } = setup(state(), info());
    await assert.rejects(locator.setInputFiles(missing), new Error(`setInputFiles(): file not found: ${missing}`));
    assert.equal(sent.length, 0);
  });

  it("fails on a directory before any command is sent", async () => {
    const folder = path.join(dir, "folder");
    mkdirSync(folder);
    const { locator, sent } = setup(state(), info());
    await assert.rejects(locator.setInputFiles(folder), new Error(`setInputFiles(): not a file: ${folder}`));
    assert.equal(sent.length, 0);
  });

  it("names the first bad file when several are given", async () => {
    const good = file("good.txt");
    const bad = path.join(dir, "bad.txt");
    const { locator } = setup(state(), info());
    await assert.rejects(locator.setInputFiles([good, bad]), /file not found: .*bad\.txt/);
  });

  it("rejects an element that is not a file input, describing what it found", async () => {
    const a = file("wrong.txt");
    const div = setup(state(), info({ tag: "div", type: "" }));
    await assert.rejects(
      div.locator.setInputFiles(a, { timeout: 1000 }),
      /is not an <input type=file> \(found <div>\)/,
    );
    const text = setup(state(), info({ tag: "input", type: "text" }));
    await assert.rejects(
      text.locator.setInputFiles(a, { timeout: 1000 }),
      /is not an <input type=file> \(found <input type="text">\)/,
    );
    assert.deepEqual(setFilesParams(div.sent), []);
    assert.deepEqual(setFilesParams(text.sent), []);
  });

  it("times out naming the check that failed", async () => {
    const { locator, sent } = setup(state({ enabled: false }));
    await assert.rejects(locator.setInputFiles(file("t.txt"), { timeout: 250 }), (err) => {
      assert.ok(err instanceof ActionTimeoutError);
      assert.equal(err.action, "setInputFiles");
      assert.equal(
        err.message,
        "setInputFiles(): //input[@type='file'] was not actionable within 250ms\n" +
          "  attached ✓  enabled ✗",
      );
      return true;
    });
    assert.deepEqual(setFilesParams(sent), []);
  });

  it("times out when the input never appears", async () => {
    const { locator, nodeCounts } = setup(state());
    nodeCounts(0);
    await assert.rejects(
      locator.setInputFiles(file("n.txt"), { timeout: 150 }),
      /setInputFiles\(\): \/\/input\[@type='file'\] was not attached within 150ms/,
    );
  });

  it("with timeout 0 it looks once", async () => {
    const { locator, calls } = setup(state({ enabled: false }));
    await assert.rejects(locator.setInputFiles(file("z.txt"), { timeout: 0 }), ActionTimeoutError);
    assert.equal(calls.length, 1);
  });

  it("waits until the input becomes enabled", async () => {
    const { locator, sent } = setup(state({ enabled: false }), state({ enabled: false }), state(), info());
    await locator.setInputFiles(file("w.txt"), { timeout: 3000 });
    assert.equal(setFilesParams(sent).length, 1);
  });

  it("an input that vanished after the wait is reported as not found", async () => {
    const { locator, nodeCounts, sent } = setup(state(), info());
    nodeCounts(1, 0);
    await assert.rejects(
      locator.setInputFiles(file("v.txt"), { timeout: 1000 }),
      /Failed to locate element \/\/input\[@type='file'\]/,
    );
    assert.deepEqual(setFilesParams(sent), []);
  });

  it("rethrows what the browser answers", async () => {
    const { locator, failCommand } = setup(state(), info());
    failCommand("input.setFiles", new BiDiError("input.setFiles", "unable to set file input", "read-only"));
    await assert.rejects(locator.setInputFiles(file("e.txt"), { timeout: 1000 }), {
      name: "BiDiError",
      code: "unable to set file input",
    });
  });

  it("works through a chained locator", async () => {
    const stub = stubConnector(state(), info());
    const chained = new Locator("//form", stub.connector, "ctx").getByCss("input[type=file]");
    await chained.setInputFiles(file("c.txt"), { timeout: 1000 });
    assert.equal(setFilesParams(stub.sent).length, 1);
  });
});
