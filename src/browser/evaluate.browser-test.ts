import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  ScriptError,
  ScriptSerializationError,
} from "../script/call-function.js";
import { ElementHandle } from "../script/element-handle.js";
import { RemoteObject } from "../script/serialize.js";
import { testBrowser } from "../testing/test-browser.js";
import { Browser } from "./browser.js";
import type Page from "./page.js";

let browser: Browser;
let page: Page;

before(async () => {
  ({ browser, page } = await Browser.launch(testBrowser(), {
    port: 9450,
    headless: true,
  }));
  await page.navigateTo("about:blank", "complete");
});

after(async () => {
  await browser?.close();
});

const OPTIONS = { timeout: 30000 };
test(
  "plain values, nested objects and arrays come back as they are",
  OPTIONS,
  async () => {
    const value = await page.evaluate(() => ({
      text: "a",
      list: [1, [2, { deep: true }]],
      nested: { a: { b: { c: null } } },
    }));
    assert.deepEqual(value, {
      text: "a",
      list: [1, [2, { deep: true }]],
      nested: { a: { b: { c: null } } },
    });
  },
);

test(
  "Date, Map, Set, RegExp, BigInt, NaN, Infinity and undefined survive",
  OPTIONS,
  async () => {
    const value = (await page.evaluate(() => ({
      date: new Date("2026-01-02T03:04:05.000Z"),
      map: new Map<unknown, unknown>([["k", { v: 1 }]]),
      set: new Set([1, "two"]),
      pattern: /a+b/gi,
      big: 12345678901234567890n,
      nan: NaN,
      inf: Infinity,
      missing: undefined,
    }))) as Record<string, unknown>;
    assert.deepEqual(value.date, new Date("2026-01-02T03:04:05.000Z"));
    assert.deepEqual(value.map, new Map([["k", { v: 1 }]]));
    assert.deepEqual(value.set, new Set([1, "two"]));
    assert.equal((value.pattern as RegExp).source, "a+b");
    assert.equal((value.pattern as RegExp).flags, "gi");
    assert.equal(value.big, 12345678901234567890n);
    assert.ok(Number.isNaN(value.nan));
    assert.equal(value.inf, Infinity);
    assert.ok("missing" in value, "the key is kept");
    assert.equal(value.missing, undefined);
  },
);

test(
  "NaN and undefined come back as themselves at the top level",
  OPTIONS,
  async () => {
    assert.ok(Number.isNaN(await page.evaluate(() => NaN)));
    assert.equal(await page.evaluate(() => undefined), undefined);
    assert.equal(await page.evaluate("undefined"), undefined);
  },
);

test("a DOM node comes back as an ElementHandle", OPTIONS, async () => {
  const node = await page.evaluate("document.body");
  assert.ok(node instanceof ElementHandle);
  assert.ok((node as ElementHandle).sharedId.length > 0);
});

test(
  "what cannot be copied comes back as a RemoteObject with its type",
  OPTIONS,
  async () => {
    const fn = await page.evaluate(() => () => 1);
    assert.ok(fn instanceof RemoteObject);
    assert.equal((fn as RemoteObject).type, "function");
    const holder = (await page.evaluate(() => ({
      f() {},
      w: (globalThis as any).window,
    }))) as Record<string, unknown>;
    assert.ok(holder.f instanceof RemoteObject);
    assert.equal((holder.f as RemoteObject).type, "function");
    assert.ok(holder.w instanceof RemoteObject);
    assert.equal((holder.w as RemoteObject).type, "window");
  },
);

test("an async function is awaited", OPTIONS, async () => {
  const value = await page.evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return "later";
  });
  assert.equal(value, "later");
});

test(
  "an expression string is evaluated, and a promise in it awaited",
  OPTIONS,
  async () => {
    await page.evaluate("document.title = 'Evaluate title'");
    assert.equal(await page.evaluate("document.title"), "Evaluate title");
    assert.equal(await page.evaluate("1 + 2"), 3);
    assert.equal(await page.evaluate("Promise.resolve('p')"), "p");
    assert.equal(await page.evaluate("(() => 7)()"), 7);
  },
);

test(
  "a string holding a function is called with the argument",
  OPTIONS,
  async () => {
    assert.equal(await page.evaluate("(a) => a.x * 2", { x: 21 }), 42);
    assert.equal(await page.evaluate("async n => n + 1", 1), 2);
    assert.equal(await page.evaluate("function (n) { return n - 1; }", 1), 0);
  },
);

test("the argument is passed, including rich values", OPTIONS, async () => {
  const echoed = await page.evaluate(
    (arg: { when: Date; items: Set<number>; map: Map<string, number> }) => ({
      year: arg.when.getUTCFullYear(),
      size: arg.items.size,
      one: arg.map.get("one"),
    }),
    {
      when: new Date("2030-05-05T00:00:00.000Z"),
      items: new Set([1, 2, 3]),
      map: new Map([["one", 1]]),
    },
  );
  assert.deepEqual(echoed, { year: 2030, size: 3, one: 1 });
});

test("the page's error message is kept", OPTIONS, async () => {
  await assert.rejects(
    page.evaluate(() => {
      throw new Error("boom from the page");
    }),
    (err: Error) => {
      assert.ok(err instanceof ScriptError);
      assert.match(err.message, /boom from the page/);
      return true;
    },
  );
  await assert.rejects(
    page.evaluate("throw new Error('boom from an expression')"),
    /boom from an expression/,
  );
  await assert.rejects(
    page.evaluate(async () => {
      await Promise.resolve();
      throw new Error("rejected later");
    }),
    /rejected later/,
  );
});

test(
  "a named inner function under tsx says what is wrong",
  OPTIONS,
  async () => {
    await assert.rejects(
      page.evaluate(() => {
        function inner() {
          return 1;
        }
        return inner();
      }),
      (err: Error) => {
        assert.ok(err instanceof ScriptSerializationError);
        assert.match(err.message, /__name/);
        assert.match(err.message, /pass it as a string/);
        return true;
      },
    );
    // The workaround the message names: the same code as a string
    assert.equal(
      await page.evaluate(
        "() => { function inner() { return 1; } return inner(); }",
      ),
      1,
    );
  },
);
