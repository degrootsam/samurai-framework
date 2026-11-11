import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyRecorderEvent } from "./apply.js";
import { secretNameFor } from "./expectation.js";
import {
  Normaliser,
  type Observation,
  type RecorderEvent,
} from "./normalise.js";
import { parseSpec } from "../steps/parse.js";
import { loc, click, input, stepOf } from "../testing/normalise-fixtures.js";

describe("Normaliser", () => {
  it("merges typing into one fill that is rewritten as the text grows", () => {
    const n = new Normaliser({ at: 0 });
    const events = ["a", "ab", "abc"].flatMap((value, i) =>
      n.observe(input("f", value), i * 100),
    );
    assert.deepEqual(
      events.map(({ op, index }) => [op, index]),
      [
        ["insert", 0],
        ["replace", 0],
        ["replace", 0],
      ],
    );
    assert.deepEqual(stepOf(events[2]), {
      kind: "fill",
      locator: loc("f"),
      value: { kind: "literal", value: "abc" },
    });
    assert.equal(n.nextIndex, 1);
  });

  it("starts a new fill when another field is typed into", () => {
    const n = new Normaliser({ at: 0 });
    n.observe(input("a", "x"), 0);
    const [event] = n.observe(input("b", "y"), 10);
    assert.deepEqual([event!.op, event!.index], ["insert", 1]);
    const [again] = n.observe(input("a", "z"), 20);
    assert.equal(again!.op, "insert", "an earlier field is not merged into");
  });

  it("drops clicks that only focus a text field", () => {
    const n = new Normaliser({ at: 0 });
    assert.deepEqual(n.observe(click("f", true), 0), []);
    assert.equal(n.observe(click("b"), 5).length, 1);
  });

  it("turns a password into a secret reference without the value", () => {
    const n = new Normaliser({ at: 0 });
    const [event] = n.observe(
      {
        type: "input",
        key: "p",
        locator: loc("p"),
        secret: true,
        secretName: "userPassword",
      },
      0,
    );
    assert.deepEqual((stepOf(event) as { value: unknown }).value, {
      kind: "secret",
      name: "USER_PASSWORD",
    });
    assert.equal(secretNameFor(""), "PASSWORD");
    assert.equal(secretNameFor("9x"), "PASSWORD");
    assert.equal(secretNameFor("login-pass"), "LOGIN_PASS");
  });

  it("writes a navigation right after an action as a network-idle wait, once", () => {
    const n = new Normaliser({ at: 0 });
    n.observe(click("b"), 1000);
    const [wait] = n.navigated("https://x.test/next", 1300);
    assert.deepEqual(stepOf(wait), { kind: "waitForNetworkIdle" });
    assert.deepEqual(stepOf(n.navigated("https://x.test/redirect", 1400)[0]), {
      kind: "goto",
      url: "https://x.test/redirect",
    });
  });

  it("writes a navigation without a recent action as goto, relative to the base URL", () => {
    const n = new Normaliser({ at: 3, baseURL: "https://x.test/" });
    n.observe(click("b"), 0);
    const [goto] = n.navigated("https://x.test/a?b=1#c", 10_000);
    assert.deepEqual(
      [goto!.index, stepOf(goto)],
      [4, { kind: "goto", url: "/a?b=1#c" }],
    );
    assert.equal(n.relative("https://x.test"), "/");
    assert.equal(n.relative("https://x.test.evil/a"), "https://x.test.evil/a");
    assert.equal(n.relative("https://other.test/"), "https://other.test/");
  });

  it("numbers steps from `at`", () => {
    const n = new Normaliser({ at: 5 });
    assert.equal(n.observe(click("a"), 0)[0]!.index, 5);
    assert.equal(n.observe(click("b"), 0)[0]!.index, 6);
  });

  it("an Alt+click becomes an expectation by what the element holds", () => {
    const n = new Normaliser({ at: 0 });
    const expectation = (text: string, value?: string) =>
      (
        stepOf(
          n.observe(
            {
              type: "assert",
              key: "k",
              locator: loc("k"),
              text,
              ...(value !== undefined && { value }),
            },
            0,
          )[0],
        ) as {
          expectation: unknown;
        }
      ).expectation;
    assert.deepEqual(expectation("Hello", "typed"), {
      matcher: "toHaveValue",
      expected: "typed",
    });
    assert.deepEqual(expectation("Hello"), {
      matcher: "toHaveText",
      expected: "Hello",
    });
    assert.deepEqual(expectation("x".repeat(150)), {
      matcher: "toContainText",
      expected: "x".repeat(100),
    });
    assert.deepEqual(expectation(""), { matcher: "toBeVisible" });
  });
});

describe("Normaliser with key presses", () => {
  const press = (key: string, pressed: string): Observation => ({
    type: "press",
    key,
    locator: loc(key),
    pressed,
  });

  it("an Enter ends the fill: what is typed next in the same field is a new fill, not a rewrite", () => {
    const n = new Normaliser({ at: 0 });
    const events = [
      ...n.observe(input("todo", "buy milk"), 0),
      ...n.observe(press("todo", "Enter"), 100),
      ...n.observe(input("todo", "walk dog"), 200),
      ...n.observe(press("todo", "Enter"), 300),
    ];
    assert.deepEqual(
      events.map((e) => [e.op, e.index, stepOf(e).kind]),
      [
        ["insert", 0, "fill"],
        ["insert", 1, "press"],
        ["insert", 2, "fill"],
        ["insert", 3, "press"],
      ],
    );
    assert.deepEqual((stepOf(events[1]) as { key: string }).key, "Enter");
    assert.deepEqual((stepOf(events[2]) as { value: unknown }).value, {
      kind: "literal",
      value: "walk dog",
    });
  });

  it("a navigation right after a press is a consequence of it", () => {
    const n = new Normaliser({ at: 0 });
    n.observe(input("search", "samurai"), 0);
    n.observe(press("search", "Enter"), 100);
    assert.deepEqual(stepOf(n.navigated("https://x.test/results", 400)[0]), {
      kind: "waitForNetworkIdle",
    });
  });
});

describe("applyRecorderEvent", () => {
  it("records into the middle of a test and keeps the steps after it", () => {
    let source = `test("t", async ({ page }) => {\n  await page.goto("/");\n  await page.waitForNetworkIdle();\n});\n`;
    const n = new Normaliser({ at: 1 });
    const events: RecorderEvent[] = [
      ...n.observe(input("name", "S"), 0),
      ...n.observe(input("name", "Sam"), 50),
      ...n.observe(click("save"), 100),
    ];
    for (const event of events) source = applyRecorderEvent(source, 0, event);
    assert.deepEqual(
      parseSpec(source)[0]!.steps.map(({ step }) => step.kind),
      ["goto", "fill", "click", "waitForNetworkIdle"],
    );
    assert.match(source, /fill\("Sam"\)/);
    assert.doesNotMatch(source, /fill\("S"\)/);
  });
});
