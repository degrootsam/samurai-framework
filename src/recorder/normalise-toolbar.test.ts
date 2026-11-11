import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyRecorderEvent } from "./apply.js";
import { Normaliser } from "./normalise.js";
import { parseSpec } from "../steps/parse.js";
import type { LocatorSpec } from "../steps/model.js";
import { stepOf } from "../testing/normalise-fixtures.js";

describe("toolbar observations", () => {
  const field = {
    chain: [{ method: "getByLabel", text: "Email" }],
    fallbacks: [],
  } as LocatorSpec;
  it("each becomes its step", () => {
    const n = new Normaliser({ at: 0, baseURL: "https://app.test" });
    const steps = [
      ...n.observe(
        {
          type: "expect",
          locator: field,
          not: true,
          expectation: { matcher: "toBeVisible" },
        },
        1,
      ),
      ...n.observe(
        {
          type: "insert",
          locator: field,
          value: { kind: "env", name: "testUser" },
        },
        2,
      ),
      ...n.observe({ type: "wait-idle" }, 3),
      ...n.observe({ type: "wait-time", ms: 2000 }, 4),
      ...n.observe({ type: "screenshot", name: "x", fullPage: true }, 5),
      ...n.observe({ type: "goto", url: "https://app.test/admin" }, 6),
    ].map(stepOf);
    assert.deepEqual(steps, [
      {
        kind: "expect",
        locator: field,
        not: true,
        expectation: { matcher: "toBeVisible" },
      },
      {
        kind: "fill",
        locator: field,
        value: { kind: "env", name: "testUser" },
      },
      { kind: "waitForNetworkIdle" },
      { kind: "waitForTimeout", ms: 2000 },
      { kind: "screenshot", name: "x", fullPage: true },
      { kind: "goto", url: "/admin" },
    ]);
  });

  it("a page expectation becomes an expectPage step", () => {
    const n = new Normaliser({ at: 0, baseURL: "https://app.test" });
    const [event] = n.observe(
      {
        type: "expectPage",
        not: true,
        expectation: { matcher: "toHaveURL", expected: "/checkout" },
      },
      1,
    );
    assert.deepEqual(stepOf(event), {
      kind: "expectPage",
      not: true,
      expectation: { matcher: "toHaveURL", expected: "/checkout" },
    });
  });

  it("a saved output becomes a saveOutput step, with or without a pattern", () => {
    const n = new Normaliser({ at: 0 });
    const steps = [
      ...n.observe(
        {
          type: "saveOutput",
          locator: field,
          name: "orderId",
          pattern: { source: "Order #(\\d+)", flags: "" },
        },
        1,
      ),
      ...n.observe({ type: "saveOutput", locator: field, name: "ref" }, 2),
    ].map(stepOf);
    assert.deepEqual(steps, [
      {
        kind: "saveOutput",
        name: "orderId",
        locator: field,
        pattern: { source: "Order #(\\d+)", flags: "" },
      },
      { kind: "saveOutput", name: "ref", locator: field },
    ]);
  });

  it("an inserted new input declares its default, then fills with it", () => {
    const n = new Normaliser({ at: 0 });
    const [event] = n.observe(
      {
        type: "insert",
        locator: field,
        value: { kind: "input", name: "email" },
        declare: "a@b.c",
      },
      1,
    );
    const source = applyRecorderEvent(
      `test("t", async ({ page }) => {\n});\n`,
      0,
      event!,
    );
    assert.match(
      source,
      /test\("t", \{ inputs: \{ email: "a@b\.c" \} \}, async \(\{ page, inputs \}\) => \{/,
    );
    assert.match(source, /\.fill\(inputs\.email\)/);
    const again = applyRecorderEvent(source, 0, {
      ...event!,
      index: 1,
    });
    assert.equal(
      parseSpec(again)[0]!.inputs?.length,
      1,
      "a name already declared is not declared twice",
    );
  });

  it("a saved output declares it and adds the outputs fixture in the spec", () => {
    const n = new Normaliser({ at: 0 });
    const [event] = n.observe(
      { type: "saveOutput", locator: field, name: "o" },
      1,
    );
    const source = applyRecorderEvent(
      `test("t", async ({ page }) => {\n});\n`,
      0,
      event!,
    );
    assert.match(
      source,
      /test\("t", \{ outputs: \["o"\] \}, async \(\{ page, outputs \}\) => \{/,
    );
    assert.match(
      source,
      /await outputs\.save\("o", page\.getByLabel\("Email"\)\);/,
    );
  });

  it("a toolbar step closes the fill being typed: typing afterwards is a new fill (Review Focus 3)", () => {
    const n = new Normaliser({ at: 0 });
    n.observe({ type: "input", key: "k", locator: field, value: "a" }, 1);
    n.observe({ type: "wait-time", ms: 100 }, 2);
    const [event] = n.observe(
      { type: "input", key: "k", locator: field, value: "ab" },
      3,
    );
    assert.equal(event!.op, "insert");
    assert.equal(event!.index, 2);
  });

  it("an insert replaces nothing and is followed by nothing", () => {
    const n = new Normaliser({ at: 0 });
    const events = n.observe(
      { type: "insert", locator: field, value: { kind: "secret", name: "PW" } },
      1,
    );
    assert.deepEqual(
      events.map((e) => e.op),
      ["insert"],
    );
  });
});

describe("file uploads", () => {
  const button: LocatorSpec = {
    chain: [{ method: "getByRole", role: "button", name: "Upload" }],
    fallbacks: [],
  };
  const input: LocatorSpec = {
    chain: [{ method: "getByLabel", text: "Avatar" }],
    fallbacks: [],
  };
  const zone: LocatorSpec = {
    chain: [{ method: "getByTestId", testId: "zone" }],
    fallbacks: [],
  };
  const files = [{ path: "files/a.png" }];
  const click = () =>
    ({ type: "click", key: "b", locator: button, textEntry: false }) as const;

  it("records a change without a picker click as a new step", () => {
    const n = new Normaliser({ at: 0 });
    assert.deepEqual(
      n.observe({ type: "files", via: "input", locator: input, files }, 0),
      [
        {
          op: "insert",
          index: 0,
          step: { kind: "setInputFiles", locator: input, files },
        },
      ],
    );
  });

  it("replaces the click that opened the picker", () => {
    const n = new Normaliser({ at: 0 });
    n.observe(click(), 0);
    assert.deepEqual(n.observe({ type: "picker" }, 50), []);
    assert.deepEqual(
      n.observe({ type: "files", via: "input", locator: input, files }, 9000),
      [
        {
          op: "replace",
          index: 0,
          step: { kind: "setInputFiles", locator: input, files },
        },
      ],
    );
    assert.equal(n.nextIndex, 1);
  });

  it("removes the click when the picker is cancelled", () => {
    const n = new Normaliser({ at: 3 });
    n.observe(click(), 0);
    n.observe({ type: "picker" }, 10);
    assert.deepEqual(n.observe({ type: "picker-cancel" }, 5000), [
      { op: "remove", index: 3 },
    ]);
    assert.equal(n.nextIndex, 3);
  });

  it("ignores a picker long after the click, or after another step", () => {
    const late = new Normaliser({ at: 0 });
    late.observe(click(), 0);
    late.observe({ type: "picker" }, 5000);
    assert.equal(
      late.observe(
        { type: "files", via: "input", locator: input, files },
        6000,
      )[0]!.op,
      "insert",
    );

    const other = new Normaliser({ at: 0 });
    other.observe(click(), 0);
    other.observe({ type: "picker" }, 10);
    other.observe({ type: "wait-idle" }, 20);
    assert.deepEqual(other.observe({ type: "picker-cancel" }, 30), []);
  });

  it("records a drop as dropFiles, never replacing a click", () => {
    const n = new Normaliser({ at: 0 });
    n.observe(click(), 0);
    n.observe({ type: "picker" }, 10);
    assert.deepEqual(
      n.observe({ type: "files", via: "drop", locator: zone, files }, 20),
      [
        {
          op: "insert",
          index: 1,
          step: { kind: "dropFiles", locator: zone, files },
        },
      ],
    );
  });

  it("a navigation right after an upload is a wait, not a goto", () => {
    const n = new Normaliser({ at: 0 });
    n.observe({ type: "files", via: "input", locator: input, files }, 0);
    const [event] = n.navigated("http://x/next", 500);
    assert.equal(stepOf(event).kind, "waitForNetworkIdle");
  });
});
