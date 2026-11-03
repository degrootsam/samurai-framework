import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import type Locator from "./locator.js";
import { setContent } from "../testing/browser-fixture.js";
import { testBrowser } from "../testing/test-browser.js";

let browser: Browser;
let page: Page;

before(async () => {
  ({ browser, page } = await Browser.launch(testBrowser(), {
    port: 9399,
    headless: true,
  }));
  await page.navigateTo("about:blank", "complete");
});

after(async () => {
  await browser?.close();
});

const OPTIONS = { timeout: 30000 };

const ids = async (locator: Locator) =>
  Promise.all((await locator.all()).map((item) => item.getAttribute("id")));

const BUTTONS = `
  <button id="save">Save draft</button>
  <button id="saveall">Save all</button>
  <button id="discard">Discard</button>
  <button id="upper">SAVE NOW</button>
  <div id="custom" role="button" aria-label="Custom action">x</div>`;

test(
  "getByRole with a string name keeps the browser's full, case-sensitive match",
  OPTIONS,
  async () => {
    await setContent(page, BUTTONS);
    assert.deepEqual(
      await ids(page.getByRole("button", { name: "Save draft" })),
      ["save"],
    );
    assert.deepEqual(
      await ids(page.getByRole("button", { name: "Save draft", exact: true })),
      ["save"],
    );
    assert.deepEqual(await ids(page.getByRole("button", { name: "Save" })), []);
    assert.deepEqual(
      await ids(page.getByRole("button", { name: "save draft" })),
      [],
    );
    assert.equal(await page.getByRole("button").count(), 5);
  },
);

test(
  "getByRole with a RegExp name tests the accessible name as written",
  OPTIONS,
  async () => {
    await setContent(page, BUTTONS);
    assert.deepEqual(await ids(page.getByRole("button", { name: /^save/i })), [
      "save",
      "saveall",
      "upper",
    ]);
    assert.deepEqual(await ids(page.getByRole("button", { name: /^Save/ })), [
      "save",
      "saveall",
    ]);
    assert.deepEqual(await ids(page.getByRole("button", { name: /custom/i })), [
      "custom",
    ]);
    assert.deepEqual(
      await ids(
        page.getByRole("button", { name: /^Save draft$/, exact: false }),
      ),
      ["save"],
    );
    // a global RegExp answers the same on every poll
    const global = page.getByRole("button", { name: /save/gi });
    assert.equal(await global.count(), 3);
    assert.equal(await global.count(), 3);
  },
);

test(
  "getByRole with exact:false is a case-insensitive substring of the name",
  OPTIONS,
  async () => {
    await setContent(page, BUTTONS);
    assert.deepEqual(
      await ids(page.getByRole("button", { name: "save", exact: false })),
      ["save", "saveall", "upper"],
    );
    assert.deepEqual(
      await ids(page.getByRole("button", { name: "ACTION", exact: false })),
      ["custom"],
    );
  },
);

