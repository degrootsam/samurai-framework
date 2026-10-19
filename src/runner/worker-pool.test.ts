import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TestResult } from "../types/test.js";
import { WorkerPool, type PoolEvent } from "./worker-pool.js";
import type {
  FromWorker,
  ToWorker,
  WorkerHandle,
  WorkerInit,
  WorkItem,
} from "./worker-protocol.js";

class FakeWorker implements WorkerHandle {
  readonly sent: ToWorker[] = [];
  killed = false;
  private messageListeners: ((message: FromWorker) => void)[] = [];
  private exitListeners: ((code: number | null) => void)[] = [];

  constructor(
    readonly init: WorkerInit,
    private readonly autoReady: boolean,
  ) {}

  send(message: ToWorker) {
    this.sent.push(message);
    if (message.type === "init" && this.autoReady) {
      queueMicrotask(() => this.emit({ type: "ready" }));
    }
  }
  onMessage(listener: (message: FromWorker) => void) {
    this.messageListeners.push(listener);
  }
  onExit(listener: (code: number | null) => void) {
    this.exitListeners.push(listener);
  }
  kill() {
    if (this.killed) return;
    this.killed = true;
    this.exit(null);
  }

  emit(message: FromWorker) {
    for (const listener of this.messageListeners) listener(message);
  }
  exit(code: number | null) {
    for (const listener of this.exitListeners) listener(code);
  }

  /** The items this worker was asked to run, in order */
  get runs() {
    return this.sent.flatMap((m) => (m.type === "run" ? [m] : []));
  }
  /** Answers the latest run as passed */
  pass() {
    const run = last(this.runs);
    assert.ok(run, "the worker has no run to answer");
    this.emit({ type: "test-start", id: run.id });
    this.emit({ type: "test-end", id: run.id, result: passed(run.item) });
  }
}

function setup(
  options: { workers?: number; autoReady?: boolean; graceMs?: number } = {},
) {
  const workers: FakeWorker[] = [];
  const pool = new WorkerPool({
    workers: options.workers ?? 2,
    graceMs: options.graceMs ?? 20,
    init: {
      projectDir: "/project",
      files: ["/project/a.spec.ts"],
      basePort: 9300,
    },
    factory: (init) => {
      const worker = new FakeWorker(init, options.autoReady ?? true);
      workers.push(worker);
      return worker;
    },
  });
  return { pool, workers };
}

function item(index: number, serialKey?: string): WorkItem {
  return {
    index,
    file: "/project/a.spec.ts",
    testName: `test ${index}`,
    browser: "firefox",
    ...(serialKey ? { serialKey } : {}),
  };
}

function passed(work: WorkItem): TestResult {
  return {
    name: work.testName,
    file: work.file,
    browser: work.browser,
    status: "success",
    startTime: 1,
    duration: 2,
  };
}

