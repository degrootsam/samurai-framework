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
  msg({ a: [fn(1), { scope: "file" }] });
  msg({ a: [fn(1), { timeout: 0 }] });
  msg({ a: [fn(1), { timeout: "5s" }] });
  msg({ a: [fn(1), { auto: "yes" }] });
  msg({ a: async (f: any, use: any) => use(f) });
  msg({ a: async ({ ...all }: any, use: any) => use(all) });
  msg({ a: async ({ nope }: any, use: any) => use(nope) });
  msg({ a: async ({ a }: any, use: any) => use(a) });
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

test("metadata keys are kept on the definition", () => {
  const layers = extendLayers(undefined, {
    order: [
      fn({ id: "1" }),
      {
        label: "Seeded order",
        icon: "package",
        description: "Creates an order.",
        outputs: [
          { name: "id", label: "Order id" },
          { name: "token", secret: true },
        ],
        timeout: 5000,
      },
    ],
  });
  const def = layers.get("order")![0]!;
  assert.equal(def.label, "Seeded order");
  assert.equal(def.icon, "package");
  assert.equal(def.description, "Creates an order.");
  assert.deepEqual(def.outputs, [
    { name: "id", label: "Order id" },
    { name: "token", secret: true },
  ]);
  assert.equal(def.timeout, 5000);
  assert.equal(def.scope, "test");
});

test("rejects bad metadata with an extend(): message that names the fixture", () => {
  const bad = (options: object, pattern: RegExp) =>
    assert.throws(
      () => extendLayers(undefined, { a: [fn(1), options] }),
      pattern,
    );
  bad({ label: 3 }, /fixture "a": label must be a string/);
  bad({ icon: "" }, /fixture "a": icon must be a non-empty string/);
  bad({ description: false }, /fixture "a": description must be a string/);
  bad({ outputs: "id" }, /fixture "a": outputs must be an array/);
  bad({ outputs: [{ label: "x" }] }, /fixture "a": every output needs a name/);
  bad(
    { outputs: [{ name: "id" }, { name: "id" }] },
    /fixture "a": output "id" is listed twice/,
  );
  bad(
    { outputs: [{ name: "id", secret: "yes" }] },
    /secret must be true or false/,
  );
});

test("an option fixture pairs with the fixture named without Options", () => {
  const layers = extendLayers(undefined, {
    orderOptions: [
      { items: 1 },
      {
        option: true,
        fields: [{ path: "items", type: "number", label: "Items", default: 1 }],
      },
    ],
    order: async ({ orderOptions }: any, use: any) => use(orderOptions),
  });
  const def = layers.get("orderOptions")![0]!;
  assert.equal(def.option, true);
  assert.equal(def.fields?.[0]?.path, "items");
});

test("an orphan option fixture, and fields or option misused, are refused naming both", () => {
  assert.throws(
    () =>
      extendLayers(undefined, {
        orderOptions: [{ items: 1 }, { option: true }],
      }),
    /extend\(\): option fixture "orderOptions" has no fixture "order"/,
  );
  assert.throws(
    () =>
      extendLayers(undefined, {
        order: [fn(1), { fields: [{ path: "a", type: "text" }] }],
      }),
    /extend\(\): fixture "order" has fields but is not an option fixture; put them on "orderOptions"/,
  );
  assert.throws(
    () => extendLayers(undefined, { order: [{ a: 1 }, { option: true }] }),
    /extend\(\): fixture "order" is an option fixture, so its name must end in "Options"/,
  );
  assert.throws(
    () =>
      extendLayers(undefined, {
        order: 1,
        orderOptions: [fn({}), { option: true }],
      }),
    /extend\(\): option fixture "orderOptions" must be a plain object, not a function/,
  );
  assert.throws(
    () =>
      extendLayers(undefined, {
        order: 1,
        orderOptions: [5, { option: true }],
      }),
    /extend\(\): option fixture "orderOptions" must be a plain object/,
  );
  assert.throws(
    () =>
      extendLayers(undefined, {
        order: 1,
        orderOptions: [
          {},
          { option: true, fields: [{ path: "a", type: "colour" }] },
        ],
      }),
    /extend\(\): fixture "orderOptions": field "a" has an unknown type "colour"/,
  );
  assert.throws(
    () =>
      extendLayers(undefined, {
        order: 1,
        orderOptions: [
          {},
          {
            option: true,
            fields: [
              { path: "a", type: "text" },
              { path: "a", type: "switch" },
            ],
          },
        ],
      }),
    /field "a" is listed twice/,
  );
  assert.throws(
    () =>
      extendLayers(undefined, {
        order: 1,
        orderOptions: [
          {},
          { option: true, fields: [{ path: "a", type: "select" }] },
        ],
      }),
    /field "a" needs options/,
  );
});

test("a fixture may be paired across extend calls", () => {
  const first = extendLayers(undefined, { order: 1 });
  const second = extendLayers(first, {
    orderOptions: [{ items: 1 }, { option: true }],
  });
  assert.equal(second.has("orderOptions"), true);
});

test("worker scope: a worker fixture cannot use the page or a test-scoped fixture", () => {
  const ok = extendLayers(undefined, {
    base: [async ({ env }: any, use: any) => use(env), { scope: "worker" }],
    user: async ({ base, page }: any, use: any) => use([base, page]),
  });
  assert.equal(ok.get("base")![0]!.scope, "worker");
  for (const dep of [
    "page",
    "context",
    "request",
    "browser",
    "testInfo",
    "inputs",
    "outputs",
  ])
    assert.throws(
      () =>
        extendLayers(undefined, {
          w: [
            new Function(`return async ({ ${dep} }, use) => use(1)`)(),
            { scope: "worker" },
          ],
        }),
      new RegExp(`extend\\(\\): worker fixture "w" cannot use "${dep}"`),
    );
  assert.throws(
    () =>
      extendLayers(undefined, {
        t: fn(1),
        w: [async ({ t }: any, use: any) => use(t), { scope: "worker" }],
      }),
    /extend\(\): worker fixture "w" cannot use the test-scoped fixture "t"/,
  );
  // a plain value and another worker fixture are fine
  extendLayers(undefined, {
    v: 3,
    w1: [fn(1), { scope: "worker" }],
    w2: [async ({ v, w1 }: any, use: any) => use([v, w1]), { scope: "worker" }],
  });
});
