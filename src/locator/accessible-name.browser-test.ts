import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import { setContent } from "../testing/browser-fixture.js";
import { testBrowser } from "../testing/test-browser.js";

let browser: Browser;
let page: Page;

before(async () => {
  ({ browser, page } = await Browser.launch(testBrowser(), {
    port: 9398,
    headless: true,
  }));
  await page.navigateTo("about:blank", "complete");
});

after(async () => {
  await browser?.close();
});

const OPTIONS = { timeout: 30000 };
const GIF = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

/** HTML with one element marked `id="t"`, its accessible name, and its description when it has one */
const NAMES: Array<
  [title: string, html: string, name: string, description?: string]
> = [
  ["button content", `<button id="t">Save <b>draft</b></button>`, "Save draft"],
  [
    "button content with nested spans and whitespace",
    `<button id="t"> A <span>  B </span>\n C </button>`,
    "A B C",
  ],
  [
    "inline children join without spaces",
    `<button id="t"><b>Hel</b>lo</button>`,
    "Hello",
  ],
  [
    "block children are separated",
    `<button id="t"><div>One</div><div>Two</div></button>`,
    "One Two",
  ],
  [
    "aria-label wins over content",
    `<button id="t" aria-label="Close">x</button>`,
    "Close",
  ],
  [
    "aria-labelledby wins over aria-label",
    `<span id="l">Pick</span><button id="t" aria-label="no" aria-labelledby="l">x</button>`,
    "Pick",
  ],
  [
    "aria-labelledby with several ids",
    `<i id="a">First</i><i id="b">Second</i><button id="t" aria-labelledby="a b">x</button>`,
    "First Second",
  ],
  [
    "aria-labelledby reads hidden content",
    `<span id="l" hidden>Secret</span><button id="t" aria-labelledby="l">x</button>`,
    "Secret",
  ],
  [
    "aria-labelledby to a missing id falls through",
    `<button id="t" aria-labelledby="nope">Own</button>`,
    "Own",
  ],
  [
    "aria-labelledby to itself",
    `<button id="t" aria-labelledby="t">Self</button>`,
    "Self",
  ],
  [
    "aria-labelledby loop between two elements",
    `<div id="a" aria-labelledby="b">A</div><button id="t" aria-labelledby="a">x</button>`,
    "A",
  ],
  [
    "aria-labelledby ignores the referenced element's own aria-labelledby",
    `<span id="a" aria-labelledby="b">Inner</span><span id="b">Other</span><button id="t" aria-labelledby="a">x</button>`,
    "Inner",
  ],
  ["label for", `<label for="t">Email</label><input id="t">`, "Email"],
  [
    "wrapping label excludes the control itself",
    `<label>Phone <input id="t" value="555"></label>`,
    "Phone",
  ],
  [
    "two labels",
    `<label for="t">First</label><label for="t">Last</label><input id="t">`,
    "First Last",
  ],
  [
    "label content with a nested control's value",
    `<label for="t">Pay <input value="5" size="2"> now</label><input id="t">`,
    "Pay 5 now",
  ],
  ["image alt", `<img id="t" alt="Logo" src="${GIF}">`, "Logo"],
  [
    "image title when alt is missing",
    `<img id="t" title="Tip" src="${GIF}">`,
    "Tip",
  ],
  [
    "image input alt",
    `<input id="t" type="image" alt="Go" src="${GIF}">`,
    "Go",
  ],
  [
    "area alt",
    `<map><area id="t" alt="Zone" href="/z" shape="rect" coords="0,0,1,1"></map>`,
    "Zone",
  ],
  ["input button value", `<input id="t" type="button" value="Press">`, "Press"],
  ["submit input default name", `<input id="t" type="submit">`, "Submit"],
  ["title as a last name", `<button id="t" title="Titled"></button>`, "Titled"],
  [
    "content wins over title",
    `<button id="t" title="Titled">Content</button>`,
    "Content",
    "Titled",
  ],
  [
    "placeholder as the last resort",
    `<input id="t" placeholder="Search">`,
    "Search",
  ],
  [
    "label wins over placeholder",
    `<label for="t">Query</label><input id="t" placeholder="Search">`,
    "Query",
  ],
  [
    "title wins over placeholder",
    `<input id="t" title="Tt" placeholder="Search">`,
    "Tt",
  ],
  [
    "hidden content is excluded",
    `<button id="t">Shown<span hidden>Hidden</span><span style="display:none">Gone</span><span aria-hidden="true">Aria</span></button>`,
    "Shown",
  ],
  [
    "visibility hidden content is excluded",
    `<button id="t">A<span style="visibility:hidden">B</span></button>`,
    "A",
  ],
  ["link content", `<a id="t" href="/x">Read <em>more</em></a>`, "Read more"],
  ["heading content", `<h2 id="t">Title <small>sub</small></h2>`, "Title sub"],
  ["a div has no name from content", `<div id="t">Words</div>`, ""],
  [
    "a div with a role that takes content",
    `<div id="t" role="tab">Tab one</div>`,
    "Tab one",
  ],
  [
    "checkbox label by content (role)",
    `<div id="t" role="checkbox">Agree</div>`,
    "Agree",
  ],
  [
    "fieldset legend",
    `<fieldset id="t"><legend>Address</legend><input></fieldset>`,
    "Address",
  ],
  [
    "table caption",
    `<table id="t"><caption>Totals</caption><tr><td>1</td></tr></table>`,
    "Totals",
  ],
  [
    "figure figcaption",
    `<figure id="t"><img alt="" src="${GIF}"><figcaption>Chart one</figcaption></figure>`,
    "Chart one",
  ],
  ["svg title", `<svg id="t" role="img"><title>Graph</title></svg>`, "Graph"],
  [
    "select with a label",
    `<label for="t">Size</label><select id="t"><option>S</option></select>`,
    "Size",
  ],
  [
    "embedded select in a label",
    `<label for="t">Pick <select><option>One</option><option selected>Two</option></select></label><input id="t">`,
    "Pick Two",
  ],
  [
    "whitespace is collapsed",
    `<button id="t" aria-label="  a   b  "></button>`,
    "a b",
  ],
  [
    "description from aria-describedby",
    `<p id="d">Needs <b>8</b> chars</p><input id="t" aria-label="Pass" aria-describedby="d">`,
    "Pass",
    "Needs 8 chars",
  ],
  [
    "description from several ids",
    `<i id="a">One</i><i id="b">Two</i><input id="t" aria-label="N" aria-describedby="a b">`,
    "N",
    "One Two",
  ],
  [
    "description from aria-description",
    `<input id="t" aria-label="N" aria-description="Hint">`,
    "N",
    "Hint",
  ],
  [
    "description from title when the name is not the title",
    `<button id="t" title="Extra">Go</button>`,
    "Go",
    "Extra",
  ],
  [
    "no description when the title is the name",
    `<button id="t" title="Only"></button>`,
    "Only",
    "",
  ],
  [
    "describedby reads hidden content",
    `<span id="d" hidden>Quiet</span><button id="t" aria-describedby="d">Go</button>`,
    "Go",
    "Quiet",
  ],
];

for (const [title, html, name, description] of NAMES) {
  test(`accessible name: ${title}`, OPTIONS, async () => {
    await setContent(page, html);
    const el = page.locator("#t");
    assert.equal(await el.accessibleName(), name);
    if (description !== undefined) {
      assert.equal(await el.accessibleDescription(), description);
    }
  });
}

test(
  "accessible name and description of a missing element are null",
  OPTIONS,
  async () => {
    await setContent(page, "");
    assert.equal(await page.locator("#nothing").accessibleName(), null);
    assert.equal(await page.locator("#nothing").accessibleDescription(), null);
  },
);
