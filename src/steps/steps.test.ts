import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyEdit } from "./edit.js";
import { stepToSource } from "./emit.js";
import type { Step } from "./model.js";
import { parseSpec } from "./parse.js";

const wrap = (...lines: string[]) =>
  `import { expect, test } from "samurai";\n\ntest("t", async ({ page, env, secrets }) => {\n${lines.map((l) => `  ${l}\n`).join("")}});\n`;

const stepsOf = (source: string) =>
  parseSpec(source)[0]!.steps.map(({ step }) => step);

const SAMPLES: Step[] = [
  { kind: "goto", url: "/login" },
  {
    kind: "click",
    locator: {
      chain: [{ method: "getByRole", role: "button", name: "Save" }],
      fallbacks: [],
    },
  },
  {
    kind: "click",
    locator: {
      chain: [
        { method: "locator", xpath: "//form" },
        { method: "getByCss", css: "a.b" },
      ],
      fallbacks: [],
    },
  },
  {
    kind: "fill",
    locator: {
      chain: [
        {
          method: "getByLabel",
          text: "Email",
          match: "partial",
          ignoreCase: true,
        },
      ],
      fallbacks: [],
    },
    value: { kind: "literal", value: 'say "hi"\n' },
  },
  {
    kind: "fill",
    locator: {
      chain: [{ method: "getByTestId", testId: "pw" }],
      fallbacks: [
        [{ method: "getByLabel", text: "Password" }],
        [{ method: "getByText", text: "pw" }],
      ],
    },
    value: { kind: "secret", name: "ADMIN_PASSWORD" },
  },
  {
    kind: "fill",
    locator: { chain: [{ method: "getByCss", css: "x" }], fallbacks: [] },
    value: { kind: "env", name: "has-dash" },
  },
  {
    kind: "expect",
    locator: { chain: [{ method: "getByTestId", testId: "a" }], fallbacks: [] },
    not: false,
    expectation: { matcher: "toBeVisible" },
  },
  {
    kind: "expect",
    locator: { chain: [{ method: "getByText", text: "a" }], fallbacks: [] },
    not: true,
    expectation: { matcher: "toHaveText", expected: "x" },
  },
  {
    kind: "expect",
    locator: { chain: [{ method: "getByText", text: "a" }], fallbacks: [] },
    not: false,
    expectation: {
      matcher: "toContainText",
      expected: { regex: { source: "a\\/b\\d+", flags: "i" } },
    },
  },
  {
    kind: "expect",
    locator: { chain: [{ method: "getByCss", css: "a" }], fallbacks: [] },
    not: false,
    expectation: { matcher: "toHaveAttribute", name: "href", expected: "/x" },
  },
  {
    kind: "expect",
    locator: { chain: [{ method: "getByCss", css: "li" }], fallbacks: [] },
    not: false,
    expectation: { matcher: "toHaveCount", expected: 3 },
  },
  {
    kind: "press",
    locator: {
      chain: [{ method: "getByLabel", text: "New todo" }],
      fallbacks: [],
    },
    key: "Enter",
  },
  { kind: "waitForNetworkIdle" },
];

describe("step codec", () => {
  it("round-trips every step kind through source", () => {
    for (const step of SAMPLES) {
      const source = wrap(stepToSource(step));
      assert.deepEqual(stepsOf(source), [step], stepToSource(step));
    }
  });

  it("reads a press and writes it back", () => {
    const [step] = stepsOf(
      wrap('await page.getByLabel("New todo").press("Enter");'),
    );
    assert.deepEqual(step, {
      kind: "press",
      locator: {
        chain: [{ method: "getByLabel", text: "New todo" }],
        fallbacks: [],
      },
      key: "Enter",
    });
    assert.equal(
      stepToSource(step!),
      'await page.getByLabel("New todo").press("Enter");',
    );
  });

  it("keeps a press with options, or with a computed key, as custom code", () => {
    const steps = stepsOf(
      wrap(
        'await page.getByLabel("x").press("Enter", { timeout: 1 });',
        'await page.getByLabel("x").press(key);',
      ),
    );
    assert.deepEqual(
      steps.map((step) => step.kind),
      ["custom", "custom"],
    );
  });

  it("emits canonical single-line statements", () => {
    assert.equal(
      stepToSource(SAMPLES[1]!),
      'await page.getByRole("button", { name: "Save" }).click();',
    );
    assert.equal(
      stepToSource(SAMPLES[4]!),
      'await page.getByTestId("pw").withFallbacks(page.getByLabel("Password"), page.getByText("pw")).fill(secrets.ADMIN_PASSWORD);',
    );
    assert.equal(
      stepToSource(SAMPLES[5]!),
      'await page.getByCss("x").fill(env["has-dash"]);',
    );
  });

  it("turns everything outside the set into custom steps, verbatim", () => {
    const source = wrap(
      'const link = page.locator("a");',
      "await link.click();",
      "await page.getByRole('button', { name: 'Go', exact: true }).click();",
      "await page.goto(url);",
      "await page.getByCss('x').fill(`a${b}`);",
      "await expect(page.getByCss('x')).toHaveCount(n);",
      "await page.getByCss('x').click({ force: true });",
      "await page.getByCss('a').withFallbacks(page.getByCss('b')).getByCss('c').click();",
    );
    const steps = stepsOf(source);
    assert.equal(steps.length, 8);
    assert.ok(steps.every((step) => step.kind === "custom"));
    assert.equal(
      (steps[0] as { code: string }).code,
      'const link = page.locator("a");',
    );
  });

  it("accepts single quotes and templates without substitutions", () => {
    const [step] = stepsOf(
      wrap("await page.getByTestId('a').click();", "await page.goto(`/x`);"),
    );
    assert.deepEqual(step, {
      kind: "click",
      locator: {
        chain: [{ method: "getByTestId", testId: "a" }],
        fallbacks: [],
      },
    });
  });

  it("finds tests inside describe blocks with their titles", () => {
    const source = `describe("A", () => { describe("B", () => { test("one", async ({ page }) => { await page.goto("/"); }); }); test("two", async () => {}); });`;
    const tests = parseSpec(source);
    assert.deepEqual(
      tests.map((t) => t.name),
      ["A > B > one", "A > two"],
    );
    assert.equal(tests[0]!.steps.length, 1);
    assert.equal(tests[1]!.steps.length, 0);
  });
});

