import { after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerSecret, resetSecrets } from "../../config/mask.js";
import { createPlan, MAX_PLAN_BYTES, parsePlan } from "./plan-file.js";

const dir = mkdtempSync(path.join(os.tmpdir(), "plan-file-"));
let n = 0;
const fresh = () => path.join(dir, `plan-${n++}.md`);
const HEADINGS = [
  "## Steps",
  "## Seen on the page",
  "## Not done",
  "## Open questions",
];

afterEach(() => resetSecrets());
after(() => resetSecrets());

const headingsOf = (text: string) =>
  text.split("\n").filter((line) => line.startsWith("## "));

test("createPlan writes the title, the goal, the start and the four headings", () => {
  const out = fresh();
  const plan = createPlan({
    goal: "Register with the Pro plan",
    start: "http://localhost:5180/forms",
    out,
  });
  const text = readFileSync(out, "utf8");
  assert.match(text, /^# Plan: Register with the Pro plan\n/);
  assert.match(text, /\nGoal: Register with the Pro plan\n/);
  assert.match(text, /\nStart: http:\/\/localhost:5180\/forms\n/);
  assert.deepEqual(headingsOf(text), HEADINGS);
  assert.equal(plan.count, 0);
  assert.equal(plan.file, out);
});

test("addStep appends numbered steps with an optional expectation and returns the number", () => {
  const out = fresh();
  const plan = createPlan({ goal: "g", start: "", out });
  assert.equal(plan.addStep('Fill "Full name" (textbox) with `Sam`.'), 1);
  assert.equal(
    plan.addStep('Click "Save" (button).', 'the "Saved" note shows'),
    2,
  );
  const text = readFileSync(out, "utf8");
  assert.match(text, /\n1\. Fill "Full name" \(textbox\) with `Sam`\.\n/);
  assert.match(
    text,
    /\n2\. Click "Save" \(button\)\.\n {3}Expect: the "Saved" note shows\n/,
  );
  assert.equal(plan.count, 2);
  assert.deepEqual(headingsOf(text), HEADINGS);
});

test("seen, notDone and question go under their headings and replace the placeholder", () => {
  const out = fresh();
  const plan = createPlan({ goal: "g", start: "", out });
  plan.seen("Heading Forms");
  plan.notDone("Step 5 was not clicked");
  plan.question("Which plan?");
  plan.notDone("Reset was not clicked");
  const parsed = parsePlan(readFileSync(out, "utf8"));
  assert.deepEqual(parsed.seen, ["Heading Forms"]);
  assert.deepEqual(parsed.notDone, [
    "Step 5 was not clicked",
    "Reset was not clicked",
  ]);
  assert.deepEqual(parsed.questions, ["Which plan?"]);
});

test("a new line in a text cannot start a heading or a step", () => {
  const out = fresh();
  const plan = createPlan({ goal: "g\n## Steps", start: "", out });
  plan.addStep("Click it.\n## Not done\n9. extra");
  plan.seen("a\n\n## Steps");
  const text = readFileSync(out, "utf8");
  assert.deepEqual(headingsOf(text), HEADINGS);
  assert.equal(parsePlan(text).steps.length, 1);
});

test("an existing file is an error naming it, unless force is set", () => {
  const out = fresh();
  writeFileSync(out, "old");
  assert.throws(
    () => createPlan({ goal: "g", start: "", out }),
    new RegExp(
      `createPlan\\(\\): ${out.replace(/[.\\/]/g, "\\$&")} already exists`,
    ),
  );
  assert.equal(readFileSync(out, "utf8"), "old");
  createPlan({ goal: "g", start: "", out, force: true });
  assert.match(readFileSync(out, "utf8"), /^# Plan: g/);
});

test("registered secrets are masked in everything written", () => {
  registerSecret("PASSWORD", "hunter2-Value");
  const out = fresh();
  const plan = createPlan({ goal: "login with hunter2-Value", start: "", out });
  plan.addStep("Type hunter2-Value", "hunter2-Value shown");
  plan.seen("hunter2-Value");
  assert.equal(readFileSync(out, "utf8").includes("hunter2-Value"), false);
});

test("the file never passes 32 KB: the call that would is refused and nothing is lost", () => {
  const out = fresh();
  const plan = createPlan({ goal: "g", start: "", out });
  const big = "x".repeat(4000);
  let added = 0;
  assert.throws(() => {
    for (let i = 0; i < 20; i++) {
      plan.addStep(big);
      added++;
    }
  }, /plan file is full.*32 KB/);
  assert.equal(plan.count, added);
  assert.ok(Buffer.byteLength(readFileSync(out, "utf8")) <= MAX_PLAN_BYTES);
  assert.equal(parsePlan(readFileSync(out, "utf8")).steps.length, added);
});

test("parsePlan reads what createPlan wrote", () => {
  const out = fresh();
  const plan = createPlan({ goal: "Register", start: "http://x.test/", out });
  plan.addStep("Click A.", "A is open");
  plan.addStep("Click B.");
  const parsed = parsePlan(readFileSync(out, "utf8"));
  assert.equal(parsed.title, "Register");
  assert.equal(parsed.goal, "Register");
  assert.equal(parsed.start, "http://x.test/");
  assert.deepEqual(parsed.steps, [
    { text: "Click A.", expect: "A is open" },
    { text: "Click B." },
  ]);
  assert.deepEqual(parsed.seen, []);
  assert.deepEqual(parsed.questions, []);
});

test("parsePlan accepts a hand-edited file and a file with only Steps", () => {
  const parsed = parsePlan(
    "\n\n## Steps\n\n\n1. Open the page.\n\n\n2. Click Go.\n   Expect: it works\n\n",
  );
  assert.deepEqual(parsed.steps, [
    { text: "Open the page." },
    { text: "Click Go.", expect: "it works" },
  ]);
  assert.equal(parsed.title, "");
  assert.deepEqual(parsed.notDone, []);
});

test("parsePlan names the heading that is missing", () => {
  assert.throws(
    () => parsePlan("# Plan: x\n\nGoal: y\n"),
    /parsePlan\(\): the plan has no "## Steps" heading/,
  );
});

test("createPlan makes the folder of the file", () => {
  const out = path.join(dir, "nested", "deeper", "p.md");
  createPlan({ goal: "g", start: "", out });
  assert.equal(existsSync(out), true);
});
