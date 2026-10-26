import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { browserConfig } from "../testing/test-browser.js";
import type { TestResult } from "../types/test.js";
import { runTests } from "./run.js";

const API = path.resolve("src/api.ts");

/** A project with one spec file of `tests` (bodies of `test()` calls), and a config of its own */
function project(tests: string, config: object = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "samurai-io-"));
  writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  writeFileSync(
    path.join(dir, "samurai.config.ts"),
    `export default ${JSON.stringify({
      srcDir: "./specs",
      timeout: 30000,
      expect: { timeout: 1000 },
      ...browserConfig(),
      ...config,
    })};`,
  );
  mkdirSync(path.join(dir, "specs"));
  writeFileSync(
    path.join(dir, "specs", "io.spec.ts"),
    `import { test, expect } from ${JSON.stringify(API)};
const go = (page, html) => page.navigateTo("data:text/html," + encodeURIComponent(html));
const ORDER = "<p id='o'></p><script>setTimeout(() => { document.getElementById('o').textContent = 'Order #12345 placed'; }, 300);</script>";
${tests}`,
  );
  return dir;
}

type Entry = TestResult & {
  message?: string;
  type?: string;
  duration?: number;
  inputs?: Record<string, string>;
  outputs?: Record<string, string>;
};

const byName = (tests: TestResult[], name: string) =>
  tests.find((t) => t.name === name) as Entry;

test(
  "outputs.save and inputs in one run in this process",
  { timeout: 120000 },
  async () => {
    const dir = project(`
test("text", { outputs: ["o"] }, async ({ page, outputs }) => {
  await go(page, "<p id='o'>Hello</p>");
  await outputs.save("o", page.locator("p[@id='o']"));
});
test("group", { outputs: ["o"] }, async ({ page, outputs }) => {
  await go(page, ORDER);
  await outputs.save("o", page.locator("p[@id='o']"), /Order #(\\d+)/);
});
test("whole", { outputs: ["o"] }, async ({ page, outputs }) => {
  await go(page, ORDER);
  await outputs.save("o", page.locator("p[@id='o']"), /Order #\\d+/);
});
test("missing", { outputs: ["o"] }, async ({ page, outputs }) => {
  await go(page, "<p>none</p>");
  await outputs.save("o", page.locator("div[@id='gone']"));
});
test("no match", { outputs: ["o"] }, async ({ page, outputs }) => {
  await go(page, "<p id='o'>Hello</p>");
  await outputs.save("o", page.locator("p[@id='o']"), /Order #(\\d+)/);
});
test("inputs", { inputs: { a: "default", b: "kept" } }, async ({ inputs }) => {
  if (inputs.a !== "x") throw new Error("a is " + inputs.a);
});
test("never saved", { outputs: ["o"] }, async () => {});
test("throws first", { outputs: ["o"] }, async () => {
  throw new Error("own failure");
});
test("plain", async () => {});
`);
    const summary = await runTests({
      projectDir: dir,
      dataDir: path.join(dir, "data"),
      headless: true,
      port: 9281,
      workers: 1,
      inputs: { a: "x", z: "unused" },
    });
    const get = (name: string) => byName(summary.tests, name);

    assert.equal(get("text").status, "success");
    assert.deepEqual(get("text").outputs, { o: "Hello" });
    assert.deepEqual(get("group").outputs, { o: "12345" });
    assert.deepEqual(get("whole").outputs, { o: "Order #12345" });

    for (const name of ["missing", "no match"]) {
      const entry = get(name);
      assert.equal(entry.status, "failed", name);
      assert.equal(entry.type, "assertion", name);
      assert.match(entry.message ?? "", /^outputs\.save\("o"\)/, name);
      assert.deepEqual(entry.outputs, {}, name);
    }
    assert.ok(
      (get("missing").duration ?? 0) >= 900,
      "a missing element fails at the expect timeout",
    );

    assert.equal(get("inputs").status, "success");
    assert.deepEqual(get("inputs").inputs, { a: "x", b: "kept" });

    assert.equal(get("never saved").status, "failed");
    assert.equal(get("never saved").message, 'output "o" was never saved');
    assert.equal(get("never saved").type, "assertion");

    assert.equal(get("throws first").status, "failed");
    assert.equal(get("throws first").message, "own failure");

    const plain = get("plain");
    assert.equal(plain.status, "success");
    assert.ok(!("inputs" in plain) && !("outputs" in plain));
  },
);

