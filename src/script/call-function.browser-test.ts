import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import { setContent } from "../testing/browser-fixture.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import { BiDiError } from "../transport/bidi-error.js";
import { callFunction, disown, ScriptError } from "./call-function.js";
import { ElementHandle } from "./element-handle.js";
import { RemoteObject } from "./serialize.js";

let browser: Browser;
let page: Page;
let connector: BiDiConnector;

before(async () => {
  ({ browser, page } = await Browser.launch("firefox", { port: 9233, headless: true }));
  connector = (page as unknown as { biDiConnector: BiDiConnector }).biDiConnector;
  await page.navigateTo("about:blank", "complete");
});

after(async () => {
  await browser?.close();
});

const OPTIONS = { timeout: 15000 };
const call = <T>(fn: string | ((...args: any[]) => unknown), args: unknown[] = [], options = {}) =>
  callFunction<T>(connector, page.contextId, fn, args, options);

test("plain values, Map, Set, Date and RegExp round trip", OPTIONS, async () => {
  const input = {
    text: `quote " apostrophe ' backslash \\ newline \n`,
    numbers: [1, -0, NaN, Infinity],
    map: new Map<unknown, unknown>([["k", 1]]),
    set: new Set([1, 2]),
    date: new Date("2026-09-29T10:00:00.000Z"),
    pattern: /a+b/gi,
    big: 12345678901234567890n,
    nothing: null,
    missing: undefined,
  };
  const output = await call<typeof input>("(value) => value", [input]);
  assert.equal(output.text, input.text);
  assert.ok(Object.is(output.numbers[1], -0));
  assert.ok(Number.isNaN(output.numbers[2]));
  assert.equal(output.numbers[3], Infinity);
  assert.deepEqual([...output.map], [["k", 1]]);
  assert.deepEqual([...output.set], [1, 2]);
  assert.equal(output.date.toISOString(), input.date.toISOString());
  assert.equal(output.pattern.source, "a+b");
  assert.equal(output.pattern.flags, "gi");
  assert.equal(output.big, input.big);
  assert.equal(output.nothing, null);
  assert.equal(output.missing, undefined);
});

test("an xpath with every quote style and a newline is located without escaping", OPTIONS, async () => {
  await setContent(page, `<a id="x">Don't "stop"</a>`);
  const xpath = `//a[@id="x" and contains(., "Don't")]\n`;
  const link = page.locator(xpath);
  assert.equal(await link.count(), 1);
  assert.equal(await link.textContent(), `Don't "stop"`);
});

test("awaitPromise resolves async functions", OPTIONS, async () => {
  assert.equal(await call("async () => { await new Promise((r) => setTimeout(r, 50)); return 7; }"), 7);
});

test("a function object is sent as its source", OPTIONS, async () => {
  assert.equal(await call((a: number, b: number) => a + b, [2, 3]), 5);
});

test("a throwing function becomes a ScriptError", OPTIONS, async () => {
  await assert.rejects(call(`() => { null.x; }`), (err: unknown) => {
    assert.ok(err instanceof ScriptError);
    assert.match(err.text, /TypeError/);
    return true;
  });
});

test("nodes come back as ElementHandles and can be passed in again", OPTIONS, async () => {
  await setContent(page, `<p id="p">hello</p>`);
  const handle = await call<ElementHandle>(`() => document.getElementById("p")`);
  assert.ok(handle instanceof ElementHandle);
  assert.equal(await call<string>(`(el) => el.textContent`, [handle]), "hello");
});

test("a removed node stays usable, a node from a previous document fails with no such node", OPTIONS, async () => {
  await setContent(page, `<p id="p">hello</p>`);
  const handle = await call<ElementHandle>(`() => document.getElementById("p")`);
  await call(`() => document.getElementById("p").remove()`);
  // Detached but alive: the browser still resolves the reference
  assert.equal(await call<string>(`(el) => el.textContent`, [handle]), "hello");
  await page.navigateTo("about:blank?next", "complete");
  await assert.rejects(
    call(`(el) => el.textContent`, [handle]),
    (err: unknown) => err instanceof BiDiError && err.code === "no such node",
  );
});

test("ownership root keeps a handle that disown releases, twice without error", OPTIONS, async () => {
  const kept = await call<RemoteObject>(`() => ({ a: 1 })`, [], { ownership: "root" });
  assert.ok(kept instanceof RemoteObject);
  assert.ok(kept.handle);
  assert.deepEqual(kept.value, { a: 1 });
  await disown(connector, page.contextId, [kept.handle!]);
  await assert.doesNotReject(disown(connector, page.contextId, [kept.handle!]));
});

test("unserializable arguments fail before anything is sent", OPTIONS, async () => {
  await assert.rejects(call(`(f) => f`, [() => 1]), TypeError);
});