test(
  "getByRole finds explicit roles, implicit roles and several kinds of controls",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<a id="l1" href="/x">Docs</a><a id="l2">No href</a>
     <input id="t1" type="text"><textarea id="t2"></textarea><input id="c1" type="checkbox">
     <nav id="n1">n</nav><ul id="u1"><li id="li1">one</li></ul>
     <section id="r1" aria-label="News">s</section><section id="r2">plain</section>
     <div id="x1" role="tab menuitem">Tab</div>`,
    );
    const named = { name: /./ };
    assert.deepEqual(await ids(page.getByRole("link", named)), ["l1"]);
    assert.deepEqual(
      await ids(page.getByRole("textbox", { exact: false, name: "" })),
      ["t1", "t2"],
    );
    assert.deepEqual(
      await ids(page.getByRole("checkbox", { includeHidden: true })),
      ["c1"],
    );
    assert.deepEqual(
      await ids(page.getByRole("navigation", { includeHidden: true })),
      ["n1"],
    );
    // a list item takes no name from its content
    assert.deepEqual(
      await ids(page.getByRole("listitem", { name: /one/ })),
      [],
    );
    assert.deepEqual(
      await ids(page.getByRole("listitem", { includeHidden: true })),
      ["li1"],
    );
    assert.deepEqual(await ids(page.getByRole("region", { name: /news/i })), [
      "r1",
    ]);
    assert.deepEqual(await ids(page.getByRole("tab", { name: /tab/i })), [
      "x1",
    ]);
    assert.deepEqual(
      await ids(page.getByRole("menuitem", { name: /tab/i })),
      [],
    );
  },
);

test("getByRole level matches h1 to h6 and aria-level", OPTIONS, async () => {
  await setContent(
    page,
    `<h1 id="a">One</h1><h2 id="b">Two</h2><h2 id="c">Also two</h2>
     <div id="d" role="heading" aria-level="3">Three</div><div id="e" role="heading">No level</div>`,
  );
  assert.deepEqual(await ids(page.getByRole("heading", { level: 2 })), [
    "b",
    "c",
  ]);
  assert.deepEqual(await ids(page.getByRole("heading", { level: 3 })), ["d"]);
  assert.deepEqual(
    await ids(page.getByRole("heading", { level: 2, name: /also/i })),
    ["c"],
  );
  assert.deepEqual(await ids(page.getByRole("heading", { level: 4 })), []);
  assert.equal(await page.getByRole("heading").count(), 5);
});

test(
  "getByRole checked, pressed, expanded, selected and disabled read element state and aria-*",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<input id="k1" type="checkbox" checked><input id="k2" type="checkbox"><input id="k3" type="checkbox">
     <div id="k4" role="checkbox" aria-checked="true">a</div><div id="k5" role="checkbox" aria-checked="mixed">b</div>
     <input id="r1" type="radio" checked><input id="r2" type="radio">
     <button id="p1" aria-pressed="true">P</button><button id="p2" aria-pressed="false">Q</button><button id="p3" aria-pressed="mixed">R</button><button id="p4">S</button>
     <button id="e1" aria-expanded="true">X1</button><button id="e2" aria-expanded="false">X2</button><button id="e3">X3</button>
     <div role="tablist"><div id="s1" role="tab" aria-selected="true">A</div><div id="s2" role="tab" aria-selected="false">B</div><div id="s3" role="tab">C</div></div>
     <select id="o"><option id="o1">One</option><option id="o2" selected>Two</option></select>
     <button id="d1" disabled>D</button><button id="d2">E</button><div id="d3" role="button" aria-disabled="true">F</div>
     <fieldset disabled><input id="d4"></fieldset><div aria-disabled="true"><button id="d5">inherited</button></div>`,
    );
    const intoIds = async (
      role: string,
      options: Parameters<typeof page.getByRole>[1],
    ) => ids(page.getByRole(role, options));
    {
      assert.deepEqual(await intoIds("checkbox", { checked: true }), [
        "k1",
        "k4",
      ]);
      assert.deepEqual(await intoIds("checkbox", { checked: false }), [
        "k2",
        "k3",
      ]);
      assert.deepEqual(await intoIds("checkbox", { checked: "mixed" }), ["k5"]);
      assert.deepEqual(await intoIds("radio", { checked: true }), ["r1"]);
      assert.deepEqual(await intoIds("button", { pressed: true }), ["p1"]);
      assert.deepEqual(await intoIds("button", { pressed: "mixed" }), ["p3"]);
      assert.deepEqual(
        await intoIds("button", { pressed: false, name: /[PQRS]/ }),
        ["p2", "p4"],
      );
      assert.deepEqual(await intoIds("button", { expanded: true }), ["e1"]);
      assert.deepEqual(
        await intoIds("button", { expanded: false, name: /^X/ }),
        ["e2", "e3"],
      );
      assert.deepEqual(await intoIds("tab", { selected: true }), ["s1"]);
      assert.deepEqual(await intoIds("tab", { selected: false }), ["s2", "s3"]);
      assert.deepEqual(await intoIds("option", { selected: true }), ["o2"]);
      assert.deepEqual(await intoIds("button", { disabled: true }), [
        "d1",
        "d3",
        "d5",
      ]);
      assert.deepEqual(await intoIds("textbox", { disabled: true }), ["d4"]);
      assert.deepEqual(
        await intoIds("button", { disabled: false, name: /^[DEF]$/ }),
        ["d2"],
      );
    }
  },
);

