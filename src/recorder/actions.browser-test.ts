import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import { setContent } from "../testing/browser-fixture.js";
import { testBrowser } from "../testing/test-browser.js";
import { stepToSource } from "../steps/emit.js";
import { parseSpec } from "../steps/parse.js";
import { applyRecorderEvent } from "./apply.js";
import type { RecorderEvent } from "./recorder.js";

let browser: Browser;
let page: Page;

before(async () => {
  ({ browser, page } = await Browser.launch(testBrowser(), {
    port: 9301,
    headless: true,
  }));
  await page.navigateTo("about:blank", "complete");
});

after(async () => {
  await browser?.close();
});

const OPTIONS = { timeout: 30000 };
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Records while `act` runs, and returns the spec source the events make and the statements in it */
async function record(act: () => Promise<void>) {
  const events: RecorderEvent[] = [];
  const recorder = await page.record({
    onEvent: (event) => events.push(event),
    initialGoto: false,
  });
  await act();
  await pause(600);
  await recorder.stop();
  let source = `test("t", async ({ page }) => {\n});\n`;
  for (const event of events) source = applyRecorderEvent(source, 0, event);
  const steps = parseSpec(source)[0]!.steps.map(({ step }) => step);
  return { source, steps, code: steps.map(stepToSource) };
}

test(
  "records a checkbox and a radio as check, and a second click on the checkbox as uncheck",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<label for="a">Agree</label><input id="a" type="checkbox">
       <label>Newsletter <input type="checkbox" name="news"></label>
       <fieldset><label><input type="radio" name="size" value="s"> Small</label>
       <label><input type="radio" name="size" value="l"> Large</label></fieldset>
       <button id="go">Go</button>`,
    );
    const { source, steps, code } = await record(async () => {
      await page.getByLabel("Agree").click();
      await pause(300); // a second click on one element within 150 ms counts as the browser forwarding the first
      await page.getByLabel("Agree").click();
      await page.getByLabel("Newsletter").click();
      await page.getByLabel("Large").click();
      await page.getByCss("#go").click();
    });
    assert.deepEqual(
      steps.map((step) => step.kind),
      ["check", "uncheck", "check", "check", "click"],
      source,
    );
    assert.match(code[0]!, /Agree/);
    assert.match(code[2]!, /Newsletter/);
    assert.match(code[3]!, /Large/);
    // What was recorded left the page in the state the steps describe
    assert.equal(await page.getByLabel("Agree").isChecked(), false);
    assert.equal(await page.getByLabel("Newsletter").isChecked(), true);
    assert.equal(await page.getByLabel("Large").isChecked(), true);
  },
);

test(
  "records a click on a checkbox's label as check, whichever the browser flips first",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<input id="box" type="checkbox"><label for="box" id="lbl">Remember me</label>`,
    );
    const { source, steps } = await record(async () => {
      await page.getByCss("#lbl").click();
      // The recorder takes a second click on one element within 150 ms for the browser forwarding the first
      await pause(300);
      await page.getByCss("#lbl").click();
    });
    assert.deepEqual(
      steps.map((step) => step.kind),
      ["check", "uncheck"],
      source,
    );
  },
);

test("records a choice in a select as selectOption", OPTIONS, async () => {
  await setContent(
    page,
    `<label for="c">Country</label>
       <select id="c"><option value="">Pick</option><option value="nl">Netherlands</option><option value="be">Belgium</option></select>`,
  );
  const { source, steps } = await record(async () => {
    await page.getByLabel("Country").focus();
    await page.getByLabel("Country").press("ArrowDown");
    await page.getByLabel("Country").press("ArrowDown");
  });
  assert.deepEqual(
    steps.map((step) => step.kind),
    ["selectOption", "selectOption"],
    source,
  );
  assert.deepEqual(
    steps.map((step) => (step as { option: unknown }).option),
    [{ value: "nl" }, { value: "be" }],
  );
  assert.equal(await page.getByLabel("Country").inputValue(), "be");
});

test(
  "records the value an option gets from its text, and does not record a hover",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<label for="c">Size</label>
       <select id="c"><option>Small</option><option>Large</option></select>
       <button id="hover">Menu</button>`,
    );
    const { source, steps } = await record(async () => {
      await page.getByCss("#hover").hover();
      await page.getByLabel("Size").focus();
      await page.getByLabel("Size").press("ArrowDown");
    });
    assert.deepEqual(
      steps.map((step) => step.kind),
      ["selectOption"],
      source,
    );
    // An option with no value attribute has its text as the value
    assert.deepEqual((steps[0] as { option: unknown }).option, {
      value: "Large",
    });
  },
);
