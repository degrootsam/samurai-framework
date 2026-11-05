import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import { setContent } from "../testing/browser-fixture.js";
import { testBrowser } from "../testing/test-browser.js";
import { ActionTimeoutError } from "./action-timeout-error.js";

let browser: Browser;
let page: Page;

before(async () => {
  ({ browser, page } = await Browser.launch(testBrowser(), {
    port: 9462,
    headless: true,
  }));
  await page.navigateTo("about:blank", "complete");
});

after(async () => {
  await browser?.close();
});

const OPTIONS = { timeout: 30000 };
const read = (expression: string) => page.evaluate<any>(expression);

/** Logs the events of #b in order in `window.log`, as `type:button:detail:trusted:shift` */
const LOG_BUTTON = `
  window.log = [];
  const b = document.getElementById("b");
  for (const type of ["mousedown", "mouseup", "click", "dblclick", "contextmenu"]) {
    b.addEventListener(type, (e) => window.log.push([type, e.button, e.detail, e.isTrusted, e.shiftKey].join(":")));
  }`;
const BUTTON = `<button id="b" style="position:fixed;left:50px;top:50px;width:200px;height:100px">Go</button>`;

test("click takes a button, modifiers and a click count", OPTIONS, async () => {
  await setContent(page, BUTTON, LOG_BUTTON);
  const button = page.locator("button[@id='b']");
  await button.click({ button: "right" });
  await button.click({ modifiers: ["Shift"] });
  await button.click({ clickCount: 3 });
  const log: string[] = await read(`window.log`);
  assert.ok(
    log.some((e) => e.startsWith("contextmenu:2:")),
    log.join(),
  );
  assert.ok(log.includes("click:0:1:true:true"), "click with Shift held");
  assert.ok(log.includes("click:0:3:true:false"), "third click of three");
  // The modifier is let go again
  await button.click();
  assert.equal((await read(`window.log`)).at(-1), "click:0:1:true:false");
});

test(
  "click at a position hits that point of the element",
  OPTIONS,
  async () => {
    await setContent(
      page,
      BUTTON,
      `window.at = null; document.getElementById("b").addEventListener("click", (e) => { window.at = e.clientX + "," + e.clientY; });`,
    );
    await page.locator("button[@id='b']").click({ position: { x: 10, y: 20 } });
    assert.equal(await read(`window.at`), "60,70");
  },
);

test(
  "click at a position waits for that point to be uncovered",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `${BUTTON}<div id="cover" style="position:fixed;left:50px;top:50px;width:30px;height:30px"></div>`,
    );
    const button = page.locator("button[@id='b']");
    // The centre is free, the corner under the cover is not
    await button.click({ timeout: 2000 });
    await assert.rejects(
      button.click({ position: { x: 5, y: 5 }, timeout: 500 }),
      (err) =>
        err instanceof ActionTimeoutError && /hit target/.test(err.message),
    );
  },
);

test("click holds for delay between press and release", OPTIONS, async () => {
  await setContent(
    page,
    BUTTON,
    `window.t = {}; const b = document.getElementById("b");
     b.addEventListener("mousedown", () => { window.t.down = performance.now(); });
     b.addEventListener("mouseup", () => { window.t.up = performance.now(); });`,
  );
  await page.locator("button[@id='b']").click({ delay: 300 });
  assert.ok(Number(await read(`window.t.up - window.t.down`)) >= 250);
});

test("dblclick fires a double click", OPTIONS, async () => {
  await setContent(page, BUTTON, LOG_BUTTON);
  await page.locator("button[@id='b']").dblclick();
  assert.ok((await read(`window.log`)).includes("dblclick:0:2:true:false"));
});

test(
  "hover applies :hover and fires mouseover, without clicking",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<style>#b:hover { background: rgb(255, 0, 0) !important }</style>${BUTTON}`,
      `window.log = []; const b = document.getElementById("b");
     b.addEventListener("mouseover", () => window.log.push("over"));
     b.addEventListener("click", () => window.log.push("click"));`,
    );
    await page.locator("button[@id='b']").hover();
    assert.equal(await read(`window.log.join()`), "over");
    assert.equal(
      await read(
        `getComputedStyle(document.getElementById("b")).backgroundColor`,
      ),
      "rgb(255, 0, 0)",
    );
  },
);

test("hover reveals a menu that only a hover shows", OPTIONS, async () => {
  await setContent(
    page,
    `<style>#menu { display: none } #host:hover #menu { display: block }</style>
     <div id="host" style="padding:20px">Menu<div id="menu"><a id="item" href="#x">Item</a></div></div>`,
  );
  assert.equal(await page.locator("a[@id='item']").isVisible(), false);
  await page.locator("div[@id='host']").hover();
  assert.equal(await page.locator("a[@id='item']").isVisible(), true);
});

