import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import type { SamuraiTestConfig } from "../../types/config.js";
import type { runTests } from "../../runner/run.js";
import type { TestResult } from "../../types/test.js";
import { runFlowInProject } from "./project.js";
import {
  type Call,
  config,
  chain,
  inRun,
  harness,
} from "../../testing/flow-project.js";

describe("runFlowInProject once per browser", () => {
  const both: SamuraiTestConfig = {
    ...config,
    browsers: ["firefox", "chrome"],
    groups: [
      ...config.groups!,
      { name: "chromeOnly", src: "./src/checkout", browsers: ["chrome"] },
    ],
  };
  const works = {
    id: "t",
    kind: "test",
    ref: { testId: "login.spec.ts::works" },
  };

  it("walks the flow once per browser, Firefox first, every event carrying its browser, then flow-done", async () => {
    const h = harness({ config: both });
    const result = await runFlowInProject({
      ...h.options,
      flow: chain([works]),
    });
    assert.equal(result.status, "passed");
    assert.deepEqual(
      result.runs.map((r) => [r.browser, r.summary.status]),
      [
        ["firefox", "passed"],
        ["chrome", "passed"],
      ],
    );
    assert.deepEqual(
      h.calls.map((c) => c.browsers),
      [["firefox"], ["chrome"]],
    );
    const last = h.events[h.events.length - 1]!;
    assert.deepEqual(last, { type: "flow-done", ...result });
    const runEvents = h.events.slice(0, -1);
    assert.deepEqual(
      runEvents
        .filter((e) => e.type === "flow-start" || e.type === "flow-end")
        .map((e) => [e.type, (e as { browser: string }).browser]),
      [
        ["flow-start", "firefox"],
        ["flow-end", "firefox"],
        ["flow-start", "chrome"],
        ["flow-end", "chrome"],
      ],
    );
    for (const e of runEvents)
      assert.ok((e as { browser?: string }).browser, `${e.type} has a browser`);
  });

  it("a Group node limited to Chrome is skipped in the Firefox run", async () => {
    const h = harness({ config: both });
    const result = await runFlowInProject({
      ...h.options,
      flow: chain([{ id: "g", kind: "group", ref: { group: "chromeOnly" } }]),
    });
    // Only Chrome uses it: the flow runs once
    assert.deepEqual(
      result.runs.map((r) => r.browser),
      ["chrome"],
    );
    const mixed = await runFlowInProject({
      ...h.options,
      flow: chain([
        works,
        { id: "g", kind: "group", ref: { group: "chromeOnly" } },
      ]),
    });
    assert.deepEqual(inRun(mixed, "firefox").nodes.g, {
      status: "skipped",
      note: "not run in firefox",
      durationMs: inRun(mixed, "firefox").nodes.g!.durationMs,
    });
    assert.equal(inRun(mixed, "chrome").nodes.g!.status, "passed");
    assert.equal(mixed.status, "passed");
  });

  it('browsers: ["chrome"] runs once, in Chrome', async () => {
    const h = harness({ config: both });
    const result = await runFlowInProject({
      ...h.options,
      browsers: ["chrome"],
      flow: chain([works]),
    });
    assert.deepEqual(
      result.runs.map((r) => r.browser),
      ["chrome"],
    );
    assert.deepEqual(
      h.calls.map((c) => c.browsers),
      [["chrome"]],
    );
  });

  it("a failure that stops the flow in Firefox still runs Chrome", async () => {
    const h = harness({
      config: both,
      testRunner: (async (o: Call) => {
        h.calls.push(o!);
        return { status: o!.browsers![0] === "firefox" ? "failed" : "success" };
      }) as unknown as typeof runTests,
    });
    const result = await runFlowInProject({
      ...h.options,
      flow: chain([works]),
    });
    assert.equal(inRun(result, "firefox").status, "failed");
    assert.equal(inRun(result, "chrome").status, "passed");
    assert.equal(result.status, "failed");
  });

  it("an abort during Firefox cancels both runs", async () => {
    const controller = new AbortController();
    const h = harness({
      config: both,
      signal: controller.signal,
      testRunner: (async (o: Call) => {
        h.calls.push(o!);
        controller.abort();
        return { status: "failed" };
      }) as unknown as typeof runTests,
    });
    const result = await runFlowInProject({
      ...h.options,
      flow: chain([works]),
    });
    assert.equal(result.status, "cancelled");
    assert.deepEqual(
      h.calls.map((c) => c.browsers),
      [["firefox"]],
      "Chrome never ran",
    );
    assert.deepEqual(
      result.runs.map((r) => [r.browser, r.summary.status]),
      [["firefox", "cancelled"]],
    );
  });

  it("each browser's nodes write to <outputDir>/<browser>/nodes/<id>, and screenshot paths are relative to outputDir", async () => {
    const outputDir = path.resolve("/runs/2");
    const h = harness({
      config: both,
      testRunner: (async (o: Call) => {
        h.calls.push(o!);
        const browser = o!.browsers![0]!;
        const result = {
          name: "works",
          file: "f",
          browser,
          startTime: 0,
          status: "success",
          duration: 1,
          screenshots: [
            { name: "home", path: `screenshots/${browser}/a/home.png` },
          ],
        } as TestResult;
        o!.onEvent?.({
          type: "test-end",
          name: "works",
          file: "f",
          browser,
          result,
        });
        return { status: "success" };
      }) as unknown as typeof runTests,
    });
    await runFlowInProject({ ...h.options, outputDir, flow: chain([works]) });
    assert.deepEqual(
      h.calls.map((c) => c.outputDir),
      [
        path.join(outputDir, "firefox", "nodes", "t"),
        path.join(outputDir, "chrome", "nodes", "t"),
      ],
    );
    const paths = h.events.flatMap((e) =>
      e.type === "test" && e.event.type === "test-end"
        ? (
            e.event.result as { screenshots: { path: string }[] }
          ).screenshots.map((s) => s.path)
        : [],
    );
    assert.deepEqual(paths, [
      "firefox/nodes/t/screenshots/firefox/a/home.png",
      "chrome/nodes/t/screenshots/chrome/a/home.png",
    ]);
  });
});
