import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import { setContent } from "../testing/browser-fixture.js";
import { testBrowser } from "../testing/test-browser.js";

let browser: Browser;
let page: Page;

before(async () => {
  ({ browser, page } = await Browser.launch(testBrowser(), {
    port: 9452,
    headless: true,
  }));
  await page.navigateTo("about:blank", "complete");
});

after(async () => {
  await browser?.close();
});

const OPTIONS = { timeout: 30000 };

test("innerText and innerHTML read nested markup", OPTIONS, async () => {
  await setContent(
    page,
    `<div id="n"><b>bold</b> text<br>second <i>line</i></div>`,
  );
  const node = page.locator("div[@id='n']");
  assert.equal(await node.innerText(), "bold text\nsecond line");
  assert.equal(
    await node.innerHTML(),
    "<b>bold</b> text<br>second <i>line</i>",
  );
});

test(
  "innerText leaves out hidden descendants; textContent keeps them",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<div id="n">shown<span style="display:none">hidden</span></div>`,
    );
    const node = page.locator("div[@id='n']");
    assert.equal(await node.innerText(), "shown");
    assert.equal(await node.textContent(), "shownhidden");
  },
);

test(
  "innerText of a display:none element is its text content",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<p id="h" style="display:none">  not rendered </p>`,
    );
    assert.equal(
      await page.locator("p[@id='h']").innerText(),
      "  not rendered ",
    );
    assert.equal(
      await page.locator("p[@id='h']").innerHTML(),
      "  not rendered ",
    );
  },
);

test(
  "the single reads answer null for a missing element",
  OPTIONS,
  async () => {
    await setContent(page, `<p>x</p>`);
    const missing = page.locator("p[@id='none']");
    assert.equal(await missing.innerText(), null);
    assert.equal(await missing.innerHTML(), null);
    assert.equal(await missing.boundingBox(), null);
  },
);

test(
  "allTextContents and allInnerTexts read every match, untrimmed",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<ul><li> one </li><li>two<span style="display:none">!</span></li><li></li></ul>`,
    );
    const items = page.locator("li");
    assert.deepEqual(await items.allTextContents(), [" one ", "two!", ""]);
    assert.deepEqual(await items.allInnerTexts(), ["one", "two", ""]);
    assert.equal(
      await items.first().textContent(),
      "one",
      "textContent() trims",
    );
  },
);

test(
  "allTextContents answers [] without waiting when nothing matches",
  OPTIONS,
  async () => {
    await setContent(page, `<p>x</p>`);
    const started = Date.now();
    assert.deepEqual(await page.locator("li").allTextContents(), []);
    assert.deepEqual(await page.locator("li").allInnerTexts(), []);
    assert.ok(Date.now() - started < 2000);
  },
);

test(
  "boundingBox returns the box in viewport coordinates",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<div id="card" style="position:fixed;top:100px;left:20px;width:120px;height:80px"></div>`,
    );
    assert.deepEqual(await page.locator("div[@id='card']").boundingBox(), {
      x: 20,
      y: 100,
      width: 120,
      height: 80,
    });
  },
);

test(
  "boundingBox is null for an element that is not rendered, a box for a merely invisible one",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<div id="none" style="display:none">x</div>` +
        `<div id="ghost" style="visibility:hidden;width:50px;height:10px"></div>` +
        `<div id="empty" style="width:0;height:0"></div>`,
    );
    assert.equal(await page.locator("div[@id='none']").boundingBox(), null);
    const ghost = await page.locator("div[@id='ghost']").boundingBox();
    assert.equal(ghost?.width, 50);
    assert.equal(ghost?.height, 10);
    const empty = await page.locator("div[@id='empty']").boundingBox();
    assert.equal(empty?.width, 0);
  },
);

test("boundingBox does not scroll", OPTIONS, async () => {
  await setContent(
    page,
    `<div style="height:3000px"></div><div id="far" style="width:10px;height:10px"></div>`,
  );
  const box = await page.locator("div[@id='far']").boundingBox();
  assert.ok(box && box.y >= 3000);
});
