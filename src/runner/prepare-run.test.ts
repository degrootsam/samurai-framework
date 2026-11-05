import { after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { prepareRun } from "./prepare-run.js";
import { test as samurai } from "./registry.js";
import { peekRunSettings, setRunSettings } from "../config/run-settings.js";
import { MASK, maskText, resetSecrets } from "../config/mask.js";

const dir = mkdtempSync(path.join(tmpdir(), "samurai-run-"));
writeFileSync(
  path.join(dir, ".env.staging"),
  "SAMURAI_SECRET_TEST_CARD=4242424242424242\n",
);
after(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => {
  setRunSettings(undefined);
  resetSecrets();
});

test("resolves settings, loads secrets for that environment and activates the run", () => {
  const run = prepareRun(
    {
      environments: {
        dev: {},
        staging: { baseURL: "https://staging.harbor.shop" },
      },
    },
    { environment: "staging" },
    {
      cwd: dir,
      env: { SAMURAI_SECRET_PIN: "12" } as unknown as NodeJS.ProcessEnv,
    },
  );
  assert.equal(run.settings.environment, "staging");
  assert.equal(peekRunSettings(), run.settings);
  assert.deepEqual(Object.fromEntries(run.secrets), {
    TEST_CARD: "4242424242424242",
    PIN: "12",
  });
  assert.equal(
    maskText("card 4242424242424242 pin 12"),
    `card ${MASK} pin ${MASK}`,
  );
});

test("a fixture name defined in two listed tests refuses the run before it starts", () => {
  const make = async ({}: any, use: (value: unknown) => Promise<void>) =>
    use(1);
  assert.throws(
    () =>
      prepareRun(
        {
          fixtures: [
            samurai.extend<any>({ shared: make }),
            samurai.extend<any>({ shared: make }),
          ],
        },
        {},
        { cwd: dir, env: {} as unknown as NodeJS.ProcessEnv },
      ),
    /fixture "shared" is defined twice \(config\.fixtures\[0\] and config\.fixtures\[1\]\)/,
  );
  assert.equal(peekRunSettings(), undefined);
});

test("an unknown environment fails before anything is activated", () => {
  assert.throws(() =>
    prepareRun(
      { environments: { dev: {} } },
      { environment: "stg" },
      { cwd: dir, env: {} as unknown as NodeJS.ProcessEnv },
    ),
  );
  assert.equal(peekRunSettings(), undefined);
});
