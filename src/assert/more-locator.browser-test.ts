import assert from "node:assert/strict";
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
    port: 9460,
    headless: true,
  }));
  await page.navigateTo("about:blank", "complete");
});

after(async () => {
  await browser?.close();
});

const OPTIONS = { timeout: 20000 };
const WAIT = { timeout: 3000 };
const NOW = { timeout: 0 };

const one = (id: string) => page.locator(`*[@id='${id}']`);

/** The assertion rejects with an AssertionError named `matcher` */
async function fails(promise: Promise<void>, matcher: string) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof AssertionError, String(err));
    assert.equal(err.matcher, matcher);
    return true;
  });
}

test("toBeFocused follows focus() and Tab", OPTIONS, async () => {
  await setContent(page, `<input id="a"><input id="b"><div id="d">x</div>`);
  await expect(one("a")).not.toBeFocused(NOW);
  await one("a").focus();
  await expect(one("a")).toBeFocused(WAIT);
  await expect(one("b")).not.toBeFocused(WAIT);
  await one("a").press("Tab");
  await expect(one("b")).toBeFocused(WAIT);
  await expect(one("a")).not.toBeFocused(WAIT);
  await fails(expect(one("a")).toBeFocused({ timeout: 200 }), "toBeFocused");
  await assert.rejects(
    expect(one("none")).toBeFocused({ timeout: 200 }),
    /could not read/,
  );
});

test("toBeFocused waits for a focus that comes later", OPTIONS, async () => {
  await setContent(
    page,
    `<input id="a">`,
    `setTimeout(() => document.getElementById("a").focus(), 300);`,
  );
  await expect(one("a")).toBeFocused(WAIT);
});

test("toHaveJSProperty compares primitives and objects", OPTIONS, async () => {
  await setContent(
    page,
    `<input id="i" value="hi"><div id="d"></div>`,
    `const d = document.getElementById("d");
     d.count = 3; d.flag = true; d.label = "x"; d.data = { a: [1, 2], b: { c: null } };
     setTimeout(() => { d.count = 4; }, 300);`,
  );
  const d = one("d");
  await expect(d).toHaveJSProperty("flag", true, WAIT);
  await expect(d).toHaveJSProperty("label", "x", WAIT);
  await expect(d).toHaveJSProperty("data", { a: [1, 2], b: { c: null } }, WAIT);
  await expect(d).toHaveJSProperty("count", 4, WAIT);
  await expect(d).not.toHaveJSProperty("count", 3, WAIT);
  await expect(d).toHaveJSProperty("missing", undefined, WAIT);
  await expect(one("i")).toHaveJSProperty("value", "hi", WAIT);
  await expect(one("i")).toHaveJSProperty("tagName", "INPUT", WAIT);
  await assert.rejects(
    expect(d).toHaveJSProperty("label", "y", { timeout: 200 }),
    (err) => {
      assert.ok(err instanceof AssertionError);
      assert.equal(err.expected, "y");
      assert.equal(err.actual, "x");
      return true;
    },
  );
  await assert.rejects(
    expect(one("none")).toHaveJSProperty("a", 1, { timeout: 200 }),
    /could not read/,
  );
});

