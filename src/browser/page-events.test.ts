import assert from "node:assert/strict";
import EventEmitter from "node:events";
import { describe, it } from "node:test";
import { sourcesFor, waitForPageEvent } from "./page-events.js";

const wrong = (timeout: number) => new Error(`timed out after ${timeout}`);

describe("sourcesFor", () => {
  it("names what must be listening for each event", () => {
    assert.deepEqual(sourcesFor("dialog"), ["dialogs"]);
    assert.deepEqual(sourcesFor("download"), ["downloads"]);
    assert.deepEqual(sourcesFor("filechooser"), ["filechoosers"]);
    assert.deepEqual(sourcesFor("console"), ["logs"]);
    assert.deepEqual(sourcesFor("pageerror"), ["logs"]);
    assert.deepEqual(sourcesFor("request"), ["network"]);
    assert.deepEqual(sourcesFor("requestfailed"), ["network"]);
    assert.deepEqual(sourcesFor("response"), ["network", "bodies"]);
  });
});

describe("waitForPageEvent", () => {
  it("resolves with the first event the predicate accepts and stops listening", async () => {
    const emitter = new EventEmitter();
    const pending = waitForPageEvent(
      emitter,
      "download",
      (item) => (item as unknown as number) > 1,
      {},
      1000,
      wrong,
    );
    emitter.emit("download", 1);
    emitter.emit("download", 2);
    assert.equal(await pending, 2 as never);
    assert.equal(emitter.listenerCount("download"), 0);
  });

  it("listens before the trigger runs, so what the trigger causes is not missed", async () => {
    const emitter = new EventEmitter();
    const item = await waitForPageEvent(
      emitter,
      "filechooser",
      () => true,
      { trigger: async () => void emitter.emit("filechooser", "picked") },
      1000,
      wrong,
    );
    assert.equal(item, "picked" as never);
  });

  it("rejects with the trigger's error", async () => {
    const emitter = new EventEmitter();
    await assert.rejects(
      waitForPageEvent(
        emitter,
        "download",
        () => true,
        { trigger: async () => Promise.reject(new Error("click failed")) },
        1000,
        wrong,
      ),
      /click failed/,
    );
    assert.equal(emitter.listenerCount("download"), 0);
  });

  it("rejects with the predicate's error", async () => {
    const emitter = new EventEmitter();
    const pending = waitForPageEvent(
      emitter,
      "request",
      () => {
        throw new Error("bad predicate");
      },
      {},
      1000,
      wrong,
    );
    emitter.emit("request", {});
    await assert.rejects(pending, /bad predicate/);
  });

  it("rejects with the error onTimeout builds when nothing comes", async () => {
    const emitter = new EventEmitter();
    await assert.rejects(
      waitForPageEvent(emitter, "download", () => true, {}, 20, wrong),
      /timed out after 20/,
    );
    assert.equal(emitter.listenerCount("download"), 0);
  });
});
