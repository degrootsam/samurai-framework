import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { browsersCacheDir } from "./cache-dir.js";

describe("browsersCacheDir", () => {
  it("SAMURAI_BROWSERS_PATH wins, resolved", () => {
    assert.equal(
      browsersCacheDir(
        { SAMURAI_BROWSERS_PATH: "rel/cache" },
        "darwin",
        "/home/u",
      ),
      path.resolve("rel/cache"),
    );
  });

  it("macOS: Library/Caches", () => {
    assert.equal(
      browsersCacheDir({}, "darwin", "/Users/u"),
      path.join("/Users/u", "Library", "Caches", "samurai", "browsers"),
    );
  });

  it("Linux: XDG_CACHE_HOME, else ~/.cache", () => {
    assert.equal(
      browsersCacheDir({ XDG_CACHE_HOME: "/x" }, "linux", "/home/u"),
      path.join("/x", "samurai", "browsers"),
    );
    assert.equal(
      browsersCacheDir({}, "linux", "/home/u"),
      path.join("/home/u", ".cache", "samurai", "browsers"),
    );
  });

  it("Windows: LOCALAPPDATA, else AppData/Local", () => {
    assert.equal(
      browsersCacheDir({ LOCALAPPDATA: "C:/L" }, "win32", "C:/Users/u"),
      path.join("C:/L", "samurai", "browsers"),
    );
    assert.equal(
      browsersCacheDir({}, "win32", "C:/Users/u"),
      path.join("C:/Users/u", "AppData", "Local", "samurai", "browsers"),
    );
  });
});
