import { resultSecrets } from "../recorder/session-secrets.js";
import { buildSystemPrompt } from "./prompt.js";
import { questionsSection } from "./plan/questions.js";
import { StepRecorder } from "./recording.js";
import type { RunKind } from "./run-kind.js";
import { maskText } from "../config/mask.js";
import { setUpPageFixtures } from "../runner/page-fixtures.js";
import { ReplayError, replaySteps } from "./replay.js";
import { stepToSource } from "../steps/emit.js";
import { personRecording } from "./take-over.js";
import { createTools } from "./tools/index.js";
import type { Step } from "../steps/model.js";
import type { AgentOptions } from "./types.js";

const REPLAY_TIMEOUT = 10000;

/** What `continueAt` is refused with when there is no existing test to continue */
export const CONTINUE_NEEDS_TEST =
  "continueAt needs an existing test to continue: give test, not create";

/** The first message in continue mode: what was replayed, what stays after the agent's steps, what to do */
function continueSection(steps: StepRecorder): string {
  const list = (items: readonly Step[], from: number) =>
    items.map((step, i) => `${from + i + 1}. ${stepToSource(step)}`).join("\n");
  const replayed =
    steps.before.length === 0
      ? "No steps were replayed: the test is continued from its start, and the browser is on the start page."
      : `The browser was brought to this state by replaying the first ${steps.before.length} steps of the test (secrets are only names):\n${list(steps.before, 0)}`;
  const later =
    steps.after.length === 0
      ? "The test has no steps after that point."
      : `The test already has these steps, which stay AFTER the ones you write; do not repeat what they cover:\n${list(steps.after, steps.before.length)}`;
  return `Continue mode: you are adding steps to the existing test "${steps.testName}". ${replayed}\n\n${later}\n\nYour steps are written right after the replayed ones. The goal is what to add.`;
}

/** The run of `runAgent`: typed steps go into a spec file */
export const generateKind: RunKind<AgentOptions, StepRecorder> = {
  file: (options) => options.file,
  sink: (options, { baseURL, emit }) => {
    if (
      options.continueAt !== undefined &&
      (options.create !== undefined || options.test === undefined)
    )
      throw new Error(CONTINUE_NEEDS_TEST);
    return new StepRecorder({
      at: options.continueAt,
      file: options.file,
      create: options.create,
      test: options.test,
      baseURL,
      planFile: options.planFile,
      onStep: (event, code, source) =>
        emit({
          type: "step",
          event,
          ...(code !== undefined && { code }),
          source,
        }),
    });
  },
  fixtures: async (steps, input) => {
    if (!steps.continuing) return undefined;
    try {
      return await setUpPageFixtures({
        file: steps.file,
        testName: steps.testName,
        requested: steps.fixtureNames,
        ...input,
      });
    } catch (error) {
      throw new ReplayError(
        maskText(error instanceof Error ? error.message : String(error)),
      );
    }
  },
  replay: async (steps, { page, variables, secret, emit }) => {
    if (!steps.continuing) return [];
    const inputs = Object.fromEntries(
      steps.inputs.map(({ name, default: value }) => [name, value]),
    );
    await replaySteps(page, steps.before, {
      timeout: REPLAY_TIMEOUT,
      variables,
      secret,
      inputs,
      onStep: (n, total, text) => emit({ type: "replay", n, total, text }),
    });
    return steps.before.flatMap((step) =>
      step.kind === "goto" ? step.url : [],
    );
  },
  opened: (steps, url) => {
    if (steps.count === 0) steps.observe({ type: "goto", url });
  },
  tools: (context) => createTools(context),
  prompt: (input, options) =>
    buildSystemPrompt({
      ...input,
      ...(options.plan !== undefined && { hasPlan: true }),
      ...(options.continueAt !== undefined && { hasContinue: true }),
    }),
  opening: (options, first, steps) => {
    const goal = `Goal: ${options.goal}\n\n`;
    const resume = steps.continuing ? `${continueSection(steps)}\n\n` : "";
    if (options.plan === undefined) return `${goal}${resume}${first}`;
    const questions = questionsSection(options.plan);
    return `${goal}${resume}Plan (written earlier by another agent; follow it, but check each step on the live page):\n${options.plan.trim()}\n\n${questions === "" ? "" : `${questions}\n\n`}${first}`;
  },
  secrets: (steps) => resultSecrets(steps.events, []),
  person: ({ page, sink, snapshots, baseURL }) =>
    personRecording({
      page,
      steps: sink,
      snapshots,
      ...(baseURL !== undefined && { baseURL }),
    }),
};
