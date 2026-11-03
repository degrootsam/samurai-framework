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
    port: 9397,
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

const TEXTS = `
  <p id="a">Save   draft</p>
  <p id="b">SAVE DRAFT now</p>
  <p id="c">Discard</p>
  <p id="d">save</p>`;

test(
  "getByText keeps the full, case-sensitive match by default, and exact:true is the same",
  OPTIONS,
  async () => {
    await setContent(page, TEXTS);
    assert.deepEqual(await ids(page.getByText("Save draft")), ["a"]);
    assert.deepEqual(await ids(page.getByText("Save draft", { exact: true })), [
      "a",
    ]);
    assert.deepEqual(await ids(page.getByText("save draft")), []);
    assert.deepEqual(await ids(page.getByText("Save")), []);
  },
);

test(
  "getByText with exact:false is a case-insensitive substring, whitespace normalised",
  OPTIONS,
  async () => {
    await setContent(page, TEXTS);
    assert.deepEqual(
      await ids(page.getByText("save draft", { exact: false })),
      ["a", "b"],
    );
    assert.deepEqual(await ids(page.getByText("SAVE", { exact: false })), [
      "a",
      "b",
      "d",
    ]);
  },
);

test(
  "getByText with a RegExp is tested as written, whatever exact says",
  OPTIONS,
  async () => {
    await setContent(page, TEXTS);
    assert.deepEqual(await ids(page.getByText(/^save draft$/i)), ["a"]);
    assert.deepEqual(await ids(page.getByText(/save/i)), ["a", "b", "d"]);
    assert.deepEqual(await ids(page.getByText(/save/)), ["d"]);
    assert.deepEqual(await ids(page.getByText(/^save$/, { exact: false })), [
      "d",
    ]);
    // a global RegExp gives the same answer on every poll
    const global = page.getByText(/save/gi);
    assert.equal(await global.count(), 3);
    assert.equal(await global.count(), 3);
  },
);

test(
  "getByLabel takes exact:false and RegExp, wrapping labels and aria-labelledby included",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<label for="e1">Email address</label><input id="e1">
       <label>Phone number <input id="p1"></label>
       <span id="lbl">Postcode</span><input id="z1" aria-labelledby="lbl">
       <input id="n1" aria-label="Nickname">`,
    );
    assert.deepEqual(await ids(page.getByLabel("Email")), []);
    assert.deepEqual(await ids(page.getByLabel("email", { exact: false })), [
      "e1",
    ]);
    assert.deepEqual(await ids(page.getByLabel(/phone/i)), ["p1"]);
    assert.deepEqual(await ids(page.getByLabel(/^Postcode$/)), ["z1"]);
    assert.deepEqual(await ids(page.getByLabel(/^nick/i)), ["n1"]);
    assert.deepEqual(await ids(page.getByLabel("Nickname")), ["n1"]);
  },
);

test(
  "getByPlaceholder, getByAltText and getByTitle: exact by default, exact:false and RegExp",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<input id="i1" placeholder="Your name"><input id="i2" placeholder="Your email">
       <img id="m1" alt="Company logo" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
       <button id="t1" title="Close dialog">x</button><span id="t2" title="Close">y</span>`,
    );
    assert.deepEqual(await ids(page.getByPlaceholder("Your name")), ["i1"]);
    assert.deepEqual(await ids(page.getByPlaceholder("your")), []);
    assert.deepEqual(
      await ids(page.getByPlaceholder("YOUR", { exact: false })),
      ["i1", "i2"],
    );
    assert.deepEqual(await ids(page.getByPlaceholder(/email$/)), ["i2"]);
    assert.deepEqual(await ids(page.getByAltText("Company logo")), ["m1"]);
    assert.deepEqual(await ids(page.getByAltText(/logo/i)), ["m1"]);
    assert.deepEqual(await ids(page.getByTitle("Close")), ["t2"]);
    assert.deepEqual(await ids(page.getByTitle("close", { exact: false })), [
      "t1",
      "t2",
    ]);
    assert.deepEqual(await ids(page.getByTitle(/dialog/)), ["t1"]);
  },
);

test(
  "the new matching composes with nth, filter and chaining, and strict mode counts the matches",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<ul><li id="l1">Apple pie</li><li id="l2">Apple tart</li><li id="l3">Pear</li></ul>
       <section id="s"><input id="q" placeholder="Search apples"></section>`,
    );
    const apples = page.getByText(/apple/i);
    assert.equal(await apples.nth(1).getAttribute("id"), "l2");
    assert.equal(await apples.last().getAttribute("id"), "l2");
    assert.deepEqual(await ids(apples.filter({ hasText: "tart" })), ["l2"]);
    assert.equal(
      await page
        .locator("#s")
        .getByPlaceholder("apples", { exact: false })
        .getAttribute("id"),
      "q",
    );
    assert.equal(await page.locator("#s").getByText(/apple/i).count(), 0);
    await assert.rejects(
      apples.strict().textContent(),
      /strict mode violation, 2 elements match/,
    );
  },
);
