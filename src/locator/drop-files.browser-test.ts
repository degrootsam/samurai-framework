import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, test } from "node:test";
import { Browser } from "../browser/browser.js";
import {
  generatedFile,
  removeGeneratedFiles,
} from "../browser/generated-files.js";
import type Page from "../browser/page.js";
import { setActiveProject } from "../config/config.js";
import { setContent } from "../testing/browser-fixture.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";

let browser: Browser;
let page: Page;
const OPTIONS = { timeout: 30000 };
const dir = mkdtempSync(path.join(tmpdir(), "samurai-drop-"));
mkdirSync(path.join(dir, "files"));
writeFileSync(path.join(dir, "files", "a.txt"), "hello");

before(async () => {
  ({ browser, page } = await Browser.launch("firefox", {
    port: 9263,
    headless: true,
  }));
});
after(async () => {
  await browser?.close();
});
afterEach(async () => {
  await removeGeneratedFiles();
  setActiveProject(undefined);
});

/** Reads a value in the page */
async function evaluate(expression: string): Promise<unknown> {
  const internals = page as unknown as {
    biDiConnector: BiDiConnector;
    contextId: string;
  };
  const result = await internals.biDiConnector.send("script.evaluate", {
    expression,
    awaitPromise: false,
    target: { context: internals.contextId },
  });
  if (result.type === "exception")
    throw new Error(result.exceptionDetails.text);
  return (result.result as { value?: unknown }).value;
}

const ZONE = `<div id="zone" style="width:200px;height:100px">Drop</div>`;
// setContent sets innerHTML, which doesn't run scripts: the handlers go in `setup`
const DROPZONE = `
  const zone = document.getElementById("zone");
  zone.addEventListener("dragover", (e) => e.preventDefault());
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.dataset.got = JSON.stringify(Array.from(e.dataTransfer.files, (f) => [f.name, f.size, f.type]));
    zone.dataset.events = (zone.dataset.events || "") + "drop";
  });
  zone.addEventListener("dragenter", () => { zone.dataset.events = (zone.dataset.events || "") + "enter,"; });`;

test(
  "dropFiles drops project files and generated ones on a real drop handler",
  OPTIONS,
  async () => {
    setActiveProject({ dir, config: {} });
    await setContent(page, ZONE, DROPZONE);
    await page.getByCss("#zone").dropFiles([
      "files/a.txt",
      generatedFile({
        name: "big.pdf",
        size: "2 MB",
        type: "application/pdf",
      }),
    ]);
    assert.equal(
      await page.getByCss("#zone").getAttribute("data-got"),
      JSON.stringify([
        ["a.txt", 5, "text/plain"],
        ["big.pdf", 2 * 1024 * 1024, "application/pdf"],
      ]),
    );
    assert.equal(
      await page.getByCss("#zone").getAttribute("data-events"),
      "enter,drop",
    );
  },
);

test(
  "setInputFiles takes project paths and generated files",
  OPTIONS,
  async () => {
    setActiveProject({ dir, config: {} });
    await setContent(page, `<input type="file" id="f" multiple>`);
    await page
      .getByCss("#f")
      .setInputFiles([
        "files/a.txt",
        generatedFile({ name: "g.bin", size: 10 }),
      ]);
    const sizes = await evaluate(
      `Array.from(document.getElementById("f").files, (f) => f.name + ":" + f.size).join()`,
    );
    assert.equal(sizes, "a.txt:5,g.bin:10");
  },
);

test(
  "dropFiles waits for a visible target, then fails like other actions",
  OPTIONS,
  async () => {
    await setContent(page, `<div id="zone" hidden>Drop</div>`);
    await assert.rejects(
      page
        .getByCss("#zone")
        .dropFiles(generatedFile({ name: "a", size: 1 }), { timeout: 300 }),
      /dropFiles\(\): css=#zone was not actionable.*visible ✗/s,
    );
  },
);

test("the page never sees the helper input", OPTIONS, async () => {
  await setContent(
    page,
    ZONE,
    `${DROPZONE}
     window.seen = 0;
     new MutationObserver((m) => { window.seen += m.length; }).observe(document, { childList: true, subtree: true });`,
  );
  await page.getByCss("#zone").dropFiles(generatedFile({ name: "a", size: 1 }));
  assert.equal(await evaluate("window.seen"), 0);
});
