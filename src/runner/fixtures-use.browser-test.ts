import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { testBrowser } from "../testing/test-browser.js";
import { runTests } from "./run.js";

const API = JSON.stringify(path.resolve("src/api.ts"));

/** The project's own fixtures, listed in its config: they log their setup and teardown */
const FIXTURES = `
import { appendFileSync } from "node:fs";
import { test as base } from ${API};
export const log = (line) => appendFileSync(process.env.API_LOG, line + "\\n");
export const test = base.extend({
  orderOptions: [{ items: 1, paid: true, note: "none" }, { option: true }],
  order: async ({ orderOptions, page }, use) => {
    log("+order " + JSON.stringify(orderOptions));
    await page.navigateTo("data:text/html,<h1>Order</h1>");
    await use({ items: orderOptions.items });
    log("-order");
  },
  customer: async ({}, use) => {
    log("+customer");
    await use("ada");
    log("-customer");
  },
});
`;

function project(config: string, spec: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "samurai-fixtures-use-"));
  writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  writeFileSync(path.join(dir, "fixtures.ts"), FIXTURES);
  writeFileSync(
    path.join(dir, "samurai.config.ts"),
    `import { test as shop } from "./fixtures.ts";
export default {
  srcDir: "./specs", timeout: 30000, expect: { timeout: 1000 }, forbidOnly: false,
  browsers: [${JSON.stringify(testBrowser())}], fixtures: [shop], ${config}
};`,
  );
  mkdirSync(path.join(dir, "specs"));
  writeFileSync(
    path.join(dir, "specs/shop.spec.ts"),
    `import { test, log } from "../fixtures.ts";\n${spec}`,
  );
  const apiLog = path.join(dir, "api.log");
  writeFileSync(apiLog, "");
  process.env.API_LOG = apiLog;
  return {
    dir,
    lines: () => readFileSync(apiLog, "utf8").split("\n").filter(Boolean),
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

test(
  "use.fixtures attaches fixtures and option fixtures layer through config, environment, group and test.use",
  { timeout: 180000 },
  async () => {
    const { dir, lines } = project(
      `use: { fixtures: { customer: true }, orderOptions: { items: 2, note: "config" } },
  environments: { staging: { use: { orderOptions: { note: "environment", paid: false } } } },
`,
      `
test("attached without being named", async ({ page }) => { log("body1"); });
test.describe("inner", () => {
  test.use({ orderOptions: { note: "test" }, fixtures: { customer: false } });
  test("asks for the order", async ({ order }) => { log("body2 " + order.items); });
});
`,
    );
    const summary = await run(dir, 9801, { environment: "staging" });
    assert.deepEqual(
      summary.tests.map((t) => t.status),
      ["success", "success"],
    );
    assert.deepEqual(lines(), [
      // config use attaches the customer; no group: the order is not attached
      "+customer",
      "body1",
      "-customer",
      // test.use removes the customer, the test asks for the order itself: config < environment < test.use
      '+order {"items":2,"paid":false,"note":"test"}',
      "body2 2",
      "-order",
    ]);

    const grouped = project(
      `use: { fixtures: { customer: true }, orderOptions: { items: 2, note: "config" } },
  environments: { staging: { use: { orderOptions: { note: "environment", paid: false } } } },
  groups: [{ name: "checkout", use: { fixtures: { order: true }, orderOptions: { items: 3 } } }],`,
      `
test("attached by the group", async ({ page }) => { log("body"); });
`,
    );
    const result = await run(grouped.dir, 9802, {
      environment: "staging",
      group: "checkout",
    });
    assert.deepEqual(
      result.tests.map((t) => t.status),
      ["success"],
    );
    assert.deepEqual(grouped.lines(), [
      "+customer",
      '+order {"items":3,"paid":false,"note":"environment"}',
      "body",
      "-order",
      "-customer",
    ]);
  },
);

test(
  "an environment that turns a fixture off skips the tests that need it, whatever a group or test says",
  { timeout: 180000 },
  async () => {
    const config = `environments: { production: { use: { fixtures: { order: false } } }, staging: {} },
  groups: [{ name: "checkout", use: { fixtures: { order: true } } }],`;
    const spec = `
test("asks for the order", async ({ order }) => { log("ran 1"); });
test.describe("switched on", () => {
  test.use({ fixtures: { order: true } });
  test("attached again", async ({ page }) => { log("ran 2"); });
});
test("does not need it", async ({ page }) => { log("ran 3"); });
`;
    const { dir, lines } = project(config, spec);
    const summary = await run(dir, 9803, {
      environment: "production",
      group: "checkout",
    });
    assert.deepEqual(
      summary.tests.map((t) => [t.name, t.status, "reason" in t && t.reason]),
      [
        [
          "asks for the order",
          "skipped",
          "Fixture order is turned off in production",
        ],
        [
          "switched on > attached again",
          "skipped",
          "Fixture order is turned off in production",
        ],
        // the group attaches the order too, so this test is skipped as well
        [
          "does not need it",
          "skipped",
          "Fixture order is turned off in production",
        ],
      ],
    );
    assert.deepEqual(lines(), []);

    // the same project in another environment runs them all
    const staging = project(config, spec);
    const ran = await run(staging.dir, 9804, {
      environment: "staging",
      group: "checkout",
    });
    assert.deepEqual(
      ran.tests.map((t) => t.status),
      ["success", "success", "success"],
    );
    assert.equal(staging.lines().filter((l) => l.startsWith("ran")).length, 3);
  },
);

test(
  "unknown fixture names in use refuse the run and name the known ones",
  { timeout: 120000 },
  async () => {
    const { dir } = project(
      `use: { fixtures: { orderr: true } },`,
      `test("t", async () => {});`,
    );
    await assert.rejects(
      run(dir, 9805),
      /config\.use\.fixtures: unknown fixture "orderr"\. Known fixtures: order, customer/,
    );
  },
);