/** The last element; `Array.prototype.at` is not in the target lib */
function last<T>(list: T[] | undefined): T | undefined {
  return list?.[list.length - 1];
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("WorkerPool", () => {
  it("starts no worker until there is work", async () => {
    const { pool, workers } = setup();
    await settle();
    assert.equal(workers.length, 0);
    await pool.dispose();
  });

  it("starts at most `workers`, and never more than queued items", async () => {
    const { pool, workers } = setup({ workers: 3 });
    const first = pool.run([item(0), item(1)]);
    await settle();
    assert.equal(workers.length, 2, "two items, two workers");
    workers.forEach((w) => w.pass());
    await first;

    const second = pool.run([0, 1, 2, 3, 4].map((i) => item(i)));
    await settle();
    assert.equal(workers.length, 3, "capped at three");
    await pool.dispose();
    await second.catch(() => {});
  });

  it("sends init, then run only after ready", async () => {
    const { pool, workers } = setup({ autoReady: false });
    const done = pool.run([item(0)]);
    await settle();
    const [worker] = workers;
    assert.ok(worker);
    assert.deepEqual(
      worker.sent.map((m) => m.type),
      ["init"],
    );
    assert.equal(worker.init.workerIndex, 0);
    assert.equal(worker.init.basePort, 9300);
    worker.emit({ type: "ready" });
    assert.deepEqual(
      worker.sent.map((m) => m.type),
      ["init", "run"],
    );
    worker.pass();
    await done;
  });

  it("gives items to free workers in queue order across run() calls", async () => {
    const { pool, workers } = setup({ workers: 1 });
    const a = pool.run([item(0), item(1)]);
    const b = pool.run([item(2)]);
    await settle();
    const [worker] = workers;
    assert.ok(worker);
    worker.pass();
    await settle();
    worker.pass();
    await settle();
    worker.pass();
    await Promise.all([a, b]);
    assert.deepEqual(
      worker.runs.map((r) => r.item.index),
      [0, 1, 2],
    );
  });

  it("returns results in item order and forwards events with the worker index", async () => {
    const { pool, workers } = setup();
    const events: PoolEvent[] = [];
    const done = pool.run([item(0), item(1)], {
      onEvent: (event) => events.push(event),
    });
    await settle();
    workers[1]?.pass();
    workers[0]?.pass();
    const results = await done;
    assert.deepEqual(
      results.map((r) => r.name),
      ["test 0", "test 1"],
    );
    assert.deepEqual(
      results.map((r) => r.worker),
      [0, 1],
    );
    assert.deepEqual(
      events.map((e) => [e.type, e.item.index, e.worker]),
      [
        ["test-start", 1, 1],
        ["test-end", 1, 1],
        ["test-start", 0, 0],
        ["test-end", 0, 0],
      ],
    );
  });

  it("fails the item of a worker that exits and replaces the worker", async () => {
    const { pool, workers } = setup({ workers: 1 });
    const done = pool.run([item(0), item(1)]);
    await settle();
    workers[0]?.exit(137);
    await settle();
    assert.equal(workers.length, 2, "a new worker replaced the dead one");
    assert.equal(workers[1]?.init.workerIndex, 0);
    workers[1]?.pass();
    const [first, second] = await done;
    assert.equal(first?.status, "failed");
    assert.ok(first?.status === "failed");
    assert.equal(first.type, "error");
    assert.equal(first.message, "The worker process exited (code 137)");
    assert.equal(first.name, "test 0");
    assert.equal(first.worker, 0);
    assert.equal(second?.status, "success");
  });

  it("drops a worker that exits while idle and starts another when needed", async () => {
    const { pool, workers } = setup({ workers: 1 });
    const first = pool.run([item(0)]);
    await settle();
    workers[0]?.pass();
    await first;
    workers[0]?.exit(1);
    const second = pool.run([item(1)]);
    await settle();
    assert.equal(workers.length, 2);
    workers[1]?.pass();
    assert.equal((await second)[0]?.status, "success");
  });

  it("rejects every run on fatal and kills the workers", async () => {
    const { pool, workers } = setup();
    const done = pool.run([item(0), item(1)]);
    const other = pool.run([item(2)]);
    await settle();
    workers[0]?.emit({ type: "fatal", message: "cannot import a.spec.ts" });
    await assert.rejects(done, /cannot import a\.spec\.ts/);
    await assert.rejects(other, /cannot import a\.spec\.ts/);
    assert.ok(workers.every((w) => w.killed));
  });

  it("abort: fails queued items, tells busy workers, resolves with all results", async () => {
    const { pool, workers } = setup({ workers: 1 });
    const controller = new AbortController();
    const done = pool.run([item(0), item(1), item(2)], {
      signal: controller.signal,
    });
    await settle();
    controller.abort();
    const worker = workers[0];
    assert.ok(worker);
    assert.equal(last(worker.sent)?.type, "abort");
    worker.pass();
    const results = await done;
    assert.equal(results[0]?.status, "success");
    for (const result of results.slice(1)) {
      assert.ok(result.status === "failed");
      assert.equal(result.message, "Run aborted");
      assert.equal(result.type, "error");
    }
    assert.equal(worker.killed, false, "a worker that finished in time lives");
    await pool.dispose();
  });

  it("abort: kills a worker still busy after the grace period", async () => {
    const { pool, workers } = setup({ workers: 1, graceMs: 10 });
    const controller = new AbortController();
    const done = pool.run([item(0)], { signal: controller.signal });
    await settle();
    controller.abort();
    const results = await done;
    assert.equal(workers[0]?.killed, true);
    assert.ok(results[0]?.status === "failed");
    assert.equal(results[0].message, "Run aborted");
  });

  it("abort: an already aborted signal runs nothing", async () => {
    const { pool, workers } = setup();
    const results = await pool.run([item(0)], { signal: AbortSignal.abort() });
    assert.equal(workers.length, 0);
    assert.ok(results[0]?.status === "failed");
    assert.equal(results[0].message, "Run aborted");
  });

  it("never runs two items with the same serialKey at once", async () => {
    const { pool, workers } = setup({ workers: 3 });
    const done = pool.run([item(0, "db"), item(1, "db"), item(2)]);
    await settle();
    const running = workers.flatMap((w) => w.runs.map((r) => r.item.index));
    assert.deepEqual(running.sort(), [0, 2], "item 1 waits for item 0");
    workers.find((w) => last(w.runs)?.item.index === 0)?.pass();
    await settle();
    const second = workers
      .flatMap((w) => w.runs)
      .find((r) => r.item.index === 1);
    assert.ok(second, "item 1 started once item 0 ended");
    workers.forEach((w) => {
      if (last(w.runs)?.item.index !== 0) w.pass();
    });
    await settle();
    workers.forEach((w) => {
      if (last(w.runs)?.item.index === 1) w.pass();
    });
    assert.equal((await done).length, 3);
  });

  it("does not deadlock when only serial items remain", async () => {
    const { pool, workers } = setup({ workers: 1 });
    const done = pool.run([item(0, "db"), item(1, "db"), item(2, "db")]);
    for (let i = 0; i < 3; i++) {
      await settle();
      workers[0]?.pass();
    }
    assert.equal((await done).length, 3);
  });

  it("dispose sends exit, kills the workers, is idempotent, and run() rejects after", async () => {
    const { pool, workers } = setup();
    const first = pool.run([item(0)]);
    await settle();
    workers[0]?.pass();
    await first;
    await pool.dispose();
    await pool.dispose();
    assert.equal(last(workers[0]?.sent)?.type, "exit");
    assert.equal(workers[0]?.killed, true);
    await assert.rejects(pool.run([item(1)]), /disposed/);
  });
});
