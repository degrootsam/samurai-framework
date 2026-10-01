import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  clearRegistry,
  describe as samuraiDescribe,
  registeredTests,
  test as samuraiTest,
} from "./registry.js";

afterEach(() => clearRegistry());

const noop = async () => {};

test("a test outside describe keeps its title", () => {
  samuraiTest("logs in", noop);
  const [registered] = registeredTests();
  assert.equal(registered?.name, "logs in");
  assert.deepEqual(registered?.titlePath, ["logs in"]);
  assert.equal(registered?.function, noop);
});

test("nested describe titles are joined with >", () => {
  samuraiDescribe("Checkout", () => {
    samuraiDescribe("Guest", () => {
      samuraiTest("applies coupon", noop);
    });
    samuraiTest("pays with saved card", noop);
  });
  samuraiTest("after", noop);
  assert.deepEqual(
    registeredTests().map((t) => t.name),
    ["Checkout > Guest > applies coupon", "Checkout > pays with saved card", "after"],
  );
});

test("the title stack is restored when a describe callback throws", () => {
  assert.throws(() =>
    samuraiDescribe("Broken", () => {
      throw new Error("boom");
    }),
  );
  samuraiTest("after", noop);
  assert.equal(registeredTests()[0]?.name, "after");
});

test("an async describe callback is rejected", () => {
  assert.throws(
    () => samuraiDescribe("Async", async () => {}),
    { message: "describe() callback must be synchronous; it only registers tests" },
  );
  samuraiTest("after", noop);
  assert.equal(registeredTests()[0]?.name, "after");
});

test("records the calling spec file", () => {
  samuraiTest("where", noop);
  assert.equal(registeredTests()[0]?.file, fileURLToPath(import.meta.url));
});
