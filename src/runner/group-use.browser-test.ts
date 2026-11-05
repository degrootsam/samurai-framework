import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { browserConfig, testBrowser } from "../testing/test-browser.js";
import { runTests } from "./run.js";

const API = JSON.stringify(path.resolve("src/api.ts"));
const chrome = testBrowser() === "chrome";

let server: Server;
let base = "";

before(async () => {
  server = createServer((_req, res) => {
    res
      .setHeader("content-type", "text/html")
      .end(
        `<!doctype html><meta name="viewport" content="width=600"><body></body>`,
      );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/** One spec with a plain test and a test in a describe that overrides the timezone with `test.use` */
const SPEC = `
import { appendFileSync } from "node:fs";
import { test, expect } from ${API};
const log = async (page, name) => appendFileSync(process.env.API_LOG, JSON.stringify({
  name,
  project: test.info().project.name,
  size: page.viewportSize(),
  ...(await page.evaluate(\`() => ({
    language: navigator.language,
    zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    touch: navigator.maxTouchPoints,
  })\`)),
}) + "\\n");

test("plain", async ({ page }) => {
  await page.navigateTo(process.env.GROUP_BASE + "/");
  await log(page, "plain");
});
test.describe("inner", () => {
  test.use({ timezone: "Asia/Tokyo" });
  test("overridden", async ({ page }) => {
    await page.navigateTo(process.env.GROUP_BASE + "/");
    await log(page, "overridden");
  });
});
`;

const GROUPS = [
  {
    name: "phone",
    use: {
      locale: "nl-NL",
      timezone: "Europe/Amsterdam",
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    },
  },
  {
    name: "desktop",
    use: { locale: "de-DE", viewport: { width: 1024, height: 768 } },
  },
];

function project() {
  const dir = mkdtempSync(path.join(tmpdir(), "samurai-group-use-"));
  writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  writeFileSync(
    path.join(dir, "samurai.config.ts"),
    `export default ${JSON.stringify({
      srcDir: "./specs",
      timeout: 40000,
      expect: { timeout: 2000 },
      forbidOnly: false,
      ...browserConfig(),
      use: { locale: "en-GB", timezone: "UTC" },
      groups: GROUPS,
    })};`,
  );
  mkdirSync(path.join(dir, "specs"));
  writeFileSync(path.join(dir, "specs/use.spec.ts"), SPEC);
  const apiLog = path.join(dir, "api.log");
  writeFileSync(apiLog, "");
  process.env.API_LOG = apiLog;
  process.env.GROUP_BASE = base;
  return {
    dir,
    rows: () =>
      readFileSync(apiLog, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, any>),
  };
}

const run = (
  dir: string,
  port: number,
  group?: string | string[],
  workers = 1,
) =>
  runTests({
    projectDir: dir,
    dataDir: path.join(dir, "data"),
    headless: true,
    port,
    workers,
    reportPath: false,
    ...(group !== undefined && { group }),
  });

const LONG = { timeout: 180000 };

test(
  "two groups over the same specs: each run has its group's use, name and result group, and test.use wins",
  LONG,
  async () => {
    const { dir, rows } = project();
    const summary = await run(dir, 9490, ["phone", "desktop"]);
    assert.deepEqual(
      summary.tests.map((t) => [t.group, t.name, t.status]),
      [
        ["phone", "plain", "success"],
        ["phone", "inner > overridden", "success"],
        ["desktop", "plain", "success"],
        ["desktop", "inner > overridden", "success"],
      ],
    );
    const by = (project: string, name: string) =>
      rows().find((r) => r.project === project && r.name === name)!;

    const phone = by("phone", "plain");
    assert.equal(phone.language, "nl-NL");
    assert.equal(phone.zone, "Europe/Amsterdam");
    assert.deepEqual(phone.size, { width: 390, height: 844 });
    if (chrome) assert.equal(phone.touch, 1, "hasTouch applies on Chrome");

    const desktop = by("desktop", "plain");
    assert.equal(desktop.language, "de-DE");
    assert.equal(
      desktop.zone,
      "UTC",
      "the group has no timezone: config's stays",
    );
    assert.deepEqual(desktop.size, { width: 1024, height: 768 });
    assert.equal(desktop.touch, 0);

    // test.use is the innermost layer: it beats the group's timezone, the group's locale stays
    const over = by("phone", "overridden");
    assert.equal(over.zone, "Asia/Tokyo");
    assert.equal(over.language, "nl-NL");
    assert.equal(by("desktop", "overridden").zone, "Asia/Tokyo");
  },
);

test(
  "without --group the group's use is not applied and project.name is the browser",
  LONG,
  async () => {
    const { dir, rows } = project();
    const summary = await run(dir, 9491);
    assert.deepEqual(
      summary.tests.map((t) => [t.status, "group" in t]),
      [
        ["success", false],
        ["success", false],
      ],
    );
    const [plain] = rows();
    assert.equal(plain?.project, testBrowser());
    assert.equal(plain?.language, "en-GB");
    assert.equal(plain?.zone, "UTC");
    assert.deepEqual(plain?.size, { width: 1280, height: 720 });
  },
);

test("one group on its own names the group in its results", LONG, async () => {
  const { dir, rows } = project();
  const summary = await run(dir, 9492, "desktop");
  assert.deepEqual(
    summary.tests.map((t) => t.group),
    ["desktop", "desktop"],
  );
  assert.equal(rows()[0]?.project, "desktop");
});

test(
  "on a pool of workers each run still has its group, its use and its own result",
  LONG,
  async () => {
    const { dir, rows } = project();
    const summary = await run(dir, 9493, ["phone", "desktop"], 2);
    assert.deepEqual(
      summary.tests.map((t) => [t.group, t.name, t.status]),
      [
        ["phone", "plain", "success"],
        ["phone", "inner > overridden", "success"],
        ["desktop", "plain", "success"],
        ["desktop", "inner > overridden", "success"],
      ],
    );
    const plain = rows().filter((r) => r.name === "plain");
    assert.deepEqual(plain.map((r) => [r.project, r.language]).sort(), [
      ["desktop", "de-DE"],
      ["phone", "nl-NL"],
    ]);
  },
);
