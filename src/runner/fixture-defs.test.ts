import assert from "node:assert/strict";
import { test } from "node:test";
import { extendLayers } from "./fixture-defs.js";

const fn =
  (r: unknown) =>
  async ({}: any, use: (v: unknown) => Promise<void>) =>
    use(r);

test("values, functions and tuples become definitions; auto comes from the options", () => {
  const layers = extendLayers(undefined, {
    v: 5,
    f: fn(1),
    a: [fn(1), { auto: true }],
    t: [fn(1), { scope: "test" }],
  });
  assert.equal(layers.get("v")![0]!.value, 5);
  assert.equal(layers.get("f")![0]!.setup !== undefined, true);
  assert.equal(layers.get("a")![0]!.auto, true);
  assert.equal(layers.get("t")![0]!.auto, false);
});

test("a later extend adds a layer to the same name and keeps the others", () => {
  const first = extendLayers(undefined, { a: fn(1), b: 2 });
  const second = extendLayers(first, {
    a: async ({ a }: any, use: any) => use(a),
  });
  assert.equal(second.get("a")!.length, 2);
  assert.equal(first.get("a")!.length, 1);
  assert.equal(second.get("b")!.length, 1);
});

test("rejects what cannot work with an extend(): message", () => {
  const msg = (defs: unknown, base?: Parameters<typeof extendLayers>[0]) =>
    assert.throws(() => extendLayers(base, defs), /^Error: extend\(\): /);
  msg(null);
  msg({ a: [fn(1), { scope: "worker" }] });
  msg({ a: [fn(1), { scope: "file" }] });
  msg({ a: [fn(1), { timeout: 5 }] });
  msg({ a: [fn(1), { auto: "yes" }] });
  msg({ a: async (f: any, use: any) => use(f) });
  msg({ a: async ({ ...all }: any, use: any) => use(all) });
  msg({ a: async ({ nope }: any, use: any) => use(nope) });
  msg({ a: async ({ a }: any, use: any) => use(a) });
});

test("worker scope is explained", () => {
  assert.throws(
    () => extendLayers(undefined, { a: [fn(1), { scope: "worker" }] }),
    /not supported/,
  );
});

test("detects circular dependencies, naming the loop", () => {
  assert.throws(
    () =>
      extendLayers(undefined, {
        a: async ({ b }: any, use: any) => use(b),
        b: async ({ c }: any, use: any) => use(c),
        c: async ({ a }: any, use: any) => use(a),
      }),
    /circle: a -> b -> c -> a/,
  );
});

test("a fixture may depend on a built-in of its own name, or its previous layer", () => {
  const layers = extendLayers(undefined, {
    page: async ({ page }: any, use: any) => use(page),
    forward: async ({ later }: any, use: any) => use(later),
    later: 1,
  });
  assert.equal(layers.get("page")!.length, 1);
  assert.doesNotThrow(() =>
    extendLayers(layers, {
      page: async ({ page }: any, use: any) => use(page),
    }),
  );
});
