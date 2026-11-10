import { test } from "node:test";
import assert from "node:assert/strict";
import { refIn } from "../testing/scripted-model.js";
import {
  agentRunFixture,
  ended,
  endedOnce,
  kinds,
  OPTIONS,
  promptsText,
} from "../testing/agent-run.js";

const fx = agentRunFixture(9603);
const { start } = fx;

test(
  "a scripted run reaches finish, writes valid steps and reports usage",
  OPTIONS,
  async () => {
    let snapshot = "";
    const run = start([
      {
        text: "I will fill in the email and check the heading.",
        calls: [{ name: "snapshot" }],
      },
      (last) => (
        (snapshot = last),
        {
          calls: [
            {
              name: "act",
              args: {
                kind: "fill",
                target: refIn(last, /\[(e\d+)\] textbox "Email"/),
                value: "ann@example.com",
              },
            },
          ],
        }
      ),
      () => ({
        calls: [
          {
            name: "expect",
            args: {
              target: refIn(snapshot, /\[(e\d+)\] heading "Shop"/),
              matcher: "toBeVisible",
            },
          },
        ],
      }),
      {
        calls: [{ name: "finish", args: { summary: "Filled the form" } }],
        usage: [20, 7],
      },
    ]);
    const result = await run.session.result;
    ended(result, "finished");
    assert.equal(result.summary, "Filled the form");
    assert.equal(result.test, "fills the form");
    assert.deepEqual(
      run.steps().map((s) => s.kind),
      ["goto", "fill", "expect"],
    );
    assert.equal(result.steps, 3);
    assert.equal(result.tokens, 15 * 3 + 27);
    assert.equal(run.events.filter((e) => e.type === "usage").length, 4);
    assert.equal(run.events.find((e) => e.type === "plan")?.type, "plan");
    assert.ok(kinds(run.events).includes("tool-call"));
    assert.ok(run.events.filter((e) => e.type === "step").length === 3);
    endedOnce(run.events);
    const streamed: string[] = [];
    for await (const event of run.session.events) streamed.push(event.type);
    assert.deepEqual(streamed, kinds(run.events));
  },
);

test("ask waits for the answer and the model gets it", OPTIONS, async () => {
  const run = start(
    [
      {
        calls: [
          {
            name: "ask",
            args: { question: "Which email?", options: ["a@x.nl", "b@x.nl"] },
          },
        ],
      },
      (last) => ({ calls: [{ name: "finish", args: { summary: last } }] }),
    ],
    {},
    (event, session) => {
      if (event.type === "question")
        setTimeout(() => session().answer(event.id, "b@x.nl"), 100);
    },
  );
  const result = await run.session.result;
  ended(result, "finished");
  assert.equal(result.summary, "The person answered: b@x.nl");
  const question = run.events.find((e) => e.type === "question");
  assert.deepEqual(
    question && question.type === "question" && question.options,
    ["a@x.nl", "b@x.nl"],
  );
});

test(
  "the step, token and time limits each end the run cleanly with a valid spec",
  OPTIONS,
  async () => {
    const stepLimit = start([{ calls: [{ name: "snapshot" }] }], {
      limits: { maxSteps: 3 },
    });
    const a = await stepLimit.session.result;
    ended(a, "step-limit");
    assert.equal(stepLimit.model.doGenerateCalls.length, 3);
    assert.deepEqual(
      stepLimit.steps().map((s) => s.kind),
      ["goto"],
    );
    endedOnce(stepLimit.events);

    const tokenLimit = start(
      [{ calls: [{ name: "snapshot" }], usage: [100, 100] }],
      {
        limits: { maxTokens: 250 },
      },
    );
    const b = await tokenLimit.session.result;
    ended(b, "token-limit");
    assert.equal(tokenLimit.model.doGenerateCalls.length, 2);
    assert.equal(b.tokens, 400);
    endedOnce(tokenLimit.events);

    const timeLimit = start(
      [{ calls: [{ name: "snapshot" }] }, { hang: true }],
      {
        limits: { timeoutMs: 3000 },
      },
    );
    const c = await timeLimit.session.result;
    ended(c, "time-limit");
    assert.equal(timeLimit.steps().length, 1);
    endedOnce(timeLimit.events);
  },
);

test(
  "stop ends a run that is waiting on the model, and the spec stays usable",
  OPTIONS,
  async () => {
    const run = start([{ calls: [{ name: "snapshot" }] }, { hang: true }]);
    // Stop once the first tool call has run, not after a fixed time: a slow machine needs longer to open the browser
    const watch = setInterval(() => {
      if (!run.events.some((e) => e.type === "tool-call")) return;
      clearInterval(watch);
      setTimeout(() => run.session.stop(), 200);
    }, 20);
    const result = await run.session.result;
    clearInterval(watch);
    ended(result, "stopped");
    assert.deepEqual(
      run.steps().map((s) => s.kind),
      ["goto"],
    );
    endedOnce(run.events);
  },
);

test(
  "an open question does not use up the time limit, and stop answers it",
  OPTIONS,
  async () => {
    const run = start(
      [{ calls: [{ name: "ask", args: { question: "Ready?" } }] }],
      {
        limits: { timeoutMs: 3000 },
      },
    );
    // the question is open longer than the whole limit, and the run is still alive
    setTimeout(() => run.session.stop(), 6000);
    const result = await run.session.result;
    ended(result, "stopped");
  },
);

test(
  "a wrong reference or wrong arguments are answered in a sentence and the run recovers",
  OPTIONS,
  async () => {
    const run = start([
      { calls: [{ name: "snapshot" }] },
      { calls: [{ name: "act", args: { kind: "click", target: "e9999" } }] },
      { calls: [{ name: "act", args: { kind: "wave", target: "e1" } }] },
      { calls: [{ name: "snapshot" }] },
      (last) => ({
        calls: [
          {
            name: "act",
            args: {
              kind: "click",
              target: refIn(last, /\[(e\d+)\] button "Continue"/),
            },
          },
        ],
      }),
      { calls: [{ name: "finish", args: { summary: "recovered" } }] },
    ]);
    const result = await run.session.result;
    ended(result, "finished");
    assert.deepEqual(
      run.steps().map((s) => s.kind),
      ["goto", "click"],
    );
    const text = promptsText(run.model);
    assert.match(text, /e9999 does not exist/);
    assert.match(text, /act\(\): invalid arguments \(kind: /);
    for (const raw of [
      "ZodError",
      "AI_InvalidToolInputError",
      "AI_TypeValidationError",
      '\\"issues\\"',
    ])
      assert.equal(text.includes(raw), false, `the model never sees ${raw}`);
  },
);