test("fill and the text checks save outputs", { timeout: 120000 }, async () => {
  const dir = project(`
const FORM = "<input id='i' value='old'><a id='l' href='/x/7'>Link</a>" + ORDER;
test("all", { outputs: ["f", "t", "c", "v", "a", "g"] }, async ({ page }) => {
  await go(page, FORM);
  await page.locator("input[@id='i']").fill("typed", { output: "f" });
  await expect(page.locator("p[@id='o']")).toHaveText(/Order #(\\d+)/g, { output: "t" });
  await expect(page.locator("p[@id='o']")).toContainText("Order", { output: "c" });
  await expect(page.locator("input[@id='i']")).toHaveValue("typed", { output: "v" });
  await expect(page.locator("a[@id='l']")).toHaveAttribute("href", /x\\/(\\d+)/, { output: "a" });
  await expect(page.locator("a[@id='l']")).toHaveText("Link", { output: "g" });
});
test("not saved", { outputs: ["f"] }, async ({ page }) => {
  await go(page, FORM);
  await expect(page.locator("a[@id='l']")).toHaveText("Nope", { output: "f" });
});
test("undeclared", async ({ page }) => {
  await go(page, FORM);
  await expect(page.locator("a[@id='l']")).toHaveText("Link", { output: "f" });
});
`);
  const summary = await runTests({
    projectDir: dir,
    dataDir: path.join(dir, "data"),
    headless: true,
    port: 9287,
    workers: 1,
  });
  const get = (name: string) => byName(summary.tests, name);
  assert.equal(get("all").status, "success", get("all").message);
  assert.deepEqual(get("all").outputs, {
    f: "typed",
    t: "12345",
    c: "Order #12345 placed",
    v: "typed",
    a: "7",
    g: "Link",
  });
  assert.equal(get("not saved").status, "failed");
  assert.deepEqual(get("not saved").outputs, {});
  assert.equal(get("undeclared").status, "failed");
  assert.match(
    get("undeclared").message ?? "",
    /toHaveText: output "f" is not declared/,
  );
});

test(
  "runTests inputs reach the tests on a pool of workers",
  { timeout: 120000 },
  async () => {
    const dir = project(`
for (const name of ["one", "two"])
  test(name, { inputs: { a: "default" } }, async ({ inputs, workerIndex }) => {
    if (inputs.a !== "x") throw new Error("a is " + inputs.a + " in worker " + workerIndex);
  });
`);
    const summary = await runTests({
      projectDir: dir,
      dataDir: path.join(dir, "data"),
      headless: true,
      port: 9283,
      workers: 2,
      inputs: { a: "x" },
    });
    for (const name of ["one", "two"]) {
      const entry = byName(summary.tests, name);
      assert.equal(entry.status, "success", entry.message);
      assert.deepEqual(entry.inputs, { a: "x" });
      assert.equal(typeof entry.worker, "number", "ran in a worker");
    }
  },
);

test(
  "a test that times out while saving leaves the next test's outputs alone",
  { timeout: 120000 },
  async () => {
    const dir = project(
      `
test("slow", { outputs: ["o"] }, async ({ page, outputs }) => {
  await go(page, "<p id='o'>late</p>");
  await outputs.save("o", page.locator("div[@id='late']"));
});
test("next", { outputs: ["o"] }, async ({ page, outputs }) => {
  await go(page, "<p id='o'>two</p>");
  await outputs.save("o", page.locator("p[@id='o']"));
  await page.waitForTimeout(500);
});
`,
      { timeout: 5000, expect: { timeout: 20000 } },
    );
    const summary = await runTests({
      projectDir: dir,
      dataDir: path.join(dir, "data"),
      headless: true,
      port: 9285,
      workers: 1,
    });
    const slow = byName(summary.tests, "slow");
    assert.equal(slow.status, "failed");
    assert.equal(slow.type, "timeout");
    const next = byName(summary.tests, "next");
    assert.equal(next.status, "success", next.message);
    assert.deepEqual(next.outputs, { o: "two" });
  },
);
