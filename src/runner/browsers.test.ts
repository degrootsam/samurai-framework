import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  browsersFor,
  checkBrowserList,
  validateBrowserConfig,
} from "./browsers.js";

describe("validateBrowserConfig", () => {
  it("accepts a config without browsers, with browsers, and with browsers on groups", () => {
    validateBrowserConfig({});
    validateBrowserConfig({ browsers: ["firefox", "chrome"] });
    validateBrowserConfig({
      groups: [{ name: "a", browsers: ["chrome"] }, { name: "b" }],
    });
  });

  it("rejects the removed browser key and says what to write", () => {
    assert.throws(
      () => validateBrowserConfig({ browser: "chrome" } as never),
      /"browser" was replaced by "browsers": use browsers: \["chrome"\]/,
    );
  });

  it("names the key of an unknown, a duplicated and an empty list", () => {
    assert.throws(
      () => validateBrowserConfig({ browsers: ["edge"] } as never),
      /Unknown browser "edge" in browsers\. Choose firefox or chrome\./,
    );
    assert.throws(
      () =>
        validateBrowserConfig({
          groups: [
            { name: "a" },
            { name: "b", browsers: ["chrome", "chrome"] },
          ],
        }),
      /Browser "chrome" is listed twice in groups\[1\]\.browsers\./,
    );
    assert.throws(
      () => validateBrowserConfig({ browsers: [] }),
      /browsers must list at least one browser\./,
    );
    assert.throws(
      () => checkBrowserList("chrome", "browsers"),
      /must list at least one browser/,
    );
  });
});

describe("browsersFor", () => {
  it("takes the flag, then the group, then the project, then Firefox", () => {
    assert.deepEqual(
      browsersFor({
        flag: ["chrome"],
        group: ["firefox"],
        project: ["firefox"],
      }),
      ["chrome"],
    );
    assert.deepEqual(browsersFor({ group: ["chrome"], project: ["firefox"] }), [
      "chrome",
    ]);
    assert.deepEqual(browsersFor({ project: ["chrome", "firefox"] }), [
      "chrome",
      "firefox",
    ]);
    assert.deepEqual(browsersFor({}), ["firefox"]);
  });

  it("counts an empty list as not given, and returns a copy", () => {
    assert.deepEqual(
      browsersFor({ flag: [], group: [], project: ["chrome"] }),
      ["chrome"],
    );
    const project = ["chrome"] as const;
    assert.notEqual(browsersFor({ project }), project);
  });
});
