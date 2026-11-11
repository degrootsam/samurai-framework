import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import type { SamuraiTestConfig } from "../types/config.js";
import { setUpPageFixtures } from "./page-fixtures.js";
import { withProject } from "./project.js";

const API = JSON.stringify(path.resolve("src/api.ts"));

const FIXTURES = `
import { appendFileSync } from "node:fs";
import { test as base } from ${API};
export const log = (line) => appendFileSync(process.env.PAGE_FIXTURES_LOG, line + "\\n");
export const test = base.extend({
  session: [async ({}, use) => { log("+session"); await use("s"); log("-session"); }, { auto: true }],
  seed: async ({ session }, use) => { log("+seed " + session); await use(1); log("-seed"); },
  broken: async ({}, use) => { throw new Error("no server"); },
  other: async ({}, use) => { log("+other"); await use(2); },
});
`;

/** A project with the fixtures above and one spec, returning what the log of the fixtures held */
async function inProject(
  spec: string,
  work: (input: {
    file: string;
    lines: () => string[];
    config: SamuraiTestConfig;
  }) => Promise<void>,
) {
  const dir = mkdtempSync(path.join(tmpdir(), "samurai-page-fixtures-"));
  writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  writeFileSync(path.join(dir, "fixtures.ts"), FIXTURES);
  mkdirSync(path.join(dir, "specs"));
  const file = path.join(dir, "specs/a.spec.ts");
  writeFileSync(file, `import { test } from "../fixtures.ts";\n${spec}`);
  const log = path.join(dir, "fixtures.log");
  writeFileSync(log, "");
  process.env.PAGE_FIXTURES_LOG = log;
  const shop = (await import(path.join(dir, "fixtures.ts"))).test;
  const config: SamuraiTestConfig = { fixtures: [shop] };
  await work({
    file,
    config,
    lines: () => readFileSync(log, "utf8").split("\n").filter(Boolean),
  });
}

const open = (
  file: string,
  config: SamuraiTestConfig,
  extra: {
    requested?: string[];
    hasFixtures?: boolean;
    environment?: string;
  },
  work: (set: () => ReturnType<typeof setUpPageFixtures>) => Promise<void>,
) =>
  withProject(
    {
      projectDir: path.dirname(path.dirname(file)),
      config,
      ...(extra.environment && { environment: extra.environment }),
    },
    (run) =>
      work(() =>
        setUpPageFixtures({
          file,
          testName: "checkout",
          page: {} as Page,
          browser: {} as Browser,
          browserName: "firefox",
          run,
          projectHasFixtures: extra.hasFixtures ?? true,
          requested: extra.requested ?? [],
        }),
      ),
  );

test("sets up the auto fixtures and the ones the test asks for, and tears them down last first", async () => {
  await inProject(
    `test("checkout", async ({ page, seed }) => {});`,
    async ({ file, config, lines }) => {
      await open(file, config, { requested: ["page", "seed"] }, async (set) => {
        const fixtures = await set();
        assert.deepEqual(fixtures?.names, ["session", "seed"]);
        assert.deepEqual(lines(), ["+session", "+seed s"]);
        assert.equal(await fixtures?.teardown(), undefined);
        assert.deepEqual(lines().slice(2), ["-seed", "-session"]);
      });
    },
  );
});

test("a fixture that cannot be set up fails with its name, after the others are finished", async () => {
  await inProject(
    `test("checkout", async ({ page, broken }) => {});`,
    async ({ file, config, lines }) => {
      await open(file, config, { requested: ["broken"] }, async (set) => {
        await assert.rejects(set(), /fixture "broken" setup failed: no server/);
        assert.deepEqual(lines(), ["+session", "-session"]);
      });
    },
  );
});

test("a fixture the environment turns off fails with its name", async () => {
  await inProject(
    `test("checkout", async ({ page, other }) => {});`,
    async ({ file, config }) => {
      const stage: SamuraiTestConfig = {
        ...config,
        environments: { dev: { use: { fixtures: { other: false } } } },
      };
      await open(
        file,
        stage,
        { requested: ["other"], environment: "dev" },
        async (set) => {
          await assert.rejects(set(), /Fixture other is turned off in dev/);
        },
      );
    },
  );
});

test("a test of a project without fixtures is not imported", async () => {
  await inProject(
    `throw new Error("imported");\ntest("checkout", async ({ page }) => {});`,
    async ({ file }) => {
      await open(
        file,
        {},
        { hasFixtures: false, requested: ["page"] },
        async (set) => {
          assert.equal(await set(), undefined);
        },
      );
    },
  );
});

test("a test that asks for a fixture the file does not register is named in the error", async () => {
  await inProject(
    `test("other name", async ({ page }) => {});`,
    async ({ file, config }) => {
      await open(file, config, { requested: ["other"] }, async (set) => {
        await assert.rejects(set(), /"checkout"[^]*does not register/);
      });
    },
  );
});
