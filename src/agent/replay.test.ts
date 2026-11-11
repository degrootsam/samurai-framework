import { test } from "node:test";
import assert from "node:assert/strict";
import type Page from "../browser/page.js";
import { registerSecret, resetSecrets } from "../config/mask.js";
import type { LocatorSpec, Step } from "../steps/model.js";
import { ReplayError, replaySteps, type ReplayContext } from "./replay.js";

const at = (testId: string): LocatorSpec => ({
  chain: [{ method: "getByTestId", testId }],
  fallbacks: [],
});

/** A page that records the calls made on it; a locator named `broken` fails to click */
function fakePage(calls: string[]) {
  const locator = (id: string) => {
    const record =
      (name: string) =>
      async (...args: unknown[]) => {
        if (id === "broken") throw new Error(`${name} timed out\nlog line`);
        calls.push(
          `${id}.${name}(${args.map((a) => JSON.stringify(a)).join(", ")})`,
        );
      };
    return Object.fromEntries(
      [
        "click",
        "fill",
        "press",
        "check",
        "uncheck",
        "hover",
        "dblclick",
        "clear",
        "selectOption",
        "setInputFiles",
        "dropFiles",
      ].map((name) => [name, record(name)]),
    );
  };
  return {
    goto: async (url: string) => void calls.push(`goto(${url})`),
    getByTestId: locator,
    waitForNetworkIdle: async () => void calls.push("idle"),
    waitForTimeout: async (ms: number) => void calls.push(`wait(${ms})`),
  } as unknown as Page;
}

const ctx = (extra: Partial<ReplayContext> = {}): ReplayContext => ({
  timeout: 1000,
  variables: { NAME: "ann", COUNT: 3 },
  secret: (name) => (name === "PASSWORD" ? "s3cret-value" : undefined),
  inputs: { who: "bob" },
  ...extra,
});

