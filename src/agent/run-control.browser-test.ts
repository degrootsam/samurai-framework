import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type Page from "../browser/page.js";
import { refIn } from "../testing/scripted-model.js";
import {
  agentRunFixture,
  ended,
  endedOnce,
  OPTIONS,
  pause,
  promptsText,
} from "../testing/agent-run.js";

const fx = agentRunFixture(9605);
const { start } = fx;

test("pause stops new model calls until resume", OPTIONS, async () => {
  const run = start(
    [
      { calls: [{ name: "snapshot" }] },
      { calls: [{ name: "snapshot" }] },
      { calls: [{ name: "snapshot" }] },
      { calls: [{ name: "finish", args: { summary: "done" } }] },
    ],
    {},
    (event, session) => {
      if (
        event.type === "usage" &&
        event.totalTokens === 15 &&
        run.model.doGenerateCalls.length === 1
      )
        session().pause();
    },
  );
  await pause(1500);
  const frozen = run.model.doGenerateCalls.length;
  assert.ok(frozen <= 2, `paused after ${frozen} calls`);
  await pause(600);
  assert.equal(
    run.model.doGenerateCalls.length,
    frozen,
    "no new model call while paused",
  );
  run.session.resume();
  const result = await run.session.result;
  ended(result, "finished");
  assert.equal(run.model.doGenerateCalls.length, 4);
});

test(
  "a person's steps while the agent is taken over are kept, and the agent is told",
  OPTIONS,
  async () => {
    let page!: Page;
    let snapshot = "";
    let handedOver = false;
    const run = start(
      [
        { calls: [{ name: "snapshot" }] },
        (last) => (
          (snapshot = last),
          {
            calls: [
              {
                name: "act",
                args: {
                  kind: "click",
                  target: refIn(last, /\[(e\d+)\] button "Continue"/),
                },
              },
            ],
          }
        ),
        (last) => ({
          text: last.includes("The person used the browser")
            ? "noted"
            : "no note",
          calls: [
            {
              name: "act",
              args: {
                kind: "click",
                target: refIn(snapshot, /\[(e\d+)\] button "Continue"/),
              },
            },
          ],
        }),
        { calls: [{ name: "finish", args: { summary: "ok" } }] },
      ],
      {},
      (event, session) => {
        if (event.type === "usage" && !handedOver) {
          handedOver = true;
          const s = session();
          s.takeOver();
          void (async () => {
            await pause(1200); // the person's recorder is on
            await page.getByLabel("Email").fill("person@example.com");
            await pause(900);
            s.handBack();
          })();
        }
      },
      (p) => (page = p),
    );
    const result = await run.session.result;
    ended(result, "finished");
    const kindsOf = run.steps().map((s) => s.kind);
    assert.deepEqual(
      kindsOf,
      ["goto", "fill", "click"],
      "the person's fill, then the agent's click",
    );
    assert.match(
      readFileSync(run.file, "utf8"),
      /fill\("person@example\.com"\)/,
    );
    const text = promptsText(run.model);
    assert.match(
      text,
      /The person used the browser while you were stopped\. They added 1 step to the test/,
    );
    assert.match(text, /Your last call was not run/);
    assert.ok(run.events.some((e) => e.type === "plan" && e.text === "noted"));
    endedOnce(run.events);
  },
);
