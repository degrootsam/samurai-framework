import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import type { SupportedBrowser } from "../types/browser.js";
import type {
  RegisteredTestCase,
  TestAnnotation,
  TestAttachment,
  TestError,
  TestFixtures,
  TestInfo,
} from "../types/test.js";
import { saveAttachment, type AttachInput } from "./attachments.js";
import { isSkipSignal, SkipSignal } from "./skip.js";
import { toTestError } from "./test-error.js";

/** What the running test's info needs of the run */
export interface TestInfoSources {
  test: RegisteredTestCase;
  browserName: SupportedBrowser;
  workerIndex: number;
  /** The attempt, counting from 0 */
  retry: number;
  settings: { baseURL: string | undefined; timeout: number };
  /** The run's result folder: attachment paths in the report are relative to it */
  resultDir: string;
  outputDir: string;
}

/** What a report entry lists from the info, besides the rest of its extras */
export interface InfoReportExtras {
  attachments?: { name: string; contentType: string; path: string }[];
  annotations?: TestAnnotation[];
}

/** The `TestInfo` of one attempt of a test. The runner creates it, the test only reads it. */
export class TestInfoImpl implements TestInfo {
  public readonly title: string;
  public readonly titlePath: string[];
  public readonly file: string;
  public readonly line?: number;
  public readonly column?: number;
  public readonly retry: number;
  public readonly workerIndex: number;
  public readonly project: { name: string };
  public readonly config: { baseURL: string | undefined; timeout: number };
  public annotations: TestAnnotation[] = [];
  public readonly expectedStatus = "passed" as const;
  public readonly errors: TestError[] = [];
  public readonly outputDir: string;
  private readonly saved: TestAttachment[] = [];
  private readonly used = new Set<string>();
  private readonly started = Date.now();
  private ended: number | undefined;
  private result: TestInfo["status"];
  private readonly resultDir: string;

  constructor(from: TestInfoSources) {
    const { test } = from;
    this.title = test.titlePath[test.titlePath.length - 1] ?? test.name;
    this.titlePath = [...test.titlePath];
    this.file = test.file;
    if (test.line !== undefined) this.line = test.line;
    if (test.column !== undefined) this.column = test.column;
    this.retry = from.retry;
    this.workerIndex = from.workerIndex;
    this.project = { name: from.browserName };
    this.config = { ...from.settings };
    this.resultDir = from.resultDir;
    this.outputDir = from.outputDir;
  }

  public get status(): TestInfo["status"] {
    return this.result;
  }

  public get duration(): number {
    return (this.ended ?? Date.now()) - this.started;
  }

  public get attachments(): readonly TestAttachment[] {
    return this.saved;
  }

  public async attach(name: string, options: AttachInput): Promise<void> {
    this.saved.push(
      await saveAttachment(this.outputDir, this.used, name, options),
    );
  }

  /** The body (with its `beforeEach` hooks) ended: `error` is what it threw, if anything. Runs before the `afterEach` hooks. */
  public bodyDone(error: unknown): void {
    this.ended = Date.now();
    if (error === undefined) this.result = "passed";
    else if (isSkipSignal(error)) this.result = "skipped";
    else {
      this.result = "failed";
      this.errors.push(toTestError(error));
    }
  }

  /** The fields a report entry adds for this attempt: nothing when there is nothing to list */
  public reportExtras(): InfoReportExtras {
    return {
      ...(this.saved.length > 0 && {
        attachments: this.saved.map((a) => ({
          name: a.name,
          contentType: a.contentType,
          path: path.relative(this.resultDir, a.path).split(path.sep).join("/"),
        })),
      }),
      ...(this.annotations.length > 0 && {
        annotations: this.annotations.map((a) => ({ ...a })),
      }),
    };
  }
}

/** The running test: its info and its fixtures (a condition function of `test.skip` gets them) */
export interface TestScope {
  info: TestInfo;
  fixtures: TestFixtures;
}

const scopes = new AsyncLocalStorage<TestScope>();

/** Runs `fn` (the body and hooks of one test) so that `test.info()` and `test.skip(fn)` find the test */
export function runInTestScope<T>(scope: TestScope, fn: () => T): T {
  return scopes.run(scope, fn);
}

/** `test.info()` */
export function currentTestInfo(): TestInfo {
  const scope = scopes.getStore();
  if (!scope) throw new Error("info(): no test is running");
  return scope.info;
}

/**
 * `test.skip(condition, reason)` and `test.fixme(...)` from inside a test or its hooks: throws the skip signal
 * when `condition` is true, or when it is a function and returns something truthy. The function gets the
 * test's fixtures and must be synchronous.
 */
export function skipFromCondition(
  annotation: "skip" | "fixme",
  condition: boolean | ((fixtures: TestFixtures) => boolean),
  reason?: string,
): void {
  let skip: unknown = condition;
  if (typeof condition === "function") {
    const scope = scopes.getStore();
    if (!scope)
      throw new Error(
        `test.${annotation}(): a condition function needs a running test`,
      );
    skip = condition(scope.fixtures);
    if (skip instanceof Promise) {
      skip.catch(() => {});
      throw new Error(
        `test.${annotation}(): the condition function must be synchronous`,
      );
    }
  }
  if (skip) throw new SkipSignal(annotation, reason);
}
