import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RegisteredTestCase, Suite } from "../types/test.js";
import {
  chunkBySerialBlock,
  configureSuite,
  serialBlockOf,
  unitOf,
} from "./serial.js";
import { newSuite } from "./suite.js";

const testIn = (suite: Suite, name = "t", file = "/a.spec.ts") =>
  ({ name, file, titlePath: [name], suite }) as unknown as RegisteredTestCase;

describe("configureSuite", () => {
  it("sets and clears the mode", () => {
    const suite = newSuite();
    configureSuite(suite, { mode: "serial" });
    assert.equal(suite.mode, "serial");
    configureSuite(suite, { mode: "default" });
    assert.equal(suite.mode, undefined);
  });

  it("names the problem", () => {
    assert.throws(
      () => configureSuite(newSuite(), { mode: "fast" }),
      /^TypeError: describe\.configure\(\): mode must be "default", "parallel" or "serial", got "fast"$/,
    );
    assert.throws(
      () => configureSuite(newSuite(), { mode: "serial", retries: 1 }),
      /describe\.configure\(\): unknown option "retries"/,
    );
    assert.throws(
      () => configureSuite(undefined as unknown as Suite, undefined),
      /describe\.configure\(\): expected an options object/,
    );
  });
});

describe("serialBlockOf", () => {
  it("is the outermost serial suite around the test", () => {
    const root = newSuite();
    const outer = newSuite("outer", root, undefined, undefined, "serial");
    const inner = newSuite("inner", outer, undefined, undefined, "serial");
    assert.equal(serialBlockOf(testIn(inner))?.suite, outer);
    assert.equal(serialBlockOf(testIn(inner))?.key, "serial:/a.spec.ts::outer");
    assert.equal(serialBlockOf(testIn(newSuite("plain", root))), undefined);
  });

  it("is the whole file for a serial root", () => {
    const root = newSuite(undefined, undefined, undefined, undefined, "serial");
    const inner = newSuite("x", root);
    assert.equal(serialBlockOf(testIn(inner))?.key, "serial:/a.spec.ts::");
  });
});

describe("unitOf", () => {
  it("has no unit unless fullyParallel is false (or the test is in a block)", () => {
    const test = testIn(newSuite());
    assert.equal(unitOf(test, undefined), undefined);
    assert.equal(unitOf(test, true), undefined);
    assert.deepEqual(unitOf(test, false), {
      key: "file:/a.spec.ts",
      serial: false,
    });
  });

  it("puts a serial block in one unit whatever fullyParallel says", () => {
    const test = testIn(
      newSuite("s", newSuite(), undefined, undefined, "serial"),
    );
    for (const mode of [undefined, true, false])
      assert.deepEqual(unitOf(test, mode), {
        key: "serial:/a.spec.ts::s",
        serial: true,
      });
  });

  it("lets a parallel suite spread its tests when fullyParallel is false", () => {
    const parallel = newSuite(
      "p",
      newSuite(),
      undefined,
      undefined,
      "parallel",
    );
    assert.equal(unitOf(testIn(parallel), false), undefined);
  });
});

describe("chunkBySerialBlock", () => {
  it("keeps the order and joins the neighbours of a block", () => {
    const root = newSuite();
    const a = newSuite("a", root, undefined, undefined, "serial");
    const b = newSuite("b", root, undefined, undefined, "serial");
    const tests = [
      testIn(root, "free1"),
      testIn(a, "a1"),
      testIn(a, "a2"),
      testIn(b, "b1"),
      testIn(root, "free2"),
    ];
    const chunks = chunkBySerialBlock(tests);
    assert.deepEqual(
      chunks.map((c) => [c.block?.suite.title, c.tests.map((t) => t.name)]),
      [
        [undefined, ["free1"]],
        ["a", ["a1", "a2"]],
        ["b", ["b1"]],
        [undefined, ["free2"]],
      ],
    );
  });
});