test(
  "hover works on a disabled button and waits for a cover to go",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<button id="b" disabled style="position:fixed;left:50px;top:50px;width:100px;height:50px">x</button>
     <div id="cover" style="position:fixed;inset:0"></div>`,
      `setTimeout(() => document.getElementById("cover").remove(), 300);`,
    );
    await page.locator("button[@id='b']").hover({ timeout: 3000 });
  },
);

test(
  "tap touches the element: touchstart, touchend, then a click",
  OPTIONS,
  async () => {
    await setContent(
      page,
      BUTTON,
      `window.log = []; const b = document.getElementById("b");
     b.addEventListener("pointerdown", (e) => window.log.push("pointerdown:" + e.pointerType));
     b.addEventListener("touchstart", () => window.log.push("touchstart"));
     b.addEventListener("touchend", () => window.log.push("touchend"));
     b.addEventListener("click", () => window.log.push("click"));`,
    );
    await page.locator("button[@id='b']").tap();
    const log: string[] = await read(`window.log`);
    assert.equal(log[0], "pointerdown:touch");
    assert.ok(
      log.includes("touchstart") && log.includes("touchend"),
      log.join(),
    );
    assert.ok(log.includes("click"), log.join());
  },
);

/** A draggable source and a target that accepts drops; every drag event lands in `window.log` */
const DRAG_PAGE = `
  <div id="src" draggable="true" style="position:fixed;left:20px;top:20px;width:80px;height:40px;background:#fa0">drag</div>
  <div id="dst" style="position:fixed;left:200px;top:100px;width:120px;height:80px;background:#0af">drop</div>`;
const DRAG_SETUP = `
  window.log = [];
  const src = document.getElementById("src");
  const dst = document.getElementById("dst");
  src.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", "payload"); window.log.push("dragstart"); });
  src.addEventListener("dragend", () => window.log.push("dragend"));
  dst.addEventListener("dragover", (e) => { e.preventDefault(); });
  dst.addEventListener("drop", (e) => {
    e.preventDefault();
    window.log.push("drop:" + e.dataTransfer.getData("text/plain") + ":" + Math.round(e.clientX) + "," + Math.round(e.clientY));
  });`;

test(
  "dragTo drops an HTML5 draggable on the target with its data",
  OPTIONS,
  async () => {
    await setContent(page, DRAG_PAGE, DRAG_SETUP);
    await page.locator("div[@id='src']").dragTo(page.locator("div[@id='dst']"));
    // Once each, whether the browser dropped it or the fallback did
    assert.equal(
      await read(`window.log.join()`),
      "dragstart,drop:payload:260,140,dragend",
    );
  },
);

test("dragTo drops at the target position", OPTIONS, async () => {
  await setContent(page, DRAG_PAGE, DRAG_SETUP);
  await page.locator("div[@id='src']").dragTo(page.locator("div[@id='dst']"), {
    sourcePosition: { x: 5, y: 5 },
    targetPosition: { x: 10, y: 20 },
  });
  assert.match(await read(`window.log.join()`), /drop:payload:210,120/);
});

test(
  "dragTo does not drop where dragover is not cancelled",
  OPTIONS,
  async () => {
    await setContent(
      page,
      DRAG_PAGE,
      `window.log = [];
     const src = document.getElementById("src"); const dst = document.getElementById("dst");
     src.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", "p"); window.log.push("dragstart"); });
     dst.addEventListener("drop", () => window.log.push("drop"));`,
    );
    await page.locator("div[@id='src']").dragTo(page.locator("div[@id='dst']"));
    assert.ok(!(await read(`window.log.join()`)).includes("drop"));
  },
);

test(
  "dragTo drives a pointer-based drag (mousedown, mousemove, mouseup)",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<div id="area" style="position:fixed;inset:0"></div><div id="handle" style="position:fixed;left:20px;top:20px;width:60px;height:40px;background:#fa0">h</div>`,
      `const handle = document.getElementById("handle");
     window.pos = null;
     handle.addEventListener("mousedown", () => {
       const move = (e) => { window.pos = e.clientX + "," + e.clientY; };
       const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); window.released = true; };
       document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
     });`,
    );
    await page
      .locator("div[@id='handle']")
      .dragTo(page.locator("div[@id='area']"), {
        targetPosition: { x: 300, y: 200 },
      });
    assert.equal(await read(`window.pos`), "300,200");
    assert.equal(await read(`window.released`), true);
  },
);

test("dragTo rejects bad steps before touching the page", OPTIONS, async () => {
  await setContent(page, DRAG_PAGE, DRAG_SETUP);
  await assert.rejects(
    page
      .locator("div[@id='src']")
      .dragTo(page.locator("div[@id='dst']"), { steps: 0 }),
    /dragTo\(\): steps must be a whole number/,
  );
});

