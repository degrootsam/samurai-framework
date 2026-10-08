import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { FLOW_VERSION, readFlowFile } from "./schema.js";

const base = { id: "f", name: "f", nodes: [], edges: [] };

describe("readFlowFile", () => {
  test("a missing version is read as the current one", () => {
    const flow = readFlowFile(base);
    assert.equal(flow.version, FLOW_VERSION);
    assert.equal(flow.id, "f");
  });
  test("the current version passes through", () => {
    assert.deepEqual(readFlowFile({ ...base, version: FLOW_VERSION }), {
      ...base,
      version: FLOW_VERSION,
    });
  });
  test("a newer version is refused", () => {
    assert.throws(() => readFlowFile({ ...base, version: FLOW_VERSION + 1 }), {
      message:
        "This flow was saved by a newer SAMURAI. Update @itmetsam/samurai-framework.",
    });
  });
  test("a bad version is refused", () => {
    for (const version of ["1", 0, 1.5, null]) {
      assert.throws(() => readFlowFile({ ...base, version }), /version/);
    }
  });
  test("something that is not an object is refused", () => {
    for (const raw of [null, undefined, "flow", 3, []]) {
      assert.throws(() => readFlowFile(raw), {
        message: "A flow file must be a JSON object.",
      });
    }
  });
  test("nodes and edges must be arrays", () => {
    assert.throws(() => readFlowFile({ id: "f", name: "f", edges: [] }), {
      message: "A flow file needs a nodes array.",
    });
    assert.throws(() => readFlowFile({ ...base, nodes: {} }), {
      message: "A flow file needs a nodes array.",
    });
    assert.throws(() => readFlowFile({ id: "f", name: "f", nodes: [] }), {
      message: "A flow file needs an edges array.",
    });
  });
});
