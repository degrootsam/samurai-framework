import { test } from "node:test";
import assert from "node:assert/strict";
import { expect, takePendingAssertions } from "./expect.js";
import { AssertionError } from "./assertion-error.js";
import { bool, locatorWith } from "../testing/expect-locator-setup.js";

test("expect(value) still returns value matchers", () => {
  expect(1).toBe(1);
  assert.throws(() => expect("a").toBe("b"), AssertionError);
});

test("takePendingAssertions lists assertions that were not awaited", async () => {
  takePendingAssertions();
  const { locator } = locatorWith("div", bool(false));
  const pending = expect(locator).not.toBeVisible({ timeout: 200 });
  const failing = expect(locator).toBeVisible({ timeout: 200 });
  assert.deepEqual(takePendingAssertions(), [
    "expect(locator).not.toBeVisible()",
    "expect(locator).toBeVisible()",
  ]);
  assert.deepEqual(takePendingAssertions(), []);
  await pending;
  await assert.rejects(failing, AssertionError);
});

test("awaited assertions are not pending", async () => {
  takePendingAssertions();
  await expect(locatorWith("div", bool(true)).locator).toBeVisible({
    timeout: 0,
  });
  await assert.rejects(
    expect(locatorWith("div", bool(false)).locator).toBeVisible({ timeout: 0 }),
    AssertionError,
  );
  assert.deepEqual(takePendingAssertions(), []);
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("an un-awaited assertion that already failed is still reported", async () => {
  takePendingAssertions();
  const { locator } = locatorWith("div", bool(false));
  expect(locator).toBeVisible({ timeout: 0 });
  // Let the single read finish and the assertion reject
  await settle();
  assert.deepEqual(takePendingAssertions(), ["expect(locator).toBeVisible()"]);
});

test("an un-awaited assertion that already passed is not reported", async () => {
  takePendingAssertions();
  const { locator } = locatorWith("div", bool(true));
  expect(locator).toBeVisible({ timeout: 0 });
  await settle();
  assert.deepEqual(takePendingAssertions(), []);
});

test("a failing assertion awaited through assert.rejects is not reported", async () => {
  takePendingAssertions();
  const failing = expect(locatorWith("div", bool(false)).locator).toBeVisible({
    timeout: 0,
  });
  await settle();
  await assert.rejects(failing, AssertionError);
  assert.deepEqual(takePendingAssertions(), []);
});

test("a failing assertion handled with .catch() is not reported", async () => {
  takePendingAssertions();
  let caught: unknown;
  expect(locatorWith("div", bool(false)).locator)
    .toBeVisible({ timeout: 0 })
    .catch((err) => {
      caught = err;
    });
  await settle();
  assert.ok(caught instanceof AssertionError);
  assert.deepEqual(takePendingAssertions(), []);
});

test("assertions handled with await, .then, .finally and Promise.all are not reported", async () => {
  takePendingAssertions();
  const pass = () =>
    expect(locatorWith("div", bool(true)).locator).toBeVisible({ timeout: 0 });
  const fail = () =>
    expect(locatorWith("div", bool(false)).locator).toBeVisible({ timeout: 0 });
  const failing = fail();
  await settle();
  try {
    await failing;
    assert.fail("expected a rejection");
  } catch (err) {
    assert.ok(err instanceof AssertionError);
  }
  await new Promise<void>((resolve) => {
    fail().then(undefined, () => resolve());
  });
  await assert.rejects(
    fail().finally(() => {}),
    AssertionError,
  );
  await Promise.all([pass(), pass()]);
  await assert.rejects(Promise.all([pass(), fail()]), AssertionError);
  assert.deepEqual(takePendingAssertions(), []);
});
