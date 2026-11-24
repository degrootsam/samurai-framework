import { test } from "node:test";
import assert from "node:assert/strict";
import type Page from "../browser/page.js";
import { personRecording } from "./take-over.js";
import type { StepRecorder } from "./recording.js";
import type { Snapshotter } from "./snapshot.js";

function setup(bringToFront: () => Promise<void>) {
  const order: string[] = [];
  const page = {
    bringToFront: async () => {
      order.push("front");
      await bringToFront();
    },
    record: () => {
      order.push("record");
      return Promise.resolve({ stop: () => Promise.resolve() });
    },
  } as unknown as Page;
  const hooks = personRecording({
    page,
    steps: { count: 0, rebase() {}, external() {} } as unknown as StepRecorder,
    snapshots: {} as Snapshotter,
  });
  return { hooks, order };
}

test("taking over brings the page to the front, then starts recording", async () => {
  const { hooks, order } = setup(() => Promise.resolve());
  await hooks.begin();
  assert.deepEqual(order, ["front", "record"]);
});

test("a browser that refuses to bring the window to the front does not fail the take over", async () => {
  const { hooks, order } = setup(() => Promise.reject(new Error("no window")));
  await hooks.begin();
  assert.deepEqual(order, ["front", "record"]);
});
