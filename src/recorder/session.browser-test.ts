import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { MANAGED_BROWSERS } from "../browsers/pins.js";
import { statusOf } from "../browsers/store.js";
import { parseSpec } from "../steps/parse.js";
import { OPTIONS, PAGE, pause, project } from "../testing/session-setup.js";
import { recordSpec } from "./session.js";

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
  "recordSpec sends a first recording status right after it starts",
  OPTIONS,
  async () => {
    const { dir, config } = project();
    const statuses: { state: string; toolbar: boolean }[] = [];
    const controller = new AbortController();
    await recordSpec({
      projectDir: dir,
      config,
      dataDir: path.join(dir, "data"),
      file: "tests/first.spec.ts",
      create: "first status",
      url: PAGE,
      headless: true,
      port: 9246,
      signal: controller.signal,
      onStatus: (status) => statuses.push(status),
      onStarted: () => controller.abort(),
    });
    assert.deepEqual(statuses[0], { state: "recording", toolbar: true });
    assert.equal(statuses.length, 1);
  },
);

test(
  "a recording with nothing recorded returns every result field",
  OPTIONS,
  async () => {
    const { dir, config } = project();
    const controller = new AbortController();
    const result = await recordSpec({
      projectDir: dir,
      config,
      dataDir: path.join(dir, "data"),
      file: "tests/empty.spec.ts",
      create: "nothing",
      url: PAGE,
      headless: true,
      port: 9247,
      signal: controller.signal,
      onStarted: () => controller.abort(),
    });
    assert.deepEqual(result.files, []);
    assert.deepEqual(result.missingFiles, []);
    assert.equal(result.filesIgnored, false);
    assert.equal(result.firstFiles, false);
    assert.deepEqual(result.secrets, []);
    assert.deepEqual(result.unsetSecrets, []);
    assert.equal(typeof result.filesFolder, "string");
  },
);

/** Decided once, before a test is registered (a registered test starts at once) */
const BOTH = MANAGED_BROWSERS.every(
  (name) => statusOf(name, { env: {} }).state === "installed",
)
  ? false
  : "Firefox and Chrome must both be installed";

const AGENT_PAGE = `data:text/html,<p id=ua></p><script>ua.textContent = navigator.userAgent</script>`;

async function recordedIn(options: { browser?: "firefox" | "chrome" }) {
  const { dir, config } = project({ browsers: ["chrome", "firefox"] });
  let agent = "";
  await recordSpec({
    projectDir: dir,
    config,
    dataDir: path.join(dir, "data"),
    file: "tests/which.spec.ts",
    create: "which",
    url: AGENT_PAGE,
    headless: true,
    port: 9275,
    ...options,
    onStarted: async ({ page, browser }) => {
      agent = (await page.getByCss("#ua").textContent()) ?? "";
      void browser.close();
    },
  });
  return agent;
}

test(
  "recordSpec records in the first browser of the project, or in the one it is told",
  { ...OPTIONS, skip: BOTH },
  async () => {
    assert.match(await recordedIn({}), /Chrome/);
    assert.match(await recordedIn({ browser: "firefox" }), /Firefox/);
  },
);
