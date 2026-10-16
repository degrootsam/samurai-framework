# File uploads in recorded tests (D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A file picked or dropped while recording becomes a `setInputFiles` / `dropFiles` step whose file is stored once in the project's `files/` folder, and tests can use files generated at run time.

**Architecture:** Framework first (0.8.0, branch `feat/file-uploads`): a new step codec pair, a run-time layer (project-relative paths, `generatedFile`, `locator.dropFiles`), a content-deduplicating file store, and a recorder path in which a sandbox-realm preload keeps the picked `File` objects and the recorder pulls their bytes in 1 MB chunks. Then the app (branch `feat/file-uploads`, on top of `feat/recorder-toolbar`) shows, edits and adds the new steps against the published 0.8.0.

**Tech Stack:** TypeScript, Node 20+, WebDriver BiDi (Firefox), `node:test` + `tsx` (framework), Electron + React + bun (app).

**Spec:** `docs/superpowers/specs/2026-10-15-file-uploads-design.md` (framework repo).

## Global Constraints

- Framework version `0.8.0`. App needs `@itmetsam/samurai-framework` `^0.8.0`; projects before 0.8.0 don't get the new steps in the add-step menu.
- Files live in `files/` at the project root; `filesDir` in `samurai.config.ts` changes it (relative to the project folder).
- Dedupe: SHA-256 of the content, compared only with files of the same size in the folder (top level). Same name, other content: `<stem>-2<ext>`, `-3`, …; an existing file is never overwritten.
- Recording cap: 50 MB per file (`50 * 1024 * 1024` bytes). Bigger files get a step but are not stored.
- Transfer chunk: 1 MB (`1024 * 1024` bytes), base64.
- Size units in `generatedFile`: `B`, `KB`, `MB`, `GB`, powers of 1024.
- Cleaned names: no path part (`/`, `\`), no control characters, no leading dots, trimmed, at most 120 characters keeping the extension, empty → `file`.
- Copy, verbatim:
  - over cap: `<name> is <size>. Files over 50 MB aren't saved: add it to <folder>/ yourself, or use a generated file.`
  - unreadable: `<name> couldn't be read, so it isn't saved: add it to <folder>/ yourself, or use a generated file.`
  - git-ignored: `<folder>/ is ignored by git; CI won't have these files.`
  - first files: `Recorded files are stored in <folder>/ and committed with your tests.`
  - missing at run time (relative path): `<op>(): <path> doesn't exist in the project`
  - toolbar while a transfer runs: `Saving <name>…`
- Untrusted events (`isTrusted` false) are never recorded, except through the internal test option `trustSynthetic`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Framework checks: `npm test`, `npm run test:cli`, `npm run test:browser`, `npx tsc --noEmit -p .`, `npm run build`. One browser file: `npx tsx --test --test-concurrency=1 <file>`.
- App checks: `bun test`, `npx tsc --noEmit -p .`, `npx electron-vite build` (the build must pass; tsc alone missed a broken import before).

## Rulings made while planning (spec gaps)

- The capture script runs in the page's own realm, so file capture is a **separate preload in its own sandbox** (`samurai-files`, own channel, realm-checked like the toolbar). Page scripts can't reach the `File` objects it keeps or its read hook.
- A picker cancel removes the click, which needs a new recorder event `{ op: "remove"; index }`. `applyRecorderEvent`, `resultSecrets` and the CLI handle it.
- `generatedFile`'s `type` reaches the page only through `dropFiles`. For `setInputFiles` the browser derives the type from the file name's extension (BiDi `input.setFiles` takes paths). The docs say so.
- Generated files are written to `<project>/result/files/<size>-<name>` and removed when `withProject` ends (runs, recordings, flows).
- "Use generated file" for a missing file uses the file's name and 1 MB. The editor doesn't know the recorded size, because the step only has the path. The person adjusts the size.
- An absolute path that doesn't exist keeps today's `setInputFiles(): file not found: <path>` message. Only relative paths get the new "doesn't exist in the project" message.

## Review Focus

1. A file input whose page clears `value` in its `change` handler (common "pick again" pattern): the step still lists the picked files. Pinned in Task 7 (the capture keeps the `File` objects during the event).
2. Two files with the same name but different content in one drop: both are stored (`a.png`, `a-2.png`) and the step lists both. Pinned in Task 4.
3. Paused recording, then a file pick: no step, no file in `files/`, and the sandbox drops the `File` reference. Pinned in Task 7.
4. A spec that already imports `generatedFile` under another import (`import { generatedFile } from "@itmetsam/samurai-framework"` on its own line): no second import. Pinned in Task 2.
5. A name made only of dots or slashes (`../..`): stored as `file`, never outside `files/`. Pinned in Task 4.

---

## File structure

Framework (`samurai-framework`):

| File                                         | Responsibility                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/recorder/files-capture.ts` (new)        | Sandbox preload source: listens for `change`, `drop`, `cancel`, picker clicks; keeps `File`s; read hook |
| `src/recorder/files-reader.ts` (new)         | Pulls a kept file's bytes from the sandbox in chunks                                                    |
| `src/steps/files.ts` (new)                   | `parseSize`, `formatSize`, `humanSize`, `sizeFromSource`                                                |
| `src/steps/model.ts`                         | `FileEntry`, `GeneratedFileSpec`, the two step kinds                                                    |
| `src/steps/parse.ts`, `emit.ts`, `edit.ts`   | Codec for the new kinds; `generatedFile` import                                                         |
| `src/browser/generated-files.ts` (new)       | `generatedFile()`, writing and removing generated files, resolving file inputs                          |
| `src/locator/locator.ts`                     | `setInputFiles` takes entries and project-relative paths; `dropFiles`                                   |
| `src/project/files-store.ts` (new)           | `cleanFileName`, `storeFile`, `isFolderIgnored`, `filesFolder`, `RECORD_LIMIT`                          |
| `src/recorder/normalise.ts`, `apply.ts`      | `picker`, `picker-cancel`, `files` observations; `remove` event                                         |
| `src/recorder/toolbar/*`                     | `Saving …` line and dismissible warnings                                                                |
| `src/recorder/recorder.ts`                   | Files channel, transfer, storing, missing files                                                         |
| `src/recorder/session.ts`, `src/cli/main.ts` | `RecordResult` fields, CLI output                                                                       |
| docs                                         | `recorder.md`, `locators.md`, `configuration.md`, `cli.md`, `roadmap.md`                                |

App (`samurai`):

| File                                                                                              | Responsibility                                                            |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `src/main/utils/files.ts` (new)                                                                   | Copy a chosen file into the project's files folder; file status for paths |
| `src/main/utils/ipc.ts`, `src/preload/index.ts`, `src/renderer/src/types/api.d.ts`                | `files:add`, `files:status`                                               |
| `src/shared/projects.ts`, `src/main/utils/inspect.ts`, `src/engine/index.ts`                      | `frameworkVersion`, `filesDir`                                            |
| `src/shared/specs.ts`, `src/engine/index.ts`, `src/main/record/service.ts`                        | `RecordDone` file fields                                                  |
| `src/renderer/src/lib/steps.ts`                                                                   | Views, validity, editability of the new kinds                             |
| `src/renderer/src/pages/project/test-editor/components/file-list.tsx` (new)                       | The file list editor                                                      |
| `step-edit-dialog.tsx`, `inspector.tsx`, `add-step-bar.tsx`, `step-item.tsx`, `record-alerts.tsx` | Wiring                                                                    |

---

## Framework (branch `feat/file-uploads`)

### Task 1: File capture in a sandbox, and the spike

**Files:**

- Create: `src/recorder/files-capture.ts`
- Create: `src/recorder/files-reader.ts`
- Test: `src/recorder/files-capture.browser-test.ts`

**Interfaces:**

- Produces:
  - `FILES_SANDBOX = "samurai-files"`, `FILES_KEY = "samurai.files"`, `CHUNK_BYTES = 1048576`
  - `filesCaptureSource(options?: { trustSynthetic?: boolean }): string`, a `(send) => {…}` function declaration
  - Messages on the channel:
    - `{ type: "files"; via: "input" | "drop"; target: Element; candidates: LocatorCall[]; files: { id: number; name: string; type: string; size: number }[] }`
    - `{ type: "picker" }`
    - `{ type: "picker-cancel" }`
  - Sandbox hook `globalThis[Symbol.for("samurai.files")]`: `read(id, offset) → Promise<string /*base64*/>`, `release(id)`, `dispose()`
  - `readPageFile(connector: BiDiConnector, context: string, id: number, size: number, onChunk: (bytes: Buffer) => unknown): Promise<void>`
  - `releasePageFile(connector, context, id): Promise<void>`, `disposeFilesCapture(connector, context): Promise<void>`

This task is also the spike from the spec. If either check below fails, stop and report: the plan's later tasks assume both hold.

- A sandbox realm can read a picked file's bytes, and the `change` that `input.setFiles` fires counts as trusted.
- A 50 MB file arrives intact in reasonable time.

- [ ] **Step 1: Write the failing browser test**

```ts
// src/recorder/files-capture.browser-test.ts
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
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
  ({ browser, page } = await Browser.launch("firefox", {
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
      const { readFileSync } = await import("node:fs");
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx tsx --test --test-concurrency=1 src/recorder/files-capture.browser-test.ts`
Expected: FAIL, `Cannot find module './files-capture.js'`.

- [ ] **Step 3: Write the capture source**

```ts
// src/recorder/files-capture.ts
import { CANDIDATES_JS } from "./candidates.js";

/** The BiDi sandbox realm the file capture script runs in: page scripts can't reach its listeners or the files it keeps */
export const FILES_SANDBOX = "samurai-files";
/** `Symbol.for(FILES_KEY)` on the sandbox global holds the hook the recorder reads files through */
export const FILES_KEY = "samurai.files";
/** A file is read and sent in pieces of this many bytes */
export const CHUNK_BYTES = 1024 * 1024;

/**
 * Function declaration installed as a preload script in the `samurai-files` sandbox, called as `(send)` with
 * the recorder's files channel. Top-level documents only. Reports:
 *
 * - `{ type: "files", via: "input", target, candidates, files }`: a person changed the files of an
 *   `<input type=file>` (no files: it was cleared).
 * - `{ type: "files", via: "drop", target, candidates, files }`: a person dropped files on `target`.
 * - `{ type: "picker" }`: a file input got a click (the page's `input.click()`, a label, or the input itself),
 *   which opens the file picker.
 * - `{ type: "picker-cancel" }`: the picker was closed without choosing.
 *
 * `files` is `{ id, name, type, size }[]`. The `File` objects stay here, kept by id, until the recorder reads
 * them through `globalThis[Symbol.for("samurai.files")].read(id, offset)` (base64 of up to 1 MB) and calls
 * `release(id)`. A drop's file list can only be read during the event, so it is taken then.
 * Events a person didn't cause (`isTrusted` false) are ignored, unless `trustSynthetic` (tests only).
 * A string, so no transpiler helper can end up in it.
 */
export function filesCaptureSource(
  options: { trustSynthetic?: boolean } = {},
): string {
  return String.raw`(send) => {
  if (window !== window.top) return;
  const KEY = Symbol.for("${FILES_KEY}");
  if (globalThis[KEY]) globalThis[KEY].dispose();

  ${CANDIDATES_JS}

  const TRUST_SYNTHETIC = ${options.trustSynthetic === true};
  const trusted = (event) => event.isTrusted || TRUST_SYNTHETIC;
  const files = new Map();
  let nextId = 1;
  const keep = (list) => Array.from(list || []).map((file) => {
    const id = nextId++;
    files.set(id, file);
    return { id, name: file.name, type: file.type, size: file.size };
  });
  const isFileInput = (el) =>
    el instanceof Element && el.tagName === "INPUT" && (el.getAttribute("type") || "").toLowerCase() === "file";
  const listening = [];
  const listen = (type, handler) => {
    document.addEventListener(type, handler, true);
    listening.push([type, handler]);
  };

  listen("change", (event) => {
    const el = event.target;
    if (!trusted(event) || !isFileInput(el)) return;
    send({ type: "files", via: "input", target: el, candidates: candidatesOf(el), files: keep(el.files) });
  });
  listen("cancel", (event) => {
    if (trusted(event) && isFileInput(event.target)) send({ type: "picker-cancel" });
  });
  // The page opens a picker with input.click(), which is not a trusted click: any click on a file input counts
  listen("click", (event) => {
    if (isFileInput(event.target)) send({ type: "picker" });
  });
  listen("drop", (event) => {
    const el = event.target;
    if (!trusted(event) || inToolbar(event) || !(el instanceof Element)) return;
    const data = event.dataTransfer;
    if (!data || Array.from(data.types || []).indexOf("Files") < 0 || data.files.length === 0) return;
    send({ type: "files", via: "drop", target: el, candidates: candidatesOf(el), files: keep(data.files) });
  });

  const toBase64 = (bytes) => {
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(text);
  };
  globalThis[KEY] = {
    read: async (id, offset) => {
      const file = files.get(id);
      if (!file) throw new Error("No file " + id);
      const buffer = await file.slice(offset, offset + ${CHUNK_BYTES}).arrayBuffer();
      return toBase64(new Uint8Array(buffer));
    },
    release: (id) => { files.delete(id); },
    dispose: () => {
      for (const [type, handler] of listening.splice(0)) document.removeEventListener(type, handler, true);
      files.clear();
      if (globalThis[KEY] && globalThis[KEY].read) delete globalThis[KEY];
    },
  };
}`;
}
```

- [ ] **Step 4: Write the reader**

```ts
// src/recorder/files-reader.ts
import { callFunction } from "../script/call-function.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import { CHUNK_BYTES, FILES_KEY, FILES_SANDBOX } from "./files-capture.js";

const HOOK = `globalThis[Symbol.for(${JSON.stringify(FILES_KEY)})]`;

/** Reads a file the capture script kept, `CHUNK_BYTES` at a time, handing each piece to `onChunk` in order */
export async function readPageFile(
  connector: BiDiConnector,
  context: string,
  id: number,
  size: number,
  onChunk: (bytes: Buffer) => unknown,
): Promise<void> {
  for (let offset = 0; offset < size; offset += CHUNK_BYTES) {
    const base64 = await callFunction<string>(
      connector,
      context,
      `(id, offset) => ${HOOK}.read(id, offset)`,
      [id, offset],
      { sandbox: FILES_SANDBOX },
    );
    await onChunk(Buffer.from(base64, "base64"));
  }
}

/** Lets the capture script drop its reference to a file */
export async function releasePageFile(
  connector: BiDiConnector,
  context: string,
  id: number,
): Promise<void> {
  await callFunction(
    connector,
    context,
    `(id) => { ${HOOK}?.release(id); }`,
    [id],
    {
      sandbox: FILES_SANDBOX,
      awaitPromise: false,
    },
  );
}

/** Takes the capture script's listeners off the loaded document (the recording ended) */
export async function disposeFilesCapture(
  connector: BiDiConnector,
  context: string,
): Promise<void> {
  await callFunction(connector, context, `() => { ${HOOK}?.dispose(); }`, [], {
    sandbox: FILES_SANDBOX,
    awaitPromise: false,
  });
}
```

- [ ] **Step 5: Run the tests**

Run: `npx tsx --test --test-concurrency=1 src/recorder/files-capture.browser-test.ts`
Expected: PASS, 4 tests, with the 50 MB read time logged. Record that time in the ledger. If the first test fails on `via` (the `change` from `input.setFiles` isn't trusted), stop and report: the recorder tests in Task 7 would then need `trustSynthetic`.

- [ ] **Step 6: Commit**

```bash
git add src/recorder/files-capture.ts src/recorder/files-reader.ts src/recorder/files-capture.browser-test.ts
git commit -m "feat: capture picked and dropped files in a sandbox, and read them in chunks"
```

### Task 2: The step codec for file steps

**Files:**

- Create: `src/steps/files.ts`
- Modify: `src/steps/model.ts`, `src/steps/parse.ts`, `src/steps/emit.ts`, `src/steps/edit.ts`, `src/steps/index.ts`
- Test: `src/steps/files.test.ts`, `src/steps/steps.test.ts`

**Interfaces:**

- Produces:
  - `type FileEntry = { path: string } | { generate: GeneratedFileSpec }`
  - `interface GeneratedFileSpec { name: string; size: number; type?: string; sizeSource?: string }`
  - Step kinds `{ kind: "setInputFiles"; locator: LocatorSpec; files: FileEntry[] }` and `{ kind: "dropFiles"; … }`
  - `parseSize(size: number | string): number | undefined`, `formatSize(bytes): string`, `humanSize(bytes): string`, `sizeFromSource(text: string): number | undefined`
  - `filesToSource(files: readonly FileEntry[]): string` (exported from `emit.ts`)
  - All exported from `@itmetsam/samurai-framework/steps`

- [ ] **Step 1: Write the failing size tests**

```ts
// src/steps/files.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatSize, humanSize, parseSize, sizeFromSource } from "./files.js";

describe("file sizes", () => {
  it("parses bytes and texts with units, powers of 1024", () => {
    assert.equal(parseSize(1024), 1024);
    assert.equal(parseSize("60 MB"), 60 * 1024 ** 2);
    assert.equal(parseSize("1.5 GB"), 1.5 * 1024 ** 3);
    assert.equal(parseSize("512kb"), 512 * 1024);
    assert.equal(parseSize("10 B"), 10);
    assert.equal(parseSize("0 MB"), 0);
  });

  it("rejects what isn't a size", () => {
    for (const bad of [
      -1,
      1.5,
      Number.NaN,
      "",
      "MB",
      "10 TB",
      "ten MB",
      "1e3 MB",
    ])
      assert.equal(parseSize(bad as number | string), undefined, String(bad));
  });

  it("formats with the largest unit that gives a whole number", () => {
    assert.equal(formatSize(60 * 1024 ** 2), "60 MB");
    assert.equal(formatSize(1.5 * 1024 ** 2), "1536 KB");
    assert.equal(formatSize(1536), "1536 B");
    assert.equal(formatSize(2 * 1024 ** 3), "2 GB");
    assert.equal(formatSize(0), "0 B");
  });

  it("shows sizes to people with one decimal", () => {
    assert.equal(humanSize(300 * 1024 ** 2), "300 MB");
    assert.equal(humanSize(314572801), "300 MB");
    assert.equal(humanSize(1.25 * 1024 ** 3), "1.3 GB");
    assert.equal(humanSize(900), "900 B");
  });

  it("reads a size back from its source text", () => {
    assert.equal(sizeFromSource(`"60 MB"`), 60 * 1024 ** 2);
    assert.equal(sizeFromSource(`'1 KB'`), 1024);
    assert.equal(sizeFromSource("2048"), 2048);
    assert.equal(sizeFromSource("size"), undefined);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx tsx --test src/steps/files.test.ts`
Expected: FAIL, `Cannot find module './files.js'`.

- [ ] **Step 3: Write the size helpers**

```ts
// src/steps/files.ts
const UNITS = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 } as const;
type Unit = keyof typeof UNITS;

/** Bytes for a size: a whole number of bytes, or a text like "60 MB", "1.5 GB", "512 KB" (powers of 1024) */
export function parseSize(size: number | string): number | undefined {
  if (typeof size === "number")
    return Number.isInteger(size) && size >= 0 ? size : undefined;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)\s*$/i.exec(size);
  if (!match) return undefined;
  return Math.round(Number(match[1]) * UNITS[match[2]!.toUpperCase() as Unit]);
}

/** A size in the largest unit that gives a whole number: 62914560 → "60 MB", 1536 → "1536 B" */
export function formatSize(bytes: number): string {
  for (const unit of ["GB", "MB", "KB"] as const) {
    if (bytes >= UNITS[unit] && bytes % UNITS[unit] === 0)
      return `${bytes / UNITS[unit]} ${unit}`;
  }
  return `${bytes} B`;
}

/** A size for people: the largest unit it reaches, one decimal at most ("300 MB", "1.3 GB") */
export function humanSize(bytes: number): string {
  for (const unit of ["GB", "MB", "KB"] as const) {
    if (bytes >= UNITS[unit])
      return `${Math.round((bytes / UNITS[unit]) * 10) / 10} ${unit}`;
  }
  return `${bytes} B`;
}

/** The bytes a size's source text means: a number literal, or a quoted size text */
export function sizeFromSource(text: string): number | undefined {
  if (/^\d+$/.test(text)) return parseSize(Number(text));
  const quoted = /^(["'`])(.*)\1$/s.exec(text);
  return quoted ? parseSize(quoted[2]!) : undefined;
}
```

- [ ] **Step 4: Run the size tests**

Run: `npx tsx --test src/steps/files.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the model types**

In `src/steps/model.ts`, before `/** The restricted set of statements the recorder writes. … */`, add:

```ts
/** A file generated when the step runs: seeded random bytes of `size`, never stored in the project */
export interface GeneratedFileSpec {
  name: string;
  /** Bytes */
  size: number;
  /** MIME type; `dropFiles` gives it to the page, `setInputFiles` gets it from the name's extension */
  type?: string;
  /** How the size is written in the source (`"60 MB"`, `1048576`); written back while it still means `size` */
  sizeSource?: string;
}

/** A file a step sets or drops: one stored in the project (relative to the project folder), or a generated one */
export type FileEntry = { path: string } | { generate: GeneratedFileSpec };
```

and add to the `Step` union, before the `custom` member:

```ts
  /** Sets the files of an `<input type=file>`; no files clears it */
  | { kind: "setInputFiles"; locator: LocatorSpec; files: FileEntry[] }
  /** Drops files on an element, as dragging them from the desktop does */
  | { kind: "dropFiles"; locator: LocatorSpec; files: FileEntry[] }
```

Export `FileEntry` and `GeneratedFileSpec` from `src/steps/index.ts` (type exports), and add `export { formatSize, humanSize, parseSize, sizeFromSource } from "./files.js";` and `filesToSource` to the `emit.js` export list.

- [ ] **Step 6: Write the failing codec tests**

Append to `src/steps/steps.test.ts`:

```ts
describe("file steps", () => {
  const input = {
    chain: [{ method: "getByLabel" as const, text: "Avatar" }],
    fallbacks: [],
  };
  const generated = (name: string, size: number, extra: object = {}) => ({
    generate: { name, size, ...extra },
  });

  it("round-trips one file, several, none and generated ones", () => {
    const steps: Step[] = [
      {
        kind: "setInputFiles",
        locator: input,
        files: [{ path: "files/avatar.png" }],
      },
      {
        kind: "dropFiles",
        locator: input,
        files: [{ path: "files/a.png" }, { path: "files/b.png" }],
      },
      { kind: "setInputFiles", locator: input, files: [] },
      {
        kind: "setInputFiles",
        locator: input,
        files: [
          generated("huge.pdf", 60 * 1024 ** 2, {
            type: "application/pdf",
            sizeSource: `"60 MB"`,
          }),
        ],
      },
      {
        kind: "dropFiles",
        locator: input,
        files: [generated("raw.bin", 2048, { sizeSource: "2048" })],
      },
    ];
    const source = wrap(...steps.map(stepToSource));
    assert.deepEqual(stepsOf(source), steps);
  });

  it("writes the source forms", () => {
    assert.equal(
      stepToSource({
        kind: "setInputFiles",
        locator: input,
        files: [{ path: "files/a.png" }],
      }),
      `await page.getByLabel("Avatar").setInputFiles("files/a.png");`,
    );
    assert.equal(
      stepToSource({ kind: "setInputFiles", locator: input, files: [] }),
      `await page.getByLabel("Avatar").setInputFiles([]);`,
    );
    assert.equal(
      stepToSource({
        kind: "dropFiles",
        locator: input,
        files: [generated("x.bin", 1536 * 1024)],
      }),
      `await page.getByLabel("Avatar").dropFiles(generatedFile({ name: "x.bin", size: "1536 KB" }));`,
    );
  });

  it("keeps the size as written while it still means the same size", () => {
    const [step] = stepsOf(
      wrap(
        `await page.getByLabel("Avatar").setInputFiles(generatedFile({ name: "a", size: "1024 KB" }));`,
      ),
    ) as [Extract<Step, { kind: "setInputFiles" }>];
    assert.match(stepToSource(step), /size: "1024 KB"/);
    const bigger = {
      ...step,
      files: [generated("a", 2 * 1024 ** 2, { sizeSource: `"1024 KB"` })],
    };
    assert.match(stepToSource(bigger), /size: "2 MB"/);
  });

  it("keeps other arguments as custom code", () => {
    for (const code of [
      `await page.getByLabel("Avatar").setInputFiles(file);`,
      `await page.getByLabel("Avatar").setInputFiles("a.png", { timeout: 1 });`,
      `await page.getByLabel("Avatar").dropFiles(generatedFile({ name: "a", size: "lots" }));`,
      `await page.getByLabel("Avatar").dropFiles(generatedFile({ name: "a", size: 1, extra: 1 }));`,
      `await page.getByLabel("Avatar").setInputFiles(["a.png", other]);`,
    ])
      assert.equal(stepsOf(wrap(code))[0]!.kind, "custom", code);
  });

  it("adds generatedFile to the import test comes from, once", () => {
    const source = `import { expect, test } from "@itmetsam/samurai-framework";\n\ntest("t", async ({ page }) => {\n});\n`;
    const step: Step = {
      kind: "dropFiles",
      locator: input,
      files: [generated("a.bin", 1)],
    };
    let next = applyEdit(source, { op: "insert", test: 0, index: 0, step });
    next = applyEdit(next, { op: "insert", test: 0, index: 1, step });
    assert.match(
      next,
      /^import \{ expect, test, generatedFile \} from "@itmetsam\/samurai-framework";/,
    );
    assert.equal(next.match(/generatedFile \}/g)?.length, 1);
  });

  it("leaves an existing generatedFile import alone, and adds an import when test isn't imported", () => {
    const own = `import { test } from "@itmetsam/samurai-framework";\nimport { generatedFile } from "@itmetsam/samurai-framework";\n\ntest("t", async ({ page }) => {\n});\n`;
    const step: Step = {
      kind: "dropFiles",
      locator: input,
      files: [generated("a.bin", 1)],
    };
    assert.equal(
      applyEdit(own, { op: "insert", test: 0, index: 0, step }).match(
        /generatedFile/g,
      )?.length,
      2, // the import and the step
    );
    const bare = `test("t", async ({ page }) => {\n});\n`;
    assert.match(
      applyEdit(bare, { op: "insert", test: 0, index: 0, step }),
      /^import \{ generatedFile \} from "@itmetsam\/samurai-framework";\n/,
    );
  });

  it("a path-only step adds no import", () => {
    const source = `import { test } from "x";\n\ntest("t", async ({ page }) => {\n});\n`;
    const next = applyEdit(source, {
      op: "insert",
      test: 0,
      index: 0,
      step: {
        kind: "setInputFiles",
        locator: input,
        files: [{ path: "files/a.png" }],
      },
    });
    assert.ok(next.startsWith(`import { test } from "x";`));
  });
});
```

- [ ] **Step 7: Run them to see them fail**

Run: `npx tsx --test src/steps/steps.test.ts`
Expected: FAIL in "file steps" (the statements parse as `custom`).

- [ ] **Step 8: Parse the new kinds**

In `src/steps/parse.ts`, import `FileEntry` from `./model.js` and `parseSize` from `./files.js`, and add above `readStep`:

```ts
/** `"path"` or `generatedFile({ name, size, type? })`; undefined for anything else */
function readFileEntry(node: ts.Expression): FileEntry | undefined {
  const path = stringOf(node);
  if (path !== undefined) return { path };
  if (
    !ts.isCallExpression(node) ||
    !ts.isIdentifier(node.expression) ||
    node.expression.text !== "generatedFile" ||
    node.arguments.length !== 1 ||
    !ts.isObjectLiteralExpression(node.arguments[0]!)
  )
    return undefined;
  let name: string | undefined;
  let type: string | undefined;
  let size: number | undefined;
  let sizeSource: string | undefined;
  for (const property of node.arguments[0].properties) {
    if (!ts.isPropertyAssignment(property)) return undefined;
    const value = property.initializer;
    switch (property.name.getText()) {
      case "name":
        name = stringOf(value);
        if (name === undefined) return undefined;
        break;
      case "type":
        type = stringOf(value);
        if (type === undefined) return undefined;
        break;
      case "size": {
        const text = stringOf(value);
        size =
          text !== undefined
            ? parseSize(text)
            : ts.isNumericLiteral(value)
              ? parseSize(Number(value.text))
              : undefined;
        if (size === undefined) return undefined;
        sizeSource = value.getText();
        break;
      }
      default:
        return undefined;
    }
  }
  if (name === undefined || size === undefined) return undefined;
  return {
    generate: {
      name,
      size,
      ...(type !== undefined && { type }),
      ...(sizeSource !== undefined && { sizeSource }),
    },
  };
}

/** One file entry, or an array of them */
function readFiles(node: ts.Expression | undefined): FileEntry[] | undefined {
  if (!node) return undefined;
  if (ts.isArrayLiteralExpression(node)) {
    const entries = node.elements.map(readFileEntry);
    return entries.every((entry) => entry !== undefined)
      ? (entries as FileEntry[])
      : undefined;
  }
  const entry = readFileEntry(node);
  return entry && [entry];
}
```

and in `readStep`, right after the `fill` branch (`if (name.text === "fill" && args.length === 1) {…}`):

```ts
if (
  (name.text === "setInputFiles" || name.text === "dropFiles") &&
  args.length === 1
) {
  const files = readFiles(args[0]);
  return files
    ? { kind: name.text as "setInputFiles" | "dropFiles", locator, files }
    : undefined;
}
```

- [ ] **Step 9: Emit the new kinds**

In `src/steps/emit.ts`, import `FileEntry` and add `formatSize`, `sizeFromSource` from `./files.js`:

```ts
function fileEntryToSource(entry: FileEntry): string {
  if ("path" in entry) return str(entry.path);
  const { name, size, type, sizeSource } = entry.generate;
  const sizeText =
    sizeSource !== undefined && sizeFromSource(sizeSource) === size
      ? sizeSource
      : str(formatSize(size));
  return `generatedFile({ name: ${str(name)}, size: ${sizeText}${type === undefined ? "" : `, type: ${str(type)}`} })`;
}

/** The argument of `setInputFiles` / `dropFiles`: one entry bare, else an array */
export function filesToSource(files: readonly FileEntry[]): string {
  return files.length === 1
    ? fileEntryToSource(files[0]!)
    : `[${files.map(fileEntryToSource).join(", ")}]`;
}
```

and in `stepToSource`, before `case "custom":`:

```ts
    case "setInputFiles":
    case "dropFiles":
      return `await ${locatorToSource(step.locator)}.${step.kind}(${filesToSource(step.files)});`;
```

- [ ] **Step 10: Add the import when a step needs it**

In `src/steps/edit.ts`, add `import ts from "typescript";` and:

```ts
const usesGeneratedFile = (step: Step) =>
  (step.kind === "setInputFiles" || step.kind === "dropFiles") &&
  step.files.some((file) => "generate" in file);

/** Adds `generatedFile` to the import `test` comes from (or a new import) unless the file imports it */
function withGeneratedFileImport(source: string): string {
  const file = ts.createSourceFile(
    "spec.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let testImport: ts.NamedImports | undefined;
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const named = statement.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    const names = named.elements.map((e) => (e.propertyName ?? e.name).text);
    if (names.includes("generatedFile")) return source;
    if (names.includes("test")) testImport ??= named;
  }
  if (!testImport)
    return `import { generatedFile } from "@itmetsam/samurai-framework";\n${source}`;
  const last = testImport.elements[testImport.elements.length - 1]!;
  return splice(source, last.end, last.end, ", generatedFile");
}
```

In `applyEdit`, wrap the results of `replace` and `insert` (after `withFixtures`):

```ts
    case "replace": {
      const { start, end } = pickStep(parsed, edit.index);
      // The parameters come before the body: adding to them leaves the step's offsets valid
      const next = withFixtures(
        splice(source, start, end, stepToSource(edit.step)),
        parsed,
        edit.step,
      );
      // Last: the import shifts every offset
      return usesGeneratedFile(edit.step) ? withGeneratedFileImport(next) : next;
    }
    case "insert": {
      const next = withFixtures(
        insertCode(source, parsed, edit.index, stepToSource(edit.step)),
        parsed,
        edit.step,
      );
      return usesGeneratedFile(edit.step) ? withGeneratedFileImport(next) : next;
    }
```

- [ ] **Step 11: Run the steps tests**

Run: `npx tsx --test src/steps/steps.test.ts src/steps/files.test.ts && npx tsc --noEmit -p .`
Expected: PASS, no type errors. If `tsc` reports a `switch` on `step.kind` without the new kinds elsewhere (for example `src/recorder/toolbar/controller.ts`), leave it unless it is an error; a non-exhaustive `switch` with a `default` is fine.

- [ ] **Step 12: Commit**

```bash
git add src/steps
git commit -m "feat: setInputFiles and dropFiles steps, with generated files and sizes"
```

### Task 3: Running file steps: project paths, generated files, dropFiles

**Files:**

- Create: `src/browser/generated-files.ts`
- Modify: `src/locator/locator.ts`, `src/runner/project.ts`, `src/api.ts`
- Test: `src/browser/generated-files.test.ts`, `src/locator/drop-files.browser-test.ts`

**Interfaces:**

- Consumes: `parseSize` (Task 2).
- Produces:
  - `generatedFile(options: { name: string; size: number | string; type?: string }): GeneratedFile` (public export of the package)
  - `isGeneratedFile(value: unknown): value is GeneratedFile`, `type FileInput = string | GeneratedFile`
  - `resolveFileInputs(files: FileInput | FileInput[], operation: string): Promise<string[]>`
  - `removeGeneratedFiles(): Promise<void>`
  - `locator.setInputFiles(files: FileInput | FileInput[], options?)`, `locator.dropFiles(files: FileInput | FileInput[], options?: { timeout?: number })`

- [ ] **Step 1: Write the failing unit tests**

```ts
// src/browser/generated-files.test.ts
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { setActiveProject } from "../config/config.js";
import {
  generatedFile,
  isGeneratedFile,
  removeGeneratedFiles,
  resolveFileInputs,
} from "./generated-files.js";

const sha = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

describe("generated files", () => {
  afterEach(async () => {
    await removeGeneratedFiles();
    setActiveProject(undefined);
  });

  it("checks name and size", () => {
    assert.equal(generatedFile({ name: "a.pdf", size: "2 KB" }).size, 2048);
    assert.ok(isGeneratedFile(generatedFile({ name: "a", size: 1 })));
    assert.ok(!isGeneratedFile({ name: "a", size: 1 }));
    assert.throws(
      () => generatedFile({ name: "a", size: "lots" }),
      /size must be/,
    );
    assert.throws(
      () => generatedFile({ name: "", size: 1 }),
      /name must be a file name/,
    );
    assert.equal(generatedFile({ name: "dir/a.bin", size: 1 }).name, "a.bin");
  });

  it("writes the exact size under result/files, the same bytes every run, and removes them", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "samurai-gen-"));
    setActiveProject({ dir });
    const entry = generatedFile({ name: "big.bin", size: 3 * 1024 * 1024 + 5 });
    const [file] = await resolveFileInputs(entry, "setInputFiles");
    assert.equal(path.dirname(file!), path.join(dir, "result", "files"));
    assert.equal(statSync(file!).size, 3 * 1024 * 1024 + 5);
    const first = sha(file!);
    assert.deepEqual(
      await resolveFileInputs([entry, entry], "x"),
      [file, file],
      "written once per run",
    );
    await removeGeneratedFiles();
    assert.ok(!existsSync(file!));
    const [again] = await resolveFileInputs(entry, "setInputFiles");
    assert.equal(sha(again!), first);
  });

  it("resolves project paths against the project folder and names missing ones", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "samurai-gen-"));
    mkdirSync(path.join(dir, "files"));
    writeFileSync(path.join(dir, "files", "a.txt"), "a");
    setActiveProject({ dir });
    assert.deepEqual(await resolveFileInputs("files/a.txt", "setInputFiles"), [
      path.join(dir, "files", "a.txt"),
    ]);
    await assert.rejects(
      resolveFileInputs("files/b.txt", "dropFiles"),
      new Error("dropFiles(): files/b.txt doesn't exist in the project"),
    );
    const absolute = path.join(dir, "nope.txt");
    await assert.rejects(
      resolveFileInputs(absolute, "setInputFiles"),
      new Error(`setInputFiles(): file not found: ${absolute}`),
    );
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx tsx --test src/browser/generated-files.test.ts`
Expected: FAIL, `Cannot find module './generated-files.js'`.

- [ ] **Step 3: Write the generated-files module**

```ts
// src/browser/generated-files.ts
import { createHash } from "node:crypto";
import { mkdir, open, rm, stat } from "node:fs/promises";
import path from "node:path";
import { projectDir } from "../config/config.js";
import { parseSize } from "../steps/files.js";

const GENERATED = Symbol.for("samurai.generatedFile");
const CHUNK = 1024 * 1024;

/** A file `setInputFiles` and `dropFiles` write when the step runs, instead of one stored in the project */
export interface GeneratedFile {
  readonly [GENERATED]: true;
  readonly name: string;
  /** Bytes */
  readonly size: number;
  readonly type?: string;
}

/** What `setInputFiles` and `dropFiles` take: a path (relative to the project folder) or a generated file */
export type FileInput = string | GeneratedFile;

/**
 * A file of `size` written when the step runs: seeded random bytes, the same in every run and not
 * compressible, under `result/files/`, removed when the run ends. For upload limits and load tests.
 * `size` is bytes or a text with a unit (`"60 MB"`, `"1.5 GB"`; powers of 1024). `type` is the MIME type
 * `dropFiles` gives the page; for `setInputFiles` the browser takes it from the name's extension.
 * @example
 *  await page.getByLabel("Upload").setInputFiles(generatedFile({ name: "huge.pdf", size: "60 MB" }));
 */
export function generatedFile(options: {
  name: string;
  size: number | string;
  type?: string;
}): GeneratedFile {
  const size = parseSize(options.size);
  if (size === undefined)
    throw new Error(
      `generatedFile(): size must be a number of bytes or a text like "60 MB", got ${JSON.stringify(options.size)}`,
    );
  const name = path.basename(String(options.name ?? ""));
  if (name === "" || name === "." || name === "..")
    throw new Error(
      `generatedFile(): name must be a file name, got ${JSON.stringify(options.name)}`,
    );
  return Object.freeze({
    [GENERATED]: true as const,
    name,
    size,
    ...(options.type !== undefined && { type: options.type }),
  });
}

export const isGeneratedFile = (value: unknown): value is GeneratedFile =>
  typeof value === "object" &&
  value !== null &&
  (value as Record<symbol, unknown>)[GENERATED] === true;

let folder: string | undefined;
const written = new Map<string, Promise<string>>();

/** xorshift32, seeded from the name and size */
function seedOf(file: GeneratedFile): number {
  const seed = createHash("sha256")
    .update(`${file.size}:${file.name}`)
    .digest()
    .readUInt32LE(0);
  return seed === 0 ? 1 : seed;
}

async function write(
  target: string,
  size: number,
  seed: number,
): Promise<void> {
  const handle = await open(target, "w");
  try {
    const chunk = Buffer.alloc(CHUNK);
    let state = seed;
    for (let done = 0; done < size; done += CHUNK) {
      for (let i = 0; i < CHUNK; i += 4) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        state >>>= 0;
        chunk.writeUInt32LE(state, i);
      }
      await handle.write(chunk, 0, Math.min(CHUNK, size - done));
    }
  } finally {
    await handle.close();
  }
}

/** The generated file on disk; written once per run for the same name and size */
function generatedPath(file: GeneratedFile): Promise<string> {
  folder ??= path.join(projectDir(), "result", "files");
  const key = `${file.size}-${file.name}`;
  let pending = written.get(key);
  if (!pending) {
    const dir = folder;
    pending = (async () => {
      await mkdir(dir, { recursive: true });
      const target = path.join(dir, key);
      await write(target, file.size, seedOf(file));
      return target;
    })();
    written.set(key, pending);
    pending.catch(() => written.delete(key));
  }
  return pending;
}

/** Removes this run's generated files (`withProject` calls it when the run ends) */
export async function removeGeneratedFiles(): Promise<void> {
  const dir = folder;
  folder = undefined;
  const pending = [...written.values()];
  written.clear();
  await Promise.allSettled(pending);
  if (dir) await rm(dir, { recursive: true, force: true });
}

/** Absolute paths for `setInputFiles` / `dropFiles`: generated files are written, project files must exist */
export async function resolveFileInputs(
  files: FileInput | FileInput[],
  operation: string,
): Promise<string[]> {
  const paths: string[] = [];
  for (const file of Array.isArray(files) ? files : [files]) {
    if (isGeneratedFile(file)) {
      paths.push(await generatedPath(file));
      continue;
    }
    if (typeof file !== "string")
      throw new TypeError(
        `${operation}(): expected a path or generatedFile(…), got ${typeof file}`,
      );
    const absolute = path.resolve(projectDir(), file);
    let info;
    try {
      info = await stat(absolute);
    } catch {
      throw new Error(
        path.isAbsolute(file)
          ? `${operation}(): file not found: ${absolute}`
          : `${operation}(): ${file.replace(/\\/g, "/")} doesn't exist in the project`,
      );
    }
    if (!info.isFile())
      throw new Error(`${operation}(): not a file: ${absolute}`);
    paths.push(absolute);
  }
  return paths;
}
```

- [ ] **Step 4: Run the unit tests**

Run: `npx tsx --test src/browser/generated-files.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing browser test for the locator**

```ts
// src/locator/drop-files.browser-test.ts
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

const DROPZONE = `<div id="zone" style="width:200px;height:100px">Drop</div>
<script>
  const zone = document.getElementById("zone");
  zone.addEventListener("dragover", (e) => e.preventDefault());
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.dataset.got = JSON.stringify(Array.from(e.dataTransfer.files, (f) => [f.name, f.size, f.type]));
    zone.dataset.events = (zone.dataset.events || "") + "drop";
  });
  zone.addEventListener("dragenter", () => { zone.dataset.events = (zone.dataset.events || "") + "enter,"; });
</script>`;

test(
  "dropFiles drops project files and generated ones on a real drop handler",
  OPTIONS,
  async () => {
    setActiveProject({ dir });
    await setContent(page, DROPZONE);
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
    setActiveProject({ dir });
    await setContent(page, `<input type="file" id="f" multiple>`);
    await page
      .getByCss("#f")
      .setInputFiles([
        "files/a.txt",
        generatedFile({ name: "g.bin", size: 10 }),
      ]);
    const sizes = await page.evaluate(
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
      /dropFiles\(\).*not visible|was not visible/,
    );
  },
);

test("the page never sees the helper input", OPTIONS, async () => {
  await setContent(
    page,
    `${DROPZONE}<script>window.seen = 0; new MutationObserver((m) => { window.seen += m.length; }).observe(document, { childList: true, subtree: true });</script>`,
  );
  await page.getByCss("#zone").dropFiles(generatedFile({ name: "a", size: 1 }));
  assert.equal(await page.evaluate("window.seen"), 0);
});
```

If `page.evaluate` is not the name of the page's script call in this codebase, use the one `src/browser/page-api.browser-test.ts` uses.

- [ ] **Step 6: Run it to see it fail**

Run: `npx tsx --test --test-concurrency=1 src/locator/drop-files.browser-test.ts`
Expected: FAIL, `dropFiles is not a function`.

- [ ] **Step 7: Change `setInputFiles`, add `dropFiles`**

In `src/locator/locator.ts`:

```ts
import {
  isGeneratedFile,
  resolveFileInputs,
  type FileInput,
} from "../browser/generated-files.js";
```

Remove the `resolveFiles` / `assertIsFile` import if nothing else in the file uses it. Change `setInputFiles`:

```ts
  /**
   * Sets the files of an `<input type=file>`; `[]` clears it. Paths are relative to the project folder (absolute
   * ones are used as they are); `generatedFile(…)` writes a file of a given size when the step runs.
   * Waits for the input to be attached and enabled; it need not be visible, file inputs are often hidden behind a label.
   * @example
   *  await page.getByLabel("Avatar").setInputFiles("files/avatar.png");
   *  await page.getByLabel("Upload").setInputFiles(generatedFile({ name: "huge.pdf", size: "60 MB" }));
   */
  public async setInputFiles(
    files: FileInput | FileInput[],
    options?: { timeout?: number },
  ): Promise<void> {
    const paths = await resolveFileInputs(files, "setInputFiles");
```

(the rest of the method stays). Add, after `setInputFiles`:

```ts
  /**
   * Drops files on the element, as dragging them from the desktop does: `dragenter`, `dragover` and `drop`
   * with a `DataTransfer` holding the files. Takes what `setInputFiles` takes. The events are synthetic
   * (`isTrusted` is false); a page that only accepts trusted drops ignores them.
   * Waits for the element to be attached and visible.
   * @example
   *  await page.getByTestId("dropzone").dropFiles(["files/a.png", "files/b.png"]);
   */
  public async dropFiles(
    files: FileInput | FileInput[],
    options?: { timeout?: number },
  ): Promise<void> {
    const list = Array.isArray(files) ? files : [files];
    const paths = await resolveFileInputs(list, "dropFiles");
    const types = list.map((file) => (isGeneratedFile(file) ? (file.type ?? "") : ""));
    await this.waitForActionable(
      "dropFiles",
      DROP_CHECKS,
      { scroll: true, hitTest: false },
      options?.timeout === undefined ? undefined : { timeout: options.timeout },
    );
    const el = await this.resolveOne();
    if (!el)
      throw new Error(`Failed to locate element ${this.selector}. Details: no element matches`);
    // A file input of our own, made in a sandbox and never attached: the page doesn't see it
    const input = await this.call<ElementHandle>(DROP_INPUT, [], DROP_SANDBOX);
    await this.biDiConnector.send("input.setFiles", {
      context: this.contextId,
      element: { sharedId: input.sharedId },
      files: paths,
    });
    await this.call(DROP_EVENTS, [el, types], DROP_SANDBOX);
  }
```

and near the other constants:

```ts
const DROP_CHECKS: readonly CheckName[] = ["attached", "visible"];
/** The sandbox `dropFiles` builds its files in */
const DROP_SANDBOX = "samurai-drop";
const DROP_KEY = `globalThis[Symbol.for("samurai.drop")]`;
const DROP_INPUT = `() => {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  ${DROP_KEY} = input;
  return input;
}`;
/** Fires dragenter, dragover and drop at the element's centre with the input's files (retyped where asked) */
const DROP_EVENTS = `(el, types) => {
  const input = ${DROP_KEY};
  delete ${DROP_KEY};
  const data = new DataTransfer();
  Array.from(input.files).forEach((file, i) => {
    data.items.add(types[i] ? new File([file], file.name, { type: types[i], lastModified: file.lastModified }) : file);
  });
  const box = el.getBoundingClientRect();
  const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
  for (const type of ["dragenter", "dragover", "drop"]) {
    el.dispatchEvent(new DragEvent(type, Object.assign({ bubbles: true, cancelable: true, composed: true, dataTransfer: data }, at)));
  }
}`;
```

Import `ElementHandle` as a type if `locator.ts` doesn't already. If `input.setFiles` refuses an element that isn't connected (the browser test shows it), attach the input to `document.documentElement` with `hidden` before `setFiles` and remove it in `DROP_EVENTS`, and drop the "page never sees the helper input" test with a ledger note.

- [ ] **Step 8: Remove generated files when a run ends; export `generatedFile`**

In `src/runner/project.ts`, import `removeGeneratedFiles` and add it first in `finally`:

```ts
  } finally {
    await removeGeneratedFiles().catch(() => undefined);
    setRunSettings(undefined);
```

In `src/api.ts` add:

```ts
export {
  generatedFile,
  type GeneratedFile,
  type FileInput,
} from "./browser/generated-files.js";
```

- [ ] **Step 9: Run the tests**

Run: `npx tsx --test --test-concurrency=1 src/locator/drop-files.browser-test.ts src/locator/set-files.browser-test.ts && npx tsx --test src/locator/set-files.test.ts src/browser/generated-files.test.ts && npx tsc --noEmit -p .`
Expected: PASS. `set-files.test.ts` keeps passing: its paths are absolute, so the messages are unchanged.

- [ ] **Step 10: Commit**

```bash
git add src/browser/generated-files.ts src/browser/generated-files.test.ts src/locator src/runner/project.ts src/api.ts
git commit -m "feat: generatedFile, project-relative setInputFiles, and locator.dropFiles"
```

### Task 4: The file store and `filesDir`

**Files:**

- Create: `src/project/files-store.ts`
- Modify: `src/project/index.ts`, `src/types/config.d.ts`
- Test: `src/project/files-store.test.ts`

**Interfaces:**

- Produces:
  - `RECORD_LIMIT = 50 * 1024 * 1024`
  - `cleanFileName(name: string): string`
  - `filesFolder(projectDir: string, filesDir?: string): { absolute: string; relative: string /* posix, e.g. "files" */ }`
  - `storeFile(options: { projectDir: string; filesDir?: string; name: string; content: string }): Promise<{ path: string; reused: boolean }>`: `content` is a file holding the bytes, left in place; `path` is project-relative posix (`files/a.png`)
  - `isFolderIgnored(projectDir: string, relative: string): Promise<boolean>`
  - `SamuraiTestConfig.filesDir?: string`
  - All exported from `@itmetsam/samurai-framework/project`

- [ ] **Step 1: Write the failing tests**

```ts
// src/project/files-store.test.ts
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  cleanFileName,
  filesFolder,
  isFolderIgnored,
  storeFile,
} from "./files-store.js";

const project = () => mkdtempSync(path.join(tmpdir(), "samurai-store-"));
function content(text: string) {
  const file = path.join(
    mkdtempSync(path.join(tmpdir(), "samurai-content-")),
    "content",
  );
  writeFileSync(file, text);
  return file;
}

describe("cleanFileName", () => {
  it("keeps a plain name", () =>
    assert.equal(cleanFileName("avatar.png"), "avatar.png"));
  it("drops folders, control characters and leading dots", () => {
    assert.equal(cleanFileName("../../etc/passwd"), "passwd");
    assert.equal(cleanFileName("C:\\Users\\sam\\cv.pdf"), "cv.pdf");
    assert.equal(cleanFileName("a\u0000b\nc.txt"), "abc.txt");
    assert.equal(cleanFileName(".env"), "env");
  });
  it("names an empty result file", () => {
    for (const name of ["", "...", "../..", "/", "  "])
      assert.equal(cleanFileName(name), "file", name);
  });
  it("caps long names at 120 characters, keeping the extension", () => {
    const cleaned = cleanFileName(`${"x".repeat(300)}.png`);
    assert.equal(cleaned.length, 120);
    assert.ok(cleaned.endsWith(".png"));
  });
});

describe("storeFile", () => {
  it("stores a new file under its cleaned name and reports its project path", async () => {
    const dir = project();
    const stored = await storeFile({
      projectDir: dir,
      name: "My CV.pdf",
      content: content("cv"),
    });
    assert.deepEqual(stored, { path: "files/My CV.pdf", reused: false });
    assert.equal(
      readFileSync(path.join(dir, "files", "My CV.pdf"), "utf8"),
      "cv",
    );
  });

  it("reuses identical content, whatever its name", async () => {
    const dir = project();
    await storeFile({
      projectDir: dir,
      name: "a.png",
      content: content("same"),
    });
    assert.deepEqual(
      await storeFile({
        projectDir: dir,
        name: "b.png",
        content: content("same"),
      }),
      {
        path: "files/a.png",
        reused: true,
      },
    );
    assert.deepEqual(readdirSync(path.join(dir, "files")), ["a.png"]);
  });

  it("gives a name taken by other content -2, -3, and never overwrites", async () => {
    const dir = project();
    await storeFile({
      projectDir: dir,
      name: "a.png",
      content: content("one"),
    });
    assert.equal(
      (
        await storeFile({
          projectDir: dir,
          name: "a.png",
          content: content("two"),
        })
      ).path,
      "files/a-2.png",
    );
    assert.equal(
      (
        await storeFile({
          projectDir: dir,
          name: "a.png",
          content: content("three"),
        })
      ).path,
      "files/a-3.png",
    );
    assert.equal(readFileSync(path.join(dir, "files", "a.png"), "utf8"), "one");
  });

  it("leaves the content file in place", async () => {
    const source = content("keep");
    await storeFile({ projectDir: project(), name: "k.txt", content: source });
    assert.equal(readFileSync(source, "utf8"), "keep");
  });

  it("uses filesDir, and stores a name of dots and slashes as file, inside the folder", async () => {
    const dir = project();
    const stored = await storeFile({
      projectDir: dir,
      filesDir: "test-data/uploads",
      name: "../..",
      content: content("x"),
    });
    assert.equal(stored.path, "test-data/uploads/file");
  });

  it("only hashes files of the same size", async () => {
    const dir = project();
    mkdirSync(path.join(dir, "files"));
    writeFileSync(path.join(dir, "files", "other.bin"), "different length");
    assert.equal(
      (
        await storeFile({
          projectDir: dir,
          name: "n.bin",
          content: content("n"),
        })
      ).reused,
      false,
    );
  });
});

describe("files folder", () => {
  it("is files/ by default, relative to the project", () => {
    const dir = project();
    assert.deepEqual(filesFolder(dir), {
      absolute: path.join(dir, "files"),
      relative: "files",
    });
    assert.equal(filesFolder(dir, "./a/b/").relative, "a/b");
  });

  it("knows when git ignores it", async () => {
    const dir = project();
    assert.equal(await isFolderIgnored(dir, "files"), false);
    for (const line of [
      "files",
      "files/",
      "/files",
      "/files/",
      "files/*",
      "files/**",
    ]) {
      writeFileSync(path.join(dir, ".gitignore"), `node_modules\n${line}\n`);
      assert.equal(await isFolderIgnored(dir, "files"), true, line);
    }
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx tsx --test src/project/files-store.test.ts`
Expected: FAIL, `Cannot find module './files-store.js'`.

- [ ] **Step 3: Write the store**

```ts
// src/project/files-store.ts
import { constants, createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

/** Files bigger than this aren't stored while recording */
export const RECORD_LIMIT = 50 * 1024 * 1024;
const NAME_LIMIT = 120;

/** A picked file's name as a file name in the files folder: no folders, control characters or leading dots */
export function cleanFileName(name: string): string {
  let cleaned = (name.split(/[\\/]/).pop() ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .replace(/^\.+/, "")
    .trim();
  if (cleaned.length > NAME_LIMIT) {
    const ext = path.extname(cleaned);
    const keep = ext.length > 0 && ext.length < 20 ? ext : "";
    cleaned = cleaned.slice(0, NAME_LIMIT - keep.length) + keep;
  }
  return cleaned === "" ? "file" : cleaned;
}

/** The files folder: absolute, and relative to the project with forward slashes */
export function filesFolder(
  projectDir: string,
  filesDir = "files",
): { absolute: string; relative: string } {
  const absolute = path.resolve(projectDir, filesDir);
  return {
    absolute,
    relative: path.relative(projectDir, absolute).split(path.sep).join("/"),
  };
}

function hashOf(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
}

/**
 * Stores the bytes in `content` in the files folder, once: a file there with the same content is reused,
 * whatever its name; a name taken by other content gets -2, -3, …. Nothing is overwritten and nothing is
 * written outside the folder. `content` is left in place. Returns the project-relative path.
 */
export async function storeFile(options: {
  projectDir: string;
  filesDir?: string;
  name: string;
  content: string;
}): Promise<{ path: string; reused: boolean }> {
  const { absolute, relative } = filesFolder(
    options.projectDir,
    options.filesDir,
  );
  const projectPath = (file: string) => `${relative}/${path.basename(file)}`;
  const { size } = await stat(options.content);
  await mkdir(absolute, { recursive: true });

  let hash: string | undefined;
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const candidate = path.join(absolute, entry.name);
    if ((await stat(candidate)).size !== size) continue;
    hash ??= await hashOf(options.content);
    if ((await hashOf(candidate)) === hash)
      return { path: projectPath(candidate), reused: true };
  }

  const name = cleanFileName(options.name);
  const ext = path.extname(name);
  const stem = ext === "" || ext === name ? name : name.slice(0, -ext.length);
  for (let n = 1; ; n++) {
    const target = path.join(
      absolute,
      n === 1 ? name : `${stem}-${n}${ext === name ? "" : ext}`,
    );
    if (path.dirname(target) !== absolute)
      throw new Error(`${options.name} can't be stored in ${relative}/`);
    try {
      await copyFile(options.content, target, constants.COPYFILE_EXCL);
      return { path: projectPath(target), reused: false };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
}

/** Whether the project's .gitignore ignores the folder (`files`, `files/`, `/files`, `files/*`, `files/**`) */
export async function isFolderIgnored(
  projectDir: string,
  relative: string,
): Promise<boolean> {
  let text: string;
  try {
    text = await readFile(path.join(projectDir, ".gitignore"), "utf8");
  } catch {
    return false;
  }
  return text.split(/\r?\n/).some((line) => {
    const pattern = line
      .trim()
      .replace(/^\//, "")
      .replace(/\/(\*\*?)?$/, "");
    return pattern === relative;
  });
}
```

- [ ] **Step 4: Export, and type `filesDir`**

In `src/project/index.ts`:

```ts
export {
  cleanFileName,
  filesFolder,
  isFolderIgnored,
  RECORD_LIMIT,
  storeFile,
} from "./files-store.js";
```

In `src/types/config.d.ts`, after `downloadsDir`:

```ts
  /**
   * Folder, relative to the project folder, where recorded uploads are stored and committed with the tests
   * @default "files"
   */
  filesDir?: string;
```

- [ ] **Step 5: Run the tests**

Run: `npx tsx --test src/project/files-store.test.ts && npx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/project src/types/config.d.ts
git commit -m "feat: a files folder that stores each content once, and filesDir"
```

### Task 5: The normaliser: file steps, picker clicks and the remove event

**Files:**

- Modify: `src/recorder/normalise.ts`, `src/recorder/apply.ts`, `src/recorder/session.ts` (`resultSecrets`), `src/cli/main.ts` (`onEvent`)
- Test: `src/recorder/normalise.test.ts`, `src/recorder/session.test.ts`

**Interfaces:**

- Consumes: `FileEntry` (Task 2).
- Produces:
  - `RecorderEvent` gains `{ op: "remove"; index: number }`
  - `Observation` gains `{ type: "picker" }`, `{ type: "picker-cancel" }`, `{ type: "files"; via: "input" | "drop"; locator: LocatorSpec; files: FileEntry[] }`
  - `PICKER_WINDOW = 1000` (ms between a click and the picker it opened)

- [ ] **Step 1: Write the failing tests**

Append to `src/recorder/normalise.test.ts` (reuse its existing `Normaliser` import and locator constants; this block defines its own):

```ts
describe("file uploads", () => {
  const button: LocatorSpec = {
    chain: [{ method: "getByRole", role: "button", name: "Upload" }],
    fallbacks: [],
  };
  const input: LocatorSpec = {
    chain: [{ method: "getByLabel", text: "Avatar" }],
    fallbacks: [],
  };
  const zone: LocatorSpec = {
    chain: [{ method: "getByTestId", testId: "zone" }],
    fallbacks: [],
  };
  const files = [{ path: "files/a.png" }];
  const click = (at: number) =>
    ({ type: "click", key: "b", locator: button, textEntry: false }) as const;

  it("records a change without a picker click as a new step", () => {
    const n = new Normaliser({ at: 0 });
    assert.deepEqual(
      n.observe({ type: "files", via: "input", locator: input, files }, 0),
      [
        {
          op: "insert",
          index: 0,
          step: { kind: "setInputFiles", locator: input, files },
        },
      ],
    );
  });

  it("replaces the click that opened the picker", () => {
    const n = new Normaliser({ at: 0 });
    n.observe(click(0), 0);
    assert.deepEqual(n.observe({ type: "picker" }, 50), []);
    assert.deepEqual(
      n.observe({ type: "files", via: "input", locator: input, files }, 9000),
      [
        {
          op: "replace",
          index: 0,
          step: { kind: "setInputFiles", locator: input, files },
        },
      ],
    );
    assert.equal(n.nextIndex, 1);
  });

  it("removes the click when the picker is cancelled", () => {
    const n = new Normaliser({ at: 3 });
    n.observe(click(0), 0);
    n.observe({ type: "picker" }, 10);
    assert.deepEqual(n.observe({ type: "picker-cancel" }, 5000), [
      { op: "remove", index: 3 },
    ]);
    assert.equal(n.nextIndex, 3);
  });

  it("ignores a picker long after the click, or after another step", () => {
    const late = new Normaliser({ at: 0 });
    late.observe(click(0), 0);
    late.observe({ type: "picker" }, 5000);
    assert.equal(
      late.observe(
        { type: "files", via: "input", locator: input, files },
        6000,
      )[0]!.op,
      "insert",
    );

    const other = new Normaliser({ at: 0 });
    other.observe(click(0), 0);
    other.observe({ type: "picker" }, 10);
    other.observe({ type: "wait-idle" }, 20);
    assert.deepEqual(other.observe({ type: "picker-cancel" }, 30), []);
  });

  it("records a drop as dropFiles, never replacing a click", () => {
    const n = new Normaliser({ at: 0 });
    n.observe(click(0), 0);
    n.observe({ type: "picker" }, 10);
    assert.deepEqual(
      n.observe({ type: "files", via: "drop", locator: zone, files }, 20),
      [
        {
          op: "insert",
          index: 1,
          step: { kind: "dropFiles", locator: zone, files },
        },
      ],
    );
  });

  it("a navigation right after an upload is a wait, not a goto", () => {
    const n = new Normaliser({ at: 0 });
    n.observe({ type: "files", via: "input", locator: input, files }, 0);
    assert.equal(
      n.navigated("http://x/next", 500)[0]!.step?.kind,
      "waitForNetworkIdle",
    );
  });
});
```

(If `navigated` returns events typed as a union with `remove`, write `(n.navigated(…)[0] as { step: Step }).step.kind`.)

Append to `src/recorder/session.test.ts`:

```ts
test("resultSecrets skips remove events", () => {
  assert.deepEqual(
    resultSecrets([{ op: "remove", index: 0 } as never], []),
    [],
  );
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx tsx --test src/recorder/normalise.test.ts src/recorder/session.test.ts`
Expected: FAIL in "file uploads" and "resultSecrets skips remove events".

- [ ] **Step 3: Change the normaliser**

In `src/recorder/normalise.ts`, import `FileEntry`; extend the types:

```ts
/** What the recorder does to the step list: a new step at `index`, a step rewritten in place, or one taken out */
export type RecorderEvent =
  | { op: "insert"; index: number; step: Step }
  | { op: "replace"; index: number; step: Step }
  | { op: "remove"; index: number };
```

and add to `Observation`:

```ts
  /** A file input got a click: the click recorded just before it opened the file picker */
  | { type: "picker" }
  /** The file picker closed without a choice */
  | { type: "picker-cancel" }
  /** Files were set on an input or dropped on an element, and are stored (or listed as missing) */
  | {
      type: "files";
      via: "input" | "drop";
      locator: LocatorSpec;
      files: FileEntry[];
    }
```

Add the constant and fields:

```ts
/** A picker that opens within this many ms of a click was opened by it */
export const PICKER_WINDOW = 1000;
```

```ts
  /** The last click, so a picker it opened can take its place */
  private lastClick: { index: number; at: number } | undefined;
  /** The click that opened the file picker that is open now */
  private picker: number | undefined;
```

In `insert()`, clear them: add `this.picker = undefined;` (the click branch sets `lastClick` after calling `insert`). In the click branch:

```ts
if (observation.type === "click") {
  if (observation.textEntry) return []; // focusing a field: the fill that follows needs no click
  this.lastFill = undefined;
  this.lastAction = at;
  const events = [this.insert({ kind: "click", locator: observation.locator })];
  this.lastClick = { index: this.next - 1, at };
  return events;
}
```

Before `if (observation.type === "click")`, add:

```ts
if (observation.type === "picker") {
  const click = this.lastClick;
  this.picker =
    click && click.index === this.next - 1 && at - click.at <= PICKER_WINDOW
      ? click.index
      : undefined;
  return [];
}

if (observation.type === "picker-cancel") {
  const index = this.picker;
  this.picker = undefined;
  if (index === undefined || index !== this.next - 1) return [];
  this.next--;
  this.lastClick = undefined;
  this.lastStep = undefined;
  return [{ op: "remove", index }];
}

if (observation.type === "files") {
  this.lastFill = undefined;
  this.lastAction = at;
  const step: Step = {
    kind: observation.via === "drop" ? "dropFiles" : "setInputFiles",
    locator: observation.locator,
    files: observation.files,
  };
  const index = this.picker;
  if (
    observation.via === "input" &&
    index !== undefined &&
    index === this.next - 1
  ) {
    this.picker = undefined;
    this.lastClick = undefined;
    this.lastStep = step;
    return [{ op: "replace", index, step }];
  }
  return [this.insert(step)];
}
```

`toolbarStep`'s `default: return undefined` already covers the new types.

- [ ] **Step 4: Handle `remove` where events are used**

`src/recorder/apply.ts`:

```ts
export function applyRecorderEvent(
  source: string,
  test: number,
  event: RecorderEvent,
): string {
  return event.op === "remove"
    ? applyEdit(source, { op: "remove", test, index: event.index })
    : applyEdit(source, {
        op: event.op,
        test,
        index: event.index,
        step: event.step,
      });
}
```

`src/recorder/session.ts`, in `resultSecrets`, change the parameter to `events: readonly RecorderEvent[]` and the body to `...events.flatMap((event) => event.op !== "remove" && event.step.kind === "fill" && event.step.value.kind === "secret" ? [event.step.value.name] : [])`.

`src/cli/main.ts`, in the record `onEvent`:

```ts
        onEvent: (event) => {
          if (values.json) return void io.out(`${JSON.stringify(event)}\n`);
          if (event.op === "remove") {
            count--;
            return void io.out(`  - step ${event.index + 1} (the click that opened the file picker)\n`);
          }
          io.out(`  ${event.op === "insert" ? "+" : "~"} ${stepToSource(event.step)}\n`);
          if (event.op === "insert") count++;
        },
```

In `src/recorder/recorder.ts`, `emit()` keeps calling `controller?.stepAdded(event.step)` only for inserts; add `else if (event.op === "remove") this.controller?.stepRemoved();` and in `src/recorder/toolbar/controller.ts`:

```ts
  /** A recorded step was taken out again (a cancelled file picker's click) */
  public stepRemoved(): void {
    this.steps = Math.max(0, this.steps - 1);
    this.push();
  }
```

- [ ] **Step 5: Run the tests**

Run: `npx tsx --test src/recorder/normalise.test.ts src/recorder/session.test.ts src/recorder/toolbar/controller.test.ts && npm run test:cli && npx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/recorder src/cli/main.ts
git commit -m "feat: the recorder turns uploads into steps and replaces the click that opened the picker"
```

### Task 6: Toolbar: the saving line and warnings that stay

**Files:**

- Modify: `src/recorder/toolbar/protocol.ts`, `src/recorder/toolbar/controller.ts`, `src/recorder/toolbar/source.ts`, `src/recorder/toolbar/styles.ts`
- Test: `src/recorder/toolbar/controller.test.ts`, `src/recorder/toolbar/toolbar.browser-test.ts`

**Interfaces:**

- Produces:
  - `ToolbarState.saving?: string` (the file being saved) and `ToolbarState.warnings: { id: number; text: string }[]`
  - `ToolbarMessage` gains `{ action: "dismiss"; id: number }`
  - `controller.saving(name: string | undefined): void`, `controller.warn(text: string): void`
  - Toolbar `press("dismiss", { id })`; the warnings carry `data-warning="<id>"`; the saving line has class `saving`

- [ ] **Step 1: Write the failing controller tests**

Append to `src/recorder/toolbar/controller.test.ts`:

```ts
describe("files", () => {
  it("shows the file being saved, then clears it", () => {
    const { controller, pushes } = setup();
    controller.saving("avatar.png");
    assert.equal(lastOf(pushes)?.saving, "avatar.png");
    controller.saving(undefined);
    assert.equal(lastOf(pushes)?.saving, undefined);
  });

  it("keeps warnings until each is dismissed, also across page loads", async () => {
    const { controller, pushes } = setup();
    controller.warn("big.mov is 300 MB.");
    controller.warn("huge.iso is 4 GB.");
    controller.loaded();
    const warnings = lastOf(pushes)!.warnings;
    assert.deepEqual(
      warnings.map((w) => w.text),
      ["big.mov is 300 MB.", "huge.iso is 4 GB."],
    );
    await controller.handle(msg({ action: "dismiss", id: warnings[0]!.id }));
    assert.deepEqual(
      lastOf(pushes)!.warnings.map((w) => w.text),
      ["huge.iso is 4 GB."],
    );
    controller.dispose();
  });
});
```

(If `setup()` returns other names, use them; it returns `controller` and `pushes` among others.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx tsx --test src/recorder/toolbar/controller.test.ts`
Expected: FAIL, `controller.saving is not a function`.

- [ ] **Step 3: Protocol and controller**

`protocol.ts`, in `ToolbarState` after `toast`:

```ts
  /** The name of the file being saved to the project, while a transfer runs */
  saving?: string;
  /** Shown until the tester dismisses each (a file that wasn't saved) */
  warnings: { id: number; text: string }[];
```

and in `ToolbarMessage`, add `| { action: "dismiss"; id: number }`.

`controller.ts`: fields `private savingName: string | undefined;`, `private warnings: { id: number; text: string }[] = [];`, `private warningId = 0;`. In `state()` add `...(this.savingName !== undefined && { saving: this.savingName }), warnings: this.warnings.map((w) => ({ ...w })),`. Add:

```ts
  /** A picked or dropped file is being saved; undefined when done */
  public saving(name: string | undefined): void {
    this.savingName = name;
    this.push();
  }

  /** Shows a warning that stays until the tester dismisses it */
  public warn(text: string): void {
    this.warnings.push({ id: ++this.warningId, text });
    this.push();
  }
```

and in `handle`'s switch:

```ts
      case "dismiss":
        this.warnings = this.warnings.filter((w) => w.id !== message.id);
        return this.push();
```

`accept()` must let `dismiss` through like `move` and `collapse`; check how `accept` decides and add `"dismiss"` to the actions that need no id bookkeeping.

- [ ] **Step 4: Run the controller tests**

Run: `npx tsx --test src/recorder/toolbar/controller.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing toolbar browser test**

Append to `src/recorder/toolbar/toolbar.browser-test.ts` (it has helpers to install the toolbar and call `update`/`press`; use the ones its other tests use, e.g. the helper that pushes a `ToolbarState`):

```ts
test("shows the saving line and warnings with Dismiss", OPTIONS, async () => {
  const channel = await installToolbar();
  await update({
    ...STATE,
    saving: "avatar.png",
    warnings: [{ id: 7, text: "big.mov is 300 MB." }],
  });
  const view = await callInSandbox(`() => {
    const root = globalThis[Symbol.for("samurai.toolbar")].root;
    return {
      saving: root.querySelector(".saving") && root.querySelector(".saving").textContent,
      warning: root.querySelector('[data-warning="7"]') && root.querySelector('[data-warning="7"]').textContent,
    };
  }`);
  assert.equal(view.saving, "Saving avatar.png…");
  assert.match(view.warning, /big\.mov is 300 MB\./);
  await callInSandbox(
    `() => globalThis[Symbol.for("samurai.toolbar")].press("dismiss", { id: 7 })`,
  );
  assert.ok(
    messagesOn(channel).some((m) => m.action === "dismiss" && m.id === 7),
  );
});
```

Name the helpers after the file's own (`installToolbar`, `update`, `STATE`, `callInSandbox`, `messagesOn` stand for what the file provides; read its top 120 lines first). `STATE` needs `warnings: []` added wherever the file builds a full `ToolbarState`.

- [ ] **Step 6: Render them**

`source.ts`: add `warnings: []` to `DEFAULTS`. Create the element next to `toast`:

```js
const notices = h("div", { class: "notices ui" });
```

and append it in `root.append(…, toast, notices)`. Add a `renderNotices` called at the end of `render()`:

```js
const renderNotices = () => {
  notices.replaceChildren(
    ...state.warnings.map((w) =>
      h(
        "div",
        {
          class: "notice warning",
          "data-warning": String(w.id),
          role: "alert",
        },
        h("span", null, w.text),
        h(
          "button",
          {
            class: "dismiss",
            "data-action": "dismiss",
            "data-id": String(w.id),
          },
          "Dismiss",
        ),
      ),
    ),
    ...(state.saving
      ? [h("div", { class: "notice saving" }, "Saving " + state.saving + "…")]
      : []),
  );
};
```

Register the handler with the others: `dismiss: (d) => post({ action: "dismiss", id: Number(d.id) })`. Wire the click: the toolbar's click delegation (the listener that maps `data-action` to `handlers`) must pass `{ id: el.getAttribute("data-id") }`; if the delegation passes no detail, add `notices.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest("[data-action=dismiss]"); if (b) press("dismiss", { id: b.getAttribute("data-id") }); })` through `listen`. Document `dismiss { id }` in the `press` actions comment at the top.

`styles.ts`, before `.frame`:

```css
.notices {
  position: fixed;
  z-index: 4;
  left: 50%;
  bottom: 52px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: min(520px, calc(100vw - 32px));
}
.notice {
  display: flex;
  gap: 10px;
  align-items: center;
  background: #17181c;
  color: #e9eaee;
  border-radius: 8px;
  padding: 8px 12px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28);
}
.notice.warning {
  background: #3b2a06;
  color: #ffe7b0;
  border: 1px solid #8a6514;
}
.notice .dismiss {
  margin-left: auto;
  text-decoration: underline;
  white-space: nowrap;
}
```

- [ ] **Step 7: Run the tests**

Run: `npx tsx --test --test-concurrency=1 src/recorder/toolbar/toolbar.browser-test.ts && npx tsx --test src/recorder/toolbar/controller.test.ts src/recorder/toolbar/source.test.ts && npx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/recorder/toolbar
git commit -m "feat: the toolbar shows the file being saved and warnings that stay until dismissed"
```

### Task 7: The recorder records uploads

**Files:**

- Modify: `src/recorder/recorder.ts`
- Test: `src/recorder/files.browser-test.ts`

**Interfaces:**

- Consumes:
  - Task 1: `filesCaptureSource`, `FILES_SANDBOX`, `readPageFile`, `releasePageFile`, `disposeFilesCapture`
  - Task 4: `storeFile`, `cleanFileName`, `filesFolder`, `RECORD_LIMIT`
  - Task 2: `humanSize`
  - Task 5: the `files` / `picker` / `picker-cancel` observations
  - Task 6: `controller.saving`, `controller.warn`
- Produces:
  - `RecorderOptions.files?: FileRecording`
  - `interface FileRecording { projectDir: string; filesDir?: string; onMissing?: (file: MissingFile) => void; /** @internal */ trustSynthetic?: boolean }`
  - `interface MissingFile { path: string; name: string; size: number; reason: "too-big" | "unreadable" }`
  - `recorder.storedFiles: string[]` and `recorder.missingFiles: MissingFile[]` (getters, read after `stop()`)
  - Both types exported from `src/recorder/index.ts`.

- [ ] **Step 1: Write the failing browser tests**

```ts
// src/recorder/files.browser-test.ts
import assert from "node:assert/strict";
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
  options: { trustSynthetic?: boolean } = {},
) {
  await setContent(page, html);
  const projectDir = mkdtempSync(path.join(tmpdir(), "samurai-rec-files-"));
  const events: RecorderEvent[] = [];
  const missing: MissingFile[] = [];
  const recorder = await page.record({
    onEvent: (event) => events.push(event),
    initialGoto: false,
    files: { projectDir, onMissing: (m) => missing.push(m), ...options },
  });
  await act();
  await pause(800);
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
    assert.deepEqual(
      steps.map((s) => s.kind),
      ["dropFiles"],
    );
    assert.deepEqual((steps[0] as { files: unknown }).files, [
      { path: "files/a.png" },
      { path: "files/a-2.png" },
    ]);
    assert.deepEqual(readdirSync(path.join(projectDir, "files")).sort(), [
      "a-2.png",
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

test("nothing is recorded or stored while paused", OPTIONS, async () => {
  // Paused needs the toolbar's controller: covered in session.browser-test.ts (Task 8)
});
```

Delete the empty "paused" test before committing: Task 8 covers pausing through `recordSpec`, which has the toolbar.

- [ ] **Step 2: Run them to see them fail**

Run: `npx tsx --test --test-concurrency=1 src/recorder/files.browser-test.ts`
Expected: FAIL: no `setInputFiles` step is recorded (`files` option unknown).

- [ ] **Step 3: Wire the files channel into the recorder**

In `src/recorder/recorder.ts`:

1. Imports:

```ts
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  cleanFileName,
  filesFolder,
  RECORD_LIMIT,
  storeFile,
} from "../project/index.js";
import { humanSize } from "../steps/files.js";
import type { FileEntry } from "../steps/model.js";
import { FILES_SANDBOX, filesCaptureSource } from "./files-capture.js";
import {
  disposeFilesCapture,
  readPageFile,
  releasePageFile,
} from "./files-reader.js";
```

2. Types (exported):

```ts
/** Where uploads made while recording are stored */
export interface FileRecording {
  /** The project folder */
  projectDir: string;
  /** Relative to the project folder. @default "files" */
  filesDir?: string;
  /** A file that isn't stored (over 50 MB, or unreadable): its step points at `path`, which doesn't exist */
  onMissing?: (file: MissingFile) => void;
  /** @internal Tests only: also record events no person caused (`isTrusted` false) */
  trustSynthetic?: boolean;
}

export interface MissingFile {
  /** Project-relative, as the step has it */
  path: string;
  name: string;
  size: number;
  reason: "too-big" | "unreadable";
}

/** What the files capture script sends */
type FilesMessage =
  | { type: "picker" }
  | { type: "picker-cancel" }
  | {
      type: "files";
      via: "input" | "drop";
      target: ElementHandle;
      candidates: LocatorCall[];
      files: { id: number; name: string; type: string; size: number }[];
    };
```

Add `files?: FileRecording;` to `RecorderOptions` with the doc `/** Records uploads (file inputs and drops) into the project's files folder. Without it, uploads aren't recorded */`.

3. Fields and getters on `Recorder`:

```ts
  /** The files capture script's channel, handed only to its sandbox */
  private readonly filesChannel = `samurai-files-${randomUUID()}`;
  private filesPreload: { dispose(): Promise<void> } | undefined;
  private filesRealms = new Set<string>();
  private readonly stored = new Set<string>();
  private readonly missing: MissingFile[] = [];

  /** Files stored or reused in the files folder by this recording, project-relative */
  public get storedFiles(): string[] {
    return [...this.stored];
  }

  /** Files whose steps point at a path that wasn't written */
  public get missingFiles(): MissingFile[] {
    return [...this.missing];
  }
```

4. In `onMessage`, before `if (params.channel !== this.toolbarChannel || !this.controller) return;`:

```ts
if (params.channel === this.filesChannel) {
  const realm = params.source.realm ?? "";
  const data = params.data;
  // In order with the page's messages: a picker follows the click that opened it
  this.enqueue(async () => {
    if (!this.filesRealms.has(realm)) await this.listFilesRealms();
    if (!this.filesRealms.has(realm)) {
      logger.warn(
        "Recorder ignored a files message from outside the files sandbox",
      );
      return;
    }
    await this.fromFiles(
      fromRemoteValue(
        data as Parameters<typeof fromRemoteValue>[0],
      ) as FilesMessage,
    );
  });
  return;
}
```

```ts
  private async listFilesRealms(): Promise<void> {
    const { realms } = await this.connector.send("script.getRealms", {
      context: this.context,
      type: "window",
    });
    this.filesRealms = new Set(
      realms
        .filter((info) => info.type === "window" && info.sandbox === FILES_SANDBOX)
        .map((info) => info.realm),
    );
  }
```

5. In `begin()`, after the capture preload:

```ts
if (this.options.files) {
  this.filesPreload = await addPreload(this.connector, {
    source: filesCaptureSource({
      trustSynthetic: this.options.files.trustSynthetic === true,
    }),
    sandbox: FILES_SANDBOX,
    contexts: [this.context],
    arguments: [new ChannelArg(this.filesChannel)],
    onRunError: "log",
  });
}
```

and add `this.filesPreload?.dispose()` to `release()`'s `Promise.allSettled`. In `end()`, after the toolbar dispose block:

```ts
if (this.filesPreload)
  await disposeFilesCapture(this.connector, this.context).catch(
    () => undefined,
  );
```

Keep `await this.queue.tail;` after it, so transfers that already started finish.

6. The handling:

```ts
  private async fromFiles(message: FilesMessage): Promise<void> {
    const now = Date.now();
    if (message.type !== "files") {
      if (!this.controller?.paused) this.emit(this.normaliser.observe(message, now));
      return;
    }
    const release = () =>
      Promise.allSettled(
        message.files.map((file) => releasePageFile(this.connector, this.context, file.id)),
      );
    if (this.controller?.paused) return void (await release());
    const locator = await this.locatorFor(message as unknown as PageMessage);
    if (!locator) {
      logger.warn(
        "Recorder found no locator that matches only the element the files were %s; the upload was skipped",
        message.via === "drop" ? "dropped on" : "set on",
      );
      return void (await release());
    }
    const files: FileEntry[] = [];
    for (const file of message.files) files.push({ path: await this.storePageFile(file) });
    this.emit(this.normaliser.observe({ type: "files", via: message.via, locator, files }, now));
  }

  /** Saves one kept file to the files folder; returns the path its step gets */
  private async storePageFile(file: { id: number; name: string; size: number }): Promise<string> {
    const recording = this.options.files!;
    const folder = filesFolder(recording.projectDir, recording.filesDir);
    const notSaved = (reason: MissingFile["reason"]) => {
      const missing: MissingFile = {
        path: `${folder.relative}/${cleanFileName(file.name)}`,
        name: file.name,
        size: file.size,
        reason,
      };
      this.missing.push(missing);
      recording.onMissing?.(missing);
      this.controller?.warn(missingFileText(missing, folder.relative));
      return missing.path;
    };
    if (file.size > RECORD_LIMIT) {
      await releasePageFile(this.connector, this.context, file.id).catch(() => undefined);
      return notSaved("too-big");
    }
    this.controller?.saving(file.name);
    const temp = await mkdtemp(path.join(tmpdir(), "samurai-upload-"));
    try {
      const content = path.join(temp, "content");
      const out = await open(content, "w");
      try {
        await readPageFile(this.connector, this.context, file.id, file.size, (bytes) => out.write(bytes));
      } finally {
        await out.close();
      }
      const stored = await storeFile({
        projectDir: recording.projectDir,
        ...(recording.filesDir !== undefined && { filesDir: recording.filesDir }),
        name: file.name,
        content,
      });
      this.stored.add(stored.path);
      return stored.path;
    } catch (err) {
      logger.warn("Recorder could not save %s", file.name, { err });
      return notSaved("unreadable");
    } finally {
      this.controller?.saving(undefined);
      await rm(temp, { recursive: true, force: true }).catch(() => undefined);
      await releasePageFile(this.connector, this.context, file.id).catch(() => undefined);
    }
  }
```

and the warning text, exported for the CLI (Task 8):

```ts
/** The warning for a file that isn't saved, as the toolbar and the CLI show it */
export function missingFileText(file: MissingFile, folder: string): string {
  return file.reason === "too-big"
    ? `${file.name} is ${humanSize(file.size)}. Files over 50 MB aren't saved: add it to ${folder}/ yourself, or use a generated file.`
    : `${file.name} couldn't be read, so it isn't saved: add it to ${folder}/ yourself, or use a generated file.`;
}
```

`locatorFor` reads `message.target.sharedId` and `message.candidates`, which `FilesMessage` has; the cast is only for its parameter type. Change its parameter type to `{ target: ElementHandle; candidates: LocatorCall[] }` instead of the cast if that type-checks cleanly.

7. Export `FileRecording`, `MissingFile`, `missingFileText` from `src/recorder/index.ts`.

- [ ] **Step 4: Run the tests**

Run: `npx tsx --test --test-concurrency=1 src/recorder/files.browser-test.ts src/recorder/recorder.browser-test.ts && npx tsc --noEmit -p .`
Expected: PASS. `recorder.browser-test.ts` still passes: without `files`, nothing changes.

- [ ] **Step 5: Commit**

```bash
git add src/recorder
git commit -m "feat: the recorder stores picked and dropped files and writes their steps"
```

### Task 8: recordSpec, the CLI, docs and 0.8.0

**Files:**

- Modify: `src/recorder/session.ts`, `src/cli/main.ts`, `package.json`, `docs/recorder.md`, `docs/locators.md`, `docs/configuration.md`, `docs/cli.md`, `docs/roadmap.md`
- Test: `src/recorder/session.browser-test.ts`

**Interfaces:**

- Consumes: `FileRecording`, `MissingFile`, `missingFileText`, `recorder.storedFiles`/`missingFiles` (Task 7); `isFolderIgnored`, `filesFolder` (Task 4).
- Produces:
  - `RecordSpecOptions.onMissingFile?: (file: MissingFile, text: string) => void`
  - `RecordResult.files: string[]`, `missingFiles: MissingFile[]`, `filesIgnored: boolean`, `firstFiles: boolean`
  - `firstFiles` is true when the folder didn't exist before this recording and files were stored.

- [ ] **Step 1: Write the failing test**

Append to `src/recorder/session.browser-test.ts`:

```ts
test(
  "recordSpec stores uploads in filesDir and reports files, missing files and git warnings",
  OPTIONS,
  async () => {
    const { dir, config } = project({ filesDir: "data/uploads" });
    writeFileSync(path.join(dir, ".gitignore"), "data/uploads/\n");
    const big = path.join(dir, "big.bin");
    writeFileSync(big, Buffer.alloc(50 * 1024 * 1024 + 1));
    const small = path.join(dir, "small.txt");
    writeFileSync(small, "s");
    const warned: string[] = [];
    const controller = new AbortController();
    const result = await recordSpec({
      projectDir: dir,
      config,
      dataDir: path.join(dir, "data"),
      file: "tests/up.spec.ts",
      create: "uploads",
      url: `data:text/html,<input type="file" aria-label="Doc" multiple>`,
      headless: true,
      port: 9265,
      signal: controller.signal,
      onMissingFile: (_file, text) => warned.push(text),
      onStarted: async ({ page }) => {
        await page.getByLabel("Doc").setInputFiles([small, big]);
        await pause(1500);
        controller.abort();
      },
    });
    assert.deepEqual(result.files, ["data/uploads/small.txt"]);
    assert.deepEqual(
      result.missingFiles.map((f) => f.path),
      ["data/uploads/big.bin"],
    );
    assert.equal(result.filesIgnored, true);
    assert.equal(result.firstFiles, true);
    assert.deepEqual(warned, [
      "big.bin is 50 MB. Files over 50 MB aren't saved: add it to data/uploads/ yourself, or use a generated file.",
    ]);
    assert.match(
      readFileSync(path.join(dir, "tests/up.spec.ts"), "utf8"),
      /setInputFiles\(\["data\/uploads\/small\.txt", "data\/uploads\/big\.bin"\]\)/,
    );
  },
);

test("recordSpec records no upload while paused", OPTIONS, async () => {
  const { dir, config } = project();
  const file = path.join(dir, "p.txt");
  writeFileSync(file, "p");
  const controller = new AbortController();
  const result = await recordSpec({
    projectDir: dir,
    config,
    dataDir: path.join(dir, "data"),
    file: "tests/p.spec.ts",
    create: "paused",
    url: `data:text/html,<input type="file" aria-label="Doc">`,
    headless: true,
    port: 9266,
    signal: controller.signal,
    onStarted: async ({ page }) => {
      const { biDiConnector, contextId } = page as unknown as {
        biDiConnector: BiDiConnector;
        contextId: string;
      };
      await pause(1000);
      await callFunction(
        biDiConnector,
        contextId,
        `() => globalThis[Symbol.for("samurai.toolbar")].press("pause")`,
        [],
        { sandbox: "samurai-toolbar" },
      );
      await pause(500);
      await page.getByLabel("Doc").setInputFiles(file);
      await pause(800);
      controller.abort();
    },
  });
  assert.deepEqual(result.files, []);
  assert.ok(!existsSync(path.join(dir, "files")));
});
```

`humanSize(50 * 1024 * 1024 + 1)` is `"50 MB"`, which is what the expected text uses.

- [ ] **Step 2: Run it to see it fail**

Run: `npx tsx --test --test-concurrency=1 src/recorder/session.browser-test.ts`
Expected: FAIL: `result.files` is undefined.

- [ ] **Step 3: Pass files through `recordSpec`**

In `src/recorder/session.ts`:

```ts
import { existsSync } from "node:fs"; // already imported: keep one import
import { filesFolder, isFolderIgnored } from "../project/index.js";
import { missingFileText, type MissingFile } from "./recorder.js";
```

`RecordSpecOptions`:

```ts
  /** A picked or dropped file wasn't saved (over 50 MB, or unreadable); `text` is the warning to show */
  onMissingFile?: (file: MissingFile, text: string) => void;
```

`RecordResult`:

```ts
  /** Files stored in (or reused from) the files folder, project-relative */
  files: string[];
  /** Files the steps point at that weren't saved: they must be added before the test can run */
  missingFiles: MissingFile[];
  /** The files folder is git-ignored: CI won't have the files */
  filesIgnored: boolean;
  /** The files folder was created by this recording */
  firstFiles: boolean;
```

In `recordSpec`, before `page.record(…)`:

```ts
const loaded = await loadConfig();
const folder = filesFolder(projectDir(), loaded.filesDir);
const hadFolder = existsSync(folder.absolute);
```

pass `await loadConfig()` → `loaded` to `toolbarOptions` (it already calls `loadConfig()`; reuse `loaded`), and add to the `page.record` options:

```ts
        files: {
          projectDir: projectDir(),
          ...(loaded.filesDir !== undefined && { filesDir: loaded.filesDir }),
          onMissing: (file) =>
            options.onMissingFile?.(file, missingFileText(file, folder.relative)),
        },
```

Keep the `recorder` in a variable outside the `try` (`let recorder: Recorder | undefined`) so the result can read it. Return:

```ts
const files = recorder?.storedFiles ?? [];
return {
  file,
  test: test.name,
  events,
  secrets,
  unsetSecrets,
  files,
  missingFiles: recorder?.missingFiles ?? [],
  filesIgnored:
    files.length + (recorder?.missingFiles.length ?? 0) > 0 &&
    (await isFolderIgnored(projectDir(), folder.relative)),
  firstFiles: !hadFolder && files.length > 0,
};
```

- [ ] **Step 4: Print it in the CLI**

In `src/cli/main.ts`, add to the `recordSpec` options:

```ts
        onMissingFile: (_file, text) => {
          if (!values.json) io.out(`${text}\n`);
        },
```

and after the secrets line in the summary:

```ts
if (result.missingFiles.length > 0) {
  io.out(
    `Add ${result.missingFiles.map((f) => f.path).join(", ")} before running it (or use generatedFile).\n`,
  );
}
const folder =
  result.files[0]?.split("/").slice(0, -1).join("/") ??
  result.missingFiles[0]?.path.split("/").slice(0, -1).join("/");
if (folder && result.filesIgnored)
  io.out(`${folder}/ is ignored by git; CI won't have these files.\n`);
if (folder && result.firstFiles)
  io.out(
    `Recorded files are stored in ${folder}/ and committed with your tests.\n`,
  );
```

- [ ] **Step 5: Docs and version**

- `package.json`: `"version": "0.8.0"`.
- `docs/recorder.md`:
  - add `setInputFiles` and `dropFiles` rows to the step table (`await page.getByLabel("Avatar").setInputFiles("files/avatar.png");`, `await page.getByTestId("zone").dropFiles(["files/a.png", "files/b.png"]);`);
  - add rows to "What each action becomes": `pick files in a file input` → `setInputFiles` with the files stored in `files/`; a click that opened the picker is replaced, a cancelled picker removes it; `drop files on the page` → `dropFiles` on the element they landed on;
  - add a "Files" section: the shared folder, `filesDir`, dedupe by content, `-2` names, the 50 MB cap and its warnings (toolbar, CLI, `missingFiles`), the git warnings, events a person didn't cause are ignored;
  - remove "file uploads" from "Not recorded yet".
- `docs/locators.md`: in the actions table, `setInputFiles(files, options?)` now says "paths are relative to the project folder; `generatedFile(…)` entries"; add a `dropFiles(files, options?)` row (attached, visible; synthetic drag events, `isTrusted` false); replace the `setInputFiles` paragraph's "resolved against the working directory" with "relative to the project folder"; add a `generatedFile` subsection with the example from the spec and the `type` rule (`dropFiles` only; `setInputFiles` takes the type from the extension).
- `docs/configuration.md`: `filesDir` (default `"files"`).
- `docs/cli.md`, `samurai record` details: the upload lines (`+ await page…setInputFiles(…)`, a `- step N (the click that opened the file picker)` line, the over-cap warning, the summary lines).
- `docs/roadmap.md`: take file uploads out of "Record more interactions"; add "Files manager in the app (which tests use a file, delete unused)".

- [ ] **Step 6: Run everything**

Run: `npm test && npm run test:cli && npm run test:browser && npx tsc --noEmit -p . && npm run build`
Expected: all PASS.

- [ ] **Step 7: Commit and open the PR**

```bash
git add -A src docs package.json
git commit -m "feat: recordSpec and samurai record store uploads and report missing files; 0.8.0"
git push -u origin feat/file-uploads
gh pr create --base main --title "feat: record file uploads, dropFiles and generatedFile (0.8.0)" --body-file <scratchpad>/pr-files.md
```

The PR body lists what changed (steps, runtime, recording, toolbar, CLI, config), the test plan with the commands above, and ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. The user merges and publishes 0.8.0; the app tasks wait for that.

---

## App (branch `feat/file-uploads`, from `feat/recorder-toolbar`; rebase on `main` once PR #15 is merged)

### Task 9: App backend: framework version, files folder, adding files, record results

**Files:**

- Create: `src/main/utils/files.ts`
- Modify: `src/shared/projects.ts`, `src/main/utils/inspect.ts`, `src/engine/index.ts`, `src/shared/engine.ts`, `src/shared/specs.ts`, `src/main/record/service.ts`, `src/main/utils/ipc.ts`, `src/preload/index.ts`, `src/renderer/src/types/api.d.ts`, `package.json` (framework `^0.8.0`)
- Test: `src/main/utils/files.test.ts`

**Interfaces:**

- Consumes: `storeFile`, `filesFolder` from `@itmetsam/samurai-framework/project` (the app's own copy, 0.8.0).
- Produces:
  - `ProjectInfo.frameworkVersion?: string`; `ProjectConfig.filesDir?: string`
  - `RecordDone.missingFiles: { path: string; name: string; size: number }[]`, `RecordDone.filesIgnored: boolean`, `RecordDone.firstFiles: boolean`, `RecordDone.filesFolder?: string`
  - `addProjectFiles(project: Project, filesDir: string | undefined, sources: string[]): Promise<string[]>` (project-relative paths)
  - `fileStatus(project: Project, paths: string[]): Promise<Record<string, { exists: boolean; size?: number }>>`
  - IPC `files:add (id, filesDir?) → { ok: true; paths: string[] } | { ok: false; error }` (opens the picker; `paths: []` when cancelled), `files:status (id, paths) → { ok: true; status } | { ok: false; error }`
  - `window.api.addFiles(id, filesDir?)`, `window.api.fileStatus(id, paths)`

- [ ] **Step 1: Bump the framework**

Run: `bun add @itmetsam/samurai-framework@^0.8.0`
Expected: `package.json` has `"@itmetsam/samurai-framework": "^0.8.0"`.

- [ ] **Step 2: Write the failing tests**

```ts
// src/main/utils/files.test.ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Project } from "../../shared/projects";
import { addProjectFiles, fileStatus } from "./files";

const project = (): Project =>
  ({
    id: "p",
    name: "p",
    path: mkdtempSync(join(tmpdir(), "samurai-app-files-")),
  }) as Project;
const source = (name: string, text: string) => {
  const file = join(mkdtempSync(join(tmpdir(), "samurai-src-")), name);
  writeFileSync(file, text);
  return file;
};

describe("project files", () => {
  test("copies chosen files into the files folder, once per content", async () => {
    const p = project();
    expect(
      await addProjectFiles(p, undefined, [
        source("a.png", "x"),
        source("b.png", "x"),
        source("a.png", "y"),
      ]),
    ).toEqual(["files/a.png", "files/a.png", "files/a-2.png"]);
  });

  test("uses filesDir", async () => {
    expect(
      await addProjectFiles(project(), "data", [source("a.txt", "a")]),
    ).toEqual(["data/a.txt"]);
  });

  test("reports which paths exist, with their size, and refuses paths outside the project", async () => {
    const p = project();
    await addProjectFiles(p, undefined, [source("a.txt", "abc")]);
    expect(
      await fileStatus(p, [
        "files/a.txt",
        "files/b.txt",
        "../outside.txt",
        "/etc/passwd",
      ]),
    ).toEqual({
      "files/a.txt": { exists: true, size: 3 },
      "files/b.txt": { exists: false },
      "../outside.txt": { exists: false },
      "/etc/passwd": { exists: false },
    });
  });
});
```

(Use the real `Project` shape from `src/shared/projects.ts`; fill required fields the cast hides if `tsc` complains.)

- [ ] **Step 3: Run them to see them fail**

Run: `bun test src/main/utils/files.test.ts`
Expected: FAIL, `Cannot find module './files'`.

- [ ] **Step 4: Write the helpers**

```ts
// src/main/utils/files.ts
import { stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { Project } from "../../shared/projects";

/** The framework's file store: the same cleaning and dedupe as recording */
const store = () => import("@itmetsam/samurai-framework/project");

/** Copies files the person chose into the project's files folder; returns their project paths, in order */
export async function addProjectFiles(
  project: Project,
  filesDir: string | undefined,
  sources: string[],
): Promise<string[]> {
  const { storeFile } = await store();
  const paths: string[] = [];
  for (const content of sources) {
    const name = content.split(/[\\/]/).pop() ?? "file";
    const stored = await storeFile({
      projectDir: project.path,
      ...(filesDir !== undefined && { filesDir }),
      name,
      content,
    });
    paths.push(stored.path);
  }
  return paths;
}

/** Whether each project path is a file, and its size; paths outside the project never exist */
export async function fileStatus(
  project: Project,
  paths: string[],
): Promise<Record<string, { exists: boolean; size?: number }>> {
  const result: Record<string, { exists: boolean; size?: number }> = {};
  for (const path of paths) {
    const absolute = resolve(project.path, path);
    const inside = relative(project.path, absolute);
    if (isAbsolute(path) || inside.startsWith("..") || isAbsolute(inside)) {
      result[path] = { exists: false };
      continue;
    }
    try {
      const info = await stat(absolute);
      result[path] = info.isFile()
        ? { exists: true, size: info.size }
        : { exists: false };
    } catch {
      result[path] = { exists: false };
    }
  }
  return result;
}
```

- [ ] **Step 5: Run the tests**

Run: `bun test src/main/utils/files.test.ts`
Expected: PASS.

- [ ] **Step 6: IPC, preload, types**

In `src/main/utils/ipc.ts`, next to `pickFolder`:

```ts
async function pickFiles(event: IpcMainInvokeEvent): Promise<string[]> {
  const win = BrowserWindow.fromWebContents(event.sender);
  const options = {
    title: "Add files to the project",
    buttonLabel: "Add",
    properties: ["openFile", "multiSelections"] as Array<
      "openFile" | "multiSelections"
    >,
  };
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? [] : result.filePaths;
}
```

and in `registerIpcHandlers`:

```ts
ipcMain.handle(
  "files:add",
  async (
    event,
    id: string,
    filesDir?: string,
  ): Promise<{ ok: true; paths: string[] } | { ok: false; error: string }> => {
    const project = getProject(id);
    if (!project) return { ok: false, error: "Unknown project." };
    try {
      const chosen = await pickFiles(event);
      return {
        ok: true,
        paths: await addProjectFiles(project, filesDir, chosen),
      };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },
);
ipcMain.handle("files:status", async (_event, id: string, paths: string[]) => {
  const project = getProject(id);
  if (!project) return { ok: false as const, error: "Unknown project." };
  try {
    return { ok: true as const, status: await fileStatus(project, paths) };
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }
});
```

Put the result types in `src/shared/projects.ts`:

```ts
export type FilesAddResult =
  { ok: true; paths: string[] } | { ok: false; error: string };
export type FileStatusResult =
  | { ok: true; status: Record<string, { exists: boolean; size?: number }> }
  | { ok: false; error: string };
```

and use them in the handlers. `src/preload/index.ts`:

```ts
  addFiles: (id: string, filesDir?: string) => ipcRenderer.invoke("files:add", id, filesDir),
  fileStatus: (id: string, paths: string[]) => ipcRenderer.invoke("files:status", id, paths),
```

and the matching declarations in `src/renderer/src/types/api.d.ts` (`addFiles(id: string, filesDir?: string): Promise<FilesAddResult>`, `fileStatus(id: string, paths: string[]): Promise<FileStatusResult>`).

- [ ] **Step 7: Framework version and filesDir**

- `src/shared/projects.ts`: `ProjectInfo.frameworkVersion?: string` (`/** The project's framework version; absent when it couldn't be inspected or the project has none */`), `ProjectConfig.filesDir?: string`.
- `src/main/utils/inspect.ts`: after `const doctor = …`, `if (doctor.framework.source === "project") info.frameworkVersion = doctor.framework.version;`
- `src/engine/index.ts` `readConfig`: add `filesDir: config.filesDir,`.
- `src/shared/framework.ts`: add

```ts
/** The first framework with file steps (setInputFiles from the project folder, dropFiles, generatedFile) */
export const FILE_STEPS_VERSION = "0.8.0";
```

- [ ] **Step 8: Record results**

- `src/shared/engine.ts` `RecordSummary`: add `missingFiles: { path: string; name: string; size: number }[]; filesIgnored: boolean; firstFiles: boolean; filesFolder?: string;`.
- `src/engine/index.ts` `record()`: return, besides `test` and `secrets`:

```ts
    // Frameworks before 0.8 don't record files
    missingFiles: (result.missingFiles ?? []).map(({ path, name, size }) => ({ path, name, size })),
    filesIgnored: result.filesIgnored ?? false,
    firstFiles: result.firstFiles ?? false,
    filesFolder: (result.files?.[0] ?? result.missingFiles?.[0]?.path)?.split("/").slice(0, -1).join("/"),
```

- `src/shared/specs.ts` `RecordDone`: the same four fields, with doc comments.
- `src/main/record/service.ts`: carry them from the summary into the `record:done` broadcast (on failure: `[]`, `false`, `false`, `undefined`).

- [ ] **Step 9: Check**

Run: `bun test && npx tsc --noEmit -p . && npx electron-vite build`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add -A src package.json bun.lock
git commit -m "feat: add files to a project, check file paths, and pass record file results to the editor"
```

### Task 10: App UI: file steps in the editor

**Files:**

- Create: `src/renderer/src/pages/project/test-editor/components/file-list.tsx`
- Modify: `src/renderer/src/lib/steps.ts`, `step-edit-dialog.tsx`, `inspector.tsx`, `add-step-bar.tsx`, `step-item.tsx`, `steps-panel.tsx`, `record-alerts.tsx`, the editor's `index.tsx`, `docs/` (app docs that list step kinds)
- Test: `src/renderer/src/lib/steps.test.ts`

**Interfaces:**

- Consumes: Task 9's `window.api.addFiles`, `window.api.fileStatus`, `ProjectInfo.frameworkVersion`, `ProjectConfig.filesDir`, `FILE_STEPS_VERSION`, `RecordDone` file fields; framework `FileEntry`, `formatSize`, `parseSize`, `humanSize` from `@itmetsam/samurai-framework/steps` (type-only imports in the renderer for types; the size helpers are pure and safe to import, but if the renderer bundle can't import the framework, copy the three functions into `lib/steps.ts` with a comment naming their source).
- Produces:
  - `describeStep` / `stepRowProps` for `setInputFiles` and `dropFiles`
  - `fileNames(files: FileEntry[]): string` (`avatar.png`, `report.pdf +2`, `huge.pdf (60 MB, generated)`)
  - `stepFilePaths(step: Step): string[]` (project paths of a step)
  - `FileList` component

- [ ] **Step 1: Write the failing tests**

Append to `src/renderer/src/lib/steps.test.ts`:

```ts
describe("file steps", () => {
  const locator = {
    chain: [{ method: "getByLabel" as const, text: "Avatar" }],
    fallbacks: [],
  };
  const gen = { generate: { name: "huge.pdf", size: 60 * 1024 * 1024 } };

  test("names the files: one, several, generated", () => {
    expect(fileNames([{ path: "files/avatar.png" }])).toBe("avatar.png");
    expect(
      fileNames([
        { path: "files/report.pdf" },
        { path: "files/a.png" },
        { path: "files/b.png" },
      ]),
    ).toBe("report.pdf +2");
    expect(fileNames([gen])).toBe("huge.pdf (60 MB, generated)");
    expect(fileNames([])).toBe("no files");
  });

  test("rows say upload or drop, with the target and names", () => {
    expect(
      stepRowProps({
        kind: "setInputFiles",
        locator,
        files: [{ path: "files/a.png" }],
      }),
    ).toEqual({
      action: "upload",
      title: "Upload files",
      target: "getByLabel('Avatar')",
      value: "a.png",
    });
    expect(
      stepRowProps({ kind: "dropFiles", locator, files: [gen] }).title,
    ).toBe("Drop files");
    expect(
      describeStep({ kind: "dropFiles", locator, files: [gen] }).title,
    ).toBe("Drop huge.pdf (60 MB, generated)");
  });

  test("lists a step's project paths, and file steps are editable", () => {
    const step = {
      kind: "setInputFiles" as const,
      locator,
      files: [{ path: "files/a.png" }, gen],
    };
    expect(stepFilePaths(step)).toEqual(["files/a.png"]);
    expect(stepFilePaths({ kind: "goto", url: "/" })).toEqual([]);
    expect(isEditable(step)).toBe(true);
  });

  test("a generated file needs a name and a size", () => {
    expect(
      stepValid({
        kind: "dropFiles",
        locator,
        files: [{ generate: { name: "", size: 1 } }],
      }),
    ).toBe(false);
    expect(
      stepValid({
        kind: "dropFiles",
        locator,
        files: [{ generate: { name: "a", size: Number.NaN } }],
      }),
    ).toBe(false);
    expect(stepValid({ kind: "dropFiles", locator, files: [gen] })).toBe(true);
  });
});
```

Add `fileNames`, `stepFilePaths` and `stepValid` to the file's import from `./steps`.

- [ ] **Step 2: Run them to see them fail**

Run: `bun test src/renderer/src/lib/steps.test.ts`
Expected: FAIL, `fileNames` is not exported.

- [ ] **Step 3: Step helpers**

In `src/renderer/src/lib/steps.ts` (import `FileEntry` as a type from `../../../shared/specs`, after re-exporting it there next to `Step`):

```ts
const baseName = (path: string) => path.split("/").pop() ?? path;

/** The files of a file step for people: "avatar.png", "report.pdf +2", "huge.pdf (60 MB, generated)" */
export function fileNames(files: readonly FileEntry[]): string {
  const [first, ...rest] = files;
  if (!first) return "no files";
  const name =
    "path" in first
      ? baseName(first.path)
      : `${first.generate.name} (${humanSize(first.generate.size)}, generated)`;
  return rest.length === 0 ? name : `${name} +${rest.length}`;
}

/** The project files a step points at */
export const stepFilePaths = (step: Step): string[] =>
  step.kind === "setInputFiles" || step.kind === "dropFiles"
    ? step.files.flatMap((file) => ("path" in file ? [file.path] : []))
    : [];
```

In `describeStep`, before `case "custom":`:

```ts
    case "setInputFiles":
      return { icon: "folder-open", title: `Upload ${fileNames(step.files)}`, detail: `to ${describeLocator(step.locator)}` };
    case "dropFiles":
      return { icon: "folder-open", title: `Drop ${fileNames(step.files)}`, detail: `on ${describeLocator(step.locator)}` };
```

In `stepRowProps`, before `case "custom":`:

```ts
    case "setInputFiles":
    case "dropFiles":
      return {
        action: step.kind === "dropFiles" ? "drop" : "upload",
        title: step.kind === "dropFiles" ? "Drop files" : "Upload files",
        target: short(step.locator.chain[step.locator.chain.length - 1]),
        value: fileNames(step.files),
      };
```

`stepValid`: add a branch

```ts
    : step.kind === "setInputFiles" || step.kind === "dropFiles"
      ? step.files.every((file) =>
          "path" in file
            ? file.path.trim() !== ""
            : file.generate.name.trim() !== "" && Number.isInteger(file.generate.size) && file.generate.size >= 0,
        )
```

`isEditable` stays as it is (file steps are editable). If `"folder-open"` is not an `IconName`, `tsc` says so; pick the closest file icon the library has.

- [ ] **Step 4: Run the tests**

Run: `bun test src/renderer/src/lib/steps.test.ts`
Expected: PASS.

- [ ] **Step 5: The file list editor**

```tsx
// src/renderer/src/pages/project/test-editor/components/file-list.tsx
import {
  Button,
  Icon,
  IconButton,
  Input,
  Select,
} from "@itmetsam/samurai-components";
import { useState } from "react";
import type { FileEntry, Step } from "../../../../../../shared/specs";
import { formatSize, humanSize, parseSize } from "../../../../lib/steps";

type FileStep = Extract<Step, { kind: "setInputFiles" | "dropFiles" }>;

/** The files of an upload or drop step: project files (with a missing warning) and generated ones */
export function FileList({
  step,
  set,
  status,
  onAddFiles,
}: {
  step: FileStep;
  set: (s: Step) => void;
  /** Project path → whether it exists and its size; absent while unknown */
  status?: Record<string, { exists: boolean; size?: number }>;
  /** Opens the picker and copies the chosen files into the project; resolves to their paths */
  onAddFiles: () => Promise<string[]>;
}) {
  const setFiles = (files: FileEntry[]) => set({ ...step, files });
  const replace = (i: number, file: FileEntry) =>
    setFiles(step.files.map((f, j) => (j === i ? file : f)));
  const remove = (i: number) => setFiles(step.files.filter((_, j) => j !== i));
  const move = (i: number, by: -1 | 1) => {
    const files = [...step.files];
    [files[i], files[i + by]] = [files[i + by]!, files[i]!];
    setFiles(files);
  };
  const add = async (at?: number) => {
    const paths = await onAddFiles();
    if (paths.length === 0) return;
    const added = paths.map((path) => ({ path }));
    setFiles(
      at === undefined
        ? [...step.files, ...added]
        : step.files.flatMap((f, j) => (j === at ? added : [f])),
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <Select
        label="Action"
        value={step.kind}
        onChange={(e) =>
          set({ ...step, kind: e.target.value as FileStep["kind"] })
        }
        options={[
          { label: "Upload to a file input", value: "setInputFiles" },
          { label: "Drop on the element", value: "dropFiles" },
        ]}
      />
      <ul className="flex flex-col gap-2">
        {step.files.map((file, i) => (
          <li
            key={i}
            className="flex flex-col gap-2 rounded-md border border-border p-2"
          >
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-caption font-mono">
                {"path" in file ? file.path : "Generated"}
              </span>
              <IconButton
                size="sm"
                label="Move up"
                icon={<Icon name="chevron-up" />}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              />
              <IconButton
                size="sm"
                label="Move down"
                icon={<Icon name="chevron-down" />}
                disabled={i === step.files.length - 1}
                onClick={() => move(i, 1)}
              />
              <IconButton
                size="sm"
                label="Remove"
                icon={<Icon name="trash" />}
                onClick={() => remove(i)}
              />
            </div>
            {"path" in file ? (
              <ProjectFile
                path={file.path}
                info={status?.[file.path]}
                onSupply={() => void add(i)}
                onGenerate={(size) =>
                  replace(i, {
                    generate: {
                      name: file.path.split("/").pop() ?? "file",
                      size,
                    },
                  })
                }
              />
            ) : (
              <GeneratedFields
                file={file}
                onChange={(next) => replace(i, next)}
              />
            )}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          iconLeft={<Icon name="plus" />}
          onClick={() => void add()}
        >
          Add file…
        </Button>
        <Button
          size="sm"
          variant="secondary"
          iconLeft={<Icon name="plus" />}
          onClick={() =>
            setFiles([
              ...step.files,
              { generate: { name: "file.bin", size: 1024 * 1024 } },
            ])
          }
        >
          Add generated file
        </Button>
      </div>
    </div>
  );
}

function ProjectFile({
  path,
  info,
  onSupply,
  onGenerate,
}: {
  path: string;
  info?: { exists: boolean; size?: number };
  onSupply: () => void;
  onGenerate: (size: number) => void;
}) {
  if (!info) return null;
  if (info.exists)
    return (
      <span className="text-caption text-ink-muted">
        {humanSize(info.size ?? 0)}
      </span>
    );
  return (
    <div className="flex flex-col gap-2">
      <span className="flex items-center gap-1 text-caption text-warning">
        <Icon name="triangle-alert" size={14} /> Missing: {path} isn't in the
        project
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={onSupply}>
          Add file…
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onGenerate(1024 * 1024)}
        >
          Use generated file
        </Button>
      </div>
    </div>
  );
}

/** Keeps the size as typed, so "1." can become "1.5 MB"; the step only changes while it is a size */
function GeneratedFields({
  file,
  onChange,
}: {
  file: Extract<FileEntry, { generate: unknown }>;
  onChange: (file: FileEntry) => void;
}) {
  const { generate } = file;
  const [typed, setTyped] = useState(formatSize(generate.size));
  const text =
    parseSize(typed) === generate.size ? typed : formatSize(generate.size);
  return (
    <div className="grid grid-cols-2 gap-2">
      <Input
        label="Name"
        mono
        value={generate.name}
        onChange={(e) =>
          onChange({ generate: { ...generate, name: e.target.value } })
        }
      />
      <Input
        label="Size"
        hint="e.g. 60 MB, 1.5 GB"
        mono
        value={Number.isNaN(generate.size) ? typed : text}
        error={parseSize(typed) === undefined ? "A size like 60 MB" : undefined}
        onChange={(e) => {
          setTyped(e.target.value);
          onChange({
            generate: {
              ...generate,
              size: parseSize(e.target.value) ?? Number.NaN,
            },
          });
        }}
      />
      <Input
        label="Type"
        hint="Only for drops; uploads take it from the name"
        mono
        value={generate.type ?? ""}
        onChange={(e) => {
          const { type: _old, ...rest } = generate;
          onChange({
            generate:
              e.target.value === "" ? rest : { ...rest, type: e.target.value },
          });
        }}
      />
    </div>
  );
}
```

Re-export `formatSize`, `humanSize`, `parseSize` from `lib/steps.ts` (`export { formatSize, humanSize, parseSize } from "@itmetsam/samurai-framework/steps";`, or the copied functions). `text-warning` stands for the warning text colour class the app uses elsewhere (check `record-alerts.tsx` / `Alert` usage and match it).

- [ ] **Step 6: Wire the list into the dialog, the inspector and the editor**

- `stepFields(draft, set)` gains an optional third parameter `files?: { status?: Record<string, { exists: boolean; size?: number }>; onAddFiles: () => Promise<string[]> }`; for `setInputFiles` / `dropFiles` it returns `<FileList step={draft} set={set} status={files?.status} onAddFiles={files?.onAddFiles ?? (async () => [])} />`. `StepEditDialog` and `Inspector` take the same optional `files` prop and pass it on.
- The inspector's section title for these kinds: `"Files"`.
- In the editor's `index.tsx` (where the inspector gets its props), build `files`:
  - `onAddFiles: async () => { const r = await window.api.addFiles(project.id, config?.filesDir); if (!r.ok) { setError(r.error); return []; } return r.paths; }`, using the editor's existing error state;
  - `status`: from a hook that calls `window.api.fileStatus(project.id, paths)` for every `stepFilePaths` of the test's steps whenever the test's source changes (one call per change, not per step); keep the last result in state.
- `step-item.tsx`: add `missing?: boolean`; when true, pass `icon={<Icon name="triangle-alert" size={14} />}` (it wins over the key icon) and a `title` of `A file of this step isn't in the project`. `steps-panel.tsx` passes `missing={stepFilePaths(step.step).some((p) => status?.[p]?.exists === false)}`.
- `add-step-bar.tsx`: new prop `fileSteps: boolean`; when true, add two menu items after "Screenshot":

```tsx
            ...(fileSteps
              ? [
                  {
                    label: "Upload files",
                    icon: <Icon name="folder-open" />,
                    onSelect: () => onAdd({ kind: "setInputFiles", locator: PLACEHOLDER_LOCATOR, files: [] }),
                  },
                  {
                    label: "Drop files",
                    icon: <Icon name="folder-open" />,
                    onSelect: () => onAdd({ kind: "dropFiles", locator: PLACEHOLDER_LOCATOR, files: [] }),
                  },
                ]
              : []),
```

with `const PLACEHOLDER_LOCATOR = { chain: [{ method: "getByCss" as const, css: "input[type=file]" }], fallbacks: [] };` and a comment that the locator is changed in the code view or by recording, like other locators. The editor passes `fileSteps={!details?.frameworkVersion || !isOlder(details.frameworkVersion, FILE_STEPS_VERSION)}`: hide only when the project's framework is known to be older.

- `record-alerts.tsx`: after the secrets block, render a warning `Alert` when `done.missingFiles.length > 0`:

```tsx
<Alert
  status="warning"
  title="Add the files this test uses"
  onDismiss={onDismiss}
>
  {done.missingFiles.map((f) => f.name).join(", ")} weren't saved: files over 50
  MB, or files that couldn't be read. Add them to {done.filesFolder ?? "files"}/
  (the step's Add file… does this), or use a generated file.
</Alert>
```

and an info `Alert` for `done.filesIgnored` (`{folder}/ is ignored by git; CI won't have these files.`) and for `done.firstFiles` (`Recorded files are stored in {folder}/ and committed with your tests.`). Restructure the component so several alerts can show at once (a `div` with `flex flex-col gap-2` around them); the early `return null` becomes "nothing to show".

- [ ] **Step 7: Docs**

In the app's docs that list step kinds and the record alerts (find them with `grep -rln "Screenshot" docs`), add the upload and drop steps, the file list in the side panel, and the file warnings.

- [ ] **Step 8: Check**

Run: `bun test && npx tsc --noEmit -p . && npx electron-vite build`
Expected: PASS.

- [ ] **Step 9: Commit and open the PR**

```bash
git add -A src docs
git commit -m "feat: upload and drop steps in the editor, with project and generated files"
git push -u origin feat/file-uploads
gh pr create --base feat/recorder-toolbar --title "feat: file upload steps (framework 0.8.0)" --body-file <scratchpad>/pr-app-files.md
```

Base the PR on `main` instead if PR #15 is merged by then. The body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)` and has a manual test plan:

- record an upload in the test project;
- record a drop on a dropzone;
- record a file over 50 MB and see the warnings;
- add a generated file in the side panel and run the test.
