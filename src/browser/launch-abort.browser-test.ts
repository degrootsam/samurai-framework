import assert from "node:assert/strict";
import { test } from "node:test";
import { testBrowser } from "../testing/test-browser.js";
import { BiDiConnector } from "../transport/bidi-connection.js";
import { Browser } from "./browser.js";

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
          { port: 9395, headless: true },
          controller.signal,
        ),
        /Test timed out/,
      );
    } finally {
      BiDiConnector.prototype.send = send;
    }
    const deadline = Date.now() + 10000;
    while (processes() > before && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      processes(),
      before,
      "the browser process outlived the launch",
    );
  },
);
