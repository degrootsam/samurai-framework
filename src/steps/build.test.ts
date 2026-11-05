import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Page from "../browser/page.js";
import { remote, stubConnector } from "../testing/stub-connector.js";
import { locatorFromSpec } from "./build.js";
import type { LocatorCall } from "./model.js";

const page = () => new Page(stubConnector(remote(null)).connector, "ctx");

const build = (...chain: LocatorCall[]) =>
  locatorFromSpec(page(), { chain, fallbacks: [] }).selector;

describe("locatorFromSpec", () => {
  it("builds the same locator as the calls written out", () => {
    const p = page();
    const cases: [LocatorCall[], string][] = [
      [
        [{ method: "getByText", text: "a", exact: false }],
        p.getByText("a", { exact: false }).selector,
      ],
      [
        [
          {
            method: "getByLabel",
            text: { regex: { source: "a", flags: "i" } },
          },
        ],
        p.getByLabel(/a/i).selector,
      ],
      [
        [{ method: "getByPlaceholder", text: "a", exact: false }],
        p.getByPlaceholder("a", { exact: false }).selector,
      ],
      [[{ method: "getByAltText", text: "a" }], p.getByAltText("a").selector],
      [[{ method: "getByTitle", text: "a" }], p.getByTitle("a").selector],
      [
        [
          {
            method: "getByRole",
            role: "heading",
            name: { regex: { source: "^A", flags: "" } },
            level: 2,
            includeHidden: true,
          },
        ],
        p.getByRole("heading", { name: /^A/, level: 2, includeHidden: true })
          .selector,
      ],
      [
        [
          { method: "getByCss", css: "li" },
          { method: "filter", hasText: "paid" },
          { method: "nth", index: 1 },
        ],
        p.getByCss("li").filter({ hasText: "paid" }).nth(1).selector,
      ],
      [
        [{ method: "getByCss", css: "li" }, { method: "first" }],
        p.getByCss("li").first().selector,
      ],
      [
        [{ method: "getByCss", css: "li" }, { method: "last" }],
        p.getByCss("li").last().selector,
      ],
    ];
    for (const [chain, expected] of cases)
      assert.equal(build(...chain), expected);
  });

  it("refuses a narrowing call with nothing to narrow", () => {
    assert.throws(() => build({ method: "first" }), /needs a locator/);
  });
});
