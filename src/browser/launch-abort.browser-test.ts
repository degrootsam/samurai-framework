import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { testBrowser } from "../testing/test-browser.js";
import { BiDiConnector } from "../transport/bidi-connection.js";
import { Browser } from "./browser.js";
import { chromeUsingProfile } from "./chrome-launch.js";

const processes = () =>
  process.getActiveResourcesInfo().filter((kind) => kind === "ProcessWrap")
    .length;

// The launchers stop listening for the abort once the BiDi session is open, and the runner closes only a browser
// it was handed: an abort between the two (a test timing out while the first page is set up) left the browser
// running, and its process kept the test process alive for good
test(
  "an abort after the session opened, while the first page is set up, stops the browser",
  { timeout: 60000 },
  async () => {
    const before = processes();
    // A profile of its own: a browser left behind must not hold the profile the other test files share
    const profileDir = mkdtempSync(
      path.join(tmpdir(), "samurai-launch-abort-"),
    );
    const controller = new AbortController();
    const send = BiDiConnector.prototype.send;
    BiDiConnector.prototype.send = function (this: BiDiConnector, ...args) {
      if (args[0] === "browsingContext.getTree")
        controller.abort(new Error("Test timed out"));
      return send.apply(this, args);
    } as typeof send;
    try {
      await assert.rejects(
        Browser.launch(
          testBrowser(),
          { port: 9395, headless: true, profileDir },
          controller.signal,
        ),
        /Test timed out/,
      );
    } finally {
      BiDiConnector.prototype.send = send;
    }
    // Chrome is not our child but chromedriver's: whether it is gone shows in its profile lock
    const running = () =>
      processes() > before || chromeUsingProfile(profileDir) !== undefined;
    const deadline = Date.now() + 10000;
    while (running() && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      processes(),
      before,
      "the browser process outlived the launch",
    );
    assert.equal(
      chromeUsingProfile(profileDir),
      undefined,
      "the browser still holds its profile",
    );
  },
);