test(
  "getByRole leaves out hidden elements unless includeHidden is set",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<button id="v">Visible</button>
     <button id="h1" hidden>Attr</button>
     <button id="h2" style="display:none">Display</button>
     <button id="h3" style="visibility:hidden">Visibility</button>
     <div aria-hidden="true"><button id="h4">Aria</button></div>
     <div style="display:none"><button id="h5">Parent</button></div>
     <button id="o" style="opacity:0">Opacity</button>`,
    );
    assert.deepEqual(await ids(page.getByRole("button", { name: /./ })), [
      "v",
      "o",
    ]);
    assert.deepEqual(
      await ids(page.getByRole("button", { name: /./, includeHidden: true })),
      ["v", "h1", "h2", "h3", "h4", "h5", "o"],
    );
    assert.deepEqual(
      await ids(
        page.getByRole("button", { includeHidden: true, name: "Aria" }),
      ),
      ["h4"],
    );
    assert.deepEqual(
      await ids(page.getByRole("button", { name: "Aria", exact: false })),
      [],
    );
  },
);

test(
  "getByRole names: aria-labelledby, wrapping label, button content, hidden content",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<span id="lbl">Postcode</span><input id="z" aria-labelledby="lbl">
     <label>Phone number <input id="p"></label>
     <button id="b1">Add <b>to</b> cart <span hidden>secret</span></button>
     <input id="i1" placeholder="Search site">`,
    );
    assert.deepEqual(
      await ids(page.getByRole("textbox", { name: /^postcode$/i })),
      ["z"],
    );
    assert.deepEqual(
      await ids(
        page.getByRole("textbox", { name: "Phone number", exact: false }),
      ),
      ["p"],
    );
    assert.deepEqual(
      await ids(page.getByRole("textbox", { name: /^Phone number$/ })),
      ["p"],
    );
    assert.deepEqual(
      await ids(page.getByRole("button", { name: /^Add to cart$/ })),
      ["b1"],
    );
    assert.deepEqual(
      await ids(page.getByRole("button", { name: /secret/ })),
      [],
    );
    assert.deepEqual(
      await ids(page.getByRole("textbox", { name: /search/i })),
      ["i1"],
    );
  },
);

test(
  "getByRole composes with chaining, nth, first, last, filter and strict mode",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<ul id="menu"><li><a id="a1" href="#">Alpha</a></li><li><a id="a2" href="#">Beta</a></li><li><a id="a3" href="#">Gamma</a></li></ul>
     <p id="outside"><a id="a4" href="#">Alpha two</a></p>`,
    );
    const links = page.locator("#menu").getByRole("link", { name: /a$/ });
    assert.deepEqual(await ids(links), ["a1", "a2", "a3"]);
    assert.equal(await links.nth(1).getAttribute("id"), "a2");
    assert.equal(await links.first().getAttribute("id"), "a1");
    assert.equal(await links.last().getAttribute("id"), "a3");
    assert.equal(await links.nth(-2).getAttribute("id"), "a2");
    assert.deepEqual(await ids(links.filter({ hasText: "gam" })), ["a3"]);
    assert.deepEqual(await ids(page.getByRole("link", { name: /alpha/i })), [
      "a1",
      "a4",
    ]);
    assert.deepEqual(
      await ids(page.getByRole("listitem").getByRole("link", { name: /^B/ })),
      ["a2"],
    );
    await assert.rejects(
      page.getByRole("link", { name: /alpha/i }).strict().getAttribute("id"),
      /strict mode violation, 2 elements match/,
    );
    assert.equal(
      await page
        .getByRole("link", { name: /alpha/i })
        .first()
        .getAttribute("id"),
      "a1",
    );
  },
);

test(
  "getByRole auto-waits for an element that appears, and describes itself",
  OPTIONS,
  async () => {
    await setContent(page, `<div id="host"></div>`);
    await page.addInitScript(() => undefined);
    const late = page.getByRole("button", { name: /later/i });
    assert.equal(late.selector, "role=button[name=/later/i]");
    assert.equal(await late.count(), 0);
    setTimeout(() => {
      void setContent(page, `<button id="late">Later on</button>`);
    }, 200);
    await late.click({ timeout: 10000 });
  },
);
