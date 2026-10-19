import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import { callFunction } from "../script/call-function.js";
import { setContent } from "../testing/browser-fixture.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import { parseSpec } from "../steps/parse.js";
import { applyRecorderEvent } from "./apply.js";
import type { MissingFile, RecorderEvent } from "./recorder.js";

let browser: Browser;
let page: Page;
const OPTIONS = { timeout: 60000 };
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const source = mkdtempSync(path.join(tmpdir(), "samurai-picked-"));
const picked = (name: string, text: string) => {
  const file = path.join(source, name);
  writeFileSync(file, text);
  return file;
};

before(async () => {
  ({ browser, page } = await Browser.launch("firefox", {
    port: 9264,
    headless: true,
  }));
});
after(async () => {
  await browser?.close();
});

async function record(
  html: string,
  act: () => Promise<void>,
  options: { trustSynthetic?: boolean; settle?: boolean } = {},
) {
  await setContent(page, html);
  const projectDir = mkdtempSync(path.join(tmpdir(), "samurai-rec-files-"));
  const events: RecorderEvent[] = [];
  const missing: MissingFile[] = [];
  const recorder = await page.record({
    onEvent: (event) => events.push(event),
    initialGoto: false,
    files: {
      projectDir,
      onMissing: (m) => missing.push(m),
      ...(options.trustSynthetic !== undefined && {
        trustSynthetic: options.trustSynthetic,
      }),
    },
  });
  await act();
  if (options.settle !== false) await pause(800);
  await recorder.stop();
  let spec = `test("t", async ({ page }) => {\n});\n`;
  for (const event of events) spec = applyRecorderEvent(spec, 0, event);
  return {
    projectDir,
    spec,
    steps: parseSpec(spec)[0]!.steps.map(({ step }) => step),
    missing,
    recorder,
  };
}

test(
  "a picked file becomes setInputFiles and is stored in files/",
  OPTIONS,
  async () => {
    const { projectDir, steps, recorder } = await record(
      `<label for="f">Avatar</label><input type="file" id="f">`,
      () =>
        page.getByLabel("Avatar").setInputFiles(picked("me.png", "png-bytes")),
    );
    assert.deepEqual(
      steps.map((s) => s.kind),
      ["setInputFiles"],
    );
    assert.deepEqual((steps[0] as { files: unknown }).files, [
      { path: "files/me.png" },
    ]);
    assert.equal(
      readFileSync(path.join(projectDir, "files", "me.png"), "utf8"),
      "png-bytes",
    );
    assert.deepEqual(recorder.storedFiles, ["files/me.png"]);
  },
);

test(
  "the click on a button that opens a hidden input's picker is replaced",
  OPTIONS,
  async () => {
    const { steps } = await record(
      `<input type="file" id="f" hidden aria-label="Avatar"><button onclick="document.getElementById('f').click()">Upload</button>`,
      async () => {
        await page.getByRole("button", { name: "Upload" }).click();
        await pause(300);
        await page.getByLabel("Avatar").setInputFiles(picked("a.txt", "a"));
      },
    );
    assert.deepEqual(
      steps.map((s) => s.kind),
      ["setInputFiles"],
    );
  },
);

test("a cancelled picker removes its click", OPTIONS, async () => {
  const { steps } = await record(
    `<input type="file" id="f" hidden><button onclick="document.getElementById('f').click()">Upload</button>`,
    async () => {
      await page.getByRole("button", { name: "Upload" }).click();
      await pause(300);
      const { biDiConnector, contextId } = page as unknown as {
        biDiConnector: BiDiConnector;
        contextId: string;
      };
      await callFunction(
        biDiConnector,
        contextId,
        `() => document.getElementById("f").dispatchEvent(new Event("cancel"))`,
      );
    },
    { trustSynthetic: true },
  );
  assert.deepEqual(steps, []);
});

test(
  "a page that clears the input on change still records the picked file",
  OPTIONS,
  async () => {
    const { steps } = await record(
      `<input type="file" id="f" aria-label="Avatar" onchange="setTimeout(() => { this.value = ''; })">`,
      () => page.getByLabel("Avatar").setInputFiles(picked("keep.txt", "k")),
    );
    assert.deepEqual((steps[0] as { files: unknown }).files, [
      { path: "files/keep.txt" },
    ]);
  },
);

test(
  "a drop becomes dropFiles; two files of one name are both stored",
  OPTIONS,
  async () => {
    const { projectDir, steps } = await record(
      `<div data-testid="zone" style="width:200px;height:80px">Drop</div>`,
      async () => {
        const { biDiConnector, contextId } = page as unknown as {
          biDiConnector: BiDiConnector;
          contextId: string;
        };
        await callFunction(
          biDiConnector,
          contextId,
          `() => {
        const dt = new DataTransfer();
        dt.items.add(new File(["one"], "a.png"));
        dt.items.add(new File(["two"], "a.png"));
        document.querySelector("[data-testid=zone]").dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
      }`,
        );
      },
      { trustSynthetic: true },
    );
    const twoHash = createHash("sha256")
      .update("two")
      .digest("hex")
      .slice(0, 8);
    assert.deepEqual(
      steps.map((s) => s.kind),
      ["dropFiles"],
    );
    assert.deepEqual((steps[0] as { files: unknown }).files, [
      { path: "files/a.png" },
      { path: `files/${twoHash}/a.png` },
    ]);
    assert.deepEqual(readdirSync(path.join(projectDir, "files")).sort(), [
      ...["a.png", twoHash].sort(),
    ]);
    assert.deepEqual(readdirSync(path.join(projectDir, "files", twoHash)), [
      "a.png",
    ]);
  },
);

test(
  "a file over 50 MB gets a step, isn't stored, and is reported",
  OPTIONS,
  async () => {
    const big = path.join(source, "big.mov");
    writeFileSync(big, Buffer.alloc(50 * 1024 * 1024 + 1));
    const { projectDir, steps, missing } = await record(
      `<input type="file" id="f" aria-label="Video">`,
      () => page.getByLabel("Video").setInputFiles(big),
    );
    assert.deepEqual((steps[0] as { files: unknown }).files, [
      { path: "files/big.mov" },
    ]);
    assert.ok(!existsSync(path.join(projectDir, "files", "big.mov")));
    assert.deepEqual(missing, [
      {
        path: "files/big.mov",
        name: "big.mov",
        size: 50 * 1024 * 1024 + 1,
        reason: "too-big",
      },
    ]);
  },
);

test("a file picked just before Stop is still stored", OPTIONS, async () => {
  const bytes = Buffer.alloc(4 * 1024 * 1024, "x");
  const file = path.join(source, "late.bin");
  writeFileSync(file, bytes);
  const { projectDir, steps, recorder } = await record(
    `<input type="file" id="f" aria-label="Late">`,
    () => page.getByLabel("Late").setInputFiles(file),
    { settle: false },
  );
  assert.deepEqual((steps[0] as { files: unknown }).files, [
    { path: "files/late.bin" },
  ]);
  assert.ok(
    bytes.equals(readFileSync(path.join(projectDir, "files", "late.bin"))),
  );
  assert.deepEqual(recorder.missingFiles, []);
});
