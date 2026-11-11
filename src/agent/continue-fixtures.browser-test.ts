import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { agentRunFixture, ended, OPTIONS } from "../testing/agent-run.js";
import { browserConfig } from "../testing/test-browser.js";

const fx = agentRunFixture(9608);
const { start } = fx;
const API = JSON.stringify(path.resolve("src/api.ts"));

/** Fixtures that log what they do: `session` is set up for every test, `seed` and `broken` when a test asks */
const FIXTURES = `
import { appendFileSync } from "node:fs";
import { test as base } from ${API};
const log = (line) => appendFileSync(process.env.CONTINUE_FIXTURES_LOG, line + "\\n");
export const test = base.extend({
  session: [async ({ page }, use) => {
    log("+session at " + (await page.url()));
    await use("ada");
    log("-session");
  }, { auto: true }],
  seed: async ({ session }, use) => { log("+seed " + session); await use(1); log("-seed"); },
  broken: async ({}, use) => { throw new Error("no server"); },
});
`;

/** A project whose one test asks for the fixtures in `asks` */
async function project(asks: string) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agent-continue-fixtures-"));
  writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  writeFileSync(path.join(dir, "fixtures.ts"), FIXTURES);
  mkdirSync(path.join(dir, "tests"));
  const file = path.join(dir, "tests/existing.spec.ts");
  writeFileSync(
    file,
    `import { test } from "../fixtures.ts";

test("shop", async ({ page, ${asks} }) => {
  await page.goto("${fx.appOrigin()}/");
  await page.getByLabel("Email").fill("ann@example.com");
  await page.getByRole("button", { name: "Continue" }).click();
});
`,
  );
  const log = path.join(dir, "fixtures.log");
  writeFileSync(log, "");
  process.env.CONTINUE_FIXTURES_LOG = log;
  const shop = (await import(path.join(dir, "fixtures.ts"))).test;
  return {
    dir,
    file,
    config: { ...browserConfig(), fixtures: [shop] },
    lines: () => readFileSync(log, "utf8").split("\n").filter(Boolean),
  };
}

test(
  "continue mode sets up the test's fixtures before the replay and tears them down when the run ends",
  OPTIONS,
  async () => {
    const { dir, config, lines } = await project("seed");
    const run = start(
      [{ calls: [{ name: "finish", args: { summary: "ok" } }] }],
      {
        projectDir: dir,
        file: "tests/existing.spec.ts",
        test: "shop",
        continueAt: 2,
        config,
      },
    );
    const result = await run.session.result;
    ended(result, "finished");
    assert.deepEqual(
      run.events.flatMap((e) => (e.type === "replay" ? [e.n] : [])),
      [1, 2],
    );
    // set up on the blank page, before the replay went anywhere; finished last first
    assert.deepEqual(lines(), [
      "+session at about:blank",
      "+seed ada",
      "-seed",
      "-session",
    ]);
  },
);

test(
  "a fixture that cannot be set up ends the run in the replay, naming it, with the spec untouched",
  OPTIONS,
  async () => {
    const { dir, file, config, lines } = await project("broken");
    const before = readFileSync(file, "utf8");
    const run = start([{ text: "never called" }], {
      projectDir: dir,
      file: "tests/existing.spec.ts",
      test: "shop",
      continueAt: 2,
      config,
    });
    const result = await run.session.result;
    ended(result, "error");
    assert.match(
      result.error ?? "",
      /fixture "broken" setup failed: no server/,
    );
    assert.equal(result.failedIn, "replay");
    assert.equal("replayStep" in result, false);
    assert.equal(run.model.doGenerateCalls.length, 0);
    assert.equal(readFileSync(file, "utf8"), before);
    assert.deepEqual(lines(), ["+session at about:blank", "-session"]);
  },
);

test(
  "a run that does not continue a test sets up no fixtures",
  OPTIONS,
  async () => {
    const { dir, config, lines } = await project("seed");
    const run = start(
      [{ calls: [{ name: "finish", args: { summary: "ok" } }] }],
      {
        projectDir: dir,
        file: "tests/existing.spec.ts",
        test: "shop",
        config,
      },
    );
    ended(await run.session.result, "finished");
    assert.deepEqual(lines(), []);
  },
);
