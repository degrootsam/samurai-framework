import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { browserConfig } from "../testing/test-browser.js";
import { runTests } from "./run.js";

const API = JSON.stringify(path.resolve("src/api.ts"));

/** `log(line)` appends to `api.log` next to the project; `logJSON(value)` appends a JSON line */
const HEAD = `
import { appendFileSync } from "node:fs";
import { test } from ${API};
const log = (line) => appendFileSync(process.env.API_LOG, line + "\\n");
const logJSON = (value) => log(JSON.stringify(value));
const open = (page) => page.navigateTo("data:text/html,<h1>Hi</h1>");
`;

function project(spec: string, config: object = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "samurai-test-api-"));
  writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  writeFileSync(
    path.join(dir, "samurai.config.ts"),
    `export default ${JSON.stringify({ srcDir: "./specs", timeout: 30000, expect: { timeout: 1000 }, forbidOnly: false, ...browserConfig(), ...config })};`,
  );
  mkdirSync(path.join(dir, "specs"));
  const specFile = path.join(dir, "specs/shop.spec.ts");
  writeFileSync(specFile, HEAD + spec);
  const apiLog = path.join(dir, "api.log");
  writeFileSync(apiLog, "");
  process.env.API_LOG = apiLog;
  const lines = () => readFileSync(apiLog, "utf8").split("\n").filter(Boolean);
  return {
    dir,
    specFile,
    lines,
    json: () =>
      lines()
        .filter((l) => l.startsWith("{"))
        .map((l) => JSON.parse(l) as Record<string, any>),
  };
}

const run = (dir: string, port: number, extra: object = {}) =>
  runTests({
    projectDir: dir,
    dataDir: path.join(dir, "data"),
    headless: true,
    port,
    workers: 1,
    reportPath: false,
    ...extra,
  });

/** Fixtures that log their setup and teardown, built on the real page */
const FIXTURES = `
const base = test.extend({
  shop: async ({ page }, use) => {
    log("+shop");
    await page.navigateTo("data:text/html,<h1 id=h>Shop</h1>");
    await use({ page, title: () => page.locator("#h").textContent() });
    log("-shop");
  },
});
`;

test(
  "test.extend fixtures use the page, are lazy, and hooks and the body share them",
  { timeout: 120000 },
  async () => {
    const { dir, lines } = project(`${FIXTURES}
const t = base.extend({
  user: async ({ shop }, use) => { log("+user"); await use({ name: await shop.title() }); log("-user"); },
  unused: async ({}, use) => { log("+unused"); await use(1); },
  answer: 42,
});
let first;
t.beforeEach(async ({ user }) => { first = user; log("beforeEach"); });
t.afterEach(async ({ user }) => { log("afterEach same=" + (user === first)); });
t("uses user", async ({ user, shop, answer, baseURL }) => {
  log("body " + user.name + " " + answer + " " + (await shop.title()));
  log("same=" + (user === first));
});
t("uses only the page", async ({ page }) => { log("plain"); });
`);
    const summary = await run(dir, 9351);
    assert.deepEqual(
      summary.tests.map((t) => [t.name, t.status]),
      [
        ["uses user", "success"],
        ["uses only the page", "success"],
      ],
    );
    assert.deepEqual(lines(), [
      "+shop",
      "+user",
      "beforeEach",
      "body Shop 42 Shop",
      "same=true",
      "afterEach same=true",
      "-user",
      "-shop",
      // The hooks ask for `user`, so a test that does not still gets it
      "+shop",
      "+user",
      "beforeEach",
      "plain",
      "afterEach same=true",
      "-user",
      "-shop",
    ]);
  },
);

test(
  "test.extend: auto fixtures, overriding built-ins, and chaining",
  { timeout: 120000 },
  async () => {
    const { dir, lines } = project(`${FIXTURES}
const t = base.extend({
  tracker: [async ({}, use) => { log("+tracker"); await use(null); log("-tracker"); }, { auto: true }],
  baseURL: "http://override.test",
  page: async ({ page }, use) => { await page.navigateTo("data:text/html,<p id=p>wrapped</p>"); await use(page); },
});
t("auto and overrides", async ({ page, baseURL }) => {
  log("body " + baseURL + " " + (await page.locator("#p").textContent()));
});
t("auto without asking", async () => { log("empty"); });
`);
    const summary = await run(dir, 9352);
    assert.deepEqual(
      summary.tests.map((t) => t.status),
      ["success", "success"],
    );
    assert.deepEqual(lines(), [
      "+tracker",
      "body http://override.test wrapped",
      "-tracker",
      "+tracker",
      "empty",
      "-tracker",
    ]);
  },
);

test(
  "test.extend: a failing test, a timed out test and a setup error still tear fixtures down; errors are clear",
  { timeout: 180000 },
  async () => {
    const { dir, lines } = project(
      `${FIXTURES}
const t = base.extend({
  broken: async ({}, use) => { throw new Error("no luck"); },
  messy: async ({}, use) => { await use(1); throw new Error("cleanup broke"); },
});
t("fails", async ({ shop }) => { log("fails"); throw new Error("body failed"); });
t("hangs", async ({ shop }) => { log("hangs"); await new Promise(() => {}); });
t("setup error", async ({ broken }) => { log("must not run"); });
t("teardown error", async ({ messy }) => { log("ran"); });
t("unknown", async ({ nope }) => { log("must not run"); });
`,
      { timeout: 4000 },
    );
    const summary = await run(dir, 9353);
    const got = summary.tests.map((t) => [
      t.name,
      t.status,
      "message" in t ? t.message : undefined,
    ]);
    assert.deepEqual(got, [
      ["fails", "failed", "body failed"],
      ["hangs", "failed", "Test timed out after 4 seconds"],
      ["setup error", "failed", 'fixture "broken" setup failed: no luck'],
      [
        "teardown error",
        "failed",
        'fixture "messy" teardown failed: cleanup broke',
      ],
      ["unknown", "failed", 'extend(): unknown fixture "nope"'],
    ]);
    assert.deepEqual(lines(), [
      "+shop",
      "fails",
      "-shop",
      "+shop",
      "hangs",
      "-shop",
      "ran",
    ]);
  },
);
