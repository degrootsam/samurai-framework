import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { browsersFor } from "./browsers.js";

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
