import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isManagedBrowser,
  LAUNCHABLE,
  MANAGED_BROWSERS,
  PINNED,
} from "./pins.js";

describe("pins", () => {
  it("every pin has a build id and a label", () => {
    for (const name of MANAGED_BROWSERS) {
      assert.match(PINNED[name].buildId, /\d+\.\d+/);
      assert.ok(PINNED[name].label.length > 0);
    }
  });

  it("lists firefox and chrome; both launch", () => {
    assert.deepEqual(MANAGED_BROWSERS, ["firefox", "chrome"]);
    assert.deepEqual([...LAUNCHABLE], ["firefox", "chrome"]);
  });

  it("knows its names", () => {
    assert.equal(isManagedBrowser("chrome"), true);
    assert.equal(isManagedBrowser("edge"), false);
  });
});
