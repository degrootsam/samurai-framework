import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestFixtures } from "../types/test.js";
import { extendLayers } from "./fixture-defs.js";
import { FixtureScope } from "./fixture-scope.js";
import { FixtureSetupError } from "./fixture-start.js";
import { runWithEachHooks } from "./hooks.js";
import { addHook, newSuite } from "./suite.js";

const builtIn = {
  page: "page",
  baseURL: "http://x",
  browserName: "firefox",
} as unknown as TestFixtures;
const scopeOf = (defs: object) =>
  new FixtureScope(extendLayers(undefined, defs), builtIn);
const body = (fn: (f: any) => unknown) => fn as (...a: never[]) => unknown;

/** A fixture that logs its setup and teardown */
const logged =
  (log: string[], name: string, value: unknown = name) =>
  async ({}: any, use: (v: unknown) => Promise<void>) => {
    log.push(`+${name}`);
    await use(value);
    log.push(`-${name}`);
  };

test("fixtures are lazy: only the ones a function destructures are set up", async () => {
  const log: string[] = [];
  const scope = scopeOf({ a: logged(log, "a"), b: logged(log, "b") });
  await scope.prepare(body(async ({ b }: any) => b));
  assert.deepEqual(log, ["+b"]);
  assert.equal((scope.fixtures as any).b, "b");
  assert.equal((scope.fixtures as any).a, undefined);
  await scope.teardown(1000);
});

test("dependencies are set up first and torn down last-first; built-ins arrive as values", async () => {
  const log: string[] = [];
  const scope = scopeOf({
    top: async ({ mid, baseURL }: any, use: any) => {
      log.push(`+top(${mid},${baseURL})`);
      await use("top");
      log.push("-top");
    },
    mid: async ({ leaf }: any, use: any) => {
      log.push(`+mid(${leaf})`);
      await use("mid");
      log.push("-mid");
    },
    leaf: logged(log, "leaf"),
  });
  await scope.prepare(body(async ({ top }: any) => top));
  assert.equal(await scope.teardown(1000), undefined);
  assert.deepEqual(log, [
    "+leaf",
    "+mid(leaf)",
    "+top(mid,http://x)",
    "-top",
    "-mid",
    "-leaf",
  ]);
});

test("a fixture is set up once however many ask, and hooks and body share the instance", async () => {
  let made = 0;
  const scope = scopeOf({
    counter: async ({}: any, use: any) => {
      await use({ id: ++made });
    },
    other: async ({ counter }: any, use: any) => use(counter),
  });
  const seen: unknown[] = [];
  const suite = newSuite();
  addHook(
    suite,
    "beforeEach",
    async ({ counter }: any) => void seen.push(counter),
  );
  addHook(
    suite,
    "afterEach",
    async ({ counter, other }: any) => void seen.push(counter, other),
  );
  await runWithEachHooks(
    suite,
    scope.fixtures,
    new AbortController().signal,
    async () => {
      await scope.prepare(body(async ({ counter }: any) => counter));
      seen.push((scope.fixtures as any).counter);
    },
    undefined,
    scope,
  );
  await scope.teardown(1000);
  assert.equal(made, 1);
  assert.equal(new Set(seen).size, 1);
  assert.equal(seen.length, 4);
});

test("auto fixtures run for every test without being asked, before beforeEach", async () => {
  const log: string[] = [];
  const scope = scopeOf({
    auto: [logged(log, "auto"), { auto: true }],
    lazy: logged(log, "lazy"),
  });
  const suite = newSuite();
  addHook(suite, "beforeEach", async () => void log.push("beforeEach"));
  addHook(suite, "afterEach", async () => void log.push("afterEach"));
  await runWithEachHooks(
    suite,
    scope.fixtures,
    new AbortController().signal,
    async () => void log.push("body"),
    undefined,
    scope,
  );
  await scope.teardown(1000);
  assert.deepEqual(log, ["+auto", "beforeEach", "body", "afterEach", "-auto"]);
});

