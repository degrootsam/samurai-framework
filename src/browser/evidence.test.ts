import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { cleanName, Evidence } from "./evidence.js";

describe("cleanName", () => {
  it("keeps letters, digits, - and _", () => {
    assert.equal(cleanName("after sign-in!"), "after-sign-in");
    assert.equal(cleanName("  "), "screenshot");
    assert.equal(cleanName("a/b\\c"), "a-b-c");
    assert.equal(cleanName("ok_1"), "ok_1");
  });
});

describe("Evidence", () => {
  it("puts a test's screenshots in its folder and numbers repeats", () => {
    const e = new Evidence("/r", "login.spec/signs-in");
    assert.deepEqual(e.fileFor("home"), {
      file: path.join(
        "/r",
        "screenshots",
        "login.spec",
        "signs-in",
        "home.png",
      ),
      name: "home",
      path: "screenshots/login.spec/signs-in/home.png",
    });
    assert.equal(e.fileFor("home").name, "home-2");
    assert.equal(e.fileFor("home").name, "home-3");
    assert.deepEqual(
      e.screenshots.map((s) => s.name),
      ["home", "home-2", "home-3"],
    );
  });

  it("without a test folder writes to screenshots/", () => {
    assert.equal(new Evidence("/r").fileFor("x").path, "screenshots/x.png");
  });
});
