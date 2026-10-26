import type { SupportedBrowser } from "../types/browser.js";
import type { RunEvent } from "./reporter.js";

/** What decides which tests of the found files run, and how the browser starts */
export interface RunnerOptions {
  /** Spec files to run, absolute or relative to the project folder. Default: every `*.spec.ts` under `srcDir` */
  files?: string[];
  /** Only tests whose full name matches (a string must be contained in it) */
  grep?: string | RegExp;
  /** Only tests with exactly one of these full names (`describe` titles joined with " > ") */
  testNames?: string[];
  /** Only the tests of this group of the config's `groups` (unknown name: an error). Combines with the other filters */
  group?: string;
  /** The browsers to run in, instead of the group's or the project's `browsers` (the command line's `--browser`) */
  browsers?: SupportedBrowser[];
  /**
   * How many tests run at the same time, each in a worker process: a whole number from 1 or a share of the CPUs
   * like `"50%"` (the command line's `--workers`). Beats `SAMURAI_WORKERS` and the config's `workers`.
   * @default the config's `workers`, else half the CPUs
   */
  workers?: number | string;
  /**
   * How many times a failing test is run again, each time with a fresh browser (the command line's `--retries`).
   * Beats `SAMURAI_RETRIES` and the config's `retries`.
   * @default the config's `retries`, else 0
   */
  retries?: number | string;
  /**
   * Values for the inputs the tests declare, by name: every test of the run reads the names it declares from
   * here, and its own default for a name missing here
   */
  inputs?: Record<string, string>;
  /** Run the browser without a window. @default false */
  headless?: boolean;
  /** Remote debugging port of the browser. @default DEFAULT_PORT (9223) */
  port?: number;
  /**
   * The folder for what the run writes, instead of `<project>/result`: `report.json` and the named screenshots
   * (their paths in the results are relative to it). Relative to the project folder.
   * @default `<project>/result`
   */
  outputDir?: string;
  /** Where the report is written; `false` writes none. Beats `outputDir` for the report. @default `report.json` in `outputDir` */
  reportPath?: string | false;
  /** Receives start and end of the run and of every test, as they happen */
  onEvent?: (event: RunEvent) => void;
  /** Aborting stops the running test (its browser is closed), skips the rest and reports the run as failed */
  signal?: AbortSignal;
}
