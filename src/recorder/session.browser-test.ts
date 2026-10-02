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
