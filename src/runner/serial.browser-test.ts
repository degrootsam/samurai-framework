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
import { browserConfig } from "../testing/test-browser.js";
import { runTests } from "./run.js";
import { SERIAL_SKIP_REASON } from "./serial.js";

const API = JSON.stringify(path.resolve("src/api.ts"));

/**
 * `run(name, fails)` logs `name worker` to `serial.log` and fails the first `fails` times the test runs (a counter
 * file per test), so a test can fail until its n-th attempt
 */
const HEAD = `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from ${API};
const log = (line) => appendFileSync(process.env.SERIAL_LOG, line + "\\n");
const run = async (page, name, workerIndex, fails = 0) => {
  const file = path.join(process.env.SERIAL_DIR, name);
  const n = (existsSync(file) ? Number(readFileSync(file, "utf8")) : 0) + 1;
  writeFileSync(file, String(n));
  log(name + " " + workerIndex);
  await page.navigateTo("data:text/html,<h1>Hi</h1>");
  await page.waitForTimeout(Number(process.env.SERIAL_HOLD || 150));
  if (n <= fails) throw new Error(name + " failed on purpose");
};
`;

function project(files: Record<string, string>, config: object = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "samurai-serial-"));
  writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  writeFileSync(
    path.join(dir, "samurai.config.ts"),
    `export default ${JSON.stringify({ srcDir: "./specs", timeout: 30000, forbidOnly: false, ...browserConfig(), ...config })};`,
  );
  mkdirSync(path.join(dir, "specs"));
  for (const [name, source] of Object.entries(files))
    writeFileSync(path.join(dir, "specs", name), HEAD + source);
  mkdirSync(path.join(dir, "attempts"));
  writeFileSync(path.join(dir, "serial.log"), "");
  process.env.SERIAL_DIR = path.join(dir, "attempts");
  process.env.SERIAL_LOG = path.join(dir, "serial.log");
  return {
    dir,
    /** The log lines: `name worker`, `beforeAll` and `afterAll`, in the order they happened */
    lines: () =>
      readFileSync(path.join(dir, "serial.log"), "utf8")
        .split("\n")
        .filter(Boolean),
    ran: (name: string) =>
      existsSync(path.join(dir, "attempts", name))
        ? Number(readFileSync(path.join(dir, "attempts", name), "utf8"))
        : 0,
  };
}

const go = (dir: string, port: number, extra: object = {}) =>
  runTests({
    projectDir: dir,
    dataDir: path.join(dir, "data"),
    headless: true,
    port,
    reportPath: false,
    ...extra,
  });

const BLOCK = (fails: Record<string, number> = {}) => `
test.describe.serial("block", () => {
  test.beforeAll(() => log("beforeAll"));
  test.afterAll(() => log("afterAll"));
  test("first", async ({ page, workerIndex }) => run(page, "first", workerIndex, ${fails.first ?? 0}));
  test("second", async ({ page, workerIndex }) => run(page, "second", workerIndex, ${fails.second ?? 0}));
  test("third", async ({ page, workerIndex }) => run(page, "third", workerIndex, ${fails.third ?? 0}));
});
test("free", async ({ page, workerIndex }) => run(page, "free", workerIndex));
`;

const statusOf = (summary: Awaited<ReturnType<typeof go>>) =>
  Object.fromEntries(summary.tests.map((t) => [t.name, t.status]));

test(
  "a failure in a serial block skips the rest of the block, in this process",
  { timeout: 120000 },
  async () => {
    const { dir, lines, ran } = project({
      "a.spec.ts": BLOCK({ second: 99 }),
    });
    const summary = await go(dir, 9510, { workers: 1 });
    assert.deepEqual(
      summary.tests.map((t) => t.name),
      ["block > first", "block > second", "block > third", "free"],
      "the report keeps the test order",
    );
    assert.deepEqual(statusOf(summary), {
      "block > first": "success",
      "block > second": "failed",
      "block > third": "skipped",
      free: "success",
    });
    const third = summary.tests[2] as { reason?: string };
    assert.equal(third.reason, SERIAL_SKIP_REASON);
    assert.equal(summary.status, "failed");
    assert.equal(ran("third"), 0, "the skipped test never ran");
    assert.deepEqual(
      lines().filter((l) => l.startsWith("beforeAll") || l === "afterAll"),
      ["beforeAll", "afterAll"],
      "the hooks of the block run once",
    );
  },
);

