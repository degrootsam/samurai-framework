import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import { ensureWarm } from "../browser/warm-up.js";
import { browsersFor } from "../runner/browsers.js";
import { DEFAULT_PORT } from "../runner/ports.js";
import type { SupportedBrowser } from "../types/browser.js";
import { loadConfig, projectDir, readConfig } from "../config/config.js";
import { loadSecrets } from "../config/secrets.js";
import {
  filesFolder,
  isFolderIgnored,
  isGitIgnored,
} from "../project/index.js";
import type { PreparedRun } from "../runner/prepare-run.js";
import { withProject, type ProjectOptions } from "../runner/project.js";
import type { SamuraiTestConfig } from "../types/config.js";
import type { ControllerOptions } from "./toolbar/controller.js";
import { parseSpec } from "../steps/parse.js";
import { applyRecorderEvent } from "./apply.js";
import type { RecorderEvent } from "./normalise.js";
import {
  missingFileText,
  type MissingFile,
  type Recorder,
} from "./recorder.js";

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
  /** The browser to record in. @default the first of the config's `browsers`, else Firefox */
  browser?: SupportedBrowser;
  /** The browser's debugging port. @default DEFAULT_PORT (9223) */
  port?: number;
  /** Run the browser without a window. A person can't use it then; for tests and machines without a display. @default the config's `use.headless`, else headless on CI and a window otherwise */
  headless?: boolean;
  /** Aborting ends the recording, like closing the browser window */
  signal?: AbortSignal;
  /** Called after each step is written to the file, with the file's new content */
  onEvent?: (event: RecorderEvent, source: string) => void;
  /**
   * Called when the recording is paused or resumed, or the toolbar fails (or comes back) on a page.
   * There is no initial call: until the first one the recording is `{ state: "recording", toolbar: true }`
   */
  onStatus?: (status: {
    state: "recording" | "paused";
    toolbar: boolean;
  }) => void;
  /** A picked or dropped file wasn't saved (over 50 MB, or unreadable); `text` is the warning to show */
  onMissingFile?: (file: MissingFile, text: string) => void;
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
  /** Those of `secrets` that have no value in the recording's environment yet, read when the recording ended */
  unsetSecrets: string[];
  /** Files stored in (or reused from) the files folder, project-relative */
  files: string[];
  /** Files the steps point at that weren't saved: they must be added before the test can run */
  missingFiles: MissingFile[];
  /** The files folder is git-ignored: CI won't have the files */
  filesIgnored: boolean;
  /** The files folder, relative to the project with forward slashes ("" for the project root) */
  filesFolder: string;
  /** The files folder was created by this recording */
  firstFiles: boolean;
}

const NEW_SPEC_HEADER = `import { expect, test } from "@itmetsam/samurai-framework";\n\n`;

function addTest(source: string, title: string): string {
  const header =
    source.trim() === ""
      ? NEW_SPEC_HEADER
      : `${source.replace(/\s*$/, "")}\n\n`;
  return `${header}test(${JSON.stringify(title)}, async ({ page }) => {\n});\n`;
}

/** Every `secrets.<NAME>` a parsed value contains, at any depth */
function secretNames(node: unknown, found: Set<string>): void {
  if (Array.isArray(node)) node.forEach((item) => secretNames(item, found));
  else if (node !== null && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (record.kind === "secret" && typeof record.name === "string")
      found.add(record.name);
    Object.values(record).forEach((item) => secretNames(item, found));
  }
}

/** What the toolbar shows of the project: its environment, variables, secrets and the test's screenshots */
export async function toolbarOptions(
  run: Pick<PreparedRun, "settings" | "secrets">,
  source: string,
  dir: string,
  config: Pick<SamuraiTestConfig, "environments">,
  testIndex: number,
): Promise<ControllerOptions> {
  const tests = parseSpec(source);
  const names = new Set(run.secrets.keys());
  secretNames(tests, names);
  const secrets: Record<string, string | undefined> = {};
  for (const name of names) secrets[name] = run.secrets.get(name);
  const { environment } = run.settings;
  return {
    environment,
    canAddVariables: typeof config.environments === "object",
    variables: run.settings.variables,
    secrets,
    secretsIgnored: await isGitIgnored(dir, `.env.${environment}`),
    screenshots:
      tests[testIndex]?.steps.filter(({ step }) => step.kind === "screenshot")
        .length ?? 0,
  };
}

