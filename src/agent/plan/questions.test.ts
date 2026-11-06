import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKind } from "../generate-kind.js";
import { parsePlan } from "./plan-file.js";
import { questionsSection } from "./questions.js";

const PLAN = `## Steps

1. Open.

## Open questions

- Which card is saved?
  Answer: the Visa ending 4242
- Is there a coupon field?
  Answer:
- Does it email?
`;

test("parsePlan reads the Answer line under a question", () => {
  const plan = parsePlan(PLAN);
  assert.deepEqual(plan.questions, [
    "Which card is saved?",
    "Is there a coupon field?",
    "Does it email?",
  ]);
  assert.deepEqual(plan.answers, [
    { question: "Which card is saved?", answer: "the Visa ending 4242" },
  ]);
});

test("a plan without answers has none", () => {
  assert.deepEqual(parsePlan("## Steps\n1. a\n").answers, []);
});

test("the section lists answered and open questions apart", () => {
  const text = questionsSection(PLAN);
  assert.match(text, /answered[^]*Which card is saved\?\n {2}Answer: the Visa/);
  assert.match(
    text,
    /still open[^]*- Is there a coupon field\?\n- Does it email\?/,
  );
});

test("the generator's first message carries the questions after the plan", () => {
  const opening = generateKind.opening(
    { goal: "g", file: "a.spec.ts", model: {} as never, plan: PLAN },
    "FIRST",
  );
  assert.match(opening, /Does it email\?[^]*Questions still open[^]*FIRST$/);
});

test("no questions, or an unreadable plan, give no section", () => {
  assert.equal(questionsSection("## Steps\n1. a\n"), "");
  assert.equal(questionsSection("nothing"), "");
});
