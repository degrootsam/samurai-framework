import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlanPrompt } from "./prompt.js";

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
