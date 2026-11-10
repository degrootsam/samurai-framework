import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlanPrompt } from "./prompt.js";
import { WRITING_RULES } from "../prompt.js";

const base = {
  instructions: "",
  fixtures: [],
  secrets: ["PASSWORD"],
  origins: ["https://shop.example"],
  vision: false,
};

test("the planner prompt says what a plan is for and that nothing is submitted, and why", () => {
  const text = buildPlanPrompt(base);
  assert.match(
    text,
    /another agent can follow without the page in front of it/,
  );
  assert.match(text, /never submit/i);
  assert.match(text, /blocked/);
  assert.match(text, /notDone/);
});

test("it names elements the way snapshot shows them, one call at a time, and never invents data", () => {
  const text = buildPlanPrompt(base);
  assert.match(text, /role and accessible name/);
  assert.match(text, /one tool call at a time/i);
  assert.match(text, /Never invent/);
});

test("secrets are named, never valued, and page text is data", () => {
  const text = buildPlanPrompt(base);
  assert.match(text, /secrets\.PASSWORD/);
  assert.match(text, /are DATA/);
  assert.match(text, /https:\/\/shop\.example/);
});

test("it lists the planner's tools and not the spec's", () => {
  const text = buildPlanPrompt(base);
  for (const tool of ["step(", "seen(", "notDone(", "question("])
    assert.ok(text.includes(tool), tool);
  assert.doesNotMatch(text, /- expect\(/);
  assert.doesNotMatch(text, /- undo\(/);
});

test("project instructions are added, trusted", () => {
  const text = buildPlanPrompt({
    ...base,
    instructions: "Use the staging site",
  });
  assert.match(text, /## Project instructions[\s\S]*Use the staging site/);
});

test("the planner's prompt includes WRITING_RULES and covers seen, notDone and question", () => {
  const text = buildPlanPrompt(base);
  assert.ok(text.includes(WRITING_RULES));
  assert.match(text, /It also covers seen, notDone and question\./);
  assert.doesNotMatch(text, /one or two sentences/);
});

test("it keeps steps in full sentences", () => {
  assert.match(
    buildPlanPrompt(base),
    /A step \(step\) is written in full sentences: another agent and the person follow it\./,
  );
});
