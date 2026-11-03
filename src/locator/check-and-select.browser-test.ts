import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import { setContent } from "../testing/browser-fixture.js";
import { ActionTimeoutError } from "./action-timeout-error.js";
import { testBrowser } from "../testing/test-browser.js";

let browser: Browser;
let page: Page;

before(async () => {
  ({ browser, page } = await Browser.launch(testBrowser(), {
    port: 9400,
    headless: true,
  }));
  await page.navigateTo("about:blank", "complete");
});

after(async () => {
  await browser?.close();
});

const OPTIONS = { timeout: 20000 };

/** Counts the real pointer presses (`mousedown`; a label's follow-up click on its input is not one) in `body[data-clicks]` */
const COUNT_CLICKS = `
  document.body.dataset.clicks = "0";
  window.stopCounting?.();
  const count = (event) => {
    if (event.isTrusted) document.body.dataset.clicks = String(Number(document.body.dataset.clicks) + 1);
  };
  document.addEventListener("mousedown", count, true);
  window.stopCounting = () => document.removeEventListener("mousedown", count, true);`;

const clicks = async () =>
  Number(await page.locator("css=body").getAttribute("data-clicks"));

test(
  "check, uncheck and setChecked toggle a plain checkbox",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<input type="checkbox" id="a"><input type="checkbox" id="b" checked>`,
      COUNT_CLICKS,
    );
    const a = page.locator("css=#a");
    await a.check();
    assert.equal(await a.isChecked(), true);
    await a.uncheck();
    assert.equal(await a.isChecked(), false);
    await a.setChecked(true);
    assert.equal(await a.isChecked(), true);
    await a.setChecked(false);
    assert.equal(await a.isChecked(), false);
    assert.equal(await clicks(), 4);
    await page.locator("css=#b").uncheck();
    assert.equal(await page.locator("css=#b").isChecked(), false);
  },
);

test(
  "check on an already checked control does not click",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<input type="checkbox" id="a" checked><div role="switch" aria-checked="true" id="s">on</div>`,
      COUNT_CLICKS,
    );
    await page.locator("css=#a").check();
    await page.locator("css=#a").setChecked(true);
    await page.locator("css=#s").check();
    assert.equal(await clicks(), 0);
  },
);

test("radio buttons can be checked but not unchecked", OPTIONS, async () => {
  await setContent(
    page,
    `<input type="radio" name="r" id="a" checked><input type="radio" name="r" id="b">`,
  );
  await page.locator("css=#b").check();
  assert.equal(await page.locator("css=#b").isChecked(), true);
  assert.equal(await page.locator("css=#a").isChecked(), false);
  await assert.rejects(
    page.locator("css=#b").uncheck(),
    /^Error: uncheck\(\): a radio button cannot be unchecked$/,
  );
  await assert.rejects(
    page.locator("css=#b").setChecked(false),
    /setChecked\(\): a radio button cannot be unchecked/,
  );
});

test(
  "an opacity 0 input under its label is checked by clicking the label",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<div style="position:relative;width:120px;height:30px">
       <input type="checkbox" id="a" style="position:absolute;inset:0;width:100%;height:100%;opacity:0">
       <label for="a" id="l" style="position:absolute;inset:0;background:#ddd">Accept</label>
     </div>`,
      COUNT_CLICKS,
    );
    const box = page.locator("css=#a");
    await box.check();
    assert.equal(await box.isChecked(), true);
    await box.uncheck();
    assert.equal(await box.isChecked(), false);
    assert.equal(await clicks(), 2);
  },
);

test(
  "an input hidden behind a wrapping label is checked, also when display none",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<label style="display:block"><input type="checkbox" id="a" style="position:absolute;opacity:0;width:1px;height:1px"><span>Small</span></label>
     <label style="display:block"><input type="checkbox" id="b" style="display:none"><span>Gone</span></label>
     <input type="checkbox" id="c" style="display:none"><label for="c">Detached label</label>`,
      COUNT_CLICKS,
    );
    for (const id of ["a", "b", "c"]) {
      const input = page.locator(`css=#${id}`);
      await input.check();
      assert.equal(await input.isChecked(), true, id);
    }
    assert.equal(await clicks(), 3);
  },
);

