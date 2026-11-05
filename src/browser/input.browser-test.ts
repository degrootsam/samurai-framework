import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Browser } from "./browser.js";
import type Page from "./page.js";
import { setContent } from "../testing/browser-fixture.js";
import { testBrowser } from "../testing/test-browser.js";

let browser: Browser;
let page: Page;

before(async () => {
  ({ browser, page } = await Browser.launch(testBrowser(), {
    port: 9461,
    headless: true,
  }));
  await page.navigateTo("about:blank", "complete");
});

after(async () => {
  await browser?.close();
});

const OPTIONS = { timeout: 30000 };

/** Logs the events of #field in order, in `window.log` */
const LOG_KEYS = `
  window.log = [];
  const field = document.getElementById("field");
  for (const type of ["keydown", "keyup", "input", "beforeinput"]) {
    field.addEventListener(type, (event) => window.log.push(type + ":" + (event.key ?? event.inputType)));
  }
  field.focus();`;

const read = (expression: string) => page.evaluate<any>(expression);

test(
  "keyboard.type types into the focused field, press sends named keys",
  OPTIONS,
  async () => {
    await setContent(page, `<input id="field">`, LOG_KEYS);
    await page.keyboard.type("hi");
    await page.keyboard.press("Backspace");
    assert.equal(await read(`document.getElementById("field").value`), "h");
    assert.equal(
      await read(`window.log.filter((e) => e.startsWith("key")).join()`),
      "keydown:h,keyup:h,keydown:i,keyup:i,keydown:Backspace,keyup:Backspace",
    );
  },
);

test(
  "keyboard.press takes a chord: Control+a selects all, the next key replaces it",
  OPTIONS,
  async () => {
    await setContent(page, `<input id="field" value="hello">`, LOG_KEYS);
    await page.keyboard.press("Control+a");
    await page.keyboard.type("x");
    assert.equal(await read(`document.getElementById("field").value`), "x");
  },
);

test(
  "keyboard.press with Shift+Tab moves focus to the previous field",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<input id="a"><input id="field">`,
      `document.getElementById("field").focus();`,
    );
    await page.keyboard.press("Shift+Tab");
    assert.equal(await read(`document.activeElement.id`), "a");
  },
);

test(
  "keyboard.press with Meta or ControlOrMeta sends the modifier",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<input id="field">`,
      `window.keys = []; document.getElementById("field").addEventListener("keydown", (e) => window.keys.push(e.key + ":" + e.metaKey + ":" + e.ctrlKey)); document.getElementById("field").focus();`,
    );
    await page.keyboard.press("Meta+Enter");
    await page.keyboard.press("ControlOrMeta+Enter");
    const keys = await read(
      `window.keys.filter((k) => k.startsWith("Enter")).join()`,
    );
    assert.match(keys, /^Enter:true:false,Enter:(true:false|false:true)$/);
  },
);

test(
  "keyboard.down keeps Shift in effect until keyboard.up",
  OPTIONS,
  async () => {
    await setContent(page, `<input id="field">`, LOG_KEYS);
    await page.keyboard.down("Shift");
    await page.keyboard.press("a");
    await page.keyboard.up("Shift");
    await page.keyboard.press("a");
    assert.equal(await read(`document.getElementById("field").value`), "Aa");
  },
);

test(
  "keyboard.press waits between key down and up with delay",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<input id="field">`,
      `const times = {}; window.times = times;
     const field = document.getElementById("field");
     field.addEventListener("keydown", () => { times.down = performance.now(); });
     field.addEventListener("keyup", () => { times.up = performance.now(); });
     field.focus();`,
    );
    await page.keyboard.press("a", { delay: 300 });
    const gap = Number(
      await read(`String(window.times.up - window.times.down)`),
    );
    assert.ok(gap >= 250, `gap was ${gap}ms`);
  },
);

test(
  "keyboard.insertText inserts at the caret without key events",
  OPTIONS,
  async () => {
    await setContent(page, `<input id="field" value="ac">`, LOG_KEYS);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.insertText("b");
    assert.equal(await read(`document.getElementById("field").value`), "abc");
    assert.equal(
      await read(`window.log.filter((e) => e.startsWith("input")).join()`),
      "input:insertText",
    );
    assert.equal(
      await read(`window.log.filter((e) => e === "keydown:b").length`),
      0,
    );
  },
);

test(
  "keyboard.insertText works in a contenteditable element",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<div id="field" contenteditable="true"></div>`,
      `document.getElementById("field").focus();`,
    );
    await page.keyboard.insertText("hello");
    assert.equal(
      await read(`document.getElementById("field").textContent`),
      "hello",
    );
  },
);

