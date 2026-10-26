import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nodeFolder } from "./index.js";

describe("nodeFolder", () => {
  it("is nodes/ and the node id cleaned for a file name, relative to outputDir", () => {
    assert.equal(nodeFolder("t"), "nodes/t");
    assert.equal(nodeFolder("login_1-a"), "nodes/login_1-a");
    assert.equal(nodeFolder("Login & checkout!"), "nodes/Login-checkout");
    assert.equal(nodeFolder("../x"), "nodes/x");
    assert.equal(nodeFolder("###"), "nodes/screenshot");
  });
});