test(
  "the tests of a serial block run in order on one worker, while another worker takes other tests",
  { timeout: 120000 },
  async () => {
    const { dir, lines } = project({
      "a.spec.ts": BLOCK(),
      "b.spec.ts": `
test("other one", async ({ page, workerIndex }) => run(page, "other one", workerIndex));
test("other two", async ({ page, workerIndex }) => run(page, "other two", workerIndex));
`,
    });
    const summary = await go(dir, 9514, { workers: 2 });
    assert.equal(summary.status, "success");
    const worker = (name: string) =>
      lines()
        .find((l) => l.startsWith(`${name} `))
        ?.split(" ")
        .pop();
    const block = ["first", "second", "third"].map(worker);
    assert.equal(new Set(block).size, 1, "one worker ran the whole block");
    const order = lines()
      .filter((l) => /^(first|second|third) /.test(l))
      .map((l) => l.split(" ")[0]);
    assert.deepEqual(order, ["first", "second", "third"]);
    assert.equal(lines().filter((l) => l === "beforeAll").length, 1);
  },
);

test(
  "a failure in a serial block skips the rest when the tests run on workers",
  { timeout: 120000 },
  async () => {
    const { dir, ran } = project({
      "a.spec.ts": BLOCK({ first: 99 }),
      "b.spec.ts": `test("other", async ({ page, workerIndex }) => run(page, "other", workerIndex));`,
    });
    const summary = await go(dir, 9518, { workers: 2 });
    assert.deepEqual(statusOf(summary), {
      "block > first": "failed",
      "block > second": "skipped",
      "block > third": "skipped",
      free: "success",
      other: "success",
    });
    assert.equal(ran("second"), 0);
    const skipped = summary.tests.find((t) => t.name === "block > second") as {
      reason?: string;
    };
    assert.equal(skipped.reason, SERIAL_SKIP_REASON);
  },
);

for (const workers of [1, 2]) {
  test(
    `with retries a failed serial block starts over from its first test (${workers} ${workers === 1 ? "worker" : "workers"})`,
    { timeout: 120000 },
    async () => {
      const { dir, lines, ran } = project({
        "a.spec.ts": BLOCK({ second: 1 }),
        ...(workers > 1 && {
          "b.spec.ts": `test("other", async ({ page, workerIndex }) => run(page, "other", workerIndex));`,
        }),
      });
      const summary = await go(dir, 9522 + workers * 4, {
        workers,
        retries: 1,
      });
      assert.equal(summary.status, "success");
      assert.equal(ran("first"), 2, "the passed test ran again with the block");
      assert.equal(ran("second"), 2);
      assert.equal(ran("third"), 1);
      const [first, second, third] = summary.tests as {
        retry?: number;
        flaky?: boolean;
        previousAttempts?: { message: string }[];
      }[];
      assert.equal(first?.retry, 1);
      assert.equal(second?.flaky, true);
      assert.match(
        second?.previousAttempts?.[0]?.message ?? "",
        /second failed on purpose/,
      );
      assert.equal(third?.flaky, undefined);
      assert.equal(
        lines().filter((l) => l === "beforeAll").length,
        2,
        "beforeAll runs once per attempt at the block",
      );
      assert.equal(lines().filter((l) => l === "afterAll").length, 2);
    },
  );
}

const plain = (names: string[]) =>
  names
    .map(
      (n) =>
        `test(${JSON.stringify(n)}, async ({ page, workerIndex }) => run(page, ${JSON.stringify(n)}, workerIndex));`,
    )
    .join("\n");

/** The workers that ran the tests whose names start with `prefix` */
const workersOf = (lines: string[], prefix: string) =>
  new Set(
    lines.filter((l) => l.startsWith(prefix)).map((l) => l.split(" ")[1]),
  );

test(
  "fullyParallel false keeps the tests of a file together on one worker",
  { timeout: 120000 },
  async () => {
    process.env.SERIAL_HOLD = "700";
    const { dir, lines } = project(
      {
        "a.spec.ts": plain(["a1", "a2", "a3"]),
        "b.spec.ts": plain(["b1", "b2", "b3"]),
      },
      { fullyParallel: false },
    );
    const summary = await go(dir, 9538, { workers: 2 });
    assert.equal(summary.status, "success");
    assert.equal(workersOf(lines(), "a").size, 1);
    assert.equal(workersOf(lines(), "b").size, 1);
    assert.notDeepEqual(workersOf(lines(), "a"), workersOf(lines(), "b"));
    delete process.env.SERIAL_HOLD;
  },
);

test(
  "without fullyParallel the tests of one file go to different workers, and a parallel describe frees a file of fullyParallel false",
  { timeout: 120000 },
  async () => {
    process.env.SERIAL_HOLD = "700";
    const unset = project({ "a.spec.ts": plain(["a1", "a2", "a3", "a4"]) });
    assert.equal((await go(unset.dir, 9542, { workers: 2 })).status, "success");
    assert.equal(workersOf(unset.lines(), "a").size, 2);

    const freed = project(
      {
        "a.spec.ts": `test.describe.configure({ mode: "parallel" });\n${plain(["a1", "a2", "a3", "a4"])}`,
      },
      { fullyParallel: false },
    );
    assert.equal((await go(freed.dir, 9546, { workers: 2 })).status, "success");
    assert.equal(workersOf(freed.lines(), "a").size, 2);
    delete process.env.SERIAL_HOLD;
  },
);