test(
  "toBeInViewport with a scrolled element and a ratio",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<div id="top" style="height:100px">top</div>
     <div style="height:4000px"></div>
     <div id="far" style="height:100px">far</div>
     <div id="gone" style="display:none">gone</div>
     <div id="edge" style="position:fixed;left:0;height:100px;width:100px;top:calc(100vh - 50px)">edge</div>`,
    );
    await page.evaluate("() => window.scrollTo(0, 0)");
    await expect(one("top")).toBeInViewport(WAIT);
    await expect(one("top")).toBeInViewport({ ratio: 1, timeout: 3000 });
    await expect(one("far")).not.toBeInViewport(WAIT);
    await fails(
      expect(one("far")).toBeInViewport({ timeout: 200 }),
      "toBeInViewport",
    );
    await expect(one("gone")).not.toBeInViewport(WAIT);
    // Half of the fixed box is below the viewport
    await expect(one("edge")).toBeInViewport({ ratio: 0.4, timeout: 3000 });
    await expect(one("edge")).not.toBeInViewport({ ratio: 0.9, timeout: 1000 });
    await page.evaluate(`() => window.scrollTo(0, document.body.scrollHeight)`);
    await expect(one("far")).toBeInViewport({ ratio: 1, timeout: 3000 });
    await expect(one("top")).not.toBeInViewport(WAIT);
    await assert.rejects(
      expect(one("none")).toBeInViewport({ timeout: 200 }),
      /could not read/,
    );
  },
);

test("toBeAttached and toBeDisabled and toBeEditable", OPTIONS, async () => {
  await setContent(
    page,
    `<button id="off" disabled>x</button><button id="on">x</button>
     <input id="rw"><input id="ro" readonly><div id="plain">x</div>`,
    `setTimeout(() => {
       const p = document.createElement("p"); p.id = "late"; document.body.append(p);
       document.getElementById("on").disabled = true;
     }, 300);`,
  );
  await expect(one("late")).not.toBeAttached(NOW);
  await expect(one("late")).toBeAttached(WAIT);
  await expect(one("late")).toBeAttached({ attached: true, timeout: 3000 });
  await expect(one("nothing")).not.toBeAttached(WAIT);
  await expect(one("nothing")).toBeAttached({ attached: false, timeout: 3000 });
  await fails(
    expect(one("nothing")).toBeAttached({ timeout: 200 }),
    "toBeAttached",
  );
  await fails(
    expect(one("late")).not.toBeAttached({ timeout: 200 }),
    "not.toBeAttached",
  );

  await expect(one("off")).toBeDisabled(WAIT);
  await expect(one("on")).toBeDisabled(WAIT);
  await expect(one("rw")).not.toBeDisabled(WAIT);
  await fails(expect(one("rw")).toBeDisabled({ timeout: 200 }), "toBeDisabled");
  await assert.rejects(
    expect(one("nothing")).toBeDisabled({ timeout: 200 }),
    /could not read/,
  );

  await expect(one("rw")).toBeEditable(WAIT);
  await expect(one("ro")).not.toBeEditable(WAIT);
  await expect(one("plain")).not.toBeEditable(WAIT);
  await expect(one("ro")).toBeEditable({ editable: false, timeout: 3000 });
  await fails(expect(one("ro")).toBeEditable({ timeout: 200 }), "toBeEditable");
  await assert.rejects(
    expect(one("nothing")).toBeEditable({ timeout: 200 }),
    /could not read/,
  );
});

test(
  "toHaveId, toBeEmpty and presence-only toHaveAttribute",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<div id="e"></div><div id="ws">  </div><div id="kid"><span></span></div>
     <div id="txt">a</div><input id="in"><input id="full" value="v" hidden>
     <textarea id="ta"></textarea>`,
    );
    await expect(one("e")).toHaveId("e", WAIT);
    await expect(one("e")).toHaveId(/^e$/, WAIT);
    await expect(one("e")).not.toHaveId("f", WAIT);
    await fails(expect(one("e")).toHaveId("f", { timeout: 200 }), "toHaveId");
    await assert.rejects(
      expect(one("none")).toHaveId("x", { timeout: 200 }),
      /could not read/,
    );

    await expect(one("e")).toBeEmpty(WAIT);
    await expect(one("ws")).toBeEmpty(WAIT);
    await expect(one("kid")).not.toBeEmpty(WAIT);
    await expect(one("txt")).not.toBeEmpty(WAIT);
    await expect(one("in")).toBeEmpty(WAIT);
    await expect(one("ta")).toBeEmpty(WAIT);
    await expect(one("full")).not.toBeEmpty(WAIT);
    await fails(expect(one("txt")).toBeEmpty({ timeout: 200 }), "toBeEmpty");
    await assert.rejects(
      expect(one("none")).toBeEmpty({ timeout: 200 }),
      /could not read/,
    );

    await expect(one("full")).toHaveAttribute("hidden", WAIT);
    await expect(one("full")).toHaveAttribute("value", WAIT);
    await expect(one("in")).not.toHaveAttribute("hidden", WAIT);
    await expect(one("none")).not.toHaveAttribute("hidden", WAIT);
    await fails(
      expect(one("in")).toHaveAttribute("hidden", { timeout: 200 }),
      "toHaveAttribute",
    );
  },
);

