import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentEvent, AgentOptions, AgentResult } from "../agent/index.js";
import { parseCommandLine } from "./args.js";
import { generateCommand } from "./generate.js";
import type { Io } from "./io.js";
import { main } from "./main.js";

const KEY = "sk-cli-test-key-123";

const result = (extra: Partial<AgentResult> = {}): AgentResult => ({
  reason: "finished",
  summary: "Signed in",
  file: "tests/a.spec.ts",
  test: "signs in",
  steps: 2,
  secrets: [],
  tokens: 321,
  ...extra,
});

/** A fake agent entry: the model is a stub, the session plays `events` and records what it was asked */
function fakeAgent(events: AgentEvent[], final: AgentResult = result()) {
  const seen: {
    options?: AgentOptions;
    answers: [string, string][];
    stopped: boolean;
  } = {
    answers: [],
    stopped: false,
  };
  const entry = {
    defaultModelSpec: async () => undefined as string | undefined,
    modelFromSpec: async (spec: string) => ({ spec }) as never,
    readPlan: (file: string) => {
      if (file === "missing.md")
        throw new Error("readPlan(): missing.md cannot be read");
      if (file === "big.md")
        throw new Error("readPlan(): big.md is 40 KB, over the 32 KB limit");
      if (file === "nosteps.md")
        throw new Error(
          'readPlan(): nosteps.md: the plan has no "## Steps" heading',
        );
      return `PLAN TEXT of ${file}`;
    },
    runAgent: (options: AgentOptions) => {
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
  return generateCommand(parseCommandLine(argv.slice(1)), sink.io, {
    loadAgent: agent.load,
  }).then((code) => ({
    code,
    ...sink,
  }));
};

const ARGS = [
  "generate",
  "sign in",
  "--file",
  "tests/a.spec.ts",
  "--model",
  "anthropic:claude-x",
];

test("usage mistakes are errors, which the command line reports with exit code 2", async () => {
  const agent = fakeAgent([]);
  for (const [argv, message] of [
    [["generate"], /Which goal\?/],
    [["generate", "x"], /exactly one --file/],
    [["generate", "x", "--file", "a", "--file", "b"], /exactly one --file/],
    [[...ARGS, "--max-steps", "0"], /--max-steps must be a whole number/],
    [
      [...ARGS, "--yes-origin", "not a url"],
      /--yes-origin: "not a url" is not a URL/,
    ],
    [
      [...ARGS, "--browser", "firefox", "--browser", "chrome"],
      /uses one browser/,
    ],
  ] as const)
    await assert.rejects(run([...argv], agent), message);
  const sink = io();
  assert.equal(await main(["generate"], sink.io), 2);
  assert.match(sink.err(), /Which goal\?/);
});

test("without any model the error says the three places to set one", async () => {
  const agent = fakeAgent([]);
  await assert.rejects(
    run(["generate", "x", "--file", "a.spec.ts"], agent),
    /pass --model provider:name.*SAMURAI_AI_MODEL.*ai\.model/,
  );
});

test("the options reach the run, and a finished run exits 0 with a summary", async () => {
  const agent = fakeAgent(
    [
      { type: "plan", text: "I will sign in." },
      { type: "tool-call", tool: "navigate", args: { url: "/login" } },
      {
        type: "step",
        event: {
          op: "insert",
          index: 0,
          step: { kind: "goto", url: "/login" },
        },
        code: 'await page.goto("/login");',
        source: "",
      },
      { type: "ended", result: result({ secrets: ["PASSWORD"] }) },
    ],
    result({ secrets: ["PASSWORD"] }),
  );
  const { code, out, err } = await run(
    [
      ...ARGS,
      "--new",
      "signs in",
      "--url",
      "http://shop.test",
      "--max-steps",
      "7",
      "--yes-origin",
      "https://cdn.shop.test/x",
      "--secret",
      "PASSWORD",
      "--secret-field",
      "#key",
      "--test",
      "2",
    ],
    agent,
  );
  assert.equal(code, 0);
  assert.deepEqual(
    {
      goal: agent.seen.options?.goal,
      file: agent.seen.options?.file,
      create: agent.seen.options?.create,
      test: agent.seen.options?.test,
      url: agent.seen.options?.url,
      origins: agent.seen.options?.allowedOrigins,
      steps: agent.seen.options?.limits,
      secrets: agent.seen.options?.secrets,
      fields: agent.seen.options?.secretFields,
    },
    {
      goal: "sign in",
      file: "tests/a.spec.ts",
      create: "signs in",
      test: 2,
      url: "http://shop.test",
      origins: ["https://cdn.shop.test"],
      steps: { maxSteps: 7 },
      secrets: ["PASSWORD"],
      fields: ["#key"],
    },
  );
  assert.match(
    out(),
    /Model anthropic: the pages the agent reads are sent to that provider\./,
  );
  assert.match(out(), /I will sign in\./);
  assert.match(out(), /· navigate \{"url":"\/login"\}/);
  assert.match(out(), /\+ await page\.goto\("\/login"\);/);
  assert.match(
    out(),
    /Done "signs in" has 2 steps in tests\/a\.spec\.ts\.\nSigned in/,
  );
  assert.match(out(), /Set SAMURAI_SECRET_PASSWORD/);
  assert.equal(err(), "");
  assert.equal(
    (out() + err()).includes(KEY),
    false,
    "the key is never printed",
  );
});

test("a run that ends at a limit, is stopped or fails exits 1", async () => {
  for (const [reason, text] of [
    ["step-limit", /Stopped at the step limit/],
    ["token-limit", /token limit/],
    ["time-limit", /time limit/],
    ["stopped", /Stopped\./],
  ] as const) {
    const final = result({ reason });
    const { code, out } = await run(
      ARGS,
      fakeAgent([{ type: "ended", result: final }], final),
    );
    assert.equal(code, 1);
    assert.match(out(), text);
  }
  const failed = result({
    reason: "error",
    error: "the browser did not start",
  });
  const { code, err } = await run(
    ARGS,
    fakeAgent([{ type: "ended", result: failed }], failed),
  );
  assert.equal(code, 1);
  assert.match(err(), /The run failed: the browser did not start/);
});

test("--json prints the events as lines and nothing else", async () => {
  const ended: AgentEvent = { type: "ended", result: result() };
  const { out } = await run(
    [...ARGS, "--json"],
    fakeAgent([{ type: "plan", text: "go" }, ended]),
  );
  const lines = out().trim().split("\n");
  assert.deepEqual(
    lines.map((line) => JSON.parse(line).type),
    ["plan", "ended"],
  );
});

test("without a terminal an unknown site is refused and any other question ends the run", async () => {
  const origin: AgentEvent = {
    type: "question",
    id: "q1",
    question: "Allow https://evil.test?",
    options: ["allow", "deny"],
  };
  const first = fakeAgent([origin, { type: "ended", result: result() }]);
  assert.equal((await run(ARGS, first)).code, 0);
  assert.deepEqual(first.seen.answers, [["q1", "deny"]]);
  assert.equal(first.seen.stopped, false);

  const other: AgentEvent = {
    type: "question",
    id: "q2",
    question: "Which account?",
  };
  const second = fakeAgent([other], result({ reason: "stopped" }));
  const outcome = await run(ARGS, second);
  assert.equal(outcome.code, 1);
  assert.equal(second.seen.stopped, true);
  assert.match(
    outcome.err(),
    /The agent asked "Which account\?" and nobody can answer: stdin is not a terminal/,
  );
});

test("in a terminal the question is asked and the answer goes to the run", async () => {
  const question: AgentEvent = {
    type: "question",
    id: "q1",
    question: "Which account?",
    options: ["a", "b"],
  };
  const agent = fakeAgent([question, { type: "ended", result: result() }]);
  const asked: string[] = [];
  const { out } = await run(ARGS, agent, {
    prompt: async (q) => (asked.push(q), "b"),
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(out(), /\? Which account\? \(a\/b\)/);
  assert.deepEqual(agent.seen.answers, [["q1", "b"]]);
});

test("--plan reads the plan and hands its text to the run", async () => {
  const agent = fakeAgent([{ type: "ended", result: result() }]);
  const { code } = await run([...ARGS, "--plan", "plans/a.md"], agent);
  assert.equal(code, 0);
  assert.equal(agent.seen.options?.plan, "PLAN TEXT of plans/a.md");
  const without = fakeAgent([{ type: "ended", result: result() }]);
  await run(ARGS, without);
  assert.equal("plan" in (without.seen.options ?? {}), false);
});

test("a plan file that cannot be used is a usage error that names it", async () => {
  for (const [file, message] of [
    ["missing.md", /--plan: missing\.md cannot be read/],
    ["big.md", /--plan: big\.md is 40 KB, over the 32 KB limit/],
    ["nosteps.md", /--plan: nosteps\.md: the plan has no "## Steps" heading/],
  ] as const) {
    const agent = fakeAgent([]);
    await assert.rejects(run([...ARGS, "--plan", file], agent), message);
    assert.equal(agent.seen.options, undefined, "no run was started");
  }
  const sink = io();
  assert.equal(await main([...ARGS, "--plan", "x.md", "--bogus"], sink.io), 2);
});
