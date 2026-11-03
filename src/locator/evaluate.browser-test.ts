import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import { ScriptError } from "../script/call-function.js";
import { setContent } from "../testing/browser-fixture.js";
import { testBrowser } from "../testing/test-browser.js";
import { ActionTimeoutError } from "./action-timeout-error.js";

let browser: Browser;
let page: Page;

before(async () => {
  ({ browser, page } = await Browser.launch(testBrowser(), {
    port: 9451,
    headless: true,
  }));
  await page.navigateTo("about:blank", "complete");
});

after(async () => {
  await browser?.close();
});

const OPTIONS = { timeout: 30000 };

test(
  "evaluate passes the element first and the argument second",
  OPTIONS,
  async () => {
    await setContent(page, `<p id="a" data-n="4">text</p>`);
    const result = await page
      .locator("p[@id='a']")
      .evaluate(
        (el, extra: { by: number }) => el.id + ":" + el.dataset.n * extra.by,
        { by: 3 },
      );
    assert.equal(result, "a:12");
  },
);

test(
  "evaluate can change the page and returns rich values",
  OPTIONS,
  async () => {
    await setContent(page, `<p id="a">text</p>`);
    const value = await page.locator("p[@id='a']").evaluate((el) => {
      el.textContent = "changed";
      return {
        when: new Date("2026-02-03T00:00:00.000Z"),
        tags: new Set([el.tagName]),
      };
    });
    assert.deepEqual(value, {
      when: new Date("2026-02-03T00:00:00.000Z"),
      tags: new Set(["P"]),
    });
    assert.equal(await page.locator("p[@id='a']").textContent(), "changed");
  },
);

test(
  "evaluate awaits a promise and takes a function's source",
  OPTIONS,
  async () => {
    await setContent(page, `<p id="a">text</p>`);
    const paragraph = page.locator("p[@id='a']");
    assert.equal(
      await paragraph.evaluate(async (el) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return el.textContent;
      }),
      "text",
    );
    assert.equal(
      await paragraph.evaluate("(el, n) => el.tagName + n", 1),
      "P1",
    );
  },
);

test("evaluate works on a hidden element", OPTIONS, async () => {
  await setContent(page, `<p id="a" style="display:none">secret</p>`);
  assert.equal(
    await page.locator("p[@id='a']").evaluate((el) => el.textContent),
    "secret",
  );
});

test("evaluate waits for an element that appears", OPTIONS, async () => {
  await setContent(
    page,
    ``,
    `setTimeout(() => { document.body.innerHTML = '<p id="late">here</p>'; }, 300);`,
  );
  assert.equal(
    await page
      .locator("p[@id='late']")
      .evaluate((el) => el.textContent, undefined, { timeout: 5000 }),
    "here",
  );
});

test(
  "evaluate on a missing element ends in the usual timeout error",
  OPTIONS,
  async () => {
    await setContent(page, `<p>other</p>`);
    const started = Date.now();
    await assert.rejects(
      page
        .locator("p[@id='missing']")
        .evaluate((el) => el.id, undefined, { timeout: 400 }),
      (err: Error) => {
        assert.ok(err instanceof ActionTimeoutError);
        assert.match(err.message, /evaluate/);
        assert.match(err.message, /missing/);
        return true;
      },
    );
    assert.ok(Date.now() - started < 5000);
  },
);

test(
  "evaluate follows strict selectors, and evaluateAll does not",
  OPTIONS,
  async () => {
    await setContent(page, `<ul><li>one</li><li>two</li></ul>`);
    const items = page.locator("li");
    assert.equal(await items.evaluate((el) => el.textContent), "one");
    await assert.rejects(
      items.strict().evaluate((el) => el.textContent),
      /evaluate\(\): strict mode violation, 2 elements match/,
    );
    page.setStrictSelectors(true);
    try {
      await assert.rejects(
        page.locator("li").evaluate((el) => el.textContent),
        /strict mode violation/,
      );
      assert.equal(
        await page.locator("li").evaluateAll((els) => els.length),
        2,
      );
    } finally {
      page.setStrictSelectors(undefined);
    }
  },
);

test("the page's error message is kept", OPTIONS, async () => {
  await setContent(page, `<p id="a">x</p>`);
  await assert.rejects(
    page.locator("p[@id='a']").evaluate(() => {
      throw new Error("locator boom");
    }),
    (err: Error) => {
      assert.ok(err instanceof ScriptError);
      assert.match(err.message, /locator boom/);
      assert.doesNotMatch(err.message, /Failed to locate/);
      return true;
    },
  );
});

test(
  "evaluateAll gets every match, or an empty array without waiting",
  OPTIONS,
  async () => {
    await setContent(page, `<ul><li>a</li><li>b</li><li>c</li></ul>`);
    assert.deepEqual(
      await page
        .locator("li")
        .evaluateAll(
          (els, upper: boolean) =>
            els.map((el) =>
              upper ? el.textContent.toUpperCase() : el.textContent,
            ),
          true,
        ),
      ["A", "B", "C"],
    );
    const started = Date.now();
    assert.equal(
      await page.locator("li[@class='none']").evaluateAll((els) => els.length),
      0,
    );
    assert.ok(Date.now() - started < 2000, "no waiting");
    assert.deepEqual(
      await page.locator("li[@class='none']").evaluateAll((els) => els),
      [],
    );
  },
);
