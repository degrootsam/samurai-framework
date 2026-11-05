import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fixtureCatalog } from "./fixture-registry.js";
import { test as samurai } from "./registry.js";

const make = async ({}: any, use: (value: unknown) => Promise<void>) =>
  use({ id: "1" });

const orders = samurai.extend<any>({
  orderOptions: [
    { items: 1, paid: true },
    {
      option: true,
      fields: [
        { path: "items", type: "number", label: "Items", default: 1 },
        { path: "paid", type: "switch", label: "Paid", default: true },
      ],
    },
  ],
  customer: make,
  order: [
    async ({ customer, orderOptions }: any, use: any) =>
      use({ id: "1", total: orderOptions.items, customer, token: "t" }),
    {
      label: "Seeded order",
      icon: "package",
      description: "Creates a paid order.",
      outputs: [
        { name: "id", label: "Order id" },
        { name: "token", secret: true },
      ],
    },
  ],
});

describe("fixtureCatalog", () => {
  test("lists the fixtures of the extended tests without running anything", () => {
    const catalog = fixtureCatalog([orders]);
    assert.deepEqual(
      catalog.map((entry) => entry.name),
      ["customer", "order"],
    );
    const order = catalog.find((entry) => entry.name === "order")!;
    assert.equal(order.label, "Seeded order");
    assert.equal(order.icon, "package");
    assert.equal(order.description, "Creates a paid order.");
    assert.equal(order.scope, "test");
    assert.equal(order.auto, false);
    assert.deepEqual(order.dependencies, ["customer", "orderOptions"]);
    assert.deepEqual(order.options?.defaults, { items: 1, paid: true });
    assert.equal(order.options?.name, "orderOptions");
    assert.equal(order.options?.fields[0]?.path, "items");
    // a secret output is never listed
    assert.deepEqual(order.outputs, [{ name: "id", label: "Order id" }]);
    const customer = catalog.find((entry) => entry.name === "customer")!;
    assert.equal(customer.label, "customer");
    assert.equal(customer.options, undefined);
  });

  test("a test extended from another lists the shared fixtures once", () => {
    const more = orders.extend<any>({ extra: 1 });
    const names = fixtureCatalog([orders, more]).map((entry) => entry.name);
    assert.deepEqual(names.sort(), ["customer", "extra", "order"]);
  });

  test("a name defined in two places is refused, naming both", () => {
    const other = samurai.extend<any>({ customer: make });
    assert.throws(
      () => fixtureCatalog([orders, other]),
      /^Error: config\.fixtures: fixture "customer" is defined twice \(config\.fixtures\[0\] and config\.fixtures\[1\]\)/,
    );
  });

  test("a name must match the pattern", () => {
    for (const name of ["Order", "my_order", "my-order", "1order"])
      assert.throws(
        () => fixtureCatalog([samurai.extend<any>({ [name]: 1 })]),
        new RegExp(`fixture name "${name}" must match`),
      );
  });

  test("a built-in name is listed as an override", () => {
    const entry = fixtureCatalog([
      samurai.extend<any>({ baseURL: "http://x.test" }),
    ])[0]!;
    assert.equal(entry.overridesBuiltIn, true);
  });

  test("something that is not an extended test is refused", () => {
    assert.throws(
      () => fixtureCatalog([{}]),
      /config\.fixtures\[0\] is not a test/,
    );
    assert.throws(
      () => fixtureCatalog("nope" as never),
      /config\.fixtures must be an array/,
    );
  });
});
