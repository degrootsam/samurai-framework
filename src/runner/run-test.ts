import path from "path";
import { takePendingAssertions } from "../assert/expect.js";
import { Browser } from "../browser/browser.js";
import { Evidence } from "../browser/evidence.js";
import type Page from "../browser/page.js";
import { projectDir, readConfig } from "../config/config.js";
import { createSecretsFixture } from "../config/secrets.js";
import { createEnvFixture } from "../config/variables.js";
import logger from "../logger/index.js";
import { ConnectionClosedError } from "../transport/bidi-connection.js";
import type { SupportedBrowser } from "../types/browser.js";
import type {
  RegisteredTestCase,
  TestError,
  TestFixtures,
  TestLogEntry,
} from "../types/test.js";
import type { RunnerOptions } from "./options.js";
import { judgePageLogs, type LogsConfig } from "./page-logs-report.js";
import { DEFAULT_PORT } from "./ports.js";
import type { PreparedRun } from "./prepare-run.js";
import type { TestSink } from "./reporter.js";
import { testDirOf } from "./test-dir.js";
import { toTestError } from "./test-error.js";

type Logs = { logs?: TestLogEntry[]; logsDropped?: number };

/**
 * The state of one test run. A test ends once, whichever of finishing, failing, timing out, an abort or a
 * closed browser comes first: that one is reported and the rest are ignored.
 */
class TestOutcome {
  /** The test has been reported: later calls to `finish` do nothing */
  private ended = false;
  /** The runner itself is closing the browser: its exit is expected and is not a failure */
  public closing = false;
  /** A person closed the browser, or it crashed, while the test ran */
  public browserClosed = false;
  /** The named screenshots of the test, listed in its report entry */
  public evidence: Evidence | undefined;

  constructor(
    private readonly reporter: TestSink,
    private readonly test: RegisteredTestCase,
    private readonly browser: SupportedBrowser,
  ) {}

  public get isEnded(): boolean {
    return this.ended;
  }

  public finish(error?: TestError, logs?: Logs): void {
    if (this.ended) return;
    this.ended = true;
    this.reporter.onTestEnd(this.test, this.browser, error, {
      ...logs,
      screenshots: this.evidence?.screenshots,
    });
  }
}

/** What a worker gives its tests that the main process does not: its own port and profile, and its number */
export interface WorkerResources {
  /** The browser's debugging port. @default `options.port`, else DEFAULT_PORT */
  port?: number;
  /** The browser's profile folder. @default the browser's own */
  profileDir?: string;
  /** The `workerIndex` fixture. @default 0 */
  workerIndex?: number;
}

