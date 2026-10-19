import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AnyNodeDefinition, FlowFile } from "../core/index.js";
import {
  assertRunnable,
  defaultSleep,
  definitionOf,
  dynamicBranches,
  ShapeError,
  shapeError,
} from "./prepare-flow.js";

const flowOf = (...kinds: string[]) =>
  ({
    nodes: kinds.map((kind, i) => ({ id: `n${i}`, kind })),
    edges: [],
  }) as unknown as FlowFile;

describe("definitionOf", () => {
  it("finds a built-in kind, prefers the project's own definition, and gives undefined for an unknown kind", () => {
    assert.equal(definitionOf([], "start")?.kind, "start");
    const own = { kind: "start", label: "Mine" } as AnyNodeDefinition;
    assert.equal(definitionOf([own], "start"), own);
    assert.equal(definitionOf([], "no-such-kind"), undefined);
  });
});

describe("dynamicBranches", () => {
  it("is true only for a branching kind whose branches are decided at run time", () => {
    const def = (extra: object) => ({ ...extra }) as AnyNodeDefinition;
    assert.equal(
      dynamicBranches(
        def({ shape: "branches", branches: { dynamic: true, min: 2 } }),
      ),
      true,
    );
    assert.equal(
      dynamicBranches(def({ shape: "branches", branches: [{ id: "a" }] })),
      false,
    );
    assert.equal(dynamicBranches(def({ shape: "step" })), false);
  });
});

describe("assertRunnable", () => {
  it("throws once for every step or branching kind that has no handler", () => {
    assert.throws(
      () => assertRunnable(flowOf("group", "group", "start"), [], {}),
      /^Error: This flow can't run: Group can't run yet\.$/,
    );
  });

  it("passes when every such kind has a handler", () => {
    assertRunnable(flowOf("wait", "start"), [], {
      wait: async () => "cancelled",
    });
  });
});

describe("defaultSleep", () => {
  it("resolves after the time, and rejects at once when already aborted or aborted meanwhile", async () => {
    await defaultSleep(5, new AbortController().signal);
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(defaultSleep(1000, aborted.signal), /aborted/);
    const later = new AbortController();
    const pending = defaultSleep(1000, later.signal);
    later.abort();
    await assert.rejects(pending, /aborted/);
  });
});

describe("shapeError", () => {
  it("is a ShapeError with the standard prefix", () => {
    const err = shapeError("it has no Start.");
    assert.ok(err instanceof ShapeError);
    assert.equal(err.message, "This flow's shape can't run: it has no Start.");
  });
});
