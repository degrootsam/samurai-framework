import type Page from "../browser/page.js";
import { loadRawConfig, projectDir } from "../config/config.js";
import { maskDeep, maskText } from "../config/mask.js";
import {
  launchRecordingBrowser,
  prepareRecordingBrowser,
} from "../recorder/session-browser.js";
import { resultSecrets } from "../recorder/session-secrets.js";
import { fixtureCatalog } from "../runner/fixture-registry.js";
import { withProject } from "../runner/project.js";
import { loadInstructions } from "./instructions.js";
import { resolveLimits } from "./limits.js";
import { runLoop, type RunTally } from "./loop.js";
import { assertModelObject } from "./model.js";
import { buildSystemPrompt } from "./prompt.js";
import { StepRecorder } from "./recording.js";
import { toSdkTools, type AiModule } from "./sdk-tools.js";
import { AgentController } from "./session.js";
import { Snapshotter } from "./snapshot.js";
import { createTools } from "./tools/index.js";
import { OriginPolicy } from "./tools/origins.js";
import type { ToolContext } from "./tools/context.js";
import { personRecording, type PersonRecording } from "./take-over.js";
import type {
  AgentEndReason,
  AgentOptions,
  AgentResult,
  AgentSession,
} from "./types.js";

/** What a run needs from outside, replaced in tests */
export interface RunDeps {
  importAi?: () => Promise<AiModule>;
  /** Called with the page once the browser is open (a test plays the person with it) */
  onPage?: (page: Page) => void;
}

const ACTION_TIMEOUT = 5000;

async function loadAi(deps: RunDeps): Promise<AiModule> {
  try {
    return await (deps.importAi ?? (() => import("ai")))();
  } catch (error) {
    const missing = (error as { code?: string }).code;
    throw new Error(
      missing === "ERR_MODULE_NOT_FOUND" || deps.importAi
        ? 'agent(): the "ai" package is not installed. Install it, and a provider package for your model, with: npm install ai zod @ai-sdk/anthropic'
        : `agent(): could not load the "ai" package: ${(error as Error).message}`,
    );
  }
}

/** The fixtures of the project's config, for the prompt; the agent works without them */
async function fixturesOf(options: AgentOptions) {
  try {
    const config = options.config ?? (await loadRawConfig());
    return fixtureCatalog(config.fixtures ?? []);
  } catch {
    return [];
  }
}

function endReason(
  controller: AgentController,
  tally: RunTally,
  limit: "step-limit" | "token-limit" | undefined,
  failed: boolean,
): AgentEndReason {
  const stopped = controller.stopReason;
  if (stopped) return stopped;
  if (failed) return "error";
  if (tally.finished) return "finished";
  return limit ?? "finished";
}

