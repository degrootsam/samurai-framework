import { fileURLToPath } from "node:url";
import type { RegisteredTestCase, TestResult } from "../types/test.js";
import type { SupportedBrowser } from "../types/browser.js";
import type { RunEvent } from "./reporter.js";
import type {
  FromWorker,
  ToWorker,
  WorkerInit,
  WorkItem,
} from "./worker-protocol.js";

/** A project opened in this process, with its specs imported once */
export interface WorkerSession {
  tests: readonly RegisteredTestCase[];
  /** Runs one test; `onEvent` gets the reporter's events for it. Aborting `signal` ends the test as aborted */
  runTest(
    test: RegisteredTestCase,
    browser: SupportedBrowser,
    signal: AbortSignal,
    onEvent: (event: RunEvent) => void,
    options?: { outputDir?: string; inputs?: Record<string, string> },
  ): Promise<void>;
  /** Ends the project's session */
  close(): Promise<void>;
}

export interface WorkerDeps {
  open(init: WorkerInit): Promise<WorkerSession>;
  exit(): void;
}

/** Where messages come from and go to: the IPC channel of the process, or a stand-in in tests */
export interface WorkerChannel {
  send(message: FromWorker): void;
  onMessage(listener: (message: ToWorker) => void): void;
}

const failedResult = (
  item: WorkItem,
  worker: number,
  message: string,
): TestResult => ({
  name: item.testName,
  file: item.file,
  browser: item.browser,
  worker,
  status: "failed",
  startTime: performance.now(),
  duration: 0,
  message,
  type: "error",
});

/**
 * Answers the pool's messages: opens the project on `init`, runs the tests it is sent one at a time, aborts
 * the running one on `abort` and leaves on `exit`. Whatever goes wrong outside a test is reported as `fatal`.
 */
export function handleMessages(
  channel: WorkerChannel,
  { open, exit }: WorkerDeps,
): void {
  let session: WorkerSession | undefined;
  let workerIndex = 0;
  let current: AbortController | undefined;
  // Messages other than `abort` are handled in the order they arrive, each after the one before it
  let queue: Promise<void> = Promise.resolve();

  const init = async (message: WorkerInit) => {
    workerIndex = message.workerIndex;
    session = await open(message);
    channel.send({ type: "ready" });
  };

  const run = async (id: number, item: WorkItem) => {
    if (!session)
      throw new Error("The worker was sent a test before it was initialised");
    channel.send({ type: "test-start", id });
    const test = session.tests.find(
      ({ file, name }) => file === item.file && name === item.testName,
    );
    if (!test) {
      const message = `Test "${item.testName}" was not found in ${item.file}`;
      channel.send({
        type: "test-end",
        id,
        result: failedResult(item, workerIndex, message),
      });
      return;
    }
    let ended = false;
    current = new AbortController();
    try {
      await session.runTest(
        test,
        item.browser,
        current.signal,
        (event) => {
          // The first start was sent above; a test run again starts again, saying which attempt
          if (event.type === "test-start" && event.retry)
            channel.send({ type: "test-start", id, retry: event.retry });
          if (event.type !== "test-end") return;
          ended = true;
          channel.send({
            type: "test-end",
            id,
            result: { ...event.result, worker: workerIndex },
          });
        },
        {
          ...(item.outputDir !== undefined && { outputDir: item.outputDir }),
          ...(item.inputs !== undefined && { inputs: item.inputs }),
        },
      );
    } finally {
      current = undefined;
    }
    if (!ended) {
      const message = "The test ended without a result";
      channel.send({
        type: "test-end",
        id,
        result: failedResult(item, workerIndex, message),
      });
    }
  };

  const leave = async () => {
    await session?.close();
    exit();
  };

  const enqueue = (work: () => Promise<void>) => {
    queue = queue.then(work).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      channel.send({ type: "fatal", message });
    });
  };

  channel.onMessage((message) => {
    switch (message.type) {
      case "init":
        return enqueue(() => init(message.init));
      case "run":
        return enqueue(() => run(message.id, message.item));
      case "abort":
        return current?.abort(new Error("Run aborted"));
      case "exit":
        return enqueue(leave);
    }
  });
}

/** Runs as the child process the pool forks: messages arrive over the IPC channel */
async function main(): Promise<void> {
  // Specs are TypeScript. Under tsx (from the sources) this is already so; from `dist/` tsx is registered here
  if (!process.execArgv.some((arg) => arg.includes("tsx"))) {
    try {
      const { register } = await import("tsx/esm/api");
      register();
    } catch (err) {
      if ((err as { code?: string }).code !== "ERR_MODULE_NOT_FOUND") throw err;
      process.stderr.write("samurai loads TypeScript specs with tsx\n");
      process.exit(2);
    }
  }
  const { openSession } = await import("./worker-session.js");
  let listener: (message: ToWorker) => void = () => {};
  handleMessages(
    {
      send: (message) => void process.send?.(message),
      onMessage: (next) => (listener = next),
    },
    { open: openSession, exit: () => process.exit(0) },
  );
  process.on("message", (message: ToWorker) => listener(message));
  // The main process is gone: end the running test, close and leave
  process.on("disconnect", () => {
    listener({ type: "abort" });
    listener({ type: "exit" });
  });
}

if (process.send && process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