test(
  "custom role=checkbox, switch and radio controls follow aria-checked",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<div role="checkbox" id="c" aria-checked="false" tabindex="0">c</div>
     <div role="switch" id="s" aria-checked="false" tabindex="0" style="opacity:0.99">s</div>
     <div role="radio" id="r" aria-checked="false" tabindex="0">r</div>`,
      `for (const el of document.querySelectorAll("[role]")) {
       el.addEventListener("click", () => el.setAttribute("aria-checked", String(el.getAttribute("aria-checked") !== "true")));
     }`,
    );
    const c = page.locator("css=#c");
    await c.check();
    assert.equal(await c.isChecked(), true);
    await c.uncheck();
    assert.equal(await c.isChecked(), false);
    await page.locator("css=#s").setChecked(true);
    assert.equal(await page.locator("css=#s").isChecked(), true);
    await page.locator("css=#r").check();
    await assert.rejects(
      page.locator("css=#r").uncheck(),
      /radio button cannot/,
    );
  },
);

test(
  "check fails clearly when the click does not change the state",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<input type="checkbox" id="a"><div role="checkbox" aria-checked="false" id="d">d</div>`,
      `document.getElementById("a").addEventListener("click", (e) => e.preventDefault());`,
    );
    await assert.rejects(
      page.locator("css=#a").check(),
      /^Error: check\(\): clicking the checkbox did not change its state$/,
    );
    await assert.rejects(
      page.locator("css=#d").check(),
      /check\(\): clicking the checkbox did not change its state/,
    );
  },
);

test("check on an element that is not checkable throws", OPTIONS, async () => {
  await setContent(
    page,
    `<button id="b">Go</button><input id="t" type="text">`,
  );
  for (const id of ["b", "t"]) {
    await assert.rejects(
      page.locator(`css=#${id}`).check(),
      /^Error: check\(\): element is not a checkbox, radio, or role=checkbox\/radio\/switch$/,
    );
  }
});

test("a disabled checkbox times out like click does", OPTIONS, async () => {
  await setContent(
    page,
    `<input type="checkbox" id="a" disabled>`,
    COUNT_CLICKS,
  );
  const box = page.locator("css=#a");
  await assert.rejects(box.check({ timeout: 400 }), (err) => {
    assert.ok(err instanceof ActionTimeoutError);
    assert.match(
      err.message,
      /^check\(\): css=#a was not actionable within 400ms/,
    );
    assert.match(err.message, /enabled ✗/);
    return true;
  });
  assert.equal(await clicks(), 0);
});

test(
  "check waits for a disabled checkbox to become enabled",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<input type="checkbox" id="a" disabled>`,
      `setTimeout(() => { document.getElementById("a").disabled = false; }, 300);`,
    );
    await page.locator("css=#a").check({ timeout: 5000 });
    assert.equal(await page.locator("css=#a").isChecked(), true);
  },
);

test("check with trial does not click", OPTIONS, async () => {
  await setContent(page, `<input type="checkbox" id="a">`, COUNT_CLICKS);
  await page.locator("css=#a").check({ trial: true });
  assert.equal(await page.locator("css=#a").isChecked(), false);
  assert.equal(await clicks(), 0);
});

test("an indeterminate checkbox is checked by check", OPTIONS, async () => {
  await setContent(
    page,
    `<input type="checkbox" id="a">`,
    `document.getElementById("a").indeterminate = true;`,
  );
  await page.locator("css=#a").check();
  assert.equal(await page.locator("css=#a").isChecked(), true);
});

test(
  "check composes with nth, filter and getByLabel, and honours strict mode",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<ul><li><label>One <input type="checkbox"></label></li>
     <li><label for="two">Two</label><input type="checkbox" id="two"></li>
     <li><label>Three <input type="checkbox"></label></li></ul>`,
    );
    const boxes = page.locator("css=input");
    await boxes.nth(2).check();
    assert.deepEqual(
      [
        await boxes.nth(0).isChecked(),
        await boxes.nth(1).isChecked(),
        await boxes.nth(2).isChecked(),
      ],
      [false, false, true],
    );
    await page
      .locator("css=li")
      .filter({ hasText: "One" })
      .locator("css=input")
      .check();
    assert.equal(await boxes.nth(0).isChecked(), true);
    await page.getByLabel("Two").check();
    assert.equal(await boxes.nth(1).isChecked(), true);
    await assert.rejects(
      boxes.strict().check({ timeout: 2000 }),
      /check\(\): strict mode violation, 3 elements match css=input/,
    );
    await assert.rejects(
      boxes.strict().uncheck({ timeout: 2000 }),
      /uncheck\(\): strict mode violation/,
    );
  },
);