/** Starts a run; its work goes on in the background and `result` settles when it ends */
export function startAgent(
  options: AgentOptions,
  deps: RunDeps = {},
): AgentSession {
  assertModelObject(options.model);
  const limits = resolveLimits(options.limits);
  const person: { hooks?: PersonRecording } = {};
  const controller = new AgentController(
    {
      begin: () => person.hooks?.begin() ?? Promise.resolve(),
      end: () => person.hooks?.end() ?? Promise.resolve(""),
    },
    options.onEvent,
  );
  options.signal?.addEventListener("abort", () => controller.stop(), {
    once: true,
  });
  if (options.signal?.aborted) controller.stop();
  const tally: RunTally = { modelCalls: 0, tokens: 0, finished: false };
  const done: {
    steps?: StepRecorder;
    summary?: string;
    error?: string;
    limit?: "step-limit" | "token-limit";
    text: string;
  } = { text: "" };

  const work = async () => {
    const ai = await loadAi(deps);
    await withProject(options, async (run) => {
      const { settings } = run;
      const instructions = loadInstructions(projectDir());
      const startUrl = options.url ?? settings.baseURL;
      const prepared = await prepareRecordingBrowser({
        ...(options.browser && { browser: options.browser }),
        ...(options.port !== undefined && { port: options.port }),
        signal: controller.signal,
      });
      const steps = new StepRecorder({
        file: options.file,
        create: options.create,
        test: options.test,
        baseURL: settings.baseURL,
        onStep: (event, code, source) =>
          controller.emit({
            type: "step",
            event,
            ...(code !== undefined && { code }),
            source,
          }),
      });
      done.steps = steps;
      const { browser, page } = await launchRecordingBrowser(prepared, {
        ...(options.port !== undefined && { port: options.port }),
        signal: controller.signal,
        headless: options.headless ?? false,
      });
      try {
        deps.onPage?.(page);
        if (options.url !== undefined) await page.goto(options.url);
        else if (settings.baseURL !== undefined)
          await page.navigateTo(settings.baseURL);
        const current = await page.url();
        const onWeb = /^https?:/.test(current);
        const snapshots = new Snapshotter(page, {
          secretFields: options.secretFields ?? [],
        });
        if (onWeb && steps.count === 0)
          steps.observe({ type: "goto", url: current });
        const origins = new OriginPolicy([
          ...(options.allowedOrigins ?? []),
          ...(onWeb ? [current] : startUrl ? [startUrl] : []),
        ]);
        person.hooks = personRecording({
          page,
          steps,
          snapshots,
          ...(settings.baseURL !== undefined && { baseURL: settings.baseURL }),
        });
        const context: ToolContext = {
          page,
          snapshots,
          steps,
          origins,
          secrets: {
            allowed: options.secrets ?? [],
            get: (name) => run.secrets.get(name),
          },
          vision: options.vision === true,
          actionTimeout: ACTION_TIMEOUT,
          ask: (question, choices) => controller.ask(question, choices),
          finish: (summary) => {
            done.summary = summary;
            tally.finished = true;
          },
          emit: (event) => controller.emit(event),
          secretOnScreen: false,
        };
        const system = buildSystemPrompt({
          instructions: instructions.text,
          fixtures: await fixturesOf(options),
          secrets: options.secrets ?? [],
          origins: origins.list(),
          vision: options.vision === true,
        });
        const first = onWeb
          ? `The browser is open on ${current}. This is the page now:\n\n${maskText((await snapshots.take()).text)}`
          : "No page is open yet: start with navigate.";
        const tools = toSdkTools(ai, createTools(context), {
          wait: () => controller.gate(),
          note: async () => controller.takeNote(),
        });
        const outcome = await runLoop({
          ai,
          model: options.model,
          system,
          prompt: `Goal: ${options.goal}\n\n${first}`,
          tools,
          controller,
          limits,
          tally,
        });
        done.text = outcome.text;
        if (outcome.limit) done.limit = outcome.limit;
      } finally {
        await person.hooks?.dispose().catch(() => undefined);
        await browser.close().catch(() => undefined);
      }
    });
  };

  const stopTimer = controller.watchTime(limits.timeoutMs);
  const result: Promise<AgentResult> = work()
    .then(() => false)
    .catch((error: unknown) => {
      done.error = maskText(
        error instanceof Error ? error.message : String(error),
      );
      return true;
    })
    .then(async (failed) => {
      stopTimer();
      await controller.settle();
      const steps = done.steps;
      const reason = endReason(controller, tally, done.limit, failed);
      const summary = done.summary ?? (done.text.trim() || undefined);
      const ended: AgentResult = maskDeep({
        reason,
        ...(reason === "finished" && summary !== undefined && { summary }),
        ...(reason === "error" &&
          done.error !== undefined && { error: done.error }),
        file: steps?.file ?? options.file,
        test: steps?.testName ?? "",
        steps: steps?.count ?? 0,
        secrets: steps ? resultSecrets(steps.events, []) : [],
        tokens: tally.tokens,
      });
      controller.end(ended);
      return ended;
    });

  return {
    events: controller.events,
    result,
    answer: (id, text) => controller.answer(id, text),
    pause: () => controller.pause(),
    resume: () => controller.resume(),
    takeOver: () => controller.takeOver(),
    handBack: () => controller.handBack(),
    stop: () => controller.stop(),
  };
}
