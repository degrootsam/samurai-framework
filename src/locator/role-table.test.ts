import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACCESSIBLE_NAME_JS } from "./accessible-name.js";
import { ROLE_LOCATE } from "./role-locator.js";
import {
  NAME_FROM_CONTENT_ROLES,
  ROLE_OF_JS,
  TAG_ROLES,
} from "./role-table.js";

/** A fake element: the four members `roleOf` reads */
class Fake {
  parentElement: Fake | null = null;
  constructor(
    public localName: string,
    private attributes: Record<string, string> = {},
  ) {}
  inside(parent: Fake) {
    this.parentElement = parent;
    return this;
  }
  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }
  hasAttribute(name: string) {
    return name in this.attributes;
  }
}

const roleOf = new Function(`${ROLE_OF_JS}; return roleOf;`)() as (
  el: Fake,
) => string;
const role = (tag: string, attributes: Record<string, string> = {}) =>
  roleOf(new Fake(tag, attributes));

describe("roleOf", () => {
  it("maps tags with one role", () => {
    for (const [tag, expected] of Object.entries(TAG_ROLES)) {
      assert.equal(role(tag), expected, tag);
    }
    assert.equal(role("div"), "generic");
    assert.equal(role("span"), "generic");
    assert.equal(role("custom-element"), "");
  });

  it("gives links only to anchors with an href", () => {
    assert.equal(role("a", { href: "/x" }), "link");
    assert.equal(role("a"), "generic");
    assert.equal(role("area", { href: "/x" }), "link");
    assert.equal(role("area"), "");
  });

  it("maps input types, select, img and the table cells", () => {
    const input = (type?: string, more: Record<string, string> = {}) =>
      role("input", { ...(type !== undefined && { type }), ...more });
    assert.equal(input(), "textbox");
    assert.equal(input("EMAIL"), "textbox");
    assert.equal(input("password"), "textbox");
    assert.equal(input("checkbox"), "checkbox");
    assert.equal(input("radio"), "radio");
    assert.equal(input("submit"), "button");
    assert.equal(input("image"), "button");
    assert.equal(input("range"), "slider");
    assert.equal(input("number"), "spinbutton");
    assert.equal(input("search"), "searchbox");
    assert.equal(input("search", { list: "x" }), "combobox");
    assert.equal(input("text", { list: "x" }), "combobox");
    assert.equal(input("hidden"), "");
    assert.equal(input("file"), "");
    assert.equal(role("select"), "combobox");
    assert.equal(role("select", { multiple: "" }), "listbox");
    assert.equal(role("select", { size: "4" }), "listbox");
    assert.equal(role("select", { size: "1" }), "combobox");
    assert.equal(role("img", { alt: "Logo" }), "img");
    assert.equal(role("img", { alt: "" }), "presentation");
    assert.equal(role("th"), "columnheader");
    assert.equal(role("th", { scope: "row" }), "rowheader");
    assert.equal(role("td"), "cell");
    const grid = new Fake("table", { role: "grid" });
    assert.equal(roleOf(new Fake("td").inside(grid)), "gridcell");
  });

  it("gives section and form a role only with a name", () => {
    assert.equal(role("section"), "");
    assert.equal(role("section", { "aria-label": "News" }), "region");
    assert.equal(role("section", { "aria-labelledby": "h" }), "region");
    assert.equal(role("section", { "aria-label": " " }), "");
    assert.equal(role("form"), "");
    assert.equal(role("form", { "aria-label": "Search" }), "form");
  });

  it("makes header and footer landmarks only outside sectioning content", () => {
    assert.equal(role("header"), "banner");
    assert.equal(role("footer"), "contentinfo");
    const article = new Fake("article");
    assert.equal(roleOf(new Fake("header").inside(article)), "");
    const nested = new Fake("div").inside(new Fake("main"));
    assert.equal(roleOf(new Fake("footer").inside(nested)), "");
    const region = new Fake("div", { role: "region" });
    assert.equal(roleOf(new Fake("header").inside(region)), "");
  });

  it("lets the role attribute win, first token only, lower-cased", () => {
    assert.equal(role("div", { role: "button" }), "button");
    assert.equal(role("a", { href: "/x", role: "tab menuitem" }), "tab");
    assert.equal(role("div", { role: "  SWITCH " }), "switch");
    assert.equal(role("button", { role: "link" }), "link");
  });

  it("lists only roles that exist in the table or the special cases", () => {
    assert.ok(NAME_FROM_CONTENT_ROLES.includes("button"));
    assert.ok(NAME_FROM_CONTENT_ROLES.includes("heading"));
    assert.ok(!NAME_FROM_CONTENT_ROLES.includes("textbox"));
  });
});

describe("page-side sources", () => {
  it("ROLE_LOCATE is a function declaration", () => {
    assert.doesNotThrow(() => new Function(`return (${ROLE_LOCATE})`));
  });

  it("ACCESSIBLE_NAME_JS defines name, description and hidden helpers", () => {
    const api = new Function(
      `${ACCESSIBLE_NAME_JS}; return { accessibleName, accessibleDescription, isHidden, roleOf };`,
    )() as Record<string, unknown>;
    for (const key of [
      "accessibleName",
      "accessibleDescription",
      "isHidden",
      "roleOf",
    ]) {
      assert.equal(typeof api[key], "function", key);
    }
  });
});
