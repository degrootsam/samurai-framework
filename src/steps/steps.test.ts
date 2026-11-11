import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stepToSource } from "./emit.js";
import type { Step } from "./model.js";
import { parseSpec } from "./parse.js";
import { stepsOf, wrap } from "../testing/spec-source.js";

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
    kind: "expect",
    locator: {
      chain: [{ method: "getByRole", role: "button", name: "Save" }],
      fallbacks: [],
    },
    not: false,
    expectation: { matcher: "toBeHidden" },
  },
  {
    kind: "expect",
    locator: {
      chain: [{ method: "getByRole", role: "button", name: "Save" }],
      fallbacks: [],
    },
    not: true,
    expectation: { matcher: "toBeEnabled" },
  },
  {
    kind: "expect",
    locator: {
      chain: [{ method: "getByRole", role: "button", name: "Save" }],
      fallbacks: [],
    },
    not: false,
    expectation: { matcher: "toBeChecked" },
  },
  {
    kind: "expect",
    locator: {
      chain: [{ method: "getByRole", role: "button", name: "Save" }],
      fallbacks: [],
    },
    not: false,
    expectation: { matcher: "toHaveClass", expected: "a b" },
  },
  {
    kind: "expect",
    locator: {
      chain: [{ method: "getByRole", role: "button", name: "Save" }],
      fallbacks: [],
    },
    not: false,
    expectation: {
      matcher: "toHaveClass",
      expected: { regex: { source: "active", flags: "" } },
    },
  },
  {
    kind: "expect",
    locator: {
      chain: [{ method: "getByRole", role: "button", name: "Save" }],
      fallbacks: [],
    },
    not: false,
    expectation: {
      matcher: "toHaveCSS",
      name: "color",
      expected: "rgb(255, 0, 0)",
    },
  },
  {
    kind: "expectPage",
    not: false,
    expectation: { matcher: "toHaveURL", expected: "/checkout" },
  },
  {
    kind: "expectPage",
    not: true,
    expectation: {
      matcher: "toHaveTitle",
      expected: { regex: { source: "Error", flags: "" } },
    },
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
  { kind: "waitForTimeout", ms: 2000 },
  { kind: "screenshot", name: "after-sign-in", fullPage: false },
  { kind: "screenshot", name: "whole", fullPage: true },
];

describe("step codec", () => {
  it("round-trips every step kind through source", () => {
    for (const step of SAMPLES) {
      const source = wrap(stepToSource(step));
      assert.deepEqual(stepsOf(source), [step], stepToSource(step));
    }
  });

  it("reads waits and screenshots, and keeps other shapes as custom code", () => {
    assert.equal(
      stepToSource({ kind: "waitForTimeout", ms: 1500 }),
      "await page.waitForTimeout(1500);",
    );
    assert.equal(
      stepToSource({ kind: "screenshot", name: "a", fullPage: true }),
      'await page.screenshot({ name: "a", fullPage: true });',
    );
    assert.equal(
      stepToSource({ kind: "screenshot", name: "a", fullPage: false }),
      'await page.screenshot({ name: "a" });',
    );
    const steps = stepsOf(
      wrap(
        "await page.waitForTimeout(ms);",
        "await page.waitForTimeout(1.5);",
        "await page.waitForTimeout(-1);",
        'await page.screenshot({ path: "x.png" });',
        "await page.screenshot();",
        'await page.screenshot({ name: "a", fullPage: false });',
      ),
    );
    assert.deepEqual(
      steps.map((s) => s.kind),
      ["custom", "custom", "custom", "custom", "custom", "screenshot"],
    );
    assert.deepEqual(steps[5], {
      kind: "screenshot",
      name: "a",
      fullPage: false,
    });
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
      "await page.getByRole('button', { name: 'Go', hidden: true }).click();",
      "await page.goto(url);",
      "await page.getByCss('x').fill(`a${b}`);",
      "await expect(page.getByCss('x')).toHaveCount(n);",
      "await page.getByCss('x').click({ force: true });",
      'await expect(page.getByCss("x")).toBeHidden({ timeout: 1 });',
      'await expect(page.getByCss("x")).toHaveCSS("color");',
      "await expect(page).toHaveURL(url);",
      'await expect(other).toHaveURL("/");',
      "await page.getByCss('a').withFallbacks(page.getByCss('b')).getByCss('c').click();",
    );
    const steps = stepsOf(source);
    assert.equal(steps.length, 12);
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
