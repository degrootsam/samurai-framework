import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import { projectDir } from "../config/config.js";
import { withProject, type ProjectOptions } from "../runner/project.js";
import { parseSpec } from "../steps/parse.js";
import { applyRecorderEvent } from "./apply.js";
import type { RecorderEvent } from "./normalise.js";

export interface RecordSpecOptions extends ProjectOptions {
  /** The spec file, absolute or relative to the project folder. Created when `create` is given and it doesn't exist */
  file: string;
  /** The test to record into: its full name (or a part that is unique), or its index in the file. Optional when the file has one test */
  test?: string | number;
  /** Add a test with this title to the file (and create the file) instead of recording into an existing one */
  create?: string;
  /**
   * Index the first recorded step gets. @default after the last step of the test.
   * The browser starts on `url` (or the base URL), not where steps `0…at-1` would leave it
   */
  at?: number;
  /** The page to start on. @default the environment's base URL; without one the browser starts blank */
  url?: string;
  /** The browser's debugging port. @default 9223 */
  port?: number;
  /** Run the browser without a window. A person can't use it then; for tests and machines without a display. @default the config's `use.headless`, else headless on CI and a window otherwise */
  headless?: boolean;
  /** Aborting ends the recording, like closing the browser window */
  signal?: AbortSignal;
  /** Called after each step is written to the file, with the file's new content */
  onEvent?: (event: RecorderEvent, source: string) => void;
  /** Called once the browser is open and recording */
  onStarted?: (context: {
    page: Page;
    browser: Browser;
  }) => void | Promise<void>;
}

export interface RecordResult {
  file: string;
  /** Full name of the test the steps went into */
  test: string;
  events: RecorderEvent[];
  /** Names the recorded steps read with `secrets.<NAME>`: they must be set before the test can run */
  secrets: string[];
}

const NEW_SPEC_HEADER = `import { expect, test } from "@itmetsam/samurai-framework";\n\n`;

function addTest(source: string, title: string): string {
  const header =
    source.trim() === ""
      ? NEW_SPEC_HEADER
      : `${source.replace(/\s*$/, "")}\n\n`;
  return `${header}test(${JSON.stringify(title)}, async ({ page }) => {\n});\n`;
}

/** The index of the test `selector` names (see `RecordSpecOptions.test`) */
export function pickTest(
  tests: readonly { name: string }[],
  selector: string | number | undefined,
): number {
  if (tests.length === 0)
    throw new Error(
      "The file has no tests; give a title with --new to add one",
    );
  if (selector === undefined) {
    if (tests.length === 1) return 0;
    throw new Error(
      `The file has ${tests.length} tests; choose one with --test:\n${tests.map((t) => `  ${t.name}`).join("\n")}`,
    );
  }
  if (typeof selector === "number") {
    if (
      !Number.isInteger(selector) ||
      selector < 0 ||
      selector >= tests.length
    ) {
      throw new Error(
        `There is no test ${selector}; the file has ${tests.length}`,
      );
    }
    return selector;
  }
  const exact = tests.findIndex((t) => t.name === selector);
  if (exact !== -1) return exact;
  const partial = tests.flatMap((t, index) =>
    t.name.includes(selector) ? [index] : [],
  );
  if (partial.length === 1) return partial[0]!;
  throw new Error(
    partial.length === 0
      ? `No test matches "${selector}". Tests:\n${tests.map((t) => `  ${t.name}`).join("\n")}`
      : `"${selector}" matches ${partial.length} tests; use the full name`,
  );
}

/**
 * Opens a browser window and records what the person does into a spec file, step by step, until `signal`
 * aborts or the window is closed. Every step is written to the file as it happens, as a minimal edit.
 * @example
 *  await recordSpec({ file: "tests/login.spec.ts", create: "signs in", environment: "staging" });
 */
export async function recordSpec(
  options: RecordSpecOptions,
): Promise<RecordResult> {
  return withProject(options, async ({ settings }) => {
    const file = path.resolve(projectDir(), options.file);
    let source = existsSync(file) ? readFileSync(file, "utf8") : undefined;
    if (source === undefined && options.create === undefined) {
      throw new Error(
        `${options.file} does not exist; give a title with --new to create it`,
      );
    }
    source ??= "";
    if (
      options.create !== undefined &&
      !parseSpec(source).some((t) => t.name === options.create)
    ) {
      source = addTest(source, options.create);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, source);
    }

    const tests = parseSpec(source);
    const testIndex = pickTest(tests, options.create ?? options.test);
    const test = tests[testIndex]!;
    const at = options.at ?? test.steps.length;
    if (!Number.isInteger(at) || at < 0 || at > test.steps.length) {
      throw new RangeError(
        `--at must be between 0 and ${test.steps.length} (the test has ${test.steps.length} steps)`,
      );
    }

    const { browser, page } = await Browser.launch(
      "firefox",
      {
        port: options.port ?? 9223,
        headless: options.headless ?? settings.headless,
      },
      options.signal,
    );
    const events: RecorderEvent[] = [];
    try {
      const start = options.url ?? settings.baseURL;
      if (options.url !== undefined) await page.goto(options.url);
      else if (settings.baseURL !== undefined)
        await page.navigateTo(settings.baseURL);
      const recorder = await page.record({
        at,
        initialGoto: at === 0 && start !== undefined,
        ...(settings.baseURL !== undefined && { baseURL: settings.baseURL }),
        onEvent: (event) => {
          source = applyRecorderEvent(source!, testIndex, event);
          writeFileSync(file, source);
          events.push(event);
          options.onEvent?.(event, source);
        },
      });
      await options.onStarted?.({ page, browser });

      let windowClosed = false;
      void browser.exited.then(() => (windowClosed = true));
      await new Promise<void>((resolve) => {
        if (options.signal?.aborted) return resolve();
        options.signal?.addEventListener("abort", () => resolve(), {
          once: true,
        });
        void browser.exited.then(resolve);
      });
      // With the window gone there is nothing to ask: what was reported before is in the file
      if (!windowClosed) await recorder.stop().catch(() => undefined);
    } finally {
      await browser.close().catch(() => undefined);
    }

    const secrets = [
      ...new Set(
        events.flatMap(({ step }) =>
          step.kind === "fill" && step.value.kind === "secret"
            ? [step.value.name]
            : [],
        ),
      ),
    ];
    return { file, test: test.name, events, secrets };
  });
}
