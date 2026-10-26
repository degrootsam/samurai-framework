import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RunEvent } from "../../runner/reporter.js";
import { nodeFolder } from "./index.js";
import { inNodeFolder } from "./node-folder.js";

describe("nodeFolder", () => {
  it("is the browser, nodes/ and the node id cleaned for a file name, relative to outputDir", () => {
    assert.equal(nodeFolder("t", "firefox"), "firefox/nodes/t");
    assert.equal(nodeFolder("n 1", "chrome"), "chrome/nodes/n-1");
    assert.equal(nodeFolder("login_1-a", "firefox"), "firefox/nodes/login_1-a");
    assert.equal(
      nodeFolder("Login & checkout!", "chrome"),
      "chrome/nodes/Login-checkout",
    );
    assert.equal(nodeFolder("../x", "firefox"), "firefox/nodes/x");
    assert.equal(nodeFolder("###", "firefox"), "firefox/nodes/screenshot");
  });
});

describe("inNodeFolder", () => {
  const shot = { name: "home", path: "screenshots/firefox/a/home.png" };
  const result = {
    name: "a",
    file: "f",
    browser: "firefox" as const,
    startTime: 0,
    status: "success" as const,
    duration: 1,
    screenshots: [shot],
  };

  it("puts the node's folder in front of the screenshot paths of a test-end", () => {
    const event = inNodeFolder(
      { type: "test-end", name: "a", file: "f", browser: "firefox", result },
      "firefox/nodes/t",
    );
    assert.deepEqual(
      event.type === "test-end" &&
        "screenshots" in event.result &&
        event.result.screenshots,
      [
        {
          name: "home",
          path: "firefox/nodes/t/screenshots/firefox/a/home.png",
        },
      ],
    );
  });

  it("does the same for the tests of a run-end, and leaves other events alone", () => {
    const end = inNodeFolder(
      {
        type: "run-end",
        summary: {
          status: "success",
          duration: 1,
          startTime: 0,
          tests: [result],
          environment: "dev",
          browsers: ["firefox"],
        },
      },
      "firefox/nodes/t",
    ) as Extract<RunEvent, { type: "run-end" }>;
    assert.equal(
      (end.summary.tests[0] as typeof result).screenshots[0]!.path,
      "firefox/nodes/t/screenshots/firefox/a/home.png",
    );
    const start: RunEvent = {
      type: "test-start",
      name: "a",
      file: "f",
      browser: "firefox",
    };
    assert.equal(inNodeFolder(start, "firefox/nodes/t"), start);
  });
});
