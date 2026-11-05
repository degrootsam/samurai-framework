import type { FixtureDef } from "./fixture-defs.js";
import { finishWithin, type Started } from "./fixture-start.js";

/** A worker fixture that is set up: its value, how to finish it, and the outputs the report lists */
export interface WorkerInstance {
  value: unknown;
  started: Started;
  outputs?: Record<string, string | number | boolean> | undefined;
}

/**
 * The worker-scoped fixtures of one worker. An instance is shared by the tests that need the same definition with
 * the same key (the environment, the resolved options and the instances it uses), is set up on first use and is
 * torn down when the worker is done, last set up first.
 */
export class WorkerFixtures {
  private readonly byDef = new Map<
    FixtureDef,
    Map<string, Promise<WorkerInstance>>
  >();
  private readonly live: WorkerInstance[] = [];

  /** `limitMs`: how long a teardown may take when the fixture has no `timeout` of its own */
  constructor(private readonly limitMs: number) {}

  /** The instance of `def` under `key`: the one already set up, else the result of `make`. A failed setup is not kept */
  public async acquire(
    def: FixtureDef,
    key: string,
    make: () => Promise<WorkerInstance>,
  ): Promise<WorkerInstance & { reused: boolean }> {
    let keys = this.byDef.get(def);
    if (!keys) this.byDef.set(def, (keys = new Map()));
    const existing = keys.get(key);
    if (existing) return { ...(await existing), reused: true };
    const created = make().then((instance) => {
      this.live.push(instance);
      return instance;
    });
    keys.set(key, created);
    try {
      return { ...(await created), reused: false };
    } catch (err) {
      keys.delete(key);
      throw err;
    }
  }

  /** Tears every instance down, last set up first, and returns the errors; a second call has nothing to do */
  public async closeAll(): Promise<Error[]> {
    const errors: Error[] = [];
    this.byDef.clear();
    for (let one = this.live.pop(); one; one = this.live.pop()) {
      const error = await finishWithin(one.started, this.limitMs);
      if (error) errors.push(error);
    }
    return errors;
  }
}
