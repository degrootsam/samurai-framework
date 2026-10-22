import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import { setContent } from "../testing/browser-fixture.js";
import { testBrowser } from "../testing/test-browser.js";
import { AssertionError } from "./assertion-error.js";
import { expect } from "./expect.js";

let browser: Browser;
let page: Page;

before(async () => {
  ({ browser, page } = await Browser.launch(testBrowser(), {
    port: 9262,
    headless: true,
  }));
  await page.navigateTo("about:blank", "complete");
});

after(async () => {
  await browser?.close();
});

const OPTIONS = { timeout: 15000 };
const WAIT = { timeout: 3000 };

test(
  "toBeEnabled waits for a button that becomes enabled",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<button id="b" disabled>Go</button>`,
      `setTimeout(() => { document.getElementById("b").disabled = false; }, 300);`,
    );
    const button = page.locator("button[@id='b']");
    await expect(button).not.toBeEnabled(WAIT);
    await expect(button).toBeEnabled(WAIT);
    await expect(button)
      .not.toBeEnabled({ timeout: 0 })
      .then(
        () => {
          throw new Error(
            "expected not.toBeEnabled to fail on an enabled button",
          );
        },
        () => undefined,
      );
  },
);

test("toBeEnabled treats aria-disabled as disabled", OPTIONS, async () => {
  await setContent(page, `<div id="d" aria-disabled="true">x</div>`);
  await expect(page.locator("div[@id='d']")).not.toBeEnabled(WAIT);
});

test(
  "toBeChecked waits for a checkbox, and reads aria-checked",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<input id="c" type="checkbox"><input id="r" type="radio" checked>
     <div id="s" role="switch" aria-checked="true"></div><div id="o" role="switch" aria-checked="false"></div>`,
      `setTimeout(() => { document.getElementById("c").checked = true; }, 300);`,
    );
    await expect(page.locator("input[@id='c']")).not.toBeChecked({
      timeout: 0,
    });
    await expect(page.locator("input[@id='c']")).toBeChecked(WAIT);
    await expect(page.locator("input[@id='r']")).toBeChecked(WAIT);
    await expect(page.locator("div[@id='s']")).toBeChecked(WAIT);
    await expect(page.locator("div[@id='o']")).not.toBeChecked(WAIT);
  },
);

test(
  "toBeHidden waits for an element to hide and passes when it is missing",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<p id="p">Hello</p>`,
      `setTimeout(() => { document.getElementById("p").style.display = "none"; }, 300);`,
    );
    const paragraph = page.locator("p[@id='p']");
    await expect(paragraph).toBeVisible(WAIT);
    await expect(paragraph).toBeHidden(WAIT);
    await expect(paragraph).not.toBeVisible(WAIT);
    await expect(page.locator("p[@id='missing']")).toBeHidden(WAIT);
    await setContent(page, `<p id="p">Hello</p>`);
    await expect(paragraph).not.toBeHidden(WAIT);
  },
);

test(
  "toHaveClass normalises whitespace in strings and tests regexps as written",
  OPTIONS,
  async () => {
    await setContent(page, `<div id="d" class=" card  active "></div>`);
    const div = page.locator("div[@id='d']");
    await expect(div).toHaveClass("card active", WAIT);
    await expect(div).toHaveClass(/^ card/, WAIT);
    await expect(div).not.toHaveClass("card", WAIT);
  },
);

test(
  "toHaveCSS reads computed values, camelCase and custom properties",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<p id="p" style="color:red;background-color:rgb(0, 0, 255);--brand:blue">x</p>`,
    );
    const paragraph = page.locator("p[@id='p']");
    await expect(paragraph).toHaveCSS("color", "rgb(255, 0, 0)", WAIT);
    await expect(paragraph).toHaveCSS(
      "backgroundColor",
      "rgb(0, 0, 255)",
      WAIT,
    );
    await expect(paragraph).toHaveCSS("--brand", /blue/, WAIT);
    await expect(paragraph).not.toHaveCSS("color", "rgb(0, 0, 255)", WAIT);
  },
);

test(
  "toHaveURL resolves a path against the base URL and waits for the change",
  OPTIONS,
  async () => {
    const server = createServer((_req, res) => res.end("<title>x</title>"));
    await new Promise<void>((resolve) => server.listen(9263, resolve));
    try {
      await page.navigateTo("http://localhost:9263/a", "complete");
      page.setBaseURL("http://localhost:9263/");
      await setContent(
        page,
        "",
        `setTimeout(() => { history.replaceState(null, "", "/b#done"); }, 300);`,
      );
      await expect(page).not.toHaveURL("/b#done", { timeout: 0 });
      await expect(page).toHaveURL("/b#done", WAIT);
      await expect(page).toHaveURL(/#done$/, WAIT);
      await expect(page).toHaveURL("http://localhost:9263/b#done", WAIT);
      await expect(page).not.toHaveURL("/a", WAIT);
    } finally {
      page.setBaseURL(undefined);
      server.close();
      await page.navigateTo("about:blank", "complete");
    }
  },
);

test("toHaveTitle waits for a title set later", OPTIONS, async () => {
  await setContent(
    page,
    "",
    `setTimeout(() => { document.title = " Done "; }, 300);`,
  );
  await expect(page).toHaveTitle("Done", WAIT);
  await expect(page).toHaveTitle(/^Done$/, WAIT);
});

test(
  "a failing toHaveURL throws an AssertionError for the page",
  OPTIONS,
  async () => {
    await assert.rejects(
      expect(page).toHaveURL("https://nowhere.test/", { timeout: 200 }),
      (err: AssertionError) => {
        assert.ok(err instanceof AssertionError);
        assert.equal(err.matcher, "toHaveURL");
        assert.equal(err.locator, "page");
        return true;
      },
    );
  },
);
