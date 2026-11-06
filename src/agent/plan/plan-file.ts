import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { projectDir } from "../../config/config.js";
import { maskText } from "../../config/mask.js";

/** A plan file may not be larger than this (bytes), for the planner and for `generate --plan` */
export const MAX_PLAN_BYTES = 32 * 1024;

const NONE = "None.";
const TITLE_LENGTH = 80;

interface PlanStep {
  text: string;
  expect?: string;
}

/** A plan as `parsePlan` reads it; every part but the steps may be missing in a hand-written file */
interface ParsedPlan {
  title: string;
  goal: string;
  start: string;
  steps: PlanStep[];
  seen: string[];
  notDone: string[];
  questions: string[];
}

/** One line, masked: a new line in a text must not be able to start a heading or a step */
function oneLine(text: string): string {
  return maskText(text).replace(/\s+/g, " ").trim();
}

function bullets(items: readonly string[]): string {
  return items.length > 0
    ? items.map((item) => `- ${item}`).join("\n")
    : `- ${NONE}`;
}

/**
 * A plan file being written. The whole file is written again after every call, so it is valid Markdown with its
 * four headings whenever the run stops. Texts are masked and made one line long.
 */
class PlanFile {
  private readonly steps: PlanStep[] = [];
  private readonly seenItems: string[] = [];
  private readonly notDoneItems: string[] = [];
  private readonly questionItems: string[] = [];

  constructor(
    public readonly file: string,
    private readonly goal: string,
    private readonly start: string,
  ) {}

  /** The title, which is also what the run reports as the name of the test */
  public get title(): string {
    const first = this.goal.slice(0, TITLE_LENGTH).trim();
    return first.length < this.goal.length ? `${first}…` : first;
  }

  public get count(): number {
    return this.steps.length;
  }

  private render(): string {
    const steps = this.steps.map(
      (step, i) =>
        `${i + 1}. ${step.text}${step.expect !== undefined ? `\n   Expect: ${step.expect}` : ""}`,
    );
    return [
      `# Plan: ${this.title}`,
      "",
      `Goal: ${this.goal}`,
      `Start: ${this.start}`,
      "",
      "## Steps",
      "",
      steps.length > 0 ? steps.join("\n") : `- ${NONE}`,
      "",
      "## Seen on the page",
      "",
      bullets(this.seenItems),
      "",
      "## Not done",
      "",
      bullets(this.notDoneItems),
      "",
      "## Open questions",
      "",
      bullets(this.questionItems),
      "",
    ].join("\n");
  }

  /** Writes the file; refuses, and keeps the file as it was, when it would pass the size limit */
  private save(): void {
    const text = this.render();
    if (Buffer.byteLength(text) > MAX_PLAN_BYTES)
      throw new Error(
        `the plan file is full (${MAX_PLAN_BYTES / 1024} KB); finish with what it holds, or shorten the next entry`,
      );
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, text);
  }

  private add(list: string[], text: string): void {
    list.push(oneLine(text));
    try {
      this.save();
    } catch (error) {
      list.pop();
      throw error;
    }
  }

  /** Appends a step and returns its number */
  public addStep(text: string, expect?: string): number {
    const step: PlanStep = { text: oneLine(text) };
    const wanted = expect === undefined ? "" : oneLine(expect);
    if (wanted !== "") step.expect = wanted;
    this.steps.push(step);
    try {
      this.save();
    } catch (error) {
      this.steps.pop();
      throw error;
    }
    return this.steps.length;
  }

  public seen(text: string): void {
    this.add(this.seenItems, text);
  }

  public notDone(text: string): void {
    this.add(this.notDoneItems, text);
  }

  public question(text: string): void {
    this.add(this.questionItems, text);
  }

  /** Writes the first version of the file */
  public create(): void {
    this.save();
  }
}

export type { PlanFile };

/** Starts a plan file: the headings are written at once. An existing file is an error unless `force` is set */
export function createPlan(input: {
  goal: string;
  start: string;
  out: string;
  force?: boolean;
}): PlanFile {
  const file = path.resolve(projectDir(), input.out);
  if (existsSync(file) && input.force !== true)
    throw new Error(
      `createPlan(): ${file} already exists; pass force (--force) to replace it`,
    );
  const plan = new PlanFile(file, oneLine(input.goal), oneLine(input.start));
  plan.create();
  return plan;
}

const HEADING = /^##\s+(.*?)\s*$/;
const STEP = /^\s*\d+\.\s+(.*)$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const EXPECT = /^\s+Expect:\s*(.*)$/i;
const FIELD = /^(Goal|Start):\s*(.*)$/i;

type Section = "steps" | "seen" | "notDone" | "questions" | "other";

function sectionOf(heading: string): Section {
  const name = heading.toLowerCase();
  if (name === "steps") return "steps";
  if (name.startsWith("seen")) return "seen";
  if (name === "not done") return "notDone";
  if (name.startsWith("open question")) return "questions";
  return "other";
}

/**
 * Reads a plan, the one `createPlan` wrote or one a person edited: blank lines, a missing title, missing sections
 * and `None.` placeholders are fine. Only the `## Steps` heading is needed.
 */
export function parsePlan(text: string): ParsedPlan {
  const plan: ParsedPlan = {
    title: "",
    goal: "",
    start: "",
    steps: [],
    seen: [],
    notDone: [],
    questions: [],
  };
  let section: Section | undefined;
  let hasSteps = false;
  for (const line of text.split(/\r?\n/)) {
    const heading = HEADING.exec(line);
    if (heading) {
      section = sectionOf(heading[1]!);
      if (section === "steps") hasSteps = true;
      continue;
    }
    if (line.trim() === "") continue;
    if (section === undefined) {
      const title = /^#\s+(?:Plan:\s*)?(.*)$/i.exec(line);
      const field = FIELD.exec(line);
      if (title && plan.title === "") plan.title = title[1]!.trim();
      else if (field)
        plan[field[1]!.toLowerCase() as "goal" | "start"] = field[2]!.trim();
      continue;
    }
    if (section === "other") continue;
    if (section === "steps") {
      const last = plan.steps[plan.steps.length - 1];
      const step = STEP.exec(line);
      const expect = EXPECT.exec(line);
      if (step) plan.steps.push({ text: step[1]!.trim() });
      else if (last && expect) last.expect = expect[1]!.trim();
      else if (last && !BULLET.test(line) && /^\s/.test(line))
        last.text = `${last.text} ${line.trim()}`;
      continue;
    }
    const item = BULLET.exec(line)?.[1]?.trim();
    if (item !== undefined && item !== NONE) plan[section].push(item);
  }
  if (!hasSteps)
    throw new Error('parsePlan(): the plan has no "## Steps" heading');
  return plan;
}
