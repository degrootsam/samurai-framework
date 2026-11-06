import type Page from "../browser/page.js";
import { generatedFile } from "../browser/generated-files.js";
import { maskText } from "../config/mask.js";
import { stepToSource } from "../steps/emit.js";
import { locatorFromSpec } from "../steps/build.js";
import type { FileEntry, Step, TextValue } from "../steps/model.js";

/** What replaying steps needs from the run: where values come from and how long an action may wait */
export interface ReplayContext {
  /** Time (ms) an action waits for its element */
  timeout: number;
  /** The environment's variables, by name (`env.NAME` in a spec) */
  variables: Readonly<Record<string, string | number | boolean>>;
  /** The value of a secret in the run's environment; undefined when it has none. Never shown or sent anywhere */
  secret(name: string): string | undefined;
  /** The test's declared inputs with their defaults, by name */
  inputs: Readonly<Record<string, string>>;
  /** Called before each step that is replayed, with its 1-based number, the total and its statement */
  onStep?(n: number, total: number, text: string): void;
}

/** Step kinds that only check or save evidence: replay skips them, the page is not changed by them */
const SKIPPED: ReadonlySet<Step["kind"]> = new Set([
  "expect",
  "expectPage",
  "saveOutput",
  "screenshot",
]);

function textOf(value: TextValue, ctx: ReplayContext): string {
  switch (value.kind) {
    case "literal":
      return value.value;
    case "env": {
      const found = ctx.variables[value.name];
      if (found === undefined)
        throw new Error(`env.${value.name} is not defined`);
      return String(found);
    }
    case "secret": {
      const found = ctx.secret(value.name);
      if (found === undefined || found === "")
        throw new Error(`secrets.${value.name} has no value`);
      return found;
    }
    case "input": {
      const found = ctx.inputs[value.name];
      if (found === undefined)
        throw new Error(`inputs.${value.name} is not declared by the test`);
      return found;
    }
  }
}

function filesOf(files: readonly FileEntry[]) {
  return files.map((file) =>
    "path" in file
      ? file.path
      : generatedFile({
          name: file.generate.name,
          size: file.generate.size,
          ...(file.generate.type !== undefined && {
            type: file.generate.type,
          }),
        }),
  );
}

async function perform(
  page: Page,
  step: Step,
  ctx: ReplayContext,
): Promise<void> {
  const options = { timeout: ctx.timeout };
  switch (step.kind) {
    case "goto":
      await page.goto(step.url);
      return;
    case "click":
      return locatorFromSpec(page, step.locator).click(options);
    case "check":
    case "uncheck":
    case "hover":
    case "dblclick":
    case "clear":
      return locatorFromSpec(page, step.locator)[step.kind](options);
    case "selectOption":
      await locatorFromSpec(page, step.locator).selectOption(
        step.option,
        options,
      );
      return;
    case "fill":
      return locatorFromSpec(page, step.locator).fill(
        textOf(step.value, ctx),
        options,
      );
    case "press":
      return locatorFromSpec(page, step.locator).press(step.key, options);
    case "waitForNetworkIdle":
      await page.waitForNetworkIdle();
      return;
    case "waitForTimeout":
      return page.waitForTimeout(step.ms);
    case "setInputFiles":
      return locatorFromSpec(page, step.locator).setInputFiles(
        filesOf(step.files),
        options,
      );
    case "dropFiles":
      return locatorFromSpec(page, step.locator).dropFiles(
        filesOf(step.files),
        options,
      );
    default:
      throw new Error("cannot be replayed");
  }
}

/** The first lines of an error message, without a long call log */
function reasonOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .slice(0, 3)
    .join(" ");
}

/**
 * Plays typed steps on the live page, in order and without a model: the actions (`goto`, `click`, `fill`, `press`,
 * `selectOption`, `check`, `uncheck`, `hover`, `dblclick`, `clear`, `setInputFiles`, `dropFiles`) and the waits.
 * Assertions and evidence (`expect`, `expectPage`, `saveOutput`, `screenshot`) are skipped: they do not change the
 * page. A `custom` step is code the framework cannot play, so it stops the replay. A step that fails throws an
 * error naming its number and statement, with secret values masked. Fixtures are not set up.
 */
export async function replaySteps(
  page: Page,
  steps: readonly Step[],
  ctx: ReplayContext,
): Promise<void> {
  const custom = steps.findIndex((step) => step.kind === "custom");
  if (custom >= 0)
    throw new Error(`step ${custom + 1} is custom code and cannot be replayed`);
  for (const [index, step] of steps.entries()) {
    const n = index + 1;
    const text = stepToSource(step);
    if (SKIPPED.has(step.kind)) continue;
    ctx.onStep?.(n, steps.length, text);
    try {
      await perform(page, step, ctx);
    } catch (error) {
      throw new Error(
        maskText(`step ${n} (${text}) failed: ${reasonOf(error)}`),
      );
    }
  }
}
