import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import { setContent } from "../testing/browser-fixture.js";
import { ActionTimeoutError } from "./action-timeout-error.js";

let browser: Browser;
let page: Page;
const dir = mkdtempSync(path.join(tmpdir(), "samurai-upload-"));

before(async () => {
  ({ browser, page } = await Browser.launch("firefox", { port: 9236, headless: true }));
  await page.navigateTo("about:blank", "complete");
});

after(async () => {
  await page.dispose();
  await browser?.close();
  rmSync(dir, { recursive: true, force: true });
});

const OPTIONS = { timeout: 20000 };
function file(name: string, content = name) {
  const full = path.join(dir, name);
  writeFileSync(full, content);
  return full;
}

/** Records the chosen files and how often `input` and `change` fired */
const RECORD = `
  const input = document.getElementById("f");
  const out = document.getElementById("out");
  const counts = { input: 0, change: 0 };
  const render = () => {
    out.textContent = JSON.stringify({ names: [...input.files].map((f) => f.name), ...counts });
  };
  input.addEventListener("input", () => { counts.input++; render(); });
  input.addEventListener("change", () => { counts.change++; render(); });`;
const result = async () => JSON.parse((await page.locator("div[@id='out']").textContent()) ?? "null");

test("uploads one file and the browser fires input and change once", OPTIONS, async () => {
  await setContent(page, `<input type="file" id="f"><div id="out"></div>`, RECORD);
  await page.locator("input[@id='f']").setInputFiles(file("avatar.png"), { timeout: 5000 });
  assert.deepEqual(await result(), { names: ["avatar.png"], input: 1, change: 1 });
});

test("uploads several files to a multiple input", OPTIONS, async () => {
  await setContent(page, `<input type="file" id="f" multiple><div id="out"></div>`, RECORD);
  await page.locator("input[@id='f']").setInputFiles([file("a.csv"), file("b.csv")], { timeout: 5000 });
  assert.deepEqual((await result()).names, ["a.csv", "b.csv"]);
});

test("the browser reads the file content", OPTIONS, async () => {
  await setContent(
    page,
    `<input type="file" id="f"><div id="out"></div>`,
    `document.getElementById("f").addEventListener("change", async (e) => {
       document.getElementById("out").textContent = await e.target.files[0].text();
     });`,
  );
  await page.locator("input[@id='f']").setInputFiles(file("hello.txt", "hello upload"), { timeout: 5000 });
  await page.locator("div[@id='out']").waitFor({ state: "visible", timeout: 3000 });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(await page.locator("div[@id='out']").textContent(), "hello upload");
});

test("an empty list clears the selection", OPTIONS, async () => {
  await setContent(page, `<input type="file" id="f"><div id="out"></div>`, RECORD);
  const input = page.locator("input[@id='f']");
  await input.setInputFiles(file("first.txt"), { timeout: 5000 });
  await input.setInputFiles([], { timeout: 5000 });
  const state = await result();
  assert.deepEqual(state.names, []);
});

test("works on a hidden input behind a styled label", OPTIONS, async () => {
  await setContent(
    page,
    `<label for="f" style="display:inline-block;padding:8px">Choose</label>
     <input type="file" id="f" style="display:none"><div id="out"></div>`,
    RECORD,
  );
  const input = page.locator("input[@id='f']");
  assert.equal(await input.isVisible(), false);
  await input.setInputFiles(file("hidden.txt"), { timeout: 5000 });
  assert.deepEqual((await result()).names, ["hidden.txt"]);
});

test("waits for an input that appears later", OPTIONS, async () => {
  await setContent(
    page,
    `<div id="out"></div>`,
    `setTimeout(() => {
       document.body.insertAdjacentHTML("afterbegin", '<input type="file" id="f">');
       ${RECORD}
     }, 300);`,
  );
  await page.locator("input[@id='f']").setInputFiles(file("late.txt"), { timeout: 5000 });
  assert.deepEqual((await result()).names, ["late.txt"]);
});

test("refuses two files for an input without multiple", OPTIONS, async () => {
  await setContent(page, `<input type="file" id="f"><div id="out"></div>`, RECORD);
  await assert.rejects(
    page.locator("input[@id='f']").setInputFiles([file("x.txt"), file("y.txt")], { timeout: 5000 }),
    /does not accept multiple files/,
  );
  assert.deepEqual((await result().catch(() => null)), null, "nothing was set, so no event rendered");
});

test("refuses an element that is not a file input", OPTIONS, async () => {
  await setContent(page, `<input type="text" id="t"><div id="d"></div>`);
  await assert.rejects(
    page.locator("input[@id='t']").setInputFiles(file("t.txt"), { timeout: 5000 }),
    /is not an <input type=file> \(found <input type="text">\)/,
  );
  await assert.rejects(
    page.locator("div[@id='d']").setInputFiles(file("t.txt"), { timeout: 5000 }),
    /found <div>/,
  );
});

test("a disabled input times out naming the check", OPTIONS, async () => {
  await setContent(page, `<input type="file" id="f" disabled>`);
  await assert.rejects(
    page.locator("input[@id='f']").setInputFiles(file("d.txt"), { timeout: 400 }),
    (err) => err instanceof ActionTimeoutError && /attached ✓  enabled ✗/.test(err.message),
  );
});

test("a missing file fails before touching the page", OPTIONS, async () => {
  await setContent(page, `<input type="file" id="f">`);
  await assert.rejects(
    page.locator("input[@id='f']").setInputFiles(path.join(dir, "missing.txt")),
    /file not found/,
  );
});