describe("applyEdit", () => {
  const source = wrap(
    "await page.goto('/');",
    "// the button",
    "await page.getByCss('b').click();",
    "const x = 1; // keep",
  );

  it("replace changes only that statement", () => {
    const next = applyEdit(source, {
      op: "replace",
      test: 0,
      index: 0,
      step: { kind: "goto", url: "/home" },
    });
    assert.equal(
      next,
      source.replace("await page.goto('/');", 'await page.goto("/home");'),
    );
  });

  it("insert goes above the step and its comments, with the same indentation", () => {
    const next = applyEdit(source, {
      op: "insert",
      test: 0,
      index: 1,
      step: { kind: "waitForNetworkIdle" },
    });
    assert.equal(
      next,
      source.replace(
        "  // the button",
        "  await page.waitForNetworkIdle();\n  // the button",
      ),
    );
  });

  it("insert at the end appends after the last statement", () => {
    const next = applyEdit(source, {
      op: "insert",
      test: 0,
      index: 3,
      step: { kind: "waitForNetworkIdle" },
    });
    assert.equal(
      next,
      source.replace(
        "// keep\n",
        "// keep\n  await page.waitForNetworkIdle();\n",
      ),
    );
  });

  it("insert into an empty body", () => {
    const empty = `test("t", async () => {});\n`;
    const next = applyEdit(empty, {
      op: "insert",
      test: 0,
      index: 0,
      step: { kind: "goto", url: "/" },
    });
    assert.equal(
      next,
      `test("t", async () => {\n  await page.goto("/");\n});\n`,
    );
    assert.deepEqual(stepsOf(next), [{ kind: "goto", url: "/" }]);
  });

  it("remove deletes the statement's lines, comments included", () => {
    const next = applyEdit(source, { op: "remove", test: 0, index: 1 });
    assert.equal(
      next,
      source.replace(
        "  // the button\n  await page.getByCss('b').click();\n",
        "",
      ),
    );
  });

  it("move reorders and leaves the rest alone", () => {
    const next = applyEdit(source, { op: "move", test: 0, from: 0, to: 1 });
    const steps = stepsOf(next);
    assert.equal(steps[0]!.kind, "click");
    assert.equal(steps[1]!.kind, "goto");
    assert.equal(steps.length, 3);
    assert.match(next, /const x = 1; \/\/ keep/);
  });

  it("edits the right test of several", () => {
    const two = `test("a", async () => {\n  await page.goto("/a");\n});\ntest("b", async () => {\n  await page.goto("/b");\n});\n`;
    const next = applyEdit(two, {
      op: "replace",
      test: 1,
      index: 0,
      step: { kind: "goto", url: "/c" },
    });
    assert.equal(next, two.replace("/b", "/c"));
  });

  it("rejects out-of-range positions", () => {
    assert.throws(
      () => applyEdit(source, { op: "remove", test: 0, index: 9 }),
      RangeError,
    );
    assert.throws(
      () => applyEdit(source, { op: "remove", test: 4, index: 0 }),
      RangeError,
    );
    assert.throws(
      () =>
        applyEdit(source, {
          op: "insert",
          test: 0,
          index: 9,
          step: { kind: "waitForNetworkIdle" },
        }),
      RangeError,
    );
  });

  it("an edited file parses back to the edited steps", () => {
    let next = source;
    next = applyEdit(next, {
      op: "insert",
      test: 0,
      index: 0,
      step: { kind: "waitForNetworkIdle" },
    });
    next = applyEdit(next, { op: "remove", test: 0, index: 2 });
    assert.deepEqual(
      stepsOf(next).map((s) => s.kind),
      ["waitForNetworkIdle", "goto", "custom"],
    );
  });
});
