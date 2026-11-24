import { test } from "node:test";
import assert from "node:assert/strict";
import { refIn } from "../testing/scripted-model.js";
import {
  agentRunFixture,
  ended,
  endedOnce,
  OPTIONS,
  pause,
} from "../testing/agent-run.js";
import type { AgentEvent, LiveFrameEvent } from "./types.js";

const fx = agentRunFixture(9611);
const { start } = fx;

const framesOf = (events: AgentEvent[]) =>
  events.filter((e): e is LiveFrameEvent => e.type === "frame");

const fillEmail = (last: string) => ({
  calls: [
    {
      name: "act",
      args: {
        kind: "fill",
        target: refIn(last, /\[(e\d+)\] textbox "Email"/),
        value: "ann@example.com",
      },
    },
  ],
});

test(
  "a run with liveView streams frames, the url and the box of what the agent did",
  OPTIONS,
  async () => {
    const run = start(
      [
        { calls: [{ name: "snapshot" }] },
        fillEmail,
        () => ({ calls: [{ name: "snapshot" }] }),
        { calls: [{ name: "finish", args: { summary: "ok" } }] },
      ],
      { liveView: true },
    );
    const streamed: AgentEvent[] = [];
    const reader = (async () => {
      for await (const event of run.session.events) streamed.push(event);
    })();
    ended(await run.session.result, "finished");
    await reader;
    endedOnce(run.events);

    const frames = framesOf(run.events);
    assert.ok(frames.length >= 2, `frames: ${frames.length}`);
    const first = frames[0]!;
    assert.match(first.mime, /^image\/(jpeg|png)$/);
    assert.ok(first.width > 100 && first.height > 100);
    assert.ok(first.devicePixelRatio >= 1);
    const bytes = Buffer.from(first.data, "base64").length;
    assert.ok(bytes > 500 && bytes < 150_000, `frame bytes ${bytes}`);
    for (let i = 1; i < frames.length; i++) {
      assert.ok(
        frames[i]!.at - frames[i - 1]!.at >= 200,
        "at most about 4 a second",
      );
      assert.notEqual(
        frames[i]!.data,
        frames[i - 1]!.data,
        "never the same twice in a row",
      );
    }
    console.log(
      `live view: ${frames.length} frames, ${first.mime}, ${Math.round(bytes / 1024)} KB, ${first.width}x${first.height}@${first.devicePixelRatio}`,
    );

    const urls = run.events.filter((e) => e.type === "url");
    assert.ok(urls.length >= 1);
    assert.match(urls[0]!.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.equal(urls[0]!.title, "Shop");

    const acted = run.events.filter((e) => e.type === "acted");
    assert.equal(acted.length, 1);
    assert.equal(acted[0]!.label, 'filled "Email"');
    assert.ok(acted[0]!.box.width > 10 && acted[0]!.box.height > 5);
    assert.ok(acted[0]!.step !== undefined && acted[0]!.step >= 1);

    // A reader of the stream gets the events and never more frames than were sent
    assert.equal(streamed.filter((e) => e.type === "acted").length, 1);
    assert.ok(framesOf(streamed).length <= frames.length);
  },
);

test(
  "without liveView there are no frame, url or acted events",
  OPTIONS,
  async () => {
    const run = start([
      { calls: [{ name: "snapshot" }] },
      fillEmail,
      { calls: [{ name: "finish", args: { summary: "ok" } }] },
    ]);
    ended(await run.session.result, "finished");
    for (const type of ["frame", "url", "acted"])
      assert.equal(run.events.filter((e) => e.type === type).length, 0, type);
  },
);

test(
  "the person's work while the agent is taken over is streamed too",
  OPTIONS,
  async () => {
    let handed = false;
    const run = start(
      [
        { calls: [{ name: "snapshot" }] },
        { calls: [{ name: "snapshot" }] },
        { calls: [{ name: "snapshot" }] },
        { calls: [{ name: "finish", args: { summary: "ok" } }] },
      ],
      { liveView: { maxFps: 4, quality: 40 } },
      (event, session) => {
        if (event.type === "usage" && !handed) {
          handed = true;
          session().takeOver();
          setTimeout(() => session().handBack(), 2000);
        }
      },
      (page) => {
        setTimeout(
          () =>
            void page
              .getByLabel("Email")
              .fill("person@example.com")
              .catch(() => undefined),
          900,
        );
      },
    );
    ended(await run.session.result, "finished");
    await pause(0);
    assert.ok(framesOf(run.events).length >= 2);
  },
);
