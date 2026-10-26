import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FlowFile } from "../core/index.js";
import type { FlowEvent, FlowSummary } from "./events.js";
import { flowBrowsers, runPerBrowser } from "./per-browser.js";

const flow = {
  nodes: [
    { id: "s", kind: "start" },
    { id: "g", kind: "group" },
    { id: "t", kind: "test" },
    { id: "h", kind: "group" },
  ],
} as unknown as FlowFile;

const summary = (status: FlowSummary["status"]): FlowSummary => ({
  status,
  nodes: {},
  vars: {},
});

describe("flowBrowsers", () => {
  it("is the union of the nodes' browsers, in first-seen order", () => {
    assert.deepEqual(
      flowBrowsers(
        { g: ["chrome"], t: ["firefox"], h: ["firefox", "chrome"] },
        flow,
        ["firefox"],
      ),
      ["chrome", "firefox"],
    );
  });

  it("only keeps the browsers asked for, in the flow's order; one no node uses is ignored", () => {
    assert.deepEqual(
      flowBrowsers(
        { g: ["chrome"], t: ["firefox"] },
        flow,
        ["firefox"],
        ["chrome"],
      ),
      ["chrome"],
    );
    assert.deepEqual(
      flowBrowsers(
        { t: ["firefox"] },
        flow,
        ["firefox"],
        ["chrome", "firefox"],
      ),
      ["firefox"],
    );
  });

  it("a flow without Test or Group nodes runs once, in the project's first browser", () => {
    assert.deepEqual(flowBrowsers({}, flow, ["chrome", "firefox"]), ["chrome"]);
  });

  it("refuses a list that leaves no browser", () => {
    assert.throws(
      () => flowBrowsers({ t: ["firefox"] }, flow, ["firefox"], ["chrome"]),
      /^Error: runFlowInProject\(\): this flow runs in none of chrome$/,
    );
  });
});

describe("runPerBrowser", () => {
  it("walks once per browser, in order, then sends flow-done", async () => {
    const events: FlowEvent[] = [];
    const walked: string[] = [];
    const result = await runPerBrowser({
      browsers: ["firefox", "chrome"],
      onEvent: (e) => events.push(e),
      walk: async (browser) => {
        walked.push(browser);
        return summary(browser === "firefox" ? "failed" : "passed");
      },
    });
    assert.deepEqual(
      walked,
      ["firefox", "chrome"],
      "a failed run doesn't stop the next",
    );
    assert.equal(result.status, "failed");
    assert.deepEqual(
      result.runs.map((r) => [r.browser, r.summary.status]),
      [
        ["firefox", "failed"],
        ["chrome", "passed"],
      ],
    );
    assert.deepEqual(events, [{ type: "flow-done", ...result }]);
  });

  it("passes when every run passed; an abort stops the runs left and cancels", async () => {
    const passed = await runPerBrowser({
      browsers: ["firefox", "chrome"],
      walk: async () => summary("passed"),
    });
    assert.equal(passed.status, "passed");

    const controller = new AbortController();
    const walked: string[] = [];
    const cancelled = await runPerBrowser({
      browsers: ["firefox", "chrome"],
      signal: controller.signal,
      walk: async (browser) => {
        walked.push(browser);
        controller.abort();
        return summary("cancelled");
      },
    });
    assert.deepEqual(walked, ["firefox"]);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.runs.length, 1);
  });
});
