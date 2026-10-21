import { existsSync } from "node:fs";
import path from "node:path";
import type { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import { loadRawConfig, projectDir } from "../config/config.js";
import { loadSecrets } from "../config/secrets.js";
import { filesFolder, isFolderIgnored } from "../project/index.js";
import { withProject, type ProjectOptions } from "../runner/project.js";
import type { SupportedBrowser } from "../types/browser.js";
import type { RecorderEvent } from "./normalise.js";
import {
  missingFileText,
  type MissingFile,
  type Recorder,
} from "./recorder.js";
import {
  launchRecordingBrowser,
  prepareRecordingBrowser,
} from "./session-browser.js";
import { resultSecrets, toolbarOptions } from "./session-secrets.js";
import { prepareSpec, readSpec, SpecWriter } from "./spec-source.js";

export { pickTest } from "./spec-source.js";
export { resultSecrets, toolbarOptions } from "./session-secrets.js";

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
   * Called once with the recording's first status right after `onStarted` resolves (`{ state: "recording" }`,
   * and `toolbar: false` if the toolbar had already failed to load), then whenever the recording is paused
   * or resumed, or the toolbar fails (or comes back) on a page. Statuses that arrive while `onStarted` runs are held
   * and sent once it resolves, after the first status.
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

type Status = Parameters<NonNullable<RecordSpecOptions["onStatus"]>>[0];

/** What a recording returns; every field is always present, empty when there is nothing to report. */
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
    const existing = readSpec(file, options);
    // Before the spec is touched: a recording without its browser changes nothing
    const browserName = await prepareRecordingBrowser(options);
    const spec = prepareSpec(file, existing, options);
    const { testIndex, at } = spec;
    const writer = new SpecWriter(spec.source, file, testIndex);

    const { browser, page } = await launchRecordingBrowser(browserName, {
      ...options,
      headless: options.headless ?? settings.headless,
    });
    const loaded = await loadRawConfig();
    const folder = filesFolder(projectDir(), loaded.filesDir);
    const hadFolder = existsSync(folder.absolute);
    let recorder: Recorder | undefined;
    const addedSecrets = new Set<string>();
    // Statuses that come while `onStarted` runs wait behind the first one, which is always the first
    let waiting: Status[] | undefined = [];
    let toolbarLoaded = true;
    const onStatus = (status: Status) => {
      toolbarLoaded = status.toolbar;
      if (waiting) waiting.push(status);
      else options.onStatus?.(status);
    };
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
            spec.source,
            projectDir(),
            loaded,
            testIndex,
          )),
          projectDir: projectDir(),
          ...(options.onStatus && { onStatus }),
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
          const text = writer.write(event);
          options.onEvent?.(event, text);
        },
      });
      await options.onStarted?.({ page, browser });
      const queued = waiting ?? [];
      waiting = undefined;
      options.onStatus?.({ state: "recording", toolbar: toolbarLoaded });
      for (const status of queued) options.onStatus?.(status);

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

    const secrets = resultSecrets(writer.events, addedSecrets);
    // Read again: the toolbar may have written new ones to the .env file
    const set = loadSecrets(settings.environment);
    const unsetSecrets = secrets.filter((name) => !set.has(name));
    const files = recorder?.storedFiles ?? [];
    const missingFiles = recorder?.missingFiles ?? [];
    return {
      file,
      test: spec.testName,
      events: writer.events,
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
