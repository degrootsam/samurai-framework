import { test } from "node:test";
import assert from "node:assert/strict";
import Page from "../browser/page.js";
import { resolveRelativeURL } from "../browser/page-navigation.js";
import { expect, takePendingAssertions } from "./expect.js";
import { AssertionError } from "./assertion-error.js";
import { PageAssertions } from "./page-assertions.js";

interface Fake {
  url: () => Promise<string>;
  title: () => Promise<string>;
  resolveURL: (url: string) => string;
  closed: boolean;
}

function fakePage(overrides: Partial<Fake> = {}): Page {
  const fake: Fake = {
    url: async () => "https://x.com/app/b",
    title: async () => "Home",
    resolveURL: (url) => resolveRelativeURL(url, "https://x.com/app/"),
    closed: false,
    ...overrides,
  };
  const page = Object.create(Page.prototype) as Page;
  for (const [key, value] of Object.entries(fake))
    Object.defineProperty(page, key, { value });
  return page;
}

/** An async read that answers `values` in order, then repeats the last */
const sequence = <T>(...values: T[]) => {
  let i = 0;
  return async () => values[Math.min(i++, values.length - 1)] as T;
};

test("resolveRelativeURL resolves slash-led URLs against the base and leaves others", () => {
  const base = "https://x.com/app/";
  assert.equal(resolveRelativeURL("/checkout", base), "https://x.com/checkout");
  assert.equal(resolveRelativeURL("./b", base), "https://x.com/app/b");
  assert.equal(resolveRelativeURL("../b", base), "https://x.com/b");
  assert.equal(resolveRelativeURL("https://y.com/z", base), "https://y.com/z");
});

test("expect(page) returns PageAssertions", () => {
  assert.ok(expect(fakePage()) instanceof PageAssertions);
});

test("toHaveURL resolves a relative string against the base URL", async () => {
  await expect(fakePage()).toHaveURL("./b", { timeout: 500 });
  await expect(fakePage()).toHaveURL("https://x.com/app/b", { timeout: 500 });
  await assert.rejects(
    expect(fakePage()).toHaveURL("/b", { timeout: 0 }),
    AssertionError,
  );
});

test("toHaveURL with a RegExp tests the full URL", async () => {
  await expect(fakePage()).toHaveURL(/app\/b$/, { timeout: 500 });
  await expect(fakePage()).not.toHaveURL(/^\/app/, { timeout: 500 });
});

test("toHaveURL fails with matcher, expected, actual and locator page", async () => {
  await assert.rejects(
    expect(fakePage()).toHaveURL("https://nope", { timeout: 0 }),
    (err: AssertionError) => {
      assert.ok(err instanceof AssertionError);
      assert.equal(err.matcher, "toHaveURL");
      assert.equal(err.expected, "https://nope");
      assert.equal(err.actual, "https://x.com/app/b");
      assert.equal(err.locator, "page");
      return true;
    },
  );
});

test("toHaveTitle compares a trimmed title", async () => {
  const page = fakePage({ title: async () => " Home" });
  await expect(page).toHaveTitle("Home", { timeout: 500 });
  await expect(page).toHaveTitle(/^Home$/, { timeout: 500 });
  await expect(page).not.toHaveTitle("Other", { timeout: 500 });
});

test("toHaveTitle retries until the title matches, not.toHaveTitle until it changes", async () => {
  const page = fakePage({ title: sequence("Loading", "Loading", "Home") });
  await expect(page).toHaveTitle("Home", { timeout: 2000 });
  const changing = fakePage({ title: sequence("Home", "Home", "Done") });
  await expect(changing).not.toHaveTitle("Home", { timeout: 2000 });
});

test("a read that throws while the page is open is retried", async () => {
  let calls = 0;
  const page = fakePage({
    title: async () => {
      if (calls++ < 2) throw new Error("execution context destroyed");
      return "Home";
    },
  });
  await expect(page).toHaveTitle("Home", { timeout: 2000 });
});

test("a read that keeps throwing fails as could not read", async () => {
  const page = fakePage({
    url: async () => {
      throw new Error("navigating");
    },
  });
  await assert.rejects(
    expect(page).not.toHaveURL("x", { timeout: 150 }),
    /could not read the page URL/,
  );
});

test("a closed page fails with the page's error, not a timeout", async () => {
  const page = fakePage({
    closed: true,
    title: async () => {
      throw new Error("page closed");
    },
  });
  const start = Date.now();
  await assert.rejects(
    expect(page).toHaveTitle("Home", { timeout: 5000 }),
    /page closed/,
  );
  assert.ok(Date.now() - start < 1000);
});

test("an un-awaited page matcher is tracked as pending", async () => {
  takePendingAssertions();
  const promise = expect(fakePage()).toHaveURL("x", { timeout: 0 });
  assert.deepEqual(takePendingAssertions(), ["toHaveURL"]);
  await promise.catch(() => undefined);
});

test("toHaveTitle trims an expected string too", async () => {
  const page = fakePage({ title: async () => " Home" });
  await expect(page).toHaveTitle("Home ", { timeout: 500 });
});

test("a relative toHaveURL without a base URL rejects with the baseURL message", async () => {
  const page = fakePage({
    resolveURL: () => {
      throw new Error("toHaveURL(): a relative URL needs a baseURL");
    },
  });
  await assert.rejects(expect(page).toHaveURL("/x"), /needs a baseURL/);
});

test("an un-awaited no-base toHaveURL is listed as pending, not unhandled", async () => {
  const page = fakePage({
    resolveURL: () => {
      throw new Error("toHaveURL(): a relative URL needs a baseURL");
    },
  });
  takePendingAssertions();
  const promise = expect(page).toHaveURL("/x");
  assert.deepEqual(takePendingAssertions(), ["toHaveURL"]);
  await promise.catch(() => undefined);
});
