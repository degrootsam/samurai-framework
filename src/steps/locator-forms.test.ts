import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stepToSource } from "./emit.js";
import type { LocatorCall, Step } from "./model.js";
import { stepsOf, wrap } from "../testing/spec-source.js";

const click = (...chain: LocatorCall[]): Step => ({
  kind: "click",
  locator: { chain, fallbacks: [] },
});

const regex = (source: string, flags = "") => ({ regex: { source, flags } });

/** A chain and the statement it is written as */
const FORMS: [LocatorCall[], string][] = [
  [
    [{ method: "getByText", text: "Save", exact: false }],
    `page.getByText("Save", { exact: false })`,
  ],
  [
    [{ method: "getByText", text: "Save", exact: true }],
    `page.getByText("Save", { exact: true })`,
  ],
  [
    [{ method: "getByLabel", text: "Email", exact: false }],
    `page.getByLabel("Email", { exact: false })`,
  ],
  [
    [
      {
        method: "getByLabel",
        text: "Email",
        exact: false,
        match: "full",
        ignoreCase: true,
      },
    ],
    `page.getByLabel("Email", { exact: false, match: "full", ignoreCase: true })`,
  ],
  [
    [{ method: "getByText", text: regex("^Sav(e|ing)$", "i") }],
    `page.getByText(/^Sav(e|ing)$/i)`,
  ],
  [[{ method: "getByLabel", text: regex("mail") }], `page.getByLabel(/mail/)`],
  [
    [{ method: "getByPlaceholder", text: "Search" }],
    `page.getByPlaceholder("Search")`,
  ],
  [
    [{ method: "getByPlaceholder", text: "Search", exact: false }],
    `page.getByPlaceholder("Search", { exact: false })`,
  ],
  [
    [{ method: "getByAltText", text: regex("logo", "i") }],
    `page.getByAltText(/logo/i)`,
  ],
  [
    [{ method: "getByTitle", text: "Close", exact: true }],
    `page.getByTitle("Close", { exact: true })`,
  ],
  [
    [{ method: "getByRole", role: "button", name: regex("^Save", "i") }],
    `page.getByRole("button", { name: /^Save/i })`,
  ],
  [
    [{ method: "getByRole", role: "button", name: "Save", exact: false }],
    `page.getByRole("button", { name: "Save", exact: false })`,
  ],
  [
    [{ method: "getByRole", role: "heading", name: "Intro", level: 2 }],
    `page.getByRole("heading", { name: "Intro", level: 2 })`,
  ],
  [
    [{ method: "getByRole", role: "checkbox", checked: true }],
    `page.getByRole("checkbox", { checked: true })`,
  ],
  [
    [{ method: "getByRole", role: "checkbox", checked: "mixed" }],
    `page.getByRole("checkbox", { checked: "mixed" })`,
  ],
  [
    [{ method: "getByRole", role: "button", pressed: false, expanded: true }],
    `page.getByRole("button", { pressed: false, expanded: true })`,
  ],
  [
    [
      {
        method: "getByRole",
        role: "option",
        selected: true,
        disabled: false,
        includeHidden: true,
      },
    ],
    `page.getByRole("option", { selected: true, disabled: false, includeHidden: true })`,
  ],
  [
    [
      { method: "getByCss", css: "li" },
      { method: "nth", index: 2 },
    ],
    `page.getByCss("li").nth(2)`,
  ],
  [
    [
      { method: "getByCss", css: "li" },
      { method: "nth", index: -1 },
    ],
    `page.getByCss("li").nth(-1)`,
  ],
  [
    [{ method: "getByCss", css: "li" }, { method: "first" }],
    `page.getByCss("li").first()`,
  ],
  [
    [{ method: "getByCss", css: "li" }, { method: "last" }],
    `page.getByCss("li").last()`,
  ],
  [
    [
      { method: "getByCss", css: "li" },
      { method: "filter", hasText: "paid" },
      { method: "first" },
    ],
    `page.getByCss("li").filter({ hasText: "paid" }).first()`,
  ],
  [
    [
      { method: "getByRole", role: "row" },
      { method: "filter", hasText: regex("^Ann", "i") },
      { method: "getByRole", role: "button", name: "Edit" },
    ],
    `page.getByRole("row").filter({ hasText: /^Ann/i }).getByRole("button", { name: "Edit" })`,
  ],
];