test("steps are played in order, values read from their sources", async () => {
  const calls: string[] = [];
  const steps: Step[] = [
    { kind: "goto", url: "/shop" },
    { kind: "click", locator: at("go") },
    { kind: "fill", locator: at("a"), value: { kind: "literal", value: "x" } },
    { kind: "fill", locator: at("b"), value: { kind: "env", name: "COUNT" } },
    {
      kind: "fill",
      locator: at("c"),
      value: { kind: "secret", name: "PASSWORD" },
    },
    { kind: "fill", locator: at("d"), value: { kind: "input", name: "who" } },
    { kind: "press", locator: at("d"), key: "Enter" },
    { kind: "selectOption", locator: at("s"), option: { label: "Two" } },
    { kind: "check", locator: at("k") },
    { kind: "waitForNetworkIdle" },
    { kind: "waitForTimeout", ms: 50 },
    {
      kind: "setInputFiles",
      locator: at("f"),
      files: [
        { path: "files/a.png" },
        { generate: { name: "big.bin", size: 10 } },
      ],
    },
  ];
  const seen: string[] = [];
  await replaySteps(
    fakePage(calls),
    steps,
    ctx({ onStep: (n, total) => seen.push(`${n}/${total}`) }),
  );
  assert.deepEqual(calls.slice(0, 10), [
    "goto(/shop)",
    'go.click({"timeout":1000})',
    'a.fill("x", {"timeout":1000})',
    'b.fill("3", {"timeout":1000})',
    'c.fill("s3cret-value", {"timeout":1000})',
    'd.fill("bob", {"timeout":1000})',
    'd.press("Enter", {"timeout":1000})',
    's.selectOption({"label":"Two"}, {"timeout":1000})',
    'k.check({"timeout":1000})',
    "idle",
  ]);
  assert.match(calls[11]!, /^f\.setInputFiles\(\["files\/a\.png",/);
  assert.equal(seen.length, steps.length);
  assert.equal(seen[0], "1/12");
});

test("assertions and evidence are skipped and not reported", async () => {
  const calls: string[] = [];
  const seen: number[] = [];
  await replaySteps(
    fakePage(calls),
    [
      { kind: "click", locator: at("a") },
      {
        kind: "expect",
        locator: at("a"),
        not: false,
        expectation: { matcher: "toBeVisible" },
      },
      {
        kind: "expectPage",
        not: false,
        expectation: { matcher: "toHaveURL", expected: "x" },
      },
      { kind: "saveOutput", name: "o", locator: at("a") },
      { kind: "screenshot", name: "s", fullPage: false },
    ],
    ctx({ onStep: (n) => seen.push(n) }),
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(seen, [1]);
});

test("a custom step stops the replay before anything runs, naming its number", async () => {
  const calls: string[] = [];
  await assert.rejects(
    replaySteps(
      fakePage(calls),
      [
        { kind: "click", locator: at("a") },
        { kind: "custom", code: "await doThing();" },
      ],
      ctx(),
    ),
    /^Error: step 2 is custom code and cannot be replayed$/,
  );
  assert.deepEqual(calls, []);
});

test("a failing step names its number and statement, and the error holds no secret", async () => {
  resetSecrets();
  registerSecret("TOKEN", "tok-value-123");
  await assert.rejects(
    replaySteps(
      fakePage([]),
      [
        { kind: "click", locator: at("a") },
        { kind: "click", locator: at("broken") },
      ],
      ctx(),
    ),
    (error: Error) => {
      assert.match(
        error.message,
        /^step 2 \(await page\.getByTestId\("broken"\)\.click\(\);\) failed: click timed out/,
      );
      return true;
    },
  );
  await assert.rejects(
    replaySteps(
      fakePage([]),
      [
        {
          kind: "fill",
          locator: at("a"),
          value: { kind: "secret", name: "NOPE" },
        },
      ],
      ctx(),
    ),
    /step 1 \(.*secrets\.NOPE.*\) failed: secrets\.NOPE has no value/,
  );
  await assert.rejects(
    replaySteps(
      fakePage([]),
      [
        { kind: "goto", url: "tok-value-123" },
        { kind: "click", locator: at("broken") },
      ],
      ctx(),
    ),
    (error: Error) => !error.message.includes("tok-value-123"),
  );
  resetSecrets();
});

test("an unknown env variable or input fails the step", async () => {
  await assert.rejects(
    replaySteps(
      fakePage([]),
      [
        {
          kind: "fill",
          locator: at("a"),
          value: { kind: "env", name: "NOPE" },
        },
      ],
      ctx(),
    ),
    /env\.NOPE is not defined/,
  );
  await assert.rejects(
    replaySteps(
      fakePage([]),
      [{ kind: "fill", locator: at("a"), value: { kind: "input", name: "x" } }],
      ctx(),
    ),
    /inputs\.x is not declared/,
  );
});

/** The error a replay of `steps` throws */
async function failure(steps: Step[], page: Page = fakePage([])) {
  try {
    await replaySteps(page, steps, ctx());
  } catch (error) {
    return error;
  }
  throw new Error("the replay did not fail");
}

test("a failing step throws a ReplayError that carries its number", async () => {
  const error = await failure([
    { kind: "click", locator: at("a") },
    { kind: "click", locator: at("broken") },
  ]);
  assert.ok(error instanceof ReplayError);
  assert.equal(error.step, 2);
  assert.match(error.message, /^step 2 \(/);
});

test("a custom step throws a ReplayError that carries its number", async () => {
  const error = await failure([
    { kind: "click", locator: at("a") },
    { kind: "custom", code: "await doThing();" },
  ]);
  assert.ok(error instanceof ReplayError);
  assert.equal(error.step, 2);
});

test("an engine failure while replaying is a ReplayError too, whatever it throws", async () => {
  const page = {
    goto: async () => {
      throw "browsing context is gone";
    },
  } as unknown as Page;
  const error = await failure([{ kind: "goto", url: "/shop" }], page);
  assert.ok(error instanceof ReplayError);
  assert.equal(error.step, 1);
  assert.match(error.message, /^step 1 .*failed: browsing context is gone/);
});