/** The secrets a recording needs set: those its steps read, then those added from the panel, once each */
export function resultSecrets(
  events: readonly RecorderEvent[],
  added: Iterable<string>,
): string[] {
  return [
    ...new Set([
      ...events.flatMap((event) =>
        event.op !== "remove" &&
        event.step.kind === "fill" &&
        event.step.value.kind === "secret"
          ? [event.step.value.name]
          : [],
      ),
      ...added,
    ]),
  ];
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
  return withProject(options, async (run) => {
    const { settings } = run;
    const file = path.resolve(projectDir(), options.file);
    let source = existsSync(file) ? readFileSync(file, "utf8") : undefined;
    if (source === undefined && options.create === undefined) {
      throw new Error(
        `${options.file} does not exist; give a title with --new to create it`,
      );
    }
    // Before the spec is touched: a recording without its browser changes nothing
    // Recording in two browsers at once makes no sense: the first of the project's, or the one asked for
    const browserName =
      options.browser ??
      browsersFor({ project: await readConfig("browsers") })[0]!;
    await ensureWarm(
      browserName,
      { port: options.port ?? DEFAULT_PORT },
      options.signal,
    );
    options.signal?.throwIfAborted();
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
      browserName,
      {
        port: options.port ?? DEFAULT_PORT,
        headless: options.headless ?? settings.headless,
      },
      options.signal,
    );
    const loaded = await loadConfig();
    const folder = filesFolder(projectDir(), loaded.filesDir);
    const hadFolder = existsSync(folder.absolute);
    let recorder: Recorder | undefined;
    const events: RecorderEvent[] = [];
    const addedSecrets = new Set<string>();
    let stopRequested!: () => void;
    const stopped = new Promise<void>((resolve) => (stopRequested = resolve));
    try {
      const start = options.url ?? settings.baseURL;
      if (options.url !== undefined) await page.goto(options.url);
      else if (settings.baseURL !== undefined)
        await page.navigateTo(settings.baseURL);
      recorder = await page.record({
        at,
        initialGoto: at === 0 && start !== undefined,
        ...(settings.baseURL !== undefined && { baseURL: settings.baseURL }),
        toolbar: {
          ...(await toolbarOptions(
            run,
            source,
            projectDir(),
            loaded,
            testIndex,
          )),
          projectDir: projectDir(),
          ...(options.onStatus && { onStatus: options.onStatus }),
          onSecretAdded: (name) => addedSecrets.add(name),
          onStop: () => stopRequested(),
        },
        files: {
          projectDir: projectDir(),
          ...(loaded.filesDir !== undefined && { filesDir: loaded.filesDir }),
          onMissing: (file) =>
            options.onMissingFile?.(
              file,
              missingFileText(file, folder.relative),
            ),
        },
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
        void stopped.then(resolve);
      });
      // With the window gone there is nothing to ask: what was reported before is in the file
      if (!windowClosed) await recorder.stop().catch(() => undefined);
    } finally {
      await browser.close().catch(() => undefined);
    }

    const secrets = resultSecrets(events, addedSecrets);
    // Read again: the toolbar may have written new ones to the .env file
    const set = loadSecrets(settings.environment);
    const unsetSecrets = secrets.filter((name) => !set.has(name));
    const files = recorder?.storedFiles ?? [];
    const missingFiles = recorder?.missingFiles ?? [];
    return {
      file,
      test: test.name,
      events,
      secrets,
      unsetSecrets,
      files,
      missingFiles,
      filesFolder: folder.relative,
      filesIgnored:
        files.length + missingFiles.length > 0 &&
        (await isFolderIgnored(projectDir(), folder.relative)),
      firstFiles: !hadFolder && files.length > 0,
    };
  });
}
