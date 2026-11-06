import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { agentToolsFixture, OPTIONS, text } from "../../testing/agent-tools.js";
import { Snapshotter } from "../snapshot.js";
import type { ToolContext } from "../tools/context.js";
import { OriginPolicy } from "../tools/origins.js";
import { createPlan, parsePlan } from "./plan-file.js";
import { PlanRecorder } from "./recorder.js";
import { createPlanTools } from "./tools.js";

const fx = agentToolsFixture(9612);
const dir = mkdtempSync(path.join(os.tmpdir(), "plan-tools-"));
let counter = 0;

async function setup(answers: string[] = []) {
  const page = fx.page();
  await page.navigateTo("about:blank", "complete");
  const out = path.join(dir, `plan-${++counter}.md`);
  const steps: [number, string][] = [];
  const questions: string[] = [];
  const plan = new PlanRecorder(
    createPlan({ goal: "Sign in", start: "", out }),
    (n, t) => steps.push([n, t]),
  );
  const context: ToolContext = {
    page,
    snapshots: new Snapshotter(page, { secretFields: [] }),
    steps: plan,
    origins: new OriginPolicy([fx.appOrigin()]),
    secrets: { allowed: [], get: () => undefined },
    vision: false,
    actionTimeout: 1500,
    ask: async (question) => {
      questions.push(question);
      return answers.shift() ?? "deny";
    },
    finish: () => undefined,
    emit: () => undefined,
    secretOnScreen: false,
  };
  const tools = new Map(
    createPlanTools(context, plan).map((tool) => [tool.name, tool]),
  );
  const call = (name: string, args: unknown = {}) => tools.get(name)!.run(args);
  const file = () => parsePlan(readFileSync(out, "utf8"));
  return { call, tools, plan, file, steps, questions, out };
}

test(
  "the planner has its own tools: no expect, no undo, no screenshot, no useSecret",
  OPTIONS,
  async () => {
    const run = await setup();
    assert.deepEqual(
      [...run.tools.keys()],
      [
        "snapshot",
        "navigate",
        "act",
        "step",
        "seen",
        "notDone",
        "question",
        "finish",
      ],
    );
    assert.match(
      run.tools.get("act")!.description,
      /writes nothing|Nothing is written/,
    );
  },
);

test(
  "step is refused until act or navigate worked, then it writes the plan",
  OPTIONS,
  async () => {
    const run = await setup();
    const early = await run.call("step", { text: "Open it." });
    assert.equal(early.ok, false);
    assert.equal(
      text(early),
      "step(): nothing was done since the last step; act first",
    );

    assert.equal(
      (await run.call("navigate", { url: fx.appOrigin() + "/" })).ok,
      true,
    );
    const first = await run.call("step", {
      text: "Open the shop.",
      expect: "the Sign in heading shows",
    });
    assert.equal(first.ok, true, text(first));
    assert.equal((await run.call("step", { text: "again" })).ok, false);

    const snap = text(await run.call("snapshot"));
    const email = /\[(e\d+)\] textbox "Email"/.exec(snap)![1]!;
    assert.equal(
      (
        await run.call("act", {
          kind: "fill",
          target: email,
          value: "ann@example.com",
        })
      ).ok,
      true,
    );
    assert.equal(
      (
        await run.call("step", {
          text: 'Fill "Email" (textbox) with `ann@example.com`.',
        })
      ).ok,
      true,
    );

    assert.deepEqual(
      run.steps.map(([n]) => n),
      [1, 2],
    );
    assert.deepEqual(run.file().steps, [
      { text: "Open the shop.", expect: "the Sign in heading shows" },
      { text: 'Fill "Email" (textbox) with `ann@example.com`.' },
    ]);
  },
);

test("a failed act does not count as something done", OPTIONS, async () => {
  const run = await setup();
  await run.call("navigate", { url: fx.appOrigin() + "/" });
  await run.call("step", { text: "Open." });
  const failed = await run.call("act", { kind: "click", target: "e999" });
  assert.equal(failed.ok, false);
  assert.equal((await run.call("step", { text: "Click it." })).ok, false);
});

test(
  "seen and notDone go under their headings; question asks and is kept",
  OPTIONS,
  async () => {
    const run = await setup(["Pro"]);
    assert.equal(
      (await run.call("seen", { text: "Heading Sign in" })).ok,
      true,
    );
    assert.equal(
      (await run.call("notDone", { text: "Continue was not clicked" })).ok,
      true,
    );
    const answer = await run.call("question", {
      question: "Which plan?",
      options: ["Free", "Pro"],
    });
    assert.equal(text(answer), "The person answered: Pro");
    assert.deepEqual(run.questions, ["Which plan?"]);
    const parsed = run.file();
    assert.deepEqual(parsed.seen, ["Heading Sign in"]);
    assert.deepEqual(parsed.notDone, ["Continue was not clicked"]);
    assert.deepEqual(parsed.questions, ["Which plan?"]);
  },
);

test(
  "what the guard blocked is told to the agent with the next answer, once",
  OPTIONS,
  async () => {
    const run = await setup();
    await run.call("navigate", { url: fx.appOrigin() + "/" });
    run.plan.block("POST /api/feedback");
    const next = await run.call("snapshot");
    assert.equal(next.ok, true);
    assert.match(
      text(next),
      /blocked: the planner does not submit \(POST \/api\/feedback\)/,
    );
    assert.doesNotMatch(text(await run.call("snapshot")), /blocked:/);
  },
);

test("invalid arguments get a sentence", OPTIONS, async () => {
  const run = await setup();
  const result = await run.call("step", { text: "" });
  assert.equal(result.ok, false);
  assert.match(text(result), /^step\(\): invalid arguments/);
});
