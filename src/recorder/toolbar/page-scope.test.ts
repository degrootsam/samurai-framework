import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LEFT, PageScope } from "./page-scope.js";

describe("PageScope", () => {
  it("returns what the work returns while the page stays", async () => {
    const scope = new PageScope();
    assert.equal(await scope.whileOn(async () => 7), 7);
  });

  it("stops waiting for work that never ends once the page is left", async () => {
    const scope = new PageScope();
    const waiting = scope.whileOn(() => new Promise<never>(() => {}));
    scope.leave();
    assert.equal(await waiting, LEFT);
  });

  it("counts pages, and entering a page also frees what waited on the old one", async () => {
    const scope = new PageScope();
    const before = scope.current;
    const waiting = scope.whileOn(() => new Promise<never>(() => {}));
    scope.enter();
    assert.equal(scope.current, before + 1);
    assert.equal(await waiting, LEFT);
  });
});