test("dragTo names the element it waits for", OPTIONS, async () => {
  await setContent(page, DRAG_PAGE, DRAG_SETUP);
  await assert.rejects(
    page
      .locator("div[@id='src']")
      .dragTo(page.locator("div[@id='nothing']"), { timeout: 300 }),
    (err) =>
      err instanceof ActionTimeoutError &&
      /dragTo\(\): .*nothing/.test(err.message),
  );
});

test(
  "dispatchEvent builds the event class from the type and bubbles",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<div id="outer"><button id="b">x</button></div>`,
      `window.seen = [];
     document.getElementById("outer").addEventListener("click", (e) => window.seen.push(e.constructor.name + ":" + e.isTrusted + ":" + e.clientX));
     document.getElementById("outer").addEventListener("keydown", (e) => window.seen.push(e.constructor.name + ":" + e.key));
     document.getElementById("outer").addEventListener("ping", (e) => window.seen.push(e.constructor.name + ":" + e.detail));
     document.getElementById("outer").addEventListener("drop", (e) => window.seen.push(e.constructor.name + ":" + (e.dataTransfer instanceof DataTransfer)));`,
    );
    const button = page.locator("button[@id='b']");
    await button.dispatchEvent("click", { clientX: 7 });
    await button.dispatchEvent("keydown", { key: "k" });
    await button.dispatchEvent("ping");
    await button.dispatchEvent("drop");
    assert.deepEqual(await read(`window.seen`), [
      "MouseEvent:false:7",
      "KeyboardEvent:k",
      "Event:undefined",
      "DragEvent:true",
    ]);
  },
);

test("dispatchEvent reaches a hidden element", OPTIONS, async () => {
  await setContent(
    page,
    `<button id="b" style="display:none">x</button>`,
    `window.hit = false; document.getElementById("b").addEventListener("click", () => { window.hit = true; });`,
  );
  await page.locator("button[@id='b']").dispatchEvent("click");
  assert.equal(await read(`window.hit`), true);
});

test("blur removes focus and fires blur", OPTIONS, async () => {
  await setContent(
    page,
    `<input id="i">`,
    `window.blurred = false; const i = document.getElementById("i");
     i.addEventListener("blur", () => { window.blurred = true; }); i.focus();`,
  );
  await page.locator("input[@id='i']").blur();
  assert.equal(await read(`document.activeElement === document.body`), true);
  // A browser window without system focus (headless Firefox) fires no focus or blur events at all
  if (await read(`document.hasFocus()`)) {
    assert.equal(await read(`window.blurred`), true);
  }
});

test("clear empties an input and fires input", OPTIONS, async () => {
  await setContent(
    page,
    `<input id="i" value="text"><textarea id="t">many words</textarea>`,
    `window.inputs = 0; document.getElementById("i").addEventListener("input", () => { window.inputs++; });`,
  );
  await page.locator("input[@id='i']").clear();
  await page.locator("textarea[@id='t']").clear();
  assert.equal(await read(`document.getElementById("i").value`), "");
  assert.equal(await read(`document.getElementById("t").value`), "");
  assert.ok((await read(`window.inputs`)) >= 1);
});

test(
  "pressSequentially types key by key, with a delay between",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<input id="i">`,
      `window.keys = []; document.getElementById("i").addEventListener("keydown", (e) => window.keys.push(Math.round(performance.now())));`,
    );
    await page
      .locator("input[@id='i']")
      .pressSequentially("abc", { delay: 200 });
    assert.equal(await read(`document.getElementById("i").value`), "abc");
    const keys: number[] = await read(`window.keys`);
    assert.ok(keys[2]! - keys[0]! >= 350, `keys were ${keys.join()}`);
  },
);

test("press takes a chord on the element", OPTIONS, async () => {
  await setContent(page, `<input id="i" value="hello">`);
  const input = page.locator("input[@id='i']");
  await input.press("Control+a");
  await input.press("Backspace");
  assert.equal(await read(`document.getElementById("i").value`), "");
  await input.press("Shift+a");
  assert.equal(await read(`document.getElementById("i").value`), "A");
});

test(
  "a strict locator throws from the new actions when several elements match",
  OPTIONS,
  async () => {
    await setContent(page, `<li>a</li><li>b</li>`);
    const items = page.locator("li").strict();
    for (const [name, run] of [
      ["hover", () => items.hover({ timeout: 0 })],
      ["dblclick", () => items.dblclick({ timeout: 0 })],
      ["tap", () => items.tap({ timeout: 0 })],
      ["blur", () => items.blur({ timeout: 0 })],
      ["dispatchEvent", () => items.dispatchEvent("click", {}, { timeout: 0 })],
      ["pressSequentially", () => items.pressSequentially("x", { timeout: 0 })],
      ["dragTo", () => items.dragTo(page.locator("body"), { timeout: 0 })],
    ] as const) {
      await assert.rejects(
        run(),
        new RegExp(`${name}\\(\\): strict mode violation, 2 elements match`),
      );
    }
  },
);