/** Runs one test in one browser and reports it: launch, run the body, judge the page's logs, close the browser */
export async function runOneTest(
  test: RegisteredTestCase,
  browserName: SupportedBrowser,
  run: PreparedRun,
  options: RunnerOptions,
  srcDir: string,
  reporter: TestSink,
  resources: WorkerResources = {},
): Promise<void> {
  logger.verbose("Starting test: %s in %s", test.name, browserName);
  reporter.onTestStart(test, browserName);
  const outcome = new TestOutcome(reporter, test, browserName);
  const { settings, secrets } = run;
  const timeout = settings.timeout;
  const { reportPath } = options;
  const resultDir =
    typeof reportPath === "string"
      ? path.dirname(reportPath)
      : path.join(projectDir(), "result");

  let browser: Browser | undefined;
  let page: Page | undefined;
  let timeoutTimer: NodeJS.Timeout | undefined;
  let onRunAborted: (() => void) | undefined;
  const timeoutController = new AbortController();
  let browserGone: () => void = () => {};

  /** Resolves when the time is up or the run is aborted; the test is reported failed then */
  const limit = new Promise<void>((resolve) => {
    timeoutTimer = setTimeout(() => {
      outcome.finish({
        message: `Test timed out after ${timeout / 1000} seconds`,
        type: "timeout",
      });
      timeoutController.abort(new Error("Test timed out"));
      resolve();
    }, timeout);
    onRunAborted = () => {
      if (timeoutController.signal.aborted) return;
      outcome.finish({ message: "Run aborted", type: "error" });
      timeoutController.abort(new Error("Run aborted"));
      resolve();
    };
    options.signal?.addEventListener("abort", onRunAborted, { once: true });
  });

  /** Resolves when the browser exits on its own while the test runs */
  const gone = new Promise<void>((resolve) => (browserGone = resolve));

  /** Launches the browser, runs the test body and reports how it went */
  const runBody = async (): Promise<void> => {
    try {
      const launched = await Browser.launch(
        browserName,
        {
          port: resources.port ?? options.port ?? DEFAULT_PORT,
          ...(resources.profileDir && { profileDir: resources.profileDir }),
          headless: options.headless ?? settings.headless,
        },
        timeoutController.signal,
      );
      browser = launched.browser;
      // A person closing the window, or the browser crashing: end the test now instead of waiting for a
      // command to time out
      void launched.browser.exited.then(() => {
        if (outcome.isEnded || outcome.closing) return;
        outcome.browserClosed = true;
        outcome.finish({
          message: "The browser was closed while the test was running",
          type: "error",
        });
        timeoutController.abort(new Error("Browser closed"));
        browserGone();
      });
      page = launched.page;
      outcome.evidence = new Evidence(
        resultDir,
        `${browserName}/${testDirOf(test, srcDir)}`,
      );
      launched.page.setEvidence(outcome.evidence);
      const fixtures: TestFixtures = {
        page: launched.page,
        browser: launched.browser,
        browserName,
        workerIndex: resources.workerIndex ?? 0,
        env: createEnvFixture(settings.environment, settings.variables),
        secrets: createSecretsFixture(settings.environment, secrets),
      };
      await test.function(fixtures);
      // Already reported as timed out
      if (timeoutController.signal.aborted) return;
      const unawaited = takePendingAssertions();
      if (unawaited.length > 0) {
        outcome.finish(
          {
            message: unawaited
              .map((matcher) => `expect(locator).${matcher}() was not awaited`)
              .join("\n"),
            type: "assertion",
          },
          await judgeLogs(page, true),
        );
        return;
      }
      const verdict = await judgeLogs(page, false);
      outcome.finish(verdict.error, verdict);
    } catch (err) {
      if (timeoutController.signal.aborted) return;
      outcome.finish(
        outcome.browserClosed || err instanceof ConnectionClosedError
          ? {
              message: "The browser was closed while the test was running",
              type: "error",
            }
          : toTestError(err),
        await judgeLogs(page, true),
      );
    }
  };

  await Promise.race([limit, gone, runBody()]);

  clearTimeout(timeoutTimer);
  if (onRunAborted) options.signal?.removeEventListener("abort", onRunAborted);
  takePendingAssertions();
  logger.verbose("Closing browser for test: %s", test.name);
  outcome.closing = true;
  await browser?.close();
}

/** Reads the page's log once the test body is done and applies config `logs` (see judgePageLogs) */
async function judgeLogs(page: Page | undefined, testFailed: boolean) {
  if (!page) return {};
  try {
    // Events and command replies share one ordered connection: after this, everything logged so far is in
    await page.syncLogs();
  } catch (err) {
    logger.debug("Could not sync the page's logs", { err });
  }
  let config: LogsConfig | undefined;
  try {
    config = await readConfig("logs");
  } catch (err) {
    logger.debug("Could not read logs config, using defaults", { err });
  }
  return judgePageLogs({
    config,
    entries: page.getLogs(),
    errors: page.pageErrors(),
    dropped: page.logsDropped,
    testFailed,
    allowPageErrors: page.pageErrorsAllowed,
    routeErrors: page.routeErrors(),
  });
}
