import type { SupportedBrowser } from "../types/browser.js";
import type { TestResult } from "../types/test.js";

/** One test in one browser: what a worker is asked to run */
export interface WorkItem {
  /** Position in the run, so results can be listed in the order the tests were selected */
  index: number;
  /** The spec file, absolute */
  file: string;
  /** The test's full name */
  testName: string;
  browser: SupportedBrowser;
  /** Items with the same key never run at the same time */
  serialKey?: string;
}

/** What a worker needs to start: the project and the settings that are the same for every test */
export interface WorkerInit {
  projectDir: string;
  dataDir?: string;
  environment?: string;
  timeout?: number;
  expectTimeout?: number;
  headless?: boolean;
  /** Where the run's report goes when it is not the default; screenshots are kept beside it */
  reportPath?: string;
  /** Spec files to import, absolute */
  files: string[];
  /** 0 for the first worker; picks the worker's browser port and profile folder */
  workerIndex: number;
  /** The debugging port of worker 0; worker N uses this plus N */
  basePort: number;
}

/** Messages from the pool to a worker */
export type ToWorker =
  | { type: "init"; init: WorkerInit }
  | { type: "run"; id: number; item: WorkItem }
  | { type: "abort" }
  | { type: "exit" };

/** Messages from a worker to the pool */
export type FromWorker =
  | { type: "ready" }
  | { type: "test-start"; id: number }
  | { type: "test-end"; id: number; result: TestResult }
  | { type: "fatal"; message: string };

/** A running worker, whatever it is made of (a child process, or a fake in tests) */
export interface WorkerHandle {
  send(message: ToWorker): void;
  onMessage(listener: (message: FromWorker) => void): void;
  onExit(listener: (code: number | null) => void): void;
  kill(): void;
}

/** Starts a worker; the pool sends the same `init` as a message once the handle exists */
export type WorkerFactory = (init: WorkerInit) => WorkerHandle;
