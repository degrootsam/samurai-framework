import { resultSecrets } from "../recorder/session-secrets.js";
import { buildSystemPrompt } from "./prompt.js";
import { questionsSection } from "./plan/questions.js";
import { StepRecorder } from "./recording.js";
import type { RunKind } from "./run-kind.js";
import { personRecording } from "./take-over.js";
import { createTools } from "./tools/index.js";
import type { AgentOptions } from "./types.js";

/** The run of `runAgent`: typed steps go into a spec file */
export const generateKind: RunKind<AgentOptions, StepRecorder> = {
  file: (options) => options.file,
  sink: (options, { baseURL, emit }) =>
    new StepRecorder({
      file: options.file,
      create: options.create,
      test: options.test,
      baseURL,
      onStep: (event, code, source) =>
        emit({
          type: "step",
          event,
          ...(code !== undefined && { code }),
          source,
        }),
    }),
  opened: (steps, url) => {
    if (steps.count === 0) steps.observe({ type: "goto", url });
  },
  tools: (context) => createTools(context),
  prompt: (input, options) =>
    buildSystemPrompt({
      ...input,
      ...(options.plan !== undefined && { hasPlan: true }),
    }),
  opening: (options, first) => {
    if (options.plan === undefined) return `Goal: ${options.goal}\n\n${first}`;
    const questions = questionsSection(options.plan);
    return `Goal: ${options.goal}\n\nPlan (written earlier by another agent; follow it, but check each step on the live page):\n${options.plan.trim()}\n\n${questions === "" ? "" : `${questions}\n\n`}${first}`;
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