test("keyboard.press names an unknown key", OPTIONS, async () => {
  await assert.rejects(
    page.keyboard.press("Hyper"),
    /^Error: keyboard\.press\(\): unknown key "Hyper"/,
  );
  await assert.rejects(
    page.keyboard.down("Control+a"),
    /keyboard\.down\(\): "Control\+a" is a chord/,
  );
});

/** Logs mouse events with their trust and the button in `window.log` */
const LOG_MOUSE = `
  window.log = [];
  const box = document.getElementById("box");
  for (const type of ["mousedown", "mouseup", "click", "dblclick", "contextmenu", "mouseover", "mousemove"]) {
    box.addEventListener(type, (e) => window.log.push(type + ":" + e.button + ":" + e.detail + ":" + e.isTrusted + ":" + e.clientX + "," + e.clientY));
  }`;
const BOX = `<div id="box" style="position:fixed;left:100px;top:100px;width:200px;height:100px;background:#ccd"></div>`;

test(
  "mouse.click clicks at the coordinates with real input",
  OPTIONS,
  async () => {
    await setContent(page, BOX, LOG_MOUSE);
    await page.mouse.click(150, 130);
    assert.equal(
      await read(
        `window.log.filter((e) => !e.startsWith("mouseover") && !e.startsWith("mousemove")).join()`,
      ),
      "mousedown:0:1:true:150,130,mouseup:0:1:true:150,130,click:0:1:true:150,130",
    );
  },
);

test("mouse.click takes a button and a click count", OPTIONS, async () => {
  await setContent(page, BOX, LOG_MOUSE);
  await page.mouse.click(150, 130, { button: "right" });
  await page.mouse.click(150, 130, { clickCount: 3 });
  const log = await read(`window.log.join()`);
  assert.match(log, /contextmenu:2:/);
  assert.match(log, /click:0:3:true/);
});

test("mouse.dblclick fires dblclick", OPTIONS, async () => {
  await setContent(page, BOX, LOG_MOUSE);
  await page.mouse.dblclick(150, 130);
  assert.match(await read(`window.log.join()`), /dblclick:0:2:true/);
});

test(
  "mouse.down and mouse.up press and release where the mouse is",
  OPTIONS,
  async () => {
    await setContent(page, BOX, LOG_MOUSE);
    await page.mouse.move(150, 130);
    await page.mouse.down();
    assert.equal(
      await read(
        `window.log.filter((e) => e.startsWith("mousedown")).length + ":" + window.log.filter((e) => e.startsWith("mouseup")).length`,
      ),
      "1:0",
    );
    await page.mouse.up();
    assert.match(await read(`window.log.join()`), /mouseup:0:1:true:150,130/);
  },
);

test(
  "mouse.move reports each step and ends on the target",
  OPTIONS,
  async () => {
    await setContent(page, BOX, LOG_MOUSE);
    await page.mouse.move(110, 110);
    await read(`void (window.log.length = 0)`);
    await page.mouse.move(210, 110, { steps: 4 });
    const moves = (
      await read(
        `window.log.filter((e) => e.startsWith("mousemove")).map((e) => e.split(":")[4]).join(";")`,
      )
    ).split(";");
    assert.deepEqual(moves, ["135,110", "160,110", "185,110", "210,110"]);
  },
);

test("mouse.move hovers: the :hover style applies", OPTIONS, async () => {
  await setContent(
    page,
    `<style>#box:hover { background: rgb(255, 0, 0) !important }</style>${BOX}`,
  );
  await page.mouse.move(150, 130);
  assert.equal(
    await read(
      `getComputedStyle(document.getElementById("box")).backgroundColor`,
    ),
    "rgb(255, 0, 0)",
  );
});

test("mouse.wheel scrolls the element under the pointer", OPTIONS, async () => {
  await setContent(
    page,
    `<div id="box" style="position:fixed;left:100px;top:100px;width:200px;height:100px;overflow:auto"><div style="height:2000px">tall</div></div>`,
  );
  // Firefox hit-tests a wheel against the last real pointer move: the page was replaced under a pointer that has not moved
  await page.mouse.move(10, 10);
  await page.mouse.move(150, 130);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(300);
  const top = Number(
    await read(`String(document.getElementById("box").scrollTop)`),
  );
  assert.ok(top > 0, `scrollTop was ${top}`);
});

test("mouse methods name themselves in errors", OPTIONS, async () => {
  await assert.rejects(
    page.mouse.move(NaN, 1),
    /^Error: mouse\.move\(\): x and y must be numbers/,
  );
  await assert.rejects(
    page.mouse.click(1, 1, { button: "back" as never }),
    /mouse\.click\(\): unknown button "back"/,
  );
});
