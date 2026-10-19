import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { testDirOf } from "./test-dir.js";

describe("testDirOf", () => {
  const at = (file: string, name = "signs in") =>
    testDirOf(
      { file, name } as Parameters<typeof testDirOf>[0],
      path.resolve("/p/src"),
    );

  it("is the spec file under srcDir without extension, then the cleaned test name", () => {
    assert.equal(
      at(path.resolve("/p/src/auth/login.spec.ts")),
      "auth/login.spec/signs-in",
    );
  });

  it("keeps a spec outside srcDir inside screenshots/", () => {
    const dir = at(path.resolve("/p/e2e/login.spec.ts"));
    assert.equal(dir, "e2e/login.spec/signs-in");
    assert.ok(!dir.split("/").includes(".."), dir);
    const far = at(path.resolve("/elsewhere/deep/x.spec.ts"));
    assert.ok(!far.split("/").includes(".."), far);
    assert.ok(!far.startsWith("/"), far);
  });
});
