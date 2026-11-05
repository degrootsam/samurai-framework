import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TestResult } from "../types/test.js";
import { SERIAL_SKIP_REASON } from "./serial.js";
import { WorkerPool, type PoolEvent } from "./worker-pool.js";
import type {
  FromWorker,
  ToWorker,
  WorkerHandle,
  WorkerInit,
  WorkItem,
} from "./worker-protocol.js";

class Fake implements WorkerHandle {
  readonly sent: ToWorker[] = [];
  private messages: ((m: FromWorker) => void)[] = [];
  private exits: ((code: number | null) => void)[] = [];
  constructor(readonly init: WorkerInit) {}
  send(message: ToWorker) {
    this.sent.push(message);
    if (message.type === "init")
      queueMicrotask(() => this.messages.forEach((l) => l({ type: "ready" })));
    if (message.type === "exit")
      queueMicrotask(() => this.exits.forEach((l) => l(0)));
  }
  onMessage(listener: (m: FromWorker) => void) {
    this.messages.push(listener);
  }
  onExit(listener: (code: number | null) => void) {
    this.exits.push(listener);
  }
  kill() {}
  get runs() {
    return this.sent.flatMap((m) => (m.type === "run" ? [m] : []));
  }
  /** Answers the latest run */
  answer(status: "success" | "failed") {
    const run = this.runs[this.runs.length - 1]!;
    const result = {
      name: run.item.testName,
      file: run.item.file,
      browser: run.item.browser,
      status,
      startTime: 1,
      duration: 2,
      ...(status === "failed" && { message: "boom", type: "error" }),
    } as TestResult;
    this.messages.forEach((l) => {
      l({ type: "test-start", id: run.id });
      l({ type: "test-end", id: run.id, result });
    });
  }
}

function setup(retries = 0, workerCount = 2) {
  const workers: Fake[] = [];
  const pool = new WorkerPool({
    workers: workerCount,
    graceMs: 20,
    init: {
      projectDir: "/p",
      files: ["/p/a.spec.ts"],
      basePort: 9300,
      ...(retries > 0 && { retries }),
    },
    factory: (init) => {
      const worker = new Fake(init);
      workers.push(worker);
      return worker;
    },
  });
  return { pool, workers };
}

const item = (index: number, unit?: string, serial = false): WorkItem => ({
  index,
  file: "/p/a.spec.ts",
  testName: `t${index}`,
  browser: "firefox",
  ...(unit && { unit }),
  ...(serial && { serial }),
});

const settle = () => new Promise((resolve) => setImmediate(resolve));
const names = (events: PoolEvent[], type: PoolEvent["type"]) =>
  events.filter((e) => e.type === type).map((e) => e.item.testName);

describe("WorkerPool units", () => {
  it("runs the items of a unit in order on one worker while the other worker takes the rest", async () => {
    const { pool, workers } = setup();
    const done = pool.run([item(0, "u"), item(1, "u"), item(2), item(3, "u")]);
    await settle();
    assert.equal(workers.length, 2);
    const [owner, other] = workers[0]!.runs[0]!.item.unit
      ? [workers[0]!, workers[1]!]
      : [workers[1]!, workers[0]!];
    assert.deepEqual(
      other.runs.map((r) => r.item.index),
      [2],
    );
    other.answer("success");
    owner.answer("success");
    await settle();
    owner.answer("success");
    await settle();
    owner.answer("success");
    await done;
    assert.deepEqual(
      owner.runs.map((r) => r.item.index),
      [0, 1, 3],
    );
    await pool.dispose();
  });

  it("skips the rest of a serial block after a failure", async () => {
    const { pool, workers } = setup();
    const events: PoolEvent[] = [];
    const done = pool.run(
      [item(0, "s", true), item(1, "s", true), item(2, "s", true)],
      {
        onEvent: (e) => events.push(e),
      },
    );
    await settle();
    workers[0]!.answer("success");
    await settle();
    workers[0]!.answer("failed");
    const results = await done;
    assert.deepEqual(
      results.map((r) => r.status),
      ["success", "failed", "skipped"],
    );
    assert.equal(
      (results[2] as { reason?: string }).reason,
      SERIAL_SKIP_REASON,
    );
    assert.equal(
      workers[0]!.runs.length,
      2,
      "the third test never reached a worker",
    );
    assert.deepEqual(names(events, "test-end"), ["t0", "t1", "t2"]);
    await pool.dispose();
  });

  it("starts a failed block over on a new worker, and reports the last attempt", async () => {
    const { pool, workers } = setup(1);
    const events: PoolEvent[] = [];
    const done = pool.run([item(0, "s", true), item(1, "s", true)], {
      onEvent: (e) => events.push(e),
    });
    await settle();
    const first = workers[0]!;
    first.answer("success");
    await settle();
    first.answer("failed");
    await settle();
    // The failing worker was told to leave; a new one runs the block from its first test
    assert.ok(first.sent.some((m) => m.type === "exit"));
    assert.equal(workers.length, 2);
    const second = workers[1]!;
    assert.deepEqual(
      second.runs.map((r) => r.item.index),
      [0],
    );
    assert.equal(
      first.runs.every((r) => r.item.serial),
      true,
    );
    second.answer("success");
    await settle();
    second.answer("success");
    const results = await done;
    assert.deepEqual(
      results.map((r) => r.status),
      ["success", "success"],
    );
    assert.deepEqual(
      results.map((r) => (r as { retry?: number }).retry),
      [1, 1],
    );
    assert.equal((results[1] as { flaky?: boolean }).flaky, true);
    // Each test ended once, with the last attempt
    assert.deepEqual(names(events, "test-end"), ["t0", "t1"]);
    await pool.dispose();
  });

  it("gives up after the retries and skips the rest", async () => {
    const { pool, workers } = setup(1);
    const done = pool.run([item(0, "s", true), item(1, "s", true)]);
    await settle();
    workers[0]!.answer("failed");
    await settle();
    workers[1]!.answer("failed");
    const results = await done;
    assert.deepEqual(
      results.map((r) => r.status),
      ["failed", "skipped"],
    );
    assert.equal((results[0] as { retry?: number }).retry, 1);
    await pool.dispose();
  });

  it("hands the next item of a unit to its worker even when an idle worker before it has nothing to take", async () => {
    const { pool, workers } = setup();
    const done = pool.run([item(0), item(1, "u"), item(2, "u")]);
    await settle();
    const [idle, owner] = workers;
    assert.deepEqual(
      idle!.runs.map((r) => r.item.index),
      [0],
    );
    assert.deepEqual(
      owner!.runs.map((r) => r.item.index),
      [1],
    );
    idle!.answer("success");
    await settle();
    owner!.answer("success");
    await settle();
    assert.deepEqual(
      owner!.runs.map((r) => r.item.index),
      [1, 2],
    );
    owner!.answer("success");
    await done;
    await pool.dispose();
  });
});
