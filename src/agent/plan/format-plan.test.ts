import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPlan, MAX_PLAN_BYTES, parsePlan } from "./plan-file.js";
import type { PlanDocument } from "./plan-file.js";

const FULL: PlanDocument = {
  title: "Register",
  goal: "Register with the Pro plan",
  start: "http://localhost/forms",
  steps: [{ text: "Click Register", expect: "A form opens" }, { text: "Fill" }],
  seen: ["A banner", "A footer"],
  notDone: ["Payment"],
  questions: [
    { text: "Which plan?", answer: "Pro" },
    { text: "Which country?" },
  ],
};
const EMPTY: PlanDocument = {
  title: "",
  goal: "",
  start: "",
  steps: [],
  seen: [],
  notDone: [],
  questions: [],
};

test("parsePlan reads back what formatPlan wrote", () => {
  for (const plan of [FULL, EMPTY]) {
    const read = parsePlan(formatPlan(plan));
    assert.deepEqual(
      {
        title: read.title,
        goal: read.goal,
        start: read.start,
        steps: read.steps,
        seen: read.seen,
        notDone: read.notDone,
        questions: read.questionList,
      },
      plan,
    );
  }
});

test("formatPlan writes an empty list as None. and an answer as an indented line", () => {
  const text = formatPlan(EMPTY);
  assert.equal(text.match(/^- None\.$/gm)?.length, 4);
  assert.match(formatPlan(FULL), /- Which plan\?\n {2}Answer: Pro\n/);
});

test("formatPlan makes each text one line", () => {
  const text = formatPlan({
    ...EMPTY,
    steps: [{ text: "a\n## Steps\nb", expect: "c\n\nd" }],
    seen: ["x\ny"],
  });
  const read = parsePlan(text);
  assert.deepEqual(read.steps, [{ text: "a ## Steps b", expect: "c d" }]);
  assert.deepEqual(read.seen, ["x y"]);
});

test("formatPlan puts the front matter first and refuses an oversized plan", () => {
  assert.ok(
    formatPlan(EMPTY, "---\nstatus: ready\n---\n").startsWith(
      "---\nstatus: ready\n---\n# Plan: ",
    ),
  );
  assert.throws(
    () => formatPlan({ ...EMPTY, seen: ["x".repeat(MAX_PLAN_BYTES)] }),
    /plan file is full/,
  );
});
