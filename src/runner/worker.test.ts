import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupportedBrowser } from "../types/browser.js";
import type { RegisteredTestCase, TestResult } from "../types/test.js";
import type { RunEvent } from "./reporter.js";
import type { FromWorker, ToWorker, WorkerInit } from "./worker-protocol.js";
import { newSuite } from "./suite.js";
import {
  handleMessages,
  type WorkerDeps,
  type WorkerSession,
} from "./worker.js";

const INIT: WorkerInit = {
  projectDir: "/proj",
  files: ["/proj/a.spec.ts"],
  workerIndex: 2,
  basePort: 9300,
};

function testCase(name: string): RegisteredTestCase {
  return {
    file: "/proj/a.spec.ts",
    name,
    titlePath: [name],
    suite: newSuite(),
    function: async () => {},
  };
}

function resultOf(name: string, browser: SupportedBrowser): TestResult {
  return {
    name,
    file: "/proj/a.spec.ts",
    browser,
    status: "success",
    startTime: 1,
    duration: 2,
  };
}

/** A worker wired to an in-memory channel and a session that runs `body` for each test */
function setup(
  body: (test: RegisteredTestCase, signal: AbortSignal) => Promise<void> = () =>
    Promise.resolve(),
  open?: WorkerDeps["open"],
) {
  const sent: FromWorker[] = [];
  const events: string[] = [];
  let receive: (message: ToWorker) => void = () => {};
  let exits = 0;
  let closed = 0;
  const session: WorkerSession = {
    tests: [testCase("first"), testCase("second")],
    async runTest(t, browser, signal, onEvent: (event: RunEvent) => void) {
      events.push(`run ${t.name} ${browser}`);
      onEvent({
        type: "test-start",
        name: t.name,
        file: t.file,
        browser,
      });
      await body(t, signal);
      onEvent({
        type: "test-end",
        name: t.name,
        file: t.file,
        browser,
        result: resultOf(t.name, browser),
      });
    },
    async close() {
      closed++;
    },
  };
  handleMessages(
    {
      send: (message) => sent.push(message),
      onMessage: (listener) => (receive = listener),
    },
    {
      open: open ?? (async () => session),
      exit: () => exits++,
    },
  );
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  return {
    sent,
    events,
    send: async (message: ToWorker) => {
      receive(message);
      await tick();
    },
    exits: () => exits,
    closed: () => closed,
  };
}

const item = (testName: string, browser: SupportedBrowser = "firefox") => ({
  index: 0,
  file: "/proj/a.spec.ts",
  testName,
  browser,
});

test("init opens the project and answers ready", async () => {
  const worker = setup();
  await worker.send({ type: "init", init: INIT });
  assert.deepEqual(worker.sent, [{ type: "ready" }]);
});

test("run reports the start and the end, and stamps the result with the worker's number", async () => {
  const worker = setup();
  await worker.send({ type: "init", init: INIT });
  await worker.send({ type: "run", id: 7, item: item("second", "chrome") });
  assert.deepEqual(worker.events, ["run second chrome"]);
  assert.deepEqual(worker.sent.slice(1), [
    { type: "test-start", id: 7 },
    {
      type: "test-end",
      id: 7,
      result: { ...resultOf("second", "chrome"), worker: 2 },
    },
  ]);
});

test("a test that is not in the files is a failed result, not a crash", async () => {
  const worker = setup();
  await worker.send({ type: "init", init: INIT });
  await worker.send({ type: "run", id: 1, item: item("missing") });
  const end = worker.sent[worker.sent.length - 1] as Extract<
    FromWorker,
    { type: "test-end" }
  >;
  assert.equal(end.type, "test-end");
  assert.equal(end.result.status, "failed");
  assert.match(
    (end.result as { message: string }).message,
    /missing.*not found/,
  );
  assert.equal(end.result.worker, 2);
});

test("runs arrive one at a time even when sent together", async () => {
  const order: string[] = [];
  let release: () => void = () => {};
  const worker = setup(async (t) => {
    order.push(`start ${t.name}`);
    if (t.name === "first")
      await new Promise<void>((resolve) => (release = resolve));
    order.push(`end ${t.name}`);
  });
  await worker.send({ type: "init", init: INIT });
  await worker.send({ type: "run", id: 1, item: item("first") });
  await worker.send({ type: "run", id: 2, item: item("second") });
  assert.deepEqual(order, ["start first"]);
  release();
  await worker.send({ type: "abort" });
  await worker.send({ type: "abort" });
  assert.deepEqual(order, [
    "start first",
    "end first",
    "start second",
    "end second",
  ]);
});

test("abort aborts the running test's signal", async () => {
  let signal: AbortSignal | undefined;
  const worker = setup(async (_t, s) => {
    signal = s;
    await new Promise<void>((resolve) =>
      s.addEventListener("abort", () => resolve()),
    );
  });
  await worker.send({ type: "init", init: INIT });
  await worker.send({ type: "run", id: 1, item: item("first") });
  assert.equal(signal?.aborted, false);
  await worker.send({ type: "abort" });
  assert.equal(signal?.aborted, true);
  assert.equal(worker.sent[worker.sent.length - 1]?.type, "test-end");
});

test("exit closes the project and leaves", async () => {
  const worker = setup();
  await worker.send({ type: "init", init: INIT });
  await worker.send({ type: "exit" });
  assert.equal(worker.closed(), 1);
  assert.equal(worker.exits(), 1);
});

test("a project that cannot be opened is fatal", async () => {
  const worker = setup(undefined, async () => {
    throw new Error("no config");
  });
  await worker.send({ type: "init", init: INIT });
  assert.deepEqual(worker.sent, [{ type: "fatal", message: "no config" }]);
});

test("a run before init is fatal", async () => {
  const worker = setup();
  await worker.send({ type: "run", id: 1, item: item("first") });
  assert.equal(worker.sent[0]?.type, "fatal");
});

test("an error that escapes the test run is fatal", async () => {
  const worker = setup(async () => {
    throw new Error("sink broke");
  });
  await worker.send({ type: "init", init: INIT });
  await worker.send({ type: "run", id: 1, item: item("first") });
  assert.deepEqual(worker.sent[worker.sent.length - 1], {
    type: "fatal",
    message: "sink broke",
  });
});