test(
  "toBeEnabled, toBeChecked and toBeVisible take their option",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<button id="off" disabled>x</button><button id="on">x</button>
     <input id="c" type="checkbox"><input id="k" type="checkbox" checked>
     <input id="m" type="checkbox"><div id="am" role="checkbox" aria-checked="mixed"></div>
     <div id="at" role="checkbox" aria-checked="true"></div>
     <div id="hid" style="display:none">x</div><div id="vis">x</div>`,
      `document.getElementById("m").indeterminate = true;`,
    );
    await expect(one("off")).toBeEnabled({ enabled: false, timeout: 3000 });
    await expect(one("on")).toBeEnabled({ enabled: true, timeout: 3000 });
    await fails(
      expect(one("on")).toBeEnabled({ enabled: false, timeout: 200 }),
      "toBeEnabled",
    );

    await expect(one("c")).toBeChecked({ checked: false, timeout: 3000 });
    await expect(one("k")).toBeChecked({ checked: true, timeout: 3000 });
    await expect(one("m")).toBeChecked({ checked: "mixed", timeout: 3000 });
    await expect(one("m")).toBeChecked({ indeterminate: true, timeout: 3000 });
    await expect(one("m")).not.toBeChecked({ timeout: 3000 });
    await expect(one("am")).toBeChecked({ checked: "mixed", timeout: 3000 });
    await expect(one("at")).not.toBeChecked({
      checked: "mixed",
      timeout: 3000,
    });
    await expect(one("k")).not.toBeChecked({ checked: "mixed", timeout: 3000 });
    await fails(
      expect(one("k")).toBeChecked({ checked: false, timeout: 200 }),
      "toBeChecked",
    );

    await expect(one("hid")).toBeVisible({ visible: false, timeout: 3000 });
    await expect(one("none")).toBeVisible({ visible: false, timeout: 3000 });
    await expect(one("vis")).toBeVisible({ visible: true, timeout: 3000 });
    await fails(
      expect(one("vis")).toBeVisible({ visible: false, timeout: 200 }),
      "toBeVisible",
    );
  },
);

test(
  "toHaveText and toContainText normalise whitespace and take arrays",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<p id="p">  Hello
      big    world </p>
     <ul><li> One </li><li>Two
        words</li><li>Three</li></ul>`,
      `setTimeout(() => { document.querySelector("li:last-child").textContent = "Last"; }, 300);`,
    );
    await expect(one("p")).toHaveText("Hello big world", WAIT);
    await expect(one("p")).toContainText("big world", WAIT);
    await expect(one("p")).not.toHaveText("Hello  big", WAIT);
    const items = page.locator("li");
    await expect(items).toHaveText(["One", "Two words", "Last"], WAIT);
    await expect(items).toHaveText(["One", /^Two/, "Last"], WAIT);
    await expect(items).toContainText(["One", "Last"], WAIT);
    await expect(items).toContainText(["wo w", "ast"], WAIT);
    await expect(items).not.toContainText(["Last", "One"], WAIT);
    await expect(items).not.toHaveText(["One", "Two words"], WAIT);
    await assert.rejects(
      expect(items).toHaveText(["One", "Two words"], { timeout: 200 }),
      (err) => {
        assert.ok(err instanceof AssertionError);
        assert.deepEqual(
          err.actual,
          ["One", "Two\n        words", "Last"].map((t) => t.trim()),
        );
        return true;
      },
    );
    await expect(page.locator("em")).toHaveText([], WAIT);
    await fails(
      expect(page.locator("em")).toHaveText(["x"], { timeout: 200 }),
      "toHaveText",
    );
  },
);
