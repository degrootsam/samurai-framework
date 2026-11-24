import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { resetSecrets } from "../../config/mask.js";
import type { AgentTool, ToolContext } from "./context.js";
import { NOTE_MAX, withNotes } from "./note.js";
import { planStepTool } from "./plan-step.js";
import type { AgentEvent } from "../types.js";

function setup() {
  resetSecrets();
  const events: AgentEvent[] = [];
  const seen: unknown[] = [];
  const context = {
    secrets: {
      allowed: ["PASSWORD"],
      get: (name: string) =>
        name === "PASSWORD" ? "hunter2-Value" : undefined,
    },
    emit: (event: AgentEvent) => events.push(event),
  } as unknown as ToolContext;
  const tool: AgentTool = {
    name: "act",
    description: "d",
    inputSchema: z.object({ value: z.string().optional() }),
    run: (args) => {
      seen.push(args);
      return Promise.resolve({ ok: true, message: "done" });
    },
  };
  const [wrapped] = withNotes([tool], context, true);
  return { events, seen, wrapped: wrapped!, tool, context };
}

const narrations = (events: AgentEvent[]) =>
  events.flatMap((e) => (e.type === "narration" ? [e.text] : []));

test("a note becomes a narration event and is not passed to the tool", async () => {
  const { events, seen, wrapped } = setup();
  await wrapped.run({ value: "x", note: "  Search returned\n3 products.  " });
  assert.deepEqual(narrations(events), ["Search returned 3 products."]);
  assert.deepEqual(seen, [{ value: "x" }]);
});

test("secret values and the typed value never reach a narration", async () => {
  const { events, wrapped } = setup();
  await wrapped.run({
    value: "ann@example.com",
    note: "Typing ann@example.com; password is hunter2-Value or hunter2-Value.",
  });
  const [text] = narrations(events);
  assert.equal(text!.includes("hunter2"), false);
  assert.equal(text!.includes("ann@example.com"), false);
});

test("a long note is cut, an empty or non-text note is ignored", async () => {
  const { events, wrapped } = setup();
  await wrapped.run({ note: "a".repeat(500) });
  await wrapped.run({ note: "   " });
  await wrapped.run({ note: 42 });
  await wrapped.run({});
  const all = narrations(events);
  assert.equal(all.length, 1);
  assert.equal(all[0]!.length, NOTE_MAX);
});

test("notes are off unless enabled, and not on finish or ask", () => {
  const { tool, context } = setup();
  assert.equal(withNotes([tool], context, false)[0], tool);
  const finish = { ...tool, name: "finish" };
  assert.equal(withNotes([finish], context, true)[0], finish);
});

test("planStep reports the plan's step 0-based and ignores bad or repeated calls", async () => {
  const { events, context } = setup();
  const tool = planStepTool(3)(context);
  for (const step of [2, 2, 0, 4, -1, 3, 1]) await tool.run({ step });
  const bad = await tool.run({ step: "x" });
  assert.equal(bad.ok, false);
  const reported = events.flatMap((e) =>
    e.type === "planStep" ? [[e.index, e.total]] : [],
  );
  assert.deepEqual(reported, [
    [1, 3],
    [2, 3],
    [0, 3],
  ]);
});
