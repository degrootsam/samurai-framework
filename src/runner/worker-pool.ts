import type { TestResult } from "../types/test.js";
import type {
  FromWorker,
  WorkerFactory,
  WorkerHandle,
  WorkerInit,
  WorkItem,
} from "./worker-protocol.js";

/** How long a busy worker may take to wind down after an abort before it is killed */
const GRACE_MS = 2000;
const SHUTDOWN_MS = 60000;
/** Workers that die before they are ready this many times in a row fail the run, instead of being replaced for ever */
const STARTUP_ATTEMPTS = 3;

export type PoolEvent =
  | { type: "test-start"; item: WorkItem; worker: number; retry?: number }
  | { type: "test-end"; item: WorkItem; worker: number; result: TestResult };

export interface PoolOptions {
  /** The cap on workers running at the same time */
  workers: number;
  init: Omit<WorkerInit, "workerIndex">;
  factory: WorkerFactory;
  /** The abort grace period in ms; 2000 by default */
  graceMs?: number;
  /** How long `dispose` waits for idle workers to leave on their own, in ms: their `afterAll` hooks run first. 60000 by default */
  shutdownMs?: number;
}

export interface RunHooks {
  onEvent?: (event: PoolEvent) => void;
  signal?: AbortSignal;
}

/** One `run()` call: its results fill in as the items end */
interface Call {
  results: TestResult[];
  left: number;
  hooks: RunHooks;
  aborted: boolean;
  resolve: (results: TestResult[]) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}

/** An item waiting for a worker, and where its result goes in the call */
interface Entry {
  item: WorkItem;
  call: Call;
  at: number;
}

interface Slot {
  index: number;
  handle: WorkerHandle;
  /** Has answered `init` and can take a run */
  ready: boolean;
  busy?: { id: number; entry: Entry; startTime: number };
}

/**
 * A fixed cap of worker processes that take items from one shared queue.
 * Workers start when there is work; `run()` can be called several times at
 * once and all calls share the cap.
 */
export class WorkerPool {
  private readonly queue: Entry[] = [];
  private readonly slots = new Map<number, Slot>();
  private readonly calls = new Set<Call>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private nextId = 0;
  /** Workers in a row that exited before they were ready */
  private startupFailures = 0;
  private disposed = false;

  constructor(private readonly options: PoolOptions) {}

  /** Results in item order; may be called several times at once (flows): all calls share the cap */
  run(items: WorkItem[], hooks: RunHooks = {}): Promise<TestResult[]> {
    if (this.disposed) {
      return Promise.reject(
        new Error("WorkerPool.run(): the pool is disposed"),
      );
    }
    return new Promise((resolve, reject) => {
      const call: Call = {
        results: new Array<TestResult>(items.length),
        left: items.length,
        hooks,
        aborted: false,
        resolve,
        reject,
        cleanup: () => {},
      };
      if (items.length === 0) return resolve([]);
      this.calls.add(call);
      items.forEach((item, at) => this.queue.push({ item, call, at }));
      const { signal } = hooks;
      if (signal) {
        const onAbort = () => this.abort(call);
        signal.addEventListener("abort", onAbort, { once: true });
        call.cleanup = () => signal.removeEventListener("abort", onAbort);
        if (signal.aborted) return this.abort(call);
      }
      this.pump();
    });
  }

