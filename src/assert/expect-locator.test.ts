import { test } from "node:test";
import assert from "node:assert/strict";
import { type StubResponse } from "../testing/stub-connector.js";
import { expect } from "./expect.js";
import { AssertionError } from "./assertion-error.js";
import {
  bool,
  locatorWith,
  missing,
  text,
} from "../testing/expect-locator-setup.js";

test("toHaveText retries until the text matches", async () => {
  const { locator, expressions } = locatorWith(
    "h1",
    missing,
    missing,
    text("Contact"),
  );
  await expect(locator).toHaveText("Contact", { timeout: 2000 });
  assert.equal(expressions.length, 3);
});

test("times out with the last received value", async () => {
  const { locator } = locatorWith("h1", text("Loading"), text("Home"));
  const start = Date.now();
  await assert.rejects(
    expect(locator).toHaveText("Contact", { timeout: 250 }),
    (err) => {
      assert.ok(err instanceof AssertionError);
      assert.equal(err.matcher, "toHaveText");
      assert.equal(err.expected, "Contact");
      assert.equal(err.actual, "Home");
      assert.equal(err.locator, "//h1");
      return true;
    },
  );
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 245 && elapsed < 1000, `elapsed ${elapsed}ms`);
});

test("timeout 0 reads exactly once", async () => {
  const { locator, expressions } = locatorWith("h1", text("Home"));
  await assert.rejects(
    expect(locator).toHaveText("Contact", { timeout: 0 }),
    AssertionError,
  );
  assert.equal(expressions.length, 1);
});

test("read errors are rethrown without retrying", async () => {
  const { locator, expressions } = locatorWith("h1[", {
    exception: "SyntaxError",
  });
  await assert.rejects(
    expect(locator).toBeVisible({ timeout: 2000 }),
    (err) => {
      assert.ok(!(err instanceof AssertionError));
      assert.match((err as Error).message, /Failed to locate element/);
      return true;
    },
  );
  assert.equal(expressions.length, 1);
});

test("not.toBeVisible waits until the element is hidden", async () => {
  const { locator, expressions } = locatorWith("div", bool(true), bool(false));
  await expect(locator).not.toBeVisible({ timeout: 2000 });
  assert.equal(expressions.length, 2);
});

test("negated failure is named not.<matcher>", async () => {
  const { locator } = locatorWith("h1", text("Contact"));
  await assert.rejects(
    expect(locator).not.toHaveText("Contact", { timeout: 0 }),
    (err) => {
      assert.ok(err instanceof AssertionError);
      assert.equal(err.matcher, "not.toHaveText");
      return true;
    },
  );
});

test("toHaveText is exact, toContainText is a substring, both accept regexps", async () => {
  const { locator } = locatorWith("p", text("Hello world"));
  await assert.rejects(
    expect(locator).toHaveText("Hello", { timeout: 0 }),
    AssertionError,
  );
  await expect(locator).toContainText("Hello", { timeout: 0 });
  await expect(locator).toHaveText(/world$/, { timeout: 0 });
  await expect(locator).toContainText(/WORLD/i, { timeout: 0 });
});

test("a missing element never matches text", async () => {
  const { locator } = locatorWith("p", missing);
  await assert.rejects(
    expect(locator).toContainText("", { timeout: 0 }),
    (err) => {
      assert.ok(err instanceof AssertionError);
      assert.equal(err.actual, null);
      return true;
    },
  );
});

test("toHaveValue, toHaveAttribute and toHaveCount", async () => {
  await expect(locatorWith("input", text("test")).locator).toHaveValue("test", {
    timeout: 0,
  });
  await expect(locatorWith("a", text("/home")).locator).toHaveAttribute(
    "href",
    /home/,
    { timeout: 0 },
  );
  const three = locatorWith("li", missing);
  three.nodeCounts(3);
  await expect(three.locator).toHaveCount(3, { timeout: 0 });
  const two = locatorWith("li", missing);
  two.nodeCounts(2);
  await assert.rejects(
    expect(two.locator).toHaveCount(3, { timeout: 0 }),
    AssertionError,
  );
});

const hang: StubResponse = { hang: true };
/** Fails a regression instead of hanging the suite */
const bounded = { timeout: 3000 };

test(
  "a read that never answers fails at the timeout with the last received value",
  bounded,
  async () => {
    const { locator, expressions } = locatorWith("h1", text("Home"), hang);
    const start = Date.now();
    await assert.rejects(
      expect(locator).toHaveText("Contact", { timeout: 200 }),
      (err) => {
        assert.ok(err instanceof AssertionError);
        assert.equal(err.matcher, "toHaveText");
        assert.equal(err.expected, "Contact");
        assert.equal(err.actual, "Home");
        assert.equal(err.locator, "//h1");
        return true;
      },
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 195 && elapsed < 500, `elapsed ${elapsed}ms`);
    assert.equal(expressions.length, 2);
  },
);

test(
  "a first read that never answers fails at the timeout with a plain error",
  bounded,
  async () => {
    const { locator } = locatorWith("h1", hang);
    const start = Date.now();
    await assert.rejects(
      expect(locator).not.toBeVisible({ timeout: 200 }),
      (err) => {
        assert.ok(!(err instanceof AssertionError));
        assert.equal(
          (err as Error).message,
          "expect(locator).not.toBeVisible: could not read //h1 within 200ms",
        );
        return true;
      },
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 195 && elapsed < 500, `elapsed ${elapsed}ms`);
  },
);
