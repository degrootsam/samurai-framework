import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PageConfig } from "./page-settings.js";

describe("PageConfig", () => {
  it("uses the settings it was given", async () => {
    const config = new PageConfig({
      navigation: { timeout: 5000, waitUntil: "interactive" },
      network: { idleTime: 100 },
    });
    assert.equal(await config.navigationTimeout(), 5000);
    assert.equal(await config.navigationWait(), "interactive");
    assert.equal(await config.idleTime(), 100);
  });

  it("lets a call's own value win", async () => {
    const config = new PageConfig({
      navigation: { timeout: 5000, waitUntil: "interactive" },
      network: { idleTime: 100 },
    });
    assert.equal(await config.navigationTimeout(40), 40);
    assert.equal(await config.navigationWait("none"), "none");
    assert.equal(await config.idleTime(7), 7);
  });

  it("falls back to 30 s, the load event and 500 ms when nothing says otherwise", async () => {
    const config = new PageConfig({ navigation: {}, network: {} });
    assert.equal(await config.navigationTimeout(), 30000);
    assert.equal(await config.navigationWait(), "complete");
    assert.equal(await config.idleTime(), 500);
  });
});
