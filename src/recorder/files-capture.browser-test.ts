// src/recorder/files-capture.browser-test.ts
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, test } from "node:test";
import { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import { callFunction } from "../script/call-function.js";
import { addPreload, type PreloadHandle } from "../script/preload.js";
import { ChannelArg, fromRemoteValue } from "../script/serialize.js";
import { setContent } from "../testing/browser-fixture.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import { FILES_SANDBOX, filesCaptureSource } from "./files-capture.js";
import { readPageFile } from "./files-reader.js";
import { testBrowser } from "../testing/test-browser.js";

let browser: Browser;
let page: Page;
let connector: BiDiConnector;
let context: string;
const received: { channel: string; data: Record<string, unknown> }[] = [];
const handles: PreloadHandle[] = [];
const OPTIONS = { timeout: 60000 };
const dir = mkdtempSync(path.join(tmpdir(), "samurai-capture-"));
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

before(async () => {
  ({ browser, page } = await Browser.launch(testBrowser(), {
    port: 9262,
    headless: true,
  }));
  ({ biDiConnector: connector, contextId: context } = page as unknown as {
    biDiConnector: BiDiConnector;
    contextId: string;
  });
  connector.onEvent("script.message", (params) => {
    received.push({
      channel: params.channel,
      data: fromRemoteValue(
        params.data as Parameters<typeof fromRemoteValue>[0],
      ) as Record<string, unknown>,
    });
  });
  await connector.subscribe(["script.message"]);
});

after(async () => {
  await browser?.close();
});

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.dispose();
  received.length = 0;
});

async function install(trustSynthetic = false): Promise<string> {
  const channel = `samurai-files-${randomUUID()}`;
  handles.push(
    await addPreload(connector, {
      source: filesCaptureSource({ trustSynthetic }),
      sandbox: FILES_SANDBOX,
      contexts: [context],
      arguments: [new ChannelArg(channel)],
    }),
  );
  return channel;
}

async function next(channel: string, type: string) {
  for (let i = 0; i < 100; i++) {
    const found = received.find(
      (m) => m.channel === channel && m.data.type === type,
    );
    if (found) return found.data;
    await pause(100);
  }
  throw new Error(`No ${type} message`);
}

test(
  "a picked file's bytes reach the recorder intact, at 1 KB and at 50 MB",
  OPTIONS,
  async () => {
    const small = path.join(dir, "small.bin");
    const big = path.join(dir, "big.bin");
    writeFileSync(small, randomBytes(1024));
    writeFileSync(big, randomBytes(50 * 1024 * 1024));
    await setContent(page, `<input type="file" id="f" multiple>`);
    const channel = await install();

    await page.getByCss("#f").setInputFiles([small, big]);
    const message = (await next(channel, "files")) as {
      via: string;
      files: { id: number; name: string; size: number }[];
    };
    assert.equal(
      message.via,
      "input",
      "the change from input.setFiles counts as trusted",
    );
    assert.deepEqual(
      message.files.map(({ name, size }) => ({ name, size })),
      [
        { name: "small.bin", size: 1024 },
        { name: "big.bin", size: 50 * 1024 * 1024 },
      ],
    );

    for (const [file, source] of [
      [message.files[0]!, small],
      [message.files[1]!, big],
    ] as const) {
      const started = Date.now();
      const chunks: Buffer[] = [];
      await readPageFile(connector, context, file.id, file.size, (bytes) =>
        chunks.push(bytes),
      );
      assert.equal(sha(Buffer.concat(chunks)), sha(readFileSync(source)));
      console.log(`read ${file.name} in ${Date.now() - started} ms`);
    }
  },
);

test(
  "a drop of files is reported with the element it landed on; a drop of text is not",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<div id="zone" style="width:200px;height:100px">Drop here</div>`,
    );
    const channel = await install(true);
    const drop = (files: boolean) =>
      callFunction(
        connector,
        context,
        `(files) => {
      const dt = new DataTransfer();
      if (files) dt.items.add(new File(["hello"], "a.txt", { type: "text/plain" }));
      else dt.setData("text/plain", "just text");
      document.getElementById("zone").dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    }`,
        [files],
      );

    await drop(false);
    await drop(true);
    const message = (await next(channel, "files")) as {
      via: string;
      files: { id: number; size: number }[];
    };
    assert.equal(message.via, "drop");
    assert.equal(
      received.filter((m) => m.channel === channel && m.data.type === "files")
        .length,
      1,
    );
    const chunks: Buffer[] = [];
    await readPageFile(
      connector,
      context,
      message.files[0]!.id,
      message.files[0]!.size,
      (b) => chunks.push(b),
    );
    assert.equal(Buffer.concat(chunks).toString(), "hello");
  },
);

test(
  "untrusted drops and changes are ignored without trustSynthetic",
  OPTIONS,
  async () => {
    await setContent(page, `<div id="zone">Drop here</div>`);
    const channel = await install(false);
    await callFunction(
      connector,
      context,
      `() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["x"], "x.txt"));
    document.getElementById("zone").dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt }));
  }`,
    );
    await pause(500);
    assert.equal(received.filter((m) => m.channel === channel).length, 0);
  },
);

test(
  "the page opening a picker from a button reports a picker",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<input type="file" id="f" hidden><button onclick="document.getElementById('f').click()">Upload</button>`,
    );
    const channel = await install();
    await page.getByCss("button").click();
    await next(channel, "picker");
  },
);
