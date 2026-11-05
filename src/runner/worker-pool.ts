import type { TestResult } from "../types/test.js";
import { failedResult, serialSkipped, UnitState } from "./pool-units.js";
import { eligibleCount, nextEligible, type Worker } from "./pool-schedule.js";
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

interface Slot extends Worker {
  index: number;
  handle: WorkerHandle;
  /** Has answered `init` and can take a run */
  ready: boolean;
  /** Told to leave so the block it ran starts again on a new worker: takes no more items */
  retiring?: boolean;
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
  private readonly units = new Map<string, UnitState<Entry>>();
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
      if (!slot.ready || slot.busy || slot.retiring) continue;
      const at = nextEligible(this.queue, [...this.slots.values()], slot);
      if (at < 0) continue;
      const [entry] = this.queue.splice(at, 1);
      if (entry) this.dispatch(slot, entry);
    }
    let starting = [...this.slots.values()].filter((s) => !s.ready).length;
    const wanted = eligibleCount(this.queue, [...this.slots.values()]);
    while (this.slots.size < this.options.workers && starting < wanted) {
      if (!this.start(this.freeIndex())) return;
      starting++;
    }
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
    const { unit, serialKey } = entry.item;
    if (unit) {
      slot.unit = unit;
      slot.unitKey = serialKey;
      if (!this.units.has(unit))
        this.units.set(unit, new UnitState(entry.call));
    }
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
          ...this.retryOf(busy.entry, message.retry),
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
      this.finish(
        slot,
        busy.entry,
        failedResult(item, message, busy.startTime),
      );
    } else {
      this.pump();
    }
  }

  /** The attempt a started item is on: the worker's own retry, or the attempt at its serial block */
  private retryOf({ item }: Entry, workerRetry?: number): { retry?: number } {
    const retry =
      workerRetry || (item.serial ? this.units.get(item.unit!)?.attempt : 0);
    return retry ? { retry } : {};
  }

  /** Records an item's result, tells the listener, and gives the worker its next item */
  private finish(slot: Slot, entry: Entry, result: TestResult) {
    const stamped = { ...result, worker: slot.index };
    if (entry.item.serial) this.finishInBlock(slot, entry, stamped);
    else this.report(entry, slot.index, stamped);
    this.pump();
  }

  private report(entry: Entry, worker: number, result: TestResult) {
    this.emit(entry.call, {
      type: "test-end",
      item: entry.item,
      worker,
      result,
    });
    this.settle(entry, result);
  }

  /**
   * An item of a serial block ended. After a failure the rest of the block is skipped; with retries the block
   * starts over on a new worker first, and what its tests ended with is held until the last attempt is known.
   */
  private finishInBlock(slot: Slot, entry: Entry, result: TestResult) {
    const state = this.units.get(entry.item.unit!)!;
    const retries = this.options.init.retries ?? 0;
    if (retries === 0) this.report(entry, slot.index, result);
    else state.hold(entry, result);
    if (result.status !== "failed") {
      const last = !this.queue.some((e) => e.item.unit === entry.item.unit);
      if (last) this.release(state);
      return;
    }
    const aborted = entry.call.aborted || result.message === "Run aborted";
    if (state.attempt < retries && !aborted && !this.disposed) {
      return this.restartBlock(slot, state, entry, result);
    }
    this.release(state);
    for (let i = 0; i < this.queue.length; i++) {
      const next = this.queue[i]!;
      if (next.item.unit !== entry.item.unit) continue;
      this.queue.splice(i--, 1);
      this.report(next, slot.index, serialSkipped(next.item));
    }
  }

  /** Reports what a block's tests ended with in its last attempt */
  private release(state: UnitState<Entry>) {
    for (const { entry, result } of state.release())
      this.report(entry, result.worker ?? 0, result);
  }

  /** Puts the block back in the queue, from its first test, and tells the worker that ran it to leave */
  private restartBlock(
    slot: Slot,
    state: UnitState<Entry>,
    failed: Entry,
    result: TestResult,
  ) {
    this.queue.unshift(...state.restart(failed, result));
    slot.unit = slot.unitKey = undefined;
    if (this.slots.get(slot.index) !== slot) return;
    slot.retiring = true;
    slot.handle.send({ type: "exit" });
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      slot.handle.kill();
    }, this.options.shutdownMs ?? SHUTDOWN_MS);
    timer.unref();
    this.timers.add(timer);
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
    for (const state of this.units.values())
      if (state.call === call) this.release(state);
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const entry = this.queue[i];
      if (entry?.call !== call) continue;
      this.queue.splice(i, 1);
      this.settle(entry, failedResult(entry.item, "Run aborted"));
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
