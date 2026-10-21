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
import { runTests } from "./run.js";
import { browserConfig, testBrowser } from "../testing/test-browser.js";

const API = path.resolve("src/api.ts");

const SPEC = `
import { test } from ${JSON.stringify(API)};
test("takes screenshots", async ({ page }) => {
  await page.navigateTo("data:text/html,<h1>Hi</h1>");
  await page.screenshot({ name: "first view" });
  await page.screenshot({ name: "first view", fullPage: true });
  await page.waitForTimeout(50);
});
`;

test(
  "named screenshots are saved under result/screenshots/<browser> and listed in the report",
  { timeout: 90000 },
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "samurai-project-"));
    writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
    mkdirSync(path.join(dir, "specs"));
    writeFileSync(path.join(dir, "specs/shots.spec.ts"), SPEC);
    const summary = await runTests({
      projectDir: dir,
      config: { ...browserConfig(), srcDir: "./specs", timeout: 30000 },
      dataDir: path.join(dir, "data"),
      headless: true,
      port: 9254,
    });
    assert.equal(summary.status, "success");

    const folder = `screenshots/${testBrowser()}/shots.spec/takes-screenshots`;
    const expected = [
      { name: "first-view", path: `${folder}/first-view.png` },
      { name: "first-view-2", path: `${folder}/first-view-2.png` },
    ];
    for (const { path: relative } of expected) {
      const file = path.join(dir, "result", ...relative.split("/"));
      assert.ok(existsSync(file), `${relative} exists`);
      assert.deepEqual(
        [...readFileSync(file).subarray(0, 4)],
        [0x89, 0x50, 0x4e, 0x47],
      );
    }
    const report = JSON.parse(
      readFileSync(path.join(dir, "result/report.json"), "utf8"),
    ) as { tests: { screenshots?: unknown }[] };
    assert.deepEqual(report.tests[0]?.screenshots, expected);
  },
);

test(
  "with outputDir, the report and the screenshots go there and result/ stays empty",
  { timeout: 90000 },
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "samurai-project-"));
    writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
    mkdirSync(path.join(dir, "specs"));
    writeFileSync(path.join(dir, "specs/shots.spec.ts"), SPEC);
    const outputDir = path.join(dir, "runs", "1");
    const summary = await runTests({
      projectDir: dir,
      config: { ...browserConfig(), srcDir: "./specs", timeout: 30000 },
      dataDir: path.join(dir, "data"),
      headless: true,
      port: 9254,
      outputDir,
    });
    assert.equal(summary.status, "success");

    const relative = `screenshots/${testBrowser()}/shots.spec/takes-screenshots/first-view.png`;
    assert.ok(existsSync(path.join(outputDir, ...relative.split("/"))));
    const report = JSON.parse(
      readFileSync(path.join(outputDir, "report.json"), "utf8"),
    ) as { tests: { screenshots?: { path: string }[] }[] };
    assert.equal(report.tests[0]?.screenshots?.[0]?.path, relative);
    assert.ok(!existsSync(path.join(dir, "result", "report.json")));
    assert.ok(!existsSync(path.join(dir, "result", "screenshots")));
  },
);
