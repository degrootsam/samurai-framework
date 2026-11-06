import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { refIn } from "../testing/scripted-model.js";
import {
  agentRunFixture,
  ended,
  OPTIONS,
  promptsText,
  SECRET,
} from "../testing/agent-run.js";

const fx = agentRunFixture(9606);
const { start } = fx;

test(
  "a page that tells the agent to misbehave changes nothing: the guards hold",
  OPTIONS,
  async () => {
    const run = start(
      [
        { calls: [{ name: "snapshot" }] },
        (last) => ({
          text: last.includes("Ignore previous instructions")
            ? "I will follow the page"
            : "",
          calls: [
            { name: "navigate", args: { url: `${fx.otherOrigin()}/evil` } },
            { name: "useSecret", args: { name: "ADMIN_PASSWORD" } },
            { name: "useSecret", args: { name: "PASSWORD" } },
          ],
        }),
        { calls: [{ name: "finish", args: { summary: "done" } }] },
      ],
      {},
      (event, session) => {
        if (event.type === "question")
          setTimeout(() => session().answer(event.id, "deny"), 20);
      },
    );
    const result = await run.session.result;
    ended(result, "finished");
    const questions = run.events.filter((e) => e.type === "question");
    assert.equal(
      questions.length,
      1,
      "the other site was asked about, not opened",
    );
    const text = promptsText(run.model);
    assert.match(text, /is not allowed; the person declined/);
    assert.match(
      text,
      /ADMIN_PASSWORD is not available to the agent; available: PASSWORD/,
    );
    assert.match(text, /no field has focus/);
    assert.deepEqual(
      run.steps().map((s) => s.kind),
      ["goto"],
    );
    const everything =
      text + JSON.stringify(run.events) + readFileSync(run.file, "utf8");
    assert.equal(everything.includes(SECRET), false);
    assert.deepEqual(result.secrets, []);
  },
);

test(
  "a link or a redirect to another site is undone and reported",
  OPTIONS,
  async () => {
    let snapshot = "";
    const run = start([
      { calls: [{ name: "snapshot" }] },
      (last) => (
        (snapshot = last),
        {
          calls: [
            {
              name: "act",
              args: {
                kind: "click",
                target: refIn(last, /\[(e\d+)\] link "Elsewhere"/),
              },
            },
          ],
        }
      ),
      { calls: [{ name: "snapshot" }] },
      { calls: [{ name: "navigate", args: { url: "/redirect" } }] },
      { calls: [{ name: "snapshot" }] },
      { calls: [{ name: "finish", args: { summary: "stayed" } }] },
    ]);
    const result = await run.session.result;
    ended(result, "finished");
    assert.ok(snapshot.length > 0);
    assert.deepEqual(
      run.steps().map((s) => s.kind),
      ["goto"],
      "neither move was written",
    );
    const text = promptsText(run.model);
    assert.match(
      text,
      /act\(\): the page moved to http:\/\/127\.0\.0\.1:\d+, which is not an allowed site; it went back to/,
    );
    assert.match(
      text,
      /navigate\(\): the page moved to http:\/\/127\.0\.0\.1:\d+, which is not an allowed site/,
    );
    assert.equal(
      text.includes(`url: ${fx.appOrigin()}/\\ntitle: Shop`),
      true,
      "the page is back on the shop",
    );
  },
);

test("useSecret ends up in the result by name only", OPTIONS, async () => {
  const run = start([
    { calls: [{ name: "snapshot" }] },
    (last) => ({
      calls: [
        {
          name: "act",
          args: {
            kind: "click",
            target: refIn(last, /\[(e\d+)\] textbox "Password"/),
          },
        },
      ],
    }),
    { calls: [{ name: "useSecret", args: { name: "PASSWORD" } }] },
    { calls: [{ name: "finish", args: { summary: "signed in" } }] },
  ]);
  const result = await run.session.result;
  ended(result, "finished");
  assert.deepEqual(result.secrets, ["PASSWORD"]);
  assert.deepEqual(
    run.steps().map((s) => s.kind),
    ["goto", "click", "fill"],
  );
  const everything =
    promptsText(run.model) +
    JSON.stringify(run.events) +
    JSON.stringify(result) +
    readFileSync(run.file, "utf8");
  assert.equal(everything.includes(SECRET), false);
});
