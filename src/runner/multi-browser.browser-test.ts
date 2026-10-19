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
import { MANAGED_BROWSERS } from "../browsers/pins.js";
import { statusOf } from "../browsers/store.js";
import { listGroups, runTests, type RunEvent } from "./run.js";

const API = path.resolve("src/api.ts");

/**
 * These tests need both browsers; a machine with one of them skips them. Decided once, before the first test is
 * registered: a registered test starts at once, and anything still loading config then would clear its project
 */
const SKIP = MANAGED_BROWSERS.every(
  (name) => statusOf(name, { env: {} }).state === "installed",
)
  ? false
  : "Firefox and Chrome must both be installed";

const SPEC = `
import { expect, test } from ${JSON.stringify(API)};
test("shows the heading", async ({ page, browserName }) => {
  await page.navigateTo("data:text/html,<h1>Hi</h1>");
  await expect(page.getByCss("h1")).toHaveText("Hi");
  await page.screenshot({ name: "heading" });
  // The fixture names the browser the test really runs in
  await page.navigateTo("data:text/html,<p id=ua></p><script>ua.textContent = navigator.userAgent</script>");
  const agent = (await page.getByCss("#ua").textContent()) ?? "";
  if (!agent.includes(browserName === "chrome" ? "Chrome" : "Firefox")) throw new Error(browserName + " is not " + agent);
});
test("fails on purpose", async ({ page }) => {
  await page.navigateTo("data:text/html,<h1>Hi</h1>");
  await expect(page.getByCss("h1")).toHaveText("Bye", { timeout: 300 });
});
`;

function project(config: object) {
  const dir = mkdtempSync(path.join(tmpdir(), "samurai-multi-"));
  writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  mkdirSync(path.join(dir, "specs"));
  writeFileSync(path.join(dir, "specs/shop.spec.ts"), SPEC);
  return {
    dir,
    config: {
      srcDir: "./specs",
      timeout: 30000,
      expect: { timeout: 1000 },
      ...config,
    },
  };
}

test(
  "a project with two browsers runs every test in each, and reports a result per test and browser",
  { timeout: 180000, skip: SKIP },
  async () => {
    const { dir, config } = project({ browsers: ["firefox", "chrome"] });
    const events: RunEvent[] = [];
    const summary = await runTests({
      projectDir: dir,
      config,
      dataDir: path.join(dir, "data"),
      headless: true,
      port: 9261,
      onEvent: (event) => events.push(event),
    });

    assert.equal(summary.status, "failed");
    assert.deepEqual(summary.browsers, ["firefox", "chrome"]);
    assert.deepEqual(
      summary.tests.map((t) => [t.name, "browser" in t && t.browser, t.status]),
      [
        ["shows the heading", "firefox", "success"],
        ["fails on purpose", "firefox", "failed"],
        ["shows the heading", "chrome", "success"],
        ["fails on purpose", "chrome", "failed"],
      ],
      "all tests in the first browser, then all in the second",
    );
    assert.equal((events[0] as { total: number }).total, 4);
    assert.deepEqual(
      events
        .filter((e) => e.type === "test-end")
        .map((e) => (e as { browser: string }).browser),
      ["firefox", "firefox", "chrome", "chrome"],
    );

    for (const browser of ["firefox", "chrome"]) {
      assert.ok(
        existsSync(
          path.join(
            dir,
            "result/screenshots",
            browser,
            "shop.spec/shows-the-heading/heading.png",
          ),
        ),
        `${browser} has its own screenshot folder`,
      );
    }
    const report = JSON.parse(
      readFileSync(path.join(dir, "result/report.json"), "utf8"),
    ) as {
      browsers: string[];
      tests: { browser: string }[];
    };
    assert.deepEqual(report.browsers, ["firefox", "chrome"]);
    assert.deepEqual(
      report.tests.map((t) => t.browser),
      ["firefox", "firefox", "chrome", "chrome"],
    );
  },
);

test(
  "a group runs in its own browsers, and --browser (the option) beats the group",
  { timeout: 180000, skip: SKIP },
  async () => {
    const { dir, config } = project({
      browsers: ["firefox"],
      groups: [
        {
          name: "chrome-only",
          testMatch: "**/*.spec.ts",
          browsers: ["chrome"],
        },
      ],
    });
    const groups = await listGroups({ projectDir: dir, config });
    assert.deepEqual(
      groups.map((g) => [g.name, g.browsers]),
      [["chrome-only", ["chrome"]]],
    );

    const ofGroup = await runTests({
      projectDir: dir,
      config,
      dataDir: path.join(dir, "data"),
      headless: true,
      port: 9262,
      group: "chrome-only",
      grep: "shows the heading",
      reportPath: false,
    });
    assert.deepEqual(ofGroup.browsers, ["chrome"]);
    assert.equal(ofGroup.status, "success");

    const overridden = await runTests({
      projectDir: dir,
      config,
      dataDir: path.join(dir, "data"),
      headless: true,
      port: 9263,
      group: "chrome-only",
      browsers: ["firefox"],
      grep: "shows the heading",
      reportPath: false,
    });
    assert.deepEqual(overridden.browsers, ["firefox"]);
  },
);
