import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type Page from "../browser/page.js";
import { callFunction } from "../script/call-function.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import { parseSpec } from "../steps/parse.js";
import { recordSpec } from "./session.js";

const OPTIONS = { timeout: 90000 };
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const PAGE = `data:text/html,<label for="n">Name</label><input id="n"><label>Secret <input type="password" name="pw"></label><button>Save</button>`;

function project(config: object = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "samurai-record-"));
  return { dir, config: { srcDir: "./tests", ...config } };
}

test(
  "recordSpec creates the spec and test, writes steps as they happen and stops on abort",
  OPTIONS,
  async () => {
    const { dir, config } = project();
    const controller = new AbortController();
    const written: string[] = [];
    const result = await recordSpec({
      projectDir: dir,
      config,
      dataDir: path.join(dir, "data"),
      file: "tests/signin.spec.ts",
      create: "signs in",
      url: PAGE,
      headless: true,
      port: 9271,
      signal: controller.signal,
      onEvent: (_event, source) => written.push(source),
      onStarted: async ({ page }) => {
        await page.getByLabel("Name").fill("Sam");
        await page.getByLabel("Secret").fill("hunter2");
        await page.getByText("Save").click();
        await pause(600);
        controller.abort();
      },
    });

    const file = path.join(dir, "tests/signin.spec.ts");
    const source = readFileSync(file, "utf8");
    assert.equal(result.file, file);
    assert.equal(result.test, "signs in");
    assert.match(
      source,
      /^import \{ expect, test \} from "@itmetsam\/samurai-framework";/,
    );
    assert.deepEqual(
      parseSpec(source)[0]!.steps.map(({ step }) => step.kind),
      ["goto", "fill", "fill", "click"],
    );
    assert.ok(!source.includes("hunter2"), "a password never reaches the file");
    assert.deepEqual(result.secrets, ["PW"]);
    assert.deepEqual(result.unsetSecrets, ["PW"], "PW has no value yet");
    assert.ok(written.length >= 4, "the file was updated while recording");
  },
);

test(
  "recordSpec appends to an existing test by default and from --at when asked",
  OPTIONS,
  async () => {
    const { dir, config } = project();
    const file = path.join(dir, "tests/a.spec.ts");
    const start = `import { test } from "@itmetsam/samurai-framework";\n\ntest("t", async ({ page }) => {\n  await page.goto("/one");\n  await page.waitForNetworkIdle();\n});\n`;
    mkdirSync(path.dirname(file), { recursive: true });
    const run = async (at?: number) => {
      writeFileSync(file, start);
      const controller = new AbortController();
      await recordSpec({
        projectDir: dir,
        config,
        dataDir: path.join(dir, "data"),
        file: "tests/a.spec.ts",
        ...(at !== undefined && { at }),
        url: PAGE,
        headless: true,
        port: 9272,
        signal: controller.signal,
        onStarted: async ({ page }) => {
          await page.getByText("Save").click();
          await pause(500);
          controller.abort();
        },
      });
      return parseSpec(readFileSync(file, "utf8"))[0]!.steps.map(
        ({ step }) => step.kind,
      );
    };
    assert.deepEqual(await run(), ["goto", "waitForNetworkIdle", "click"]);
    assert.deepEqual(await run(1), ["goto", "click", "waitForNetworkIdle"]);
  },
);

test(
  "recordSpec refuses a missing file without --new, and does not create it",
  OPTIONS,
  async () => {
    const { dir, config } = project();
    await assert.rejects(
      recordSpec({
        projectDir: dir,
        config,
        file: "tests/none.spec.ts",
        port: 9273,
      }),
      /does not exist/,
    );
    assert.equal(existsSync(path.join(dir, "tests/none.spec.ts")), false);
  },
);

test("recordSpec ends when the browser window is closed", OPTIONS, async () => {
  const { dir, config } = project();
  const result = await recordSpec({
    projectDir: dir,
    config,
    dataDir: path.join(dir, "data"),
    file: "tests/c.spec.ts",
    create: "closes",
    url: PAGE,
    headless: true,
    port: 9274,
    onStarted: async ({ page, browser }) => {
      await page.getByText("Save").click();
      await pause(500);
      void browser.close();
    },
  });
  assert.equal(result.test, "closes");
});

test(
  "recordSpec resolves when the toolbar's Stop is pressed, and reports its status",
  OPTIONS,
  async () => {
    const { dir, config } = project();
    const statuses: { state: string; toolbar: boolean }[] = [];
    const result = await recordSpec({
      projectDir: dir,
      config,
      dataDir: path.join(dir, "data"),
      file: "tests/stop.spec.ts",
      create: "stops",
      url: PAGE,
      headless: true,
      port: 9245,
      onStatus: (status) => statuses.push(status),
      onStarted: async ({ page }) => {
        await page.getByLabel("Name").fill("Sam");
        await pause(1500);
        const press = (action: string) =>
          callFunction(
            (page as unknown as { biDiConnector: BiDiConnector }).biDiConnector,
            page.contextId,
            `() => globalThis[Symbol.for("samurai.toolbar")].press(${JSON.stringify(action)})`,
            [],
            { sandbox: "samurai-toolbar" },
          );
        await press("pause");
        await pause(300);
        await press("resume");
        await pause(300);
        await press("stop");
      },
    });
    assert.equal(result.test, "stops");
    assert.deepEqual(statuses, [
      { state: "paused", toolbar: true },
      { state: "recording", toolbar: true },
    ]);
  },
);

test(
  "recordSpec lists a secret added from the panel in the result",
  OPTIONS,
  async () => {
    const { dir, config } = project();
    const press = (
      page: Page,
      fn: string,
      ...args: unknown[]
    ): Promise<unknown> =>
      callFunction(
        (page as unknown as { biDiConnector: BiDiConnector }).biDiConnector,
        page.contextId,
        fn,
        args as never[],
        { sandbox: "samurai-toolbar" },
      );
    const HOOK = `globalThis[Symbol.for("samurai.toolbar")]`;
    const result = await recordSpec({
      projectDir: dir,
      config,
      dataDir: path.join(dir, "data"),
      file: "tests/added.spec.ts",
      create: "adds a secret",
      url: PAGE,
      headless: true,
      port: 9245,
      onStarted: async ({ page }) => {
        await pause(1500);
        await callFunction(
          (page as unknown as { biDiConnector: BiDiConnector }).biDiConnector,
          page.contextId,
          `() => document.getElementById("n").focus()`,
          [],
        );
        await press(page, `() => ${HOOK}.press("insert")`);
        await press(
          page,
          `() => ${HOOK}.press("insert-new", { kind: "secret" })`,
        );
        for (const [field, value] of [
          ["name", "API_KEY"],
          ["value", "s3cret"],
        ] as const) {
          await press(
            page,
            `(field, value) => {
              const el = ${HOOK}.root.querySelector('[data-field="' + field + '"]');
              el.value = value;
              el.dispatchEvent(new Event("input", { bubbles: true }));
            }`,
            field,
            value,
          );
        }
        await press(page, `() => ${HOOK}.press("new-save")`);
        await pause(1000);
        await press(page, `() => ${HOOK}.press("stop")`);
      },
    });
    assert.ok(result.secrets.includes("API_KEY"));
    assert.ok(
      !result.unsetSecrets.includes("API_KEY"),
      "a secret added from the toolbar has a value",
    );
    assert.match(
      readFileSync(path.join(dir, ".env.default"), "utf8"),
      /API_KEY/,
    );
  },
);

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
    assert.equal(result.filesFolder, "data/uploads");
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
