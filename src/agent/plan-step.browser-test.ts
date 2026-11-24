import { test } from "node:test";
import assert from "node:assert/strict";
import { refIn } from "../testing/scripted-model.js";
import {
  agentRunFixture,
  ended,
  kinds,
  OPTIONS,
  promptsText,
  SECRET,
} from "../testing/agent-run.js";
import type { AgentEvent } from "./types.js";

const fx = agentRunFixture(9612);
const { start } = fx;

const PLAN = `# Plan: shop

Goal: fill in the form
Start: /

## Steps

1. Fill the Email field
   Expect: it shows the address
2. Open the Next page link

## Seen on the page

- None.
`;

const fillEmail = (last: string) => ({
  calls: [
    {
      name: "act",
      args: {
        kind: "fill",
        target: refIn(last, /\[(e\d+)\] textbox "Email"/),
        value: "ann@example.com",
        note: `Typing ann@example.com, then ${SECRET} is not used`,
      },
    },
  ],
});

const planSteps = (events: AgentEvent[]) =>
  events.flatMap((e) => (e.type === "planStep" ? [[e.index, e.total]] : []));

test(
  "a run with a plan reports the plan step the agent says it is on",
  OPTIONS,
  async () => {
    const run = start(
      [
        { calls: [{ name: "snapshot" }] },
        { calls: [{ name: "planStep", args: { step: 1 } }] },
        { calls: [{ name: "snapshot" }] },
        fillEmail,
        { calls: [{ name: "planStep", args: { step: 1 } }] },
        { calls: [{ name: "planStep", args: { step: 9 } }] },
        { calls: [{ name: "planStep", args: { step: 2 } }] },
        { calls: [{ name: "finish", args: { summary: "ok" } }] },
      ],
      { plan: PLAN },
    );
    ended(await run.session.result, "finished");
    assert.deepEqual(planSteps(run.events), [
      [0, 2],
      [1, 2],
    ]);
    assert.match(promptsText(run.model), /The plan has 2 numbered steps/);
    // Without liveView a note is not asked for: no narration
    assert.equal(kinds(run.events).includes("narration"), false);
  },
);

test(
  "without a plan there is no planStep tool and no event",
  OPTIONS,
  async () => {
    const run = start([
      { calls: [{ name: "snapshot" }] },
      { calls: [{ name: "finish", args: { summary: "ok" } }] },
    ]);
    ended(await run.session.result, "finished");
    assert.equal(kinds(run.events).includes("planStep"), false);
    assert.doesNotMatch(promptsText(run.model), /planStep/);
  },
);

test(
  "with liveView a note becomes a narration, with every secret and the typed value removed",
  OPTIONS,
  async () => {
    const run = start(
      [
        { calls: [{ name: "snapshot", args: { note: "Shop form is open." } }] },
        fillEmail,
        { calls: [{ name: "finish", args: { summary: "ok" } }] },
      ],
      { liveView: true },
    );
    ended(await run.session.result, "finished");
    const notes = run.events.flatMap((e) =>
      e.type === "narration" ? [e.text] : [],
    );
    assert.equal(notes.length, 2);
    assert.equal(notes[0], "Shop form is open.");
    assert.equal(notes[1]!.includes(SECRET), false);
    assert.equal(notes[1]!.includes("ann@example.com"), false);
    // The note comes before the call it belongs to
    const order = kinds(run.events);
    assert.ok(order.indexOf("narration") < order.indexOf("tool-call"));
    assert.match(promptsText(run.model), /Notes for the person watching/);
    assert.equal(
      run.events.some((e) => JSON.stringify(e).includes(SECRET)),
      false,
    );
  },
);
