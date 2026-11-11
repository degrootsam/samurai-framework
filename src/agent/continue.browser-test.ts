import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { refIn } from "../testing/scripted-model.js";
import {
  agentRunFixture,
  ended,
  OPTIONS,
  promptsText,
} from "../testing/agent-run.js";
import { parseSpec } from "../steps/parse.js";

const fx = agentRunFixture(9607);
const { start } = fx;

/** A project holding one test: goto, fill the email, a check, then a click on Continue */
function project(): { dir: string; file: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agent-continue-"));
  mkdirSync(path.join(dir, "tests"));
  const file = path.join(dir, "tests/existing.spec.ts");
  writeFileSync(
    file,
    `import { test, expect } from "@itmetsam/samurai-framework";

test("shop", async ({ page, secrets }) => {
  await page.goto("${fx.appOrigin()}/");
  await page.getByLabel("Email").fill("ann@example.com");
  await page.getByLabel("Password").fill(secrets.PASSWORD);
  await expect(page.getByRole("heading", { name: "Shop" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
});
`,
  );
  return { dir, file };
}

test(
  "continue mode replays the first steps, then writes new ones before the rest",
  OPTIONS,
  async () => {
    const { dir } = project();
    const run = start(
      [
        { calls: [{ name: "snapshot" }] },
        (last) => ({
          calls: [
            {
              name: "act",
              args: {
                kind: "click",
                target: refIn(last, /\[(e\d+)\] link "Next page"/),
              },
            },
          ],
        }),
        { calls: [{ name: "finish", args: { summary: "added" } }] },
      ],
      {
        projectDir: dir,
        file: "tests/existing.spec.ts",
        test: "shop",
        continueAt: 4,
      },
    );
    const result = await run.session.result;
    ended(result, "finished");
    const replays = run.events.flatMap((e) => (e.type === "replay" ? [e] : []));
    // the check (step 4) is skipped: 3 of the 4 are played
    assert.deepEqual(
      replays.map((e) => e.n),
      [1, 2, 3],
    );
    assert.equal(replays[0]!.total, 4);
    assert.match(replays[2]!.text, /secrets\.PASSWORD/);
    assert.deepEqual(
      run.steps().map((s) => s.kind),
      ["goto", "fill", "fill", "expect", "click", "click"],
    );
    const source = readFileSync(run.file, "utf8");
    assert.ok(
      source.indexOf('"Next page"') < source.lastIndexOf('name: "Continue"'),
    );
    const text = promptsText(run.model);
    assert.match(text, /replaying the first 4 steps/);
    assert.match(text, /AFTER the ones you write/);
    assert.equal(text.includes("run-s3cret-Value-77"), false);
    assert.equal(parseSpec(source)[0]!.steps.length, 6);
    // no replay step was written twice
    assert.equal(run.events.filter((e) => e.type === "step").length, 1);
  },
);

test(
  "a failing replay ends the run with an error and leaves the spec as it was",
  OPTIONS,
  async () => {
    const { dir, file } = project();
    const before = readFileSync(file, "utf8").replace("Email", "Mail");
    writeFileSync(file, before);
    const run = start([{ text: "never called" }], {
      projectDir: dir,
      file: "tests/existing.spec.ts",
      test: "shop",
      continueAt: 3,
      timeout: 3000,
    });
    const result = await run.session.result;
    ended(result, "error");
    assert.match(
      result.error ?? "",
      /^step 2 \(await page\.getByLabel\("Mail"\)\.fill/,
    );
    assert.equal(run.model.doGenerateCalls.length, 0);
    assert.equal(readFileSync(file, "utf8"), before);
    assert.equal(result.failedIn, "replay");
    assert.equal(result.replayStep, 2);
  },
);

test(
  "a custom step before the continue point fails the replay, naming its step",
  OPTIONS,
  async () => {
    const { dir, file } = project();
    const before = readFileSync(file, "utf8").replace(
      'await page.getByLabel("Email")',
      'await doThing();\n  await page.getByLabel("Email")',
    );
    writeFileSync(file, before);
    const run = start([{ text: "never called" }], {
      projectDir: dir,
      file: "tests/existing.spec.ts",
      test: "shop",
      continueAt: 3,
    });
    const result = await run.session.result;
    ended(result, "error");
    assert.equal(result.failedIn, "replay");
    assert.equal(result.replayStep, 2);
    assert.equal(readFileSync(file, "utf8"), before);
  },
);

test(
  "a failure after the replay does not carry failedIn",
  OPTIONS,
  async () => {
    const { dir } = project();
    const run = start(
      [
        () => {
          throw new Error("model down");
        },
      ],
      {
        projectDir: dir,
        file: "tests/existing.spec.ts",
        test: "shop",
        continueAt: 2,
      },
    );
    const result = await run.session.result;
    ended(result, "error");
    assert.match(result.error ?? "", /model down/);
    assert.equal("failedIn" in result, false);
    assert.equal("replayStep" in result, false);
  },
);