const SELECTS = `
  <select id="s"><option value="a">Alpha</option><option value="b">Beta</option><option value="c" selected>Gamma</option></select>
  <select id="m" multiple><option value="x">Ex</option><option value="y">Why</option><option value="z">Zed</option></select>`;

/** Counts the input and change events of every select in `body[data-events]` as "input:change" per id */
const COUNT_EVENTS = `
  const seen = {};
  window.stopEvents?.();
  const stops = [];
  window.stopEvents = () => stops.forEach((stop) => stop());
  for (const type of ["input", "change"]) {
    const listener = (event) => {
      const key = event.target.id;
      seen[key] = seen[key] || { input: 0, change: 0 };
      seen[key][type] += 1;
      document.body.dataset.events = JSON.stringify(seen);
    };
    document.addEventListener(type, listener);
    stops.push(() => document.removeEventListener(type, listener));
  }`;

const events = async () =>
  JSON.parse(
    (await page.locator("css=body").getAttribute("data-events")) ?? "{}",
  );

test(
  "selectOption picks by value, label, index and object, returning the values",
  OPTIONS,
  async () => {
    await setContent(page, SELECTS);
    const select = page.locator("css=#s");
    assert.deepEqual(await select.selectOption("a"), ["a"]);
    assert.equal(await select.inputValue(), "a");
    assert.deepEqual(await select.selectOption("Beta"), ["b"]);
    assert.deepEqual(await select.selectOption({ index: 2 }), ["c"]);
    assert.deepEqual(await select.selectOption({ label: "Alpha" }), ["a"]);
    assert.deepEqual(await select.selectOption({ value: "b", label: "Beta" }), [
      "b",
    ]);
    assert.deepEqual(await select.selectOption([{ value: "c" }]), ["c"]);
    assert.equal(await select.inputValue(), "c");
  },
);

test(
  "selectOption on a multiple select replaces the selection",
  OPTIONS,
  async () => {
    await setContent(page, SELECTS);
    const select = page.locator("css=#m");
    assert.deepEqual(await select.selectOption(["x", "Zed"]), ["x", "z"]);
    assert.deepEqual(
      await select.selectOption([{ index: 1 }, { value: "z" }]),
      ["y", "z"],
    );
    assert.deepEqual(await select.selectOption([]), []);
  },
);

test(
  "selectOption fires input and change once each, bubbling",
  OPTIONS,
  async () => {
    await setContent(page, SELECTS, COUNT_EVENTS);
    await page.locator("css=#s").selectOption("b");
    await page.locator("css=#m").selectOption(["x", "y"]);
    assert.deepEqual(await events(), {
      s: { input: 1, change: 1 },
      m: { input: 1, change: 1 },
    });
  },
);

test(
  "selectOption throws for a missing option and for a non-select",
  OPTIONS,
  async () => {
    await setContent(page, `${SELECTS}<div id="d">x</div>`);
    await assert.rejects(
      page.locator("css=#s").selectOption("nope", { timeout: 500 }),
      /^Error: selectOption\(\): no option matches "nope" in css=#s within 500ms$/,
    );
    await assert.rejects(
      page
        .locator("css=#s")
        .selectOption({ value: "a", label: "Beta" }, { timeout: 300 }),
      /selectOption\(\): no option matches/,
    );
    await assert.rejects(
      page.locator("css=#d").selectOption("a"),
      /^Error: selectOption\(\): css=#d is not a <select>$/,
    );
    assert.equal(await page.locator("css=#s").inputValue(), "c");
  },
);

test(
  "selectOption waits for the option to appear and for the select to be enabled",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<select id="s" disabled><option value="a">A</option></select>`,
      `setTimeout(() => {
       const s = document.getElementById("s");
       s.disabled = false;
       s.add(new Option("Late", "late"));
     }, 300);`,
    );
    assert.deepEqual(
      await page.locator("css=#s").selectOption("late", { timeout: 5000 }),
      ["late"],
    );
  },
);

test(
  "selectOption composes with getByLabel and nth, and honours strict mode",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<label for="one">First</label><select id="one"><option>p</option><option>q</option></select>
     <select id="two"><option>p</option><option>q</option></select>`,
    );
    assert.deepEqual(await page.getByLabel("First").selectOption("q"), ["q"]);
    assert.deepEqual(
      await page.locator("css=select").nth(1).selectOption("q"),
      ["q"],
    );
    await assert.rejects(
      page.locator("css=select").strict().selectOption("p", { timeout: 1000 }),
      /selectOption\(\): strict mode violation, 2 elements match css=select/,
    );
  },
);
