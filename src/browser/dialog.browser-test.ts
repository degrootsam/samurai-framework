import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { callFunction } from "../script/call-function.js";
import { setContent } from "../testing/browser-fixture.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import { Browser } from "./browser.js";
import type { Dialog } from "./dialog.js";
import type Page from "./page.js";

let browser: Browser;
let page: Page;

before(async () => {
  ({ browser, page } = await Browser.launch("firefox", { port: 9239, headless: true }));
  await page.navigateTo("about:blank");
});

after(async () => {
  await page.dispose();
  await browser?.close();
});

const OPTIONS = { timeout: 30000 };
const connector = () => (page as unknown as { biDiConnector: BiDiConnector }).biDiConnector;
const run = <T>(source: string) => callFunction<T>(connector(), page.contextId, source, [], { awaitPromise: false });
const read = <T>(name: string) => run<T>(`() => window.${name}`);

/** Starts `code` in the page without waiting for it: a dialog inside would block the command */
const start = (code: string) => run(`() => { setTimeout(() => { ${code} }, 0); }`);

async function until<T>(read: () => Promise<T | undefined>, what: string, ms = 5000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("an alert is reported and holds the page until it is accepted", OPTIONS, async () => {
  const seen: string[] = [];
  const onDialog = async (dialog: Dialog) => {
    seen.push(`${dialog.type()}: ${dialog.message()}`);
    assert.equal(await read("__afterAlert"), undefined, "the page is still stuck in alert()");
    await dialog.accept();
  };
  page.on("dialog", onDialog);
  await start(`alert("Saved!"); window.__afterAlert = true;`);
  assert.equal(await until(() => read<boolean | undefined>("__afterAlert"), "the page to go on"), true);
  assert.deepEqual(seen, ["alert: Saved!"]);
  page.off("dialog", onDialog);
});

test("confirm returns true when accepted and false when dismissed", OPTIONS, async () => {
  const answers = [true, false];
  const onDialog = (dialog: Dialog) => (answers.shift() ? dialog.accept() : dialog.dismiss());
  page.on("dialog", onDialog);
  await start(`window.__yes = confirm("Sure?");`);
  assert.equal(await until(() => read<boolean | undefined>("__yes"), "the first confirm"), true);
  await start(`window.__no = confirm("Sure?");`);
  assert.equal(await until(() => read<boolean | undefined>("__no"), "the second confirm"), false);
  page.off("dialog", onDialog);
});

test("a prompt shows its default value and returns the text that was typed", OPTIONS, async () => {
  let shown = "";
  const onDialog = (dialog: Dialog) => {
    shown = `${dialog.message()} / ${dialog.defaultValue()}`;
    return dialog.accept("Sam");
  };
  page.on("dialog", onDialog);
  await start(`window.__name = prompt("Name?", "Anonymous");`);
  assert.equal(await until(() => read<string | undefined>("__name"), "the prompt"), "Sam");
  assert.equal(shown, "Name? / Anonymous");
  page.off("dialog", onDialog);
});

test("a dismissed prompt returns null", OPTIONS, async () => {
  const onDialog = (dialog: Dialog) => dialog.dismiss();
  page.on("dialog", onDialog);
  await start(`window.__cancelled = prompt("Name?") === null;`);
  assert.equal(await until(() => read<boolean | undefined>("__cancelled"), "the prompt"), true);
  page.off("dialog", onDialog);
});

test("closed resolves with what the browser reports", OPTIONS, async () => {
  let closed: Promise<unknown> | undefined;
  const onDialog = async (dialog: Dialog) => {
    closed = dialog.closed;
    await dialog.accept("typed");
  };
  page.on("dialog", onDialog);
  await start(`window.__r = prompt("x");`);
  await until(() => read<string | undefined>("__r"), "the prompt");
  assert.deepEqual(await closed, { accepted: true, userText: "typed" });
  page.off("dialog", onDialog);
});

test("an alert nobody handles is dismissed, so a click on its button does not hang", OPTIONS, async () => {
  await setContent(
    page,
    `<button id="b">Go</button>`,
    `document.getElementById("b").addEventListener("click", () => { alert("Unhandled"); window.__afterUnhandled = true; });`,
  );
  await page.locator("button[@id='b']").click({ timeout: 10000 });
  assert.equal(await until(() => read<boolean | undefined>("__afterUnhandled"), "the page to go on"), true);
});

test("a dialog opened by an iframe is handled too", OPTIONS, async () => {
  await page.navigateTo("about:blank?frame");
  const seen: string[] = [];
  const onDialog = async (dialog: Dialog) => {
    seen.push(dialog.message());
    await dialog.accept();
  };
  page.on("dialog", onDialog);
  await run(`() => {
    const frame = document.body.appendChild(document.createElement("iframe"));
    frame.src = "about:blank";
    frame.addEventListener("load", () => {
      frame.contentWindow.setTimeout(() => { frame.contentWindow.alert("from the frame"); window.__frameDone = true; }, 0);
    }, { once: true });
  }`);
  await until(() => read<boolean | undefined>("__frameDone"), "the frame's alert");
  assert.deepEqual(seen, ["from the frame"]);
  page.off("dialog", onDialog);
});

test("a beforeunload prompt does not keep the page from navigating away", OPTIONS, async (t) => {
  await page.navigateTo("about:blank?unload");
  await setContent(page, `<button id="b">x</button>`, `window.addEventListener("beforeunload", (e) => { e.preventDefault(); e.returnValue = "leave?"; });`);
  await page.locator("button[@id='b']").click({ timeout: 10000 }); // user activation, or the browser skips the prompt
  const seen: string[] = [];
  const onDialog = (dialog: Dialog) => {
    seen.push(dialog.type());
  };
  page.on("dialog", onDialog);
  await page.navigateTo("about:blank?after", { timeout: 10000 });
  page.off("dialog", onDialog);
  assert.equal(await run<string>("() => location.search"), "?after");
  assert.deepEqual(seen, ["beforeunload"], "the prompt appeared, and the default policy accepted it");
  void t;
});
