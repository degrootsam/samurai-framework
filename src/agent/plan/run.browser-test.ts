import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import {
  ended,
  endedOnce,
  kinds,
  OPTIONS,
  promptsText,
} from "../../testing/agent-run.js";
import {
  refIn,
  scriptedModel,
  type ScriptedTurn,
} from "../../testing/scripted-model.js";
import { browserConfig } from "../../testing/test-browser.js";
import { runAgent, runPlan } from "../index.js";
import type { AgentEvent } from "../types.js";
import { parsePlan } from "./plan-file.js";

const FORM = `<!doctype html><title>Contact</title><h1>Contact</h1>
<form method="post" action="/submit"><label for="n">Name</label><input id="n" name="n">
<button type="submit">Send</button></form>`;

let app: Server;
let origin = "";
let hits: string[] = [];

before(async () => {
  app = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      if (req.url !== "/favicon.ico") hits.push(`${req.method} ${req.url}`);
      res.setHeader("content-type", "text/html");
      res.end(req.method === "POST" ? "<h1>Thanks</h1>" : FORM);
    });
  });
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(app.address() as { port: number }).port}`;
});

after(() => app?.close());

const common = (dir: string) => ({
  projectDir: dir,
  config: browserConfig(),
  dataDir: path.join(dir, "data"),
  url: `${origin}/`,
  headless: true,
  port: 9613,
});

const sendPlan = (told: string[]) =>
  [
    { calls: [{ name: "snapshot" }] },
    (last: string) => ({
      calls: [
        {
          name: "act",
          args: {
            kind: "fill",
            target: refIn(last, /\[(e\d+)\] textbox "Name"/),
            value: "Sam",
          },
        },
      ],
    }),
    {
      calls: [
        {
          name: "step",
          args: {
            text: 'Fill "Name" (textbox) with `Sam`.',
            expect: "the field shows Sam",
          },
        },
      ],
    },
    { calls: [{ name: "snapshot" }] },
    (last: string) => ({
      calls: [
        {
          name: "act",
          args: {
            kind: "click",
            target: refIn(last, /\[(e\d+)\] button "Send"/),
          },
        },
      ],
    }),
    // the guard's notice comes with the click's answer or the next one, once
    (last: string) => (told.push(last), { calls: [{ name: "snapshot" }] }),
    (last: string) => (
      told.push(last),
      {
        calls: [
          {
            name: "notDone",
            args: { text: 'Click "Send" (button) was blocked: it submits.' },
          },
        ],
      }
    ),
    { calls: [{ name: "finish", args: { summary: "Planned the form" } }] },
  ] satisfies ScriptedTurn[];

test(
  "a plan run fills the form, the submit is blocked and the plan says so",
  OPTIONS,
  async () => {
    hits = [];
    const dir = mkdtempSync(path.join(os.tmpdir(), "plan-run-"));
    const events: AgentEvent[] = [];
    const told: string[] = [];
    const session = runPlan({
      ...common(dir),
      model: scriptedModel(sendPlan(told)),
      goal: "Send a message",
      out: "plans/contact.md",
      onEvent: (event) => events.push(event),
    });
    const result = await session.result;
    ended(result as never, "finished");
    assert.equal(result.summary, "Planned the form");
    assert.equal(result.steps, 1);
    endedOnce(events);
    assert.ok(kinds(events).includes("plan-step"));
    assert.equal(kinds(events).includes("step"), false, "no spec step");
    assert.deepEqual(hits, ["GET /"], "the server never saw the POST");

    const plan = parsePlan(
      readFileSync(path.join(dir, "plans/contact.md"), "utf8"),
    );
    assert.equal(plan.goal, "Send a message");
    assert.equal(plan.start, `${origin}/`);
    assert.deepEqual(plan.steps, [
      {
        text: 'Fill "Name" (textbox) with `Sam`.',
        expect: "the field shows Sam",
      },
    ]);
    assert.deepEqual(plan.notDone, [
      'Click "Send" (button) was blocked: it submits.',
    ]);
    assert.match(
      told.join("\n"),
      /blocked: the planner does not submit \(POST \/submit\)/,
    );
  },
);

test(
  "a plan run stopped at the step limit leaves a valid plan",
  OPTIONS,
  async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "plan-run-"));
    const events: AgentEvent[] = [];
    const session = runPlan({
      ...common(dir),
      model: scriptedModel([{ calls: [{ name: "snapshot" }] }]),
      goal: "Look around",
      out: "p.md",
      limits: { maxSteps: 2 },
      onEvent: (event) => events.push(event),
    });
    ended((await session.result) as never, "step-limit");
    endedOnce(events);
    assert.equal(
      parsePlan(readFileSync(path.join(dir, "p.md"), "utf8")).steps.length,
      0,
    );
  },
);

test(
  "generate with a plan puts the plan text in the first prompt",
  OPTIONS,
  async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "plan-run-"));
    const model = scriptedModel([
      { calls: [{ name: "finish", args: { summary: "ok" } }] },
    ]);
    const text = "# Plan: x\n\n## Steps\n\n1. Fill the PLAN-MARKER field.\n";
    const result = await runAgent({
      ...common(dir),
      model,
      goal: "Send a message",
      file: "tests/a.spec.ts",
      create: "sends",
      plan: text,
    }).result;
    ended(result, "finished");
    const prompts = promptsText(model);
    assert.match(prompts, /Plan (\\\\n)?\(written earlier/);
    assert.ok(prompts.includes("Fill the PLAN-MARKER field."));
    assert.match(prompts, /The goal comes with a plan/);
  },
);