  /**
   * Ends the pool; safe to call twice. A worker that has nothing to do is told to exit and given time to leave
   * (it runs its `afterAll` hooks first); one that is busy is killed, as nobody waits for its test.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.queue.length = 0;
    const leaving = this.sendHome();
    this.rejectAll(
      new Error("WorkerPool.dispose(): the pool was disposed during a run"),
    );
    await leaving;
  }

  /** Asks the idle workers to exit and waits for them (up to `shutdownMs`), kills the busy ones and the stragglers */
  private async sendHome(): Promise<void> {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    const slots = [...this.slots.values()];
    this.slots.clear();
    const gone: Promise<void>[] = [];
    for (const { handle, busy } of slots) {
      if (busy) {
        handle.kill();
        continue;
      }
      gone.push(new Promise((resolve) => handle.onExit(() => resolve())));
      handle.send({ type: "exit" });
    }
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.all(gone),
      new Promise((resolve) => {
        timer = setTimeout(resolve, this.options.shutdownMs ?? SHUTDOWN_MS);
      }),
    ]);
    clearTimeout(timer);
    for (const { handle } of slots) handle.kill();
  }

  /** Hands queued items to ready workers, then starts workers for what is left */
  private pump() {
    if (this.disposed) return;
    for (const slot of [...this.slots.values()]) {
      if (!slot.ready || slot.busy) continue;
      const at = this.nextEligible();
      if (at < 0) break;
      const [entry] = this.queue.splice(at, 1);
      if (entry) this.dispatch(slot, entry);
    }
    let starting = [...this.slots.values()].filter((s) => !s.ready).length;
    const wanted = this.eligibleCount();
    while (this.slots.size < this.options.workers && starting < wanted) {
      if (!this.start(this.freeIndex())) return;
      starting++;
    }
  }

  private busyKeys(): Set<string> {
    const keys = new Set<string>();
    for (const { busy } of this.slots.values()) {
      const key = busy?.entry.item.serialKey;
      if (key) keys.add(key);
    }
    return keys;
  }

  /** The queue position of the first item whose serial key is not running */
  private nextEligible(): number {
    const busy = this.busyKeys();
    return this.queue.findIndex(
      ({ item }) => !item.serialKey || !busy.has(item.serialKey),
    );
  }

  /** How many queued items could run at the same time right now */
  private eligibleCount(): number {
    const taken = this.busyKeys();
    let count = 0;
    for (const { item } of this.queue) {
      if (item.serialKey) {
        if (taken.has(item.serialKey)) continue;
        taken.add(item.serialKey);
      }
      count++;
    }
    return count;
  }

  private freeIndex(): number {
    let index = 0;
    while (this.slots.has(index)) index++;
    return index;
  }

  private start(index: number): boolean {
    const init = { ...this.options.init, workerIndex: index };
    let handle: WorkerHandle;
    try {
      handle = this.options.factory(init);
    } catch (error) {
      this.fatal(error instanceof Error ? error.message : String(error));
      return false;
    }
    const slot: Slot = { index, handle, ready: false };
    this.slots.set(index, slot);
    handle.onMessage((message) => this.onMessage(slot, message));
    handle.onExit((code) => this.onExit(slot, code));
    handle.send({ type: "init", init });
    return true;
  }

  private dispatch(slot: Slot, entry: Entry) {
    const id = this.nextId++;
    slot.busy = { id, entry, startTime: Date.now() };
    slot.handle.send({ type: "run", id, item: entry.item });
  }

  private onMessage(slot: Slot, message: FromWorker) {
    if (this.slots.get(slot.index) !== slot) return;
    const { busy } = slot;
    switch (message.type) {
      case "ready":
        slot.ready = true;
        this.startupFailures = 0;
        return this.pump();
      case "fatal":
        return this.fatal(message.message);
      case "test-start":
        if (busy?.id !== message.id) return;
        busy.startTime = Date.now();
        return this.emit(busy.entry.call, {
          type: "test-start",
          item: busy.entry.item,
          worker: slot.index,
          ...(message.retry && { retry: message.retry }),
        });
      case "test-end":
        if (busy?.id !== message.id) return;
        slot.busy = undefined;
        return this.finish(slot, busy.entry, message.result);
    }
  }

  private onExit(slot: Slot, code: number | null) {
    if (this.slots.get(slot.index) !== slot) return;
    this.slots.delete(slot.index);
    const { busy } = slot;
    if (!slot.ready && ++this.startupFailures >= STARTUP_ATTEMPTS) {
      return this.fatal(
        `The worker process exited before it was ready (code ${code})`,
      );
    }
    if (busy) {
      const { item, call } = busy.entry;
      const message = call.aborted
        ? "Run aborted"
        : `The worker process exited (code ${code})`;
      this.finish(slot, busy.entry, failure(item, message, busy.startTime));
    } else {
      this.pump();
    }
  }

  /** Records an item's result, tells the listener, and gives the worker its next item */
  private finish(slot: Slot, entry: Entry, result: TestResult) {
    const stamped = { ...result, worker: slot.index };
    this.emit(entry.call, {
      type: "test-end",
      item: entry.item,
      worker: slot.index,
      result: stamped,
    });
    this.settle(entry, stamped);
    this.pump();
  }

  private settle({ call, at }: Entry, result: TestResult) {
    call.results[at] = result;
    if (--call.left > 0) return;
    call.cleanup();
    this.calls.delete(call);
    call.resolve(call.results);
  }

  private emit(call: Call, event: PoolEvent) {
    try {
      call.hooks.onEvent?.(event);
    } catch {
      // a listener's failure must not stop the run
    }
  }

  /** Fails the queued items of a call, asks its busy workers to stop, and kills the ones that do not */
  private abort(call: Call) {
    call.aborted = true;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const entry = this.queue[i];
      if (entry?.call !== call) continue;
      this.queue.splice(i, 1);
      this.settle(entry, failure(entry.item, "Run aborted"));
    }
    for (const slot of this.slots.values()) {
      const busy = slot.busy;
      if (busy?.entry.call !== call) continue;
      slot.handle.send({ type: "abort" });
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        if (slot.busy === busy) slot.handle.kill();
      }, this.options.graceMs ?? GRACE_MS);
      timer.unref();
      this.timers.add(timer);
    }
  }

  private fatal(message: string) {
    this.queue.length = 0;
    this.stopWorkers(false);
    this.rejectAll(new Error(message));
  }

  private rejectAll(error: Error) {
    const calls = [...this.calls];
    this.calls.clear();
    for (const call of calls) {
      call.cleanup();
      call.reject(error);
    }
  }

  /** Forgets every worker, then kills it, so their exits are not taken for crashes */
  private stopWorkers(sayExit: boolean) {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    const slots = [...this.slots.values()];
    this.slots.clear();
    for (const { handle } of slots) {
      if (sayExit) handle.send({ type: "exit" });
      handle.kill();
    }
  }
}

function failure(
  item: WorkItem,
  message: string,
  startTime = Date.now(),
): TestResult {
  return {
    name: item.testName,
    file: item.file,
    browser: item.browser,
    status: "failed",
    type: "error",
    message,
    startTime,
    duration: Date.now() - startTime,
  };
}
