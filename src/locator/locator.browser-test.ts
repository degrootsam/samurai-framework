import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import { setContent } from "../testing/browser-fixture.js";
import { ActionTimeoutError } from "./action-timeout-error.js";

let browser: Browser;
let page: Page;

before(async () => {
  ({ browser, page } = await Browser.launch("firefox", { port: 9231, headless: true }));
  await page.navigateTo("about:blank", "complete");
});

after(async () => {
  await browser?.close();
});

/** Records on the button whether a click was a real (trusted) pointer click */
const RECORD_CLICKS = `
  const b = document.getElementById("b");
  b.addEventListener("click", (event) => { b.dataset.clicked = event.isTrusted ? "trusted" : "synthetic"; });`;

const OPTIONS = { timeout: 15000 };

test("click waits for a button that becomes enabled", OPTIONS, async () => {
  await setContent(
    page,
    `<button id="b" disabled>Go</button>`,
    `${RECORD_CLICKS} setTimeout(() => { b.disabled = false; }, 300);`,
  );
  const button = page.locator("button[@id='b']");
  await button.click({ timeout: 3000 });
  assert.equal(await button.getAttribute("data-clicked"), "trusted");
});

test("click waits for a covering overlay to disappear", OPTIONS, async () => {
  await setContent(
    page,
    `<button id="b">Go</button><div id="overlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.5)"></div>`,
    `${RECORD_CLICKS} setTimeout(() => document.getElementById("overlay").remove(), 300);`,
  );
  const button = page.locator("button[@id='b']");
  await button.click({ timeout: 3000 });
  assert.equal(await button.getAttribute("data-clicked"), "trusted");
});

test("click waits for a moving button to stop", OPTIONS, async () => {
  await setContent(
    page,
    `<button id="b" style="position:absolute;left:0;top:0;transition:left 300ms linear">Go</button>`,
    `${RECORD_CLICKS} requestAnimationFrame(() => requestAnimationFrame(() => { b.style.left = "300px"; }));`,
  );
  const button = page.locator("button[@id='b']");
  await button.click({ timeout: 3000 });
  assert.equal(await button.getAttribute("data-clicked"), "trusted");
});

test("click scrolls a button below the fold into view", OPTIONS, async () => {
  await setContent(page, `<div style="height:3000px"></div><button id="b">Go</button>`, RECORD_CLICKS);
  const button = page.locator("button[@id='b']");
  await button.click({ timeout: 3000 });
  assert.equal(await button.getAttribute("data-clicked"), "trusted");
});

test("click works on an SVG element", OPTIONS, async () => {
  await setContent(
    page,
    `<svg id="icon" width="40" height="40"><rect width="40" height="40"></rect></svg>`,
    `const icon = document.getElementById("icon");
     icon.addEventListener("click", (event) => icon.setAttribute("data-clicked", event.isTrusted ? "trusted" : "synthetic"));`,
  );
  // SVG elements are not in the HTML namespace, so a bare //svg does not match them in XPath
  const icon = page.locator("*[local-name()='svg' and @id='icon']");
  await icon.click({ timeout: 3000 });
  assert.equal(await icon.getAttribute("data-clicked"), "trusted");
});

test("fill waits for a readonly field to become editable and replaces its value", OPTIONS, async () => {
  await setContent(
    page,
    `<input id="i" readonly value="old">`,
    `setTimeout(() => { document.getElementById("i").readOnly = false; }, 300);`,
  );
  const input = page.locator("input[@id='i']");
  await input.fill("typed", { timeout: 3000 });
  assert.equal(await input.inputValue(), "typed");
});

test("force clicks an element that is not considered visible", OPTIONS, async () => {
  await setContent(page, `<button id="b" style="opacity:0">Go</button>`, RECORD_CLICKS);
  const button = page.locator("button[@id='b']");
  await assert.rejects(button.click({ timeout: 300 }), /visible ✗/);
  await button.click({ force: true, timeout: 3000 });
  assert.equal(await button.getAttribute("data-clicked"), "trusted");
});

test("waitFor hidden resolves when the element is removed; visible times out when it stays hidden", OPTIONS, async () => {
  await setContent(
    page,
    `<div id="s">Loading</div>`,
    `setTimeout(() => document.getElementById("s").remove(), 300);`,
  );
  await page.locator("div[@id='s']").waitFor({ state: "hidden", timeout: 3000 });

  await setContent(page, `<div id="s" style="display:none">Loading</div>`);
  await assert.rejects(
    page.locator("div[@id='s']").waitFor({ timeout: 300 }),
    (err) =>
      err instanceof ActionTimeoutError &&
      err.message === "waitFor(): //div[@id='s'] did not become visible within 300ms",
  );
});

test("a disabled button times out with the check summary", OPTIONS, async () => {
  await setContent(page, `<button id="b" disabled>Go</button>`);
  await assert.rejects(
    page.locator("button[@id='b']").click({ timeout: 500 }),
    (err) =>
      err instanceof ActionTimeoutError &&
      err.message ===
        "click(): //button[@id='b'] was not actionable within 500ms\n" +
          "  attached ✓  visible ✓  stable ✓  enabled ✗  hit target —",
  );
});

test("a covered button times out naming the covering element", OPTIONS, async () => {
  await setContent(
    page,
    `<button id="b">Go</button><div id="cover" class="overlay" style="position:fixed;inset:0"></div>`,
  );
  await assert.rejects(
    page.locator("button[@id='b']").click({ timeout: 500 }),
    /hit target ✗ \(covered by div#cover\.overlay\)/,
  );
});
