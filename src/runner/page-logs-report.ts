import type { LogRecord, PageError } from "../browser/page-logs.js";
import type { SamuraiTestConfig } from "../types/config.js";
import type { TestError } from "../types/test.js";
import { toTestError } from "./test-error.js";

/** Config `logs` */
export type LogsConfig = NonNullable<SamuraiTestConfig["logs"]>;

/** The page threw exceptions nobody caught, and config `logs.failOnPageError` says that fails the test */
export class PageErrorsError extends Error {
  public readonly errors: readonly PageError[];

  constructor(errors: readonly PageError[]) {
    super(`${errors.length} uncaught page error(s): ${errors.map((error) => error.message).join("\n")}`);
    this.name = "PageErrorsError";
    this.errors = errors;
  }
}

/** A route handler threw: the test's mocks did not do what the test meant */
export class RouteErrorsError extends Error {
  public readonly errors: readonly Error[];

  constructor(errors: readonly Error[]) {
    super(`${errors.length} route handler error(s): ${errors.map((error) => error.message).join("\n")}`);
    this.name = "RouteErrorsError";
    this.errors = errors;
  }
}

export interface PageLogsInput {
  config: LogsConfig | undefined;
  entries: readonly LogRecord[];
  errors: readonly PageError[];
  /** How many entries the page's buffer dropped */
  dropped: number;
  /** The test body already failed (or timed out) */
  testFailed: boolean;
  /** The test called `page.allowPageErrors()` */
  allowPageErrors: boolean;
  /** Errors thrown by `page.route` handlers; they fail a passing test */
  routeErrors?: readonly Error[];
}

export interface PageLogsVerdict {
  /** Set when a test that passed has to fail because of page errors */
  error?: TestError;
  /** The entries to put in the report, per `logs.capture` */
  logs?: LogRecord[];
  logsDropped?: number;
}

function isIgnored(error: PageError, ignore: readonly (string | RegExp)[]): boolean {
  return ignore.some((pattern) =>
    typeof pattern === "string" ? error.message.includes(pattern) : pattern.test(error.message),
  );
}

/**
 * Decides, once a test body is done, whether page errors fail it and which log entries go in the report:
 * `capture` "failures" (default) attaches them to failed tests, "all" always, "off" never.
 */
export function judgePageLogs(input: PageLogsInput): PageLogsVerdict {
  const { config, entries, errors, dropped, testFailed, allowPageErrors, routeErrors = [] } = input;
  const capture = config?.capture ?? "failures";

  let error: TestError | undefined;
  if (routeErrors.length > 0 && !testFailed) {
    error = toTestError(new RouteErrorsError(routeErrors));
  } else if (config?.failOnPageError && !testFailed && !allowPageErrors) {
    const counted = errors.filter((pageError) => !isIgnored(pageError, config.ignoreErrors ?? []));
    if (counted.length > 0) error = toTestError(new PageErrorsError(counted));
  }

  const failed = testFailed || error !== undefined;
  const attach = capture === "all" || (capture === "failures" && failed);
  return {
    ...(error && { error }),
    ...(attach && { logs: [...entries] }),
    ...(attach && dropped > 0 && { logsDropped: dropped }),
  };
}