test("teardown still runs when the test failed, and a teardown error is returned after the others ran", async () => {
  const log: string[] = [];
  const scope = scopeOf({
    a: logged(log, "a"),
    b: async ({}: any, use: any) => {
      await use(1);
      throw new Error("cleanup broke");
    },
    c: logged(log, "c"),
  });
  const suite = newSuite();
  await assert.rejects(
    runWithEachHooks(
      suite,
      scope.fixtures,
      new AbortController().signal,
      async () => {
        await scope.prepare(body(async ({ a, b, c }: any) => [a, b, c]));
        throw new Error("test failed");
      },
      undefined,
      scope,
    ),
    /test failed/,
  );
  const error = await scope.teardown(1000);
  assert.match(
    error?.message ?? "",
    /^fixture "b" teardown failed: cleanup broke$/,
  );
  assert.deepEqual(log, ["+a", "+c", "-c", "-a"]);
});

test("a teardown that hangs ends at the limit", async () => {
  const scope = scopeOf({
    stuck: async ({}: any, use: any) => {
      await use(1);
      await new Promise(() => {});
    },
  });
  await scope.prepare(body(async ({ stuck }: any) => stuck));
  const error = await scope.teardown(20);
  assert.match(
    error?.message ?? "",
    /fixture "stuck" teardown failed: timed out/,
  );
});

test("a setup error names the fixture, a dependency's error is not wrapped twice, and later asks fail the same way", async () => {
  const scope = scopeOf({
    bad: async () => {
      throw new Error("no server");
    },
    needsBad: async ({ bad }: any, use: any) => use(bad),
  });
  const ask = () => scope.prepare(body(async ({ needsBad }: any) => needsBad));
  await assert.rejects(
    ask(),
    (e: Error) =>
      e instanceof FixtureSetupError &&
      e.message === 'fixture "bad" setup failed: no server',
  );
  await assert.rejects(ask(), /fixture "bad" setup failed: no server/);
  assert.equal(await scope.teardown(1000), undefined);
});

test("a setup that never calls use(), or calls it twice, is an error", async () => {
  const never = scopeOf({ n: async () => {} });
  await assert.rejects(
    never.prepare(body(async ({ n }: any) => n)),
    /fixture "n" setup failed: the setup never called use/,
  );
  const twice = scopeOf({
    t: async ({}: any, use: any) => {
      await use(1);
      await use(2);
    },
  });
  await twice.prepare(body(async ({ t }: any) => t));
  assert.match(
    (await twice.teardown(1000))?.message ?? "",
    /use\(\) was called twice/,
  );
});

test("an unknown fixture name in a function is an error, built-ins and bare parameters are not", async () => {
  const scope = scopeOf({ a: 1 });
  await assert.rejects(
    scope.prepare(body(async ({ nope }: any) => nope)),
    /^Error: extend\(\): unknown fixture "nope"$/,
  );
  await scope.prepare(body(async ({ page, a }: any) => [page, a]));
  await scope.prepare(body(async (f: any) => f));
  assert.equal((scope.fixtures as any).a, 1);
});

test("value fixtures and overrides: a custom fixture replaces the built-in, and may use it", async () => {
  const layers = extendLayers(
    extendLayers(undefined, {
      baseURL: "http://custom",
      page: async ({ page }: any, use: any) => use(`${page}+1`),
    }),
    { page: async ({ page }: any, use: any) => use(`${page}+2`) },
  );
  const scope = new FixtureScope(layers, builtIn);
  assert.equal(scope.fixtures.baseURL, "http://x");
  await scope.prepare(body(async ({ page, baseURL }: any) => [page, baseURL]));
  assert.equal(scope.fixtures.page as unknown, "page+1+2");
  assert.equal(scope.fixtures.baseURL, "http://custom");
  assert.equal(await scope.teardown(1000), undefined);
});

test("a rest entry sets every custom fixture up", async () => {
  const log: string[] = [];
  const scope = scopeOf({ a: logged(log, "a"), b: logged(log, "b") });
  await scope.prepare(body(async ({ ...all }: any) => all));
  assert.deepEqual(log, ["+a", "+b"]);
  await scope.teardown(1000);
});
