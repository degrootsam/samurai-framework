import { test } from "node:test";
import assert from "node:assert/strict";
import type Page from "../browser/page.js";
import type Locator from "../locator/locator.js";
import { AgentController } from "./session.js";
import { LiveView, type LiveSink } from "./live-view.js";
import type { AgentEvent, LiveFrameEvent } from "./types.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A page whose picture changes on every look, or never */
function fakePage(options: { changing: boolean; jpeg?: boolean }) {
  let n = 0;
  const shots: unknown[] = [];
  const page = {
    evaluate: async () => ({
      url: "http://x.test/",
      title: "T",
      width: 100,
      height: 50,
      dpr: 2,
      sig: options.changing ? `s${n}` : "same",
    }),
    screenshot: async (o: { type: string }) => {
      shots.push(o);
      if (o.type === "jpeg" && options.jpeg === false)
        throw new Error("unsupported image format jpeg");
      return Buffer.from(options.changing ? `img${n++}` : "img");
    },
  } as unknown as Page;
  return { page, shots };
}

function sink() {
  const events: AgentEvent[] = [];
  const frames: LiveFrameEvent[] = [];
  let person = false;
  const out: LiveSink = {
    emit: (e) => events.push(e),
    frame: (f) => frames.push(f),
    person: () => person,
  };
  return { out, events, frames, setPerson: (v: boolean) => (person = v) };
}

test("frames come at most maxFps a second while the page changes", async () => {
  const { page } = fakePage({ changing: true });
  const s = sink();
  const view = new LiveView(page, s.out, { maxFps: 4 });
  view.start();
  await wait(1100);
  await view.stop();
  assert.ok(s.frames.length >= 2 && s.frames.length <= 6, `${s.frames.length}`);
  for (let i = 1; i < s.frames.length - 1; i++)
    assert.ok(s.frames[i]!.at - s.frames[i - 1]!.at >= 240);
  const first = s.frames[0]!;
  assert.equal(first.mime, "image/jpeg");
  assert.equal(first.devicePixelRatio, 2);
  assert.equal(first.width, 100);
  assert.equal(first.height, 50);
  assert.equal(
    Buffer.from(first.data, "base64").toString().startsWith("img"),
    true,
  );
});

test("an unchanging page sends one frame, and the url once", async () => {
  const { page } = fakePage({ changing: false });
  const s = sink();
  const view = new LiveView(page, s.out);
  view.start();
  await wait(2200);
  view.touch();
  await wait(600);
  await view.stop();
  assert.equal(s.frames.length, 1);
  assert.deepEqual(
    s.events.map((e) => e.type),
    ["url"],
  );
});

test("a browser that cannot do JPEG gets PNG, and stays on it", async () => {
  const { page, shots } = fakePage({ changing: true, jpeg: false });
  const s = sink();
  const view = new LiveView(page, s.out, { maxFps: 10 });
  view.start();
  await wait(700);
  await view.stop();
  assert.ok(s.frames.length >= 2);
  assert.ok(s.frames.every((f) => f.mime === "image/png"));
  assert.equal(
    (shots as { type: string }[]).filter((o) => o.type === "jpeg").length,
    1,
  );
});

test("while the person drives the page is captured as often as allowed", async () => {
  const { page } = fakePage({ changing: false });
  const s = sink();
  s.setPerson(true);
  const view = new LiveView(page, s.out);
  view.start();
  await wait(100);
  await view.stop();
  assert.equal(s.frames.length, 1);
});

test("acted gives the box, falling back to the box from before, and no event without one", async () => {
  const { page } = fakePage({ changing: false });
  const s = sink();
  const view = new LiveView(page, s.out);
  const gone = {
    boundingBox: async () => null,
  } as unknown as Locator;
  const there = {
    boundingBox: async () => ({ x: 1, y: 2, width: 30, height: 10 }),
  } as unknown as Locator;
  view.acted({ locator: gone, label: "a", before: null });
  view.acted({
    locator: gone,
    label: 'clicked "Pay"',
    step: 3,
    before: { x: 5, y: 6, width: 7, height: 8 },
  });
  view.acted({ locator: there, label: "c", before: null });
  await wait(30);
  const acted = s.events.filter((e) => e.type === "acted");
  assert.equal(acted.length, 2);
  assert.deepEqual(acted[0], {
    type: "acted",
    box: { x: 5, y: 6, width: 7, height: 8 },
    label: 'clicked "Pay"',
    step: 3,
    at: (acted[0] as { at: number }).at,
  });
  assert.deepEqual((acted[1] as { box: unknown }).box, {
    x: 1,
    y: 2,
    width: 30,
    height: 10,
  });
});

test("frames are not kept in the log: a slow reader sees the newest one only", async () => {
  const seen: AgentEvent[] = [];
  const listened: AgentEvent[] = [];
  const controller = new AgentController(
    { begin: async () => undefined, end: async () => "" },
    (e) => listened.push(e),
  );
  const frame = (n: number): LiveFrameEvent => ({
    type: "frame",
    mime: "image/jpeg",
    data: String(n),
    width: 1,
    height: 1,
    devicePixelRatio: 1,
    at: n,
  });
  for (let n = 1; n <= 5; n++) controller.emitFrame(frame(n));
  controller.emit({ type: "plan", text: "go" });
  const reader = controller.events[Symbol.asyncIterator]();
  seen.push((await reader.next()).value as AgentEvent);
  seen.push((await reader.next()).value as AgentEvent);
  assert.equal(listened.filter((e) => e.type === "frame").length, 5);
  assert.deepEqual(
    seen.map((e) => e.type),
    ["plan", "frame"],
  );
  assert.equal((seen[1] as LiveFrameEvent).data, "5");
  // Once the run ended, no frame follows the `ended` event
  controller.emitFrame(frame(6));
  controller.end({
    reason: "finished",
    file: "f",
    test: "t",
    steps: 0,
    secrets: [],
    tokens: 0,
  });
  const rest: AgentEvent[] = [];
  for (let r = await reader.next(); !r.done; r = await reader.next())
    rest.push(r.value);
  assert.deepEqual(
    rest.map((e) => e.type),
    ["ended"],
  );
});
