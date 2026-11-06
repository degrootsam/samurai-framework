import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentEvent, PlanOptions, PlanResult } from "../agent/index.js";
import { parseCommandLine } from "./args.js";
import type { Io } from "./io.js";
import { main } from "./main.js";
import { planCommand } from "./plan.js";

const KEY = "sk-cli-test-key-123";

const result = (extra: Partial<PlanResult> = {}): PlanResult => ({
  reason: "finished",
  summary: "Planned the form",
  file: "plans/a.md",
  steps: 3,
  secrets: [],
  tokens: 210,
  ...extra,
});

function fakeAgent(events: AgentEvent[], final: PlanResult = result()) {
  const seen: {
    options?: PlanOptions;
    answers: [string, string][];
    stopped: boolean;
  } = { answers: [], stopped: false };
  const entry = {
    defaultModelSpec: async () => undefined as string | undefined,
    modelFromSpec: async (spec: string) => ({ spec }) as never,
    runPlan: (options: PlanOptions) => {
      seen.options = options;
      return {
        events: (async function* () {
          for (const event of events) yield event;
        })(),
        result: Promise.resolve(final),
        answer: (id: string, text: string) =>
          void seen.answers.push([id, text]),
        stop: () => void (seen.stopped = true),
      };
    },
  };
  return { seen, load: async () => entry as never };
}

function io(extra: Partial<Io> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const value: Io = {
    out: (t) => void out.push(t),
    err: (t) => void err.push(t),
    color: false,
    env: { ANTHROPIC_API_KEY: KEY },
    ...extra,
  };
  return { io: value, out: () => out.join(""), err: () => err.join("") };
}

const run = (
  argv: string[],
  agent: ReturnType<typeof fakeAgent>,
  extra?: Partial<Io>,
) => {
  const sink = io(extra);
  return planCommand(parseCommandLine(argv.slice(1)), sink.io, {
    loadAgent: agent.load,
  }).then((code) => ({ code, ...sink }));
};

const ARGS = [
  "plan",
  "register",
  "--out",
  "plans/a.md",
  "--model",
  "anthropic:claude-x",
];

test("usage mistakes are errors, which the command line reports with exit code 2", async () => {
  const agent = fakeAgent([]);
  for (const [argv, message] of [
    [["plan"], /Which goal\?/],
    [["plan", "x", "--model", "anthropic:x"], /Give the plan file with --out/],
    [[...ARGS, "--max-steps", "0"], /--max-steps must be a whole number/],
    [[...ARGS, "--yes-origin", "nope"], /--yes-origin: "nope" is not a URL/],
  ] as const)
    await assert.rejects(run([...argv], agent), message);
  const sink = io();
  assert.equal(await main(["plan"], sink.io), 2);
  assert.match(sink.err(), /Which goal\?/);
});

test("the options reach the run and a finished run exits 0 with the plan's path", async () => {
  const agent = fakeAgent(
    [
      { type: "plan", text: "I will look at the form." },
      { type: "plan-step", n: 1, text: 'Fill "Name" (textbox).' },
      { type: "ended", result: result() as never },
    ],
    result(),
  );
  const { code, out, err } = await run(
    [...ARGS, "--force", "--url", "http://shop.test", "--max-steps", "9"],
    agent,
  );
  assert.equal(code, 0);
  assert.deepEqual(
    {
      goal: agent.seen.options?.goal,
      out: agent.seen.options?.out,
      force: agent.seen.options?.force,
      url: agent.seen.options?.url,
      limits: agent.seen.options?.limits,
    },
    {
      goal: "register",
      out: "plans/a.md",
      force: true,
      url: "http://shop.test",
      limits: { maxSteps: 9 },
    },
  );
  assert.match(
    out(),
    /Model anthropic: the pages the agent reads are sent to that provider\./,
  );
  assert.match(out(), /I will look at the form\./);
  assert.match(out(), /\+ 1\. Fill "Name" \(textbox\)\./);
  assert.match(out(), /Done The plan in plans\/a\.md has 3 steps\.\nPlanned/);
  assert.match(out(), /generate "<goal>" --plan plans\/a\.md/);
  assert.equal(err(), "");
  assert.equal((out() + err()).includes(KEY), false);
});

test("force is left out when not given", async () => {
  const agent = fakeAgent([{ type: "ended", result: result() as never }]);
  await run(ARGS, agent);
  assert.equal("force" in (agent.seen.options ?? {}), false);
});

test("a run that ends at a limit or fails exits 1", async () => {
  const limit = result({ reason: "step-limit" });
  const a = await run(
    ARGS,
    fakeAgent([{ type: "ended", result: limit as never }], limit),
  );
  assert.equal(a.code, 1);
  assert.match(a.out(), /Stopped at the step limit/);
  const failed = result({
    reason: "error",
    error: "plans/a.md already exists",
  });
  const b = await run(
    ARGS,
    fakeAgent([{ type: "ended", result: failed as never }], failed),
  );
  assert.equal(b.code, 1);
  assert.match(b.err(), /The run failed: plans\/a\.md already exists/);
});

test("--json prints the events as lines and nothing else", async () => {
  const { out } = await run(
    [...ARGS, "--json"],
    fakeAgent([
      { type: "plan-step", n: 1, text: "x" },
      { type: "ended", result: result() as never },
    ]),
  );
  assert.deepEqual(
    out()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).type),
    ["plan-step", "ended"],
  );
});

test("a question without a terminal ends the run unless it is about a site", async () => {
  const other: AgentEvent = {
    type: "question",
    id: "q",
    question: "Which plan?",
  };
  const agent = fakeAgent([other], result({ reason: "stopped" }));
  const outcome = await run(ARGS, agent);
  assert.equal(outcome.code, 1);
  assert.equal(agent.seen.stopped, true);
  assert.match(
    outcome.err(),
    /The agent asked "Which plan\?" and nobody can answer/,
  );
});