describe("locator forms in the codec", () => {
  it("writes and reads every form back unchanged", () => {
    for (const [chain, written] of FORMS) {
      const step = click(...chain);
      const code = `await ${written}.click();`;
      assert.equal(stepToSource(step), code);
      assert.deepEqual(stepsOf(wrap(code)), [step], code);
    }
  });

  it("reads the forms in any order of their options", () => {
    assert.deepEqual(
      stepsOf(
        wrap(
          `await page.getByRole("heading", { level: 1, name: "A" }).click();`,
          `await page.getByLabel("A", { ignoreCase: true, match: "partial", exact: false }).click();`,
        ),
      ),
      [
        click({ method: "getByRole", role: "heading", name: "A", level: 1 }),
        click({
          method: "getByLabel",
          text: "A",
          exact: false,
          match: "partial",
          ignoreCase: true,
        }),
      ],
    );
  });

  it("keeps the fallbacks of a chain with the new forms", () => {
    const step: Step = {
      kind: "click",
      locator: {
        chain: [{ method: "getByPlaceholder", text: "Q" }],
        fallbacks: [[{ method: "getByCss", css: "li" }, { method: "first" }]],
      },
    };
    const code = stepToSource(step);
    assert.equal(
      code,
      `await page.getByPlaceholder("Q").withFallbacks(page.getByCss("li").first());`.replace(
        ");",
        ").click();",
      ),
    );
    assert.deepEqual(stepsOf(wrap(code)), [step]);
  });

  it("keeps shapes it can't type as custom code", () => {
    for (const code of [
      // narrowing needs something to narrow
      `await page.first().click();`,
      `await page.nth(1).click();`,
      `await page.filter({ hasText: "a" }).click();`,
      // options that don't exist, or aren't literals
      `await page.getByText("a", { exact: "no" }).click();`,
      `await page.getByText("a", { exact: maybe }).click();`,
      `await page.getByText("a", { match: "some" }).click();`,
      `await page.getByText("a", { exact: false, exact: true }).click();`,
      `await page.getByPlaceholder("a", { match: "partial" }).click();`,
      // a RegExp is tested as written
      `await page.getByText(/a/, { exact: false }).click();`,
      `await page.getByRole("button", { name: /a/, exact: false }).click();`,
      `await page.getByPlaceholder(/a/, { exact: true }).click();`,
      // role options with the wrong value
      `await page.getByRole("heading", { level: 0 }).click();`,
      `await page.getByRole("heading", { level: 1.5 }).click();`,
      `await page.getByRole("heading", { level: "2" }).click();`,
      `await page.getByRole("checkbox", { checked: "yes" }).click();`,
      `await page.getByRole("button", { expanded: "mixed" }).click();`,
      `await page.getByRole("button", { name: 3 }).click();`,
      `await page.getByRole("button", { unknown: true }).click();`,
      `await page.getByRole("button", { ...rest }).click();`,
      // narrowing with something else
      `await page.getByCss("li").nth(1.5).click();`,
      `await page.getByCss("li").nth(index).click();`,
      `await page.getByCss("li").first(1).click();`,
      `await page.getByCss("li").filter({ hasNotText: "a" }).click();`,
      `await page.getByCss("li").filter({ hasText: "a", has: other }).click();`,
      `await page.getByCss("li").filter({}).click();`,
      // composition stays custom
      `await page.getByCss("li").and(page.getByCss("b")).click();`,
      `await page.getByCss("li").or(page.getByCss("b")).click();`,
      `await page.locator("li", { has: page.getByCss("b") }).click();`,
    ])
      assert.equal(stepsOf(wrap(code))[0]!.kind, "custom", code);
  });

  it("drops an empty options object, as it always did", () => {
    assert.deepEqual(stepsOf(wrap(`await page.getByText("a", {}).click();`)), [
      click({ method: "getByText", text: "a" }),
    ]);
  });
});
