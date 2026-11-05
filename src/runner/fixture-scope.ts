import { toTestError } from "./test-error.js";
import type { TestFixtureEntry, TestFixtures } from "../types/test.js";
import { requestedBy } from "./fixture-args.js";
import {
  BUILT_IN_FIXTURES,
  dependencyOf,
  type FixtureDef,
  type FixtureLayers,
} from "./fixture-defs.js";
import { resolveOptions } from "./fixture-options.js";
import { outputsOf, stableJson } from "./fixture-outputs.js";
import {
  finishWithin,
  FixtureSetupError,
  startSetup,
  type Started,
} from "./fixture-start.js";
import { WorkerFixtures, type WorkerInstance } from "./fixture-worker.js";
import { SkipSignal } from "./skip.js";

/** What `use` and the run's environment say about the fixtures of one test */
export interface ScopeRun {
  /** Fixtures to set up with the `auto` ones */
  attach?: readonly string[];
  /** The values of the option fixtures from `use`, by option fixture name */
  options?: Readonly<Record<string, Record<string, unknown>>>;
  /** Fixtures the environment turns off, with the reason a test that needs one is skipped for */
  disabled?: ReadonlyMap<string, string>;
  /** The worker's fixtures, where worker-scoped ones live. Without it they live as long as this scope */
  workers?: WorkerFixtures;
  /** The run's environment: a worker fixture is shared only within one environment */
  environment?: string;
}

/** The built-in fixtures whose value tells worker fixtures apart (the rest are the same for every test of a worker) */
const KEYED_BUILT_INS = ["browserName", "workerIndex", "baseURL"] as const;

/**
 * The custom fixtures of one test run. Fixtures are set up when a test or hook asks for them (by destructuring
 * them), their dependencies first, and torn down in the opposite order. The hooks and the body of a test share
 * one scope, so they see the same instances. Worker-scoped fixtures come from the worker's `WorkerFixtures`.
 */
export class FixtureScope {
  /** The built-in fixtures, with each custom fixture added (replacing a built-in of that name) once it is set up */
  public readonly fixtures: TestFixtures;
  private readonly values = new Map<string, unknown>();
  private readonly pending = new Map<string, Promise<void>>();
  /** What was set up for this test, last in the order it is torn down */
  private readonly started: Started[] = [];
  /** The key of each worker fixture set up here, which the fixtures that use it build theirs from */
  private readonly keys = new Map<string, string>();
  private readonly entries: TestFixtureEntry[] = [];
  private readonly entryOf = new Map<Started, TestFixtureEntry>();
  private readonly workers: WorkerFixtures;
  private readonly ownsWorkers: boolean;
  private closed = false;

  constructor(
    private readonly layers: FixtureLayers,
    private readonly base: TestFixtures,
    private readonly run: ScopeRun = {},
  ) {
    const own = Object.getOwnPropertyDescriptors(base);
    for (const descriptor of Object.values(own)) descriptor.configurable = true;
    this.fixtures = Object.defineProperties({}, own) as TestFixtures;
    this.ownsWorkers = run.workers === undefined;
    this.workers = run.workers ?? new WorkerFixtures(60_000);
  }

  /** Sets up the fixtures marked `auto`, then those `use` attaches */
  public async prepareAuto(): Promise<void> {
    for (const [name, defs] of this.layers)
      if (defs[defs.length - 1]?.auto) await this.ensure(name, defs.length - 1);
    for (const name of this.run.attach ?? []) {
      const defs = this.layers.get(name);
      if (defs) await this.ensure(name, defs.length - 1);
    }
  }

  /** Sets up the custom fixtures `fn` destructures from its first parameter */
  public async prepare(fn: (...args: never[]) => unknown): Promise<void> {
    const requested = requestedBy(fn);
    if (requested.kind === "opaque") return;
    const names = requested.rest ? [...this.layers.keys()] : requested.names;
    for (const name of names) {
      const defs = this.layers.get(name);
      if (defs) await this.ensure(name, defs.length - 1);
      else if (!BUILT_IN_FIXTURES.has(name))
        throw new Error(`extend(): unknown fixture "${name}"`);
    }
  }

  /** The fixtures this test set up, in the order they were set up, with how each went so far */
  public report(): TestFixtureEntry[] {
    return this.entries.map((entry) => structuredClone(entry));
  }

  /**
   * Finishes the fixtures that were set up, last first, each within its own `timeout` else `limitMs`. Returns the
   * first error (a fixture's cleanup threw or ran out of time); the others still run. The worker fixtures of a
   * scope that has no worker are finished too.
   */
  public async teardown(limitMs: number): Promise<Error | undefined> {
    this.closed = true;
    let first: Error | undefined;
    for (let one = this.started.pop(); one; one = this.started.pop()) {
      const begin = performance.now();
      const error = await finishWithin(one, limitMs);
      const entry = this.entryOf.get(one);
      if (entry)
        entry.teardown = {
          status: error ? "failed" : "passed",
          durationMs: performance.now() - begin,
          ...(error && { error: toTestError(error) }),
        };
      first ??= error;
    }
    if (this.ownsWorkers) first ??= (await this.workers.closeAll())[0];
    return first;
  }

  private ensure(name: string, level: number): Promise<void> {
    const off = this.run.disabled?.get(name);
    if (off !== undefined) return Promise.reject(new SkipSignal("skip", off));
    const key = `${name}#${level}`;
    let promise = this.pending.get(key);
    if (!promise) {
      promise = this.setUp(name, level);
      this.pending.set(key, promise);
    }
    return promise;
  }

  private async setUp(name: string, level: number): Promise<void> {
    const def = this.layers.get(name)?.[level];
    if (!def) throw new Error(`extend(): unknown fixture "${name}"`);
    try {
      const args: Record<string, unknown> = {};
      for (const dep of def.deps) {
        const target = dependencyOf(this.layers, name, level, dep);
        if (target === "built-in" || target === undefined)
          args[dep] = this.base[dep as keyof TestFixtures];
        else {
          await this.ensure(target.name, target.level);
          args[dep] = this.values.get(`${target.name}#${target.level}`);
        }
      }
      let value = def.value;
      if (def.option)
        value = resolveOptions(def, this.run.options?.[name], this.base);
      if (def.setup) value = await this.instantiate(def, level, args);
      this.values.set(`${name}#${level}`, value);
      if (level === (this.layers.get(name)?.length ?? 0) - 1)
        Object.defineProperty(this.fixtures, name, {
          value,
          enumerable: true,
          configurable: true,
          writable: true,
        });
    } catch (err) {
      throw err instanceof FixtureSetupError || err instanceof SkipSignal
        ? err
        : new FixtureSetupError(name, err);
    }
  }

  /** Runs the setup function of `def` (for this test, or through the worker) and records how it went */
  private async instantiate(
    def: FixtureDef,
    level: number,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const entry: TestFixtureEntry = {
      name: def.name,
      scope: def.scope,
      setup: { status: "passed", durationMs: 0 },
    };
    const begin = performance.now();
    try {
      let instance: WorkerInstance;
      if (def.scope === "worker") {
        const key = this.workerKey(def, level);
        this.keys.set(`${def.name}#${level}`, key);
        const got = await this.workers.acquire(def, key, () =>
          this.make(def, args),
        );
        if (got.reused) entry.setup.status = "skipped";
        instance = got;
      } else {
        instance = await this.make(def, args);
        if (this.closed) {
          instance.started.release();
          throw new Error("the test is already over");
        }
        this.started.push(instance.started);
        this.entryOf.set(instance.started, entry);
      }
      if (instance.outputs) entry.outputs = instance.outputs;
      return instance.value;
    } catch (err) {
      entry.setup = {
        status: "failed",
        durationMs: 0,
        error: toTestError(new FixtureSetupError(def.name, err)),
      };
      throw err;
    } finally {
      if (entry.setup.status !== "skipped")
        entry.setup.durationMs = performance.now() - begin;
      this.entries.push(entry);
    }
  }

  /** Starts the setup of `def` until it calls `use`, and checks the declared outputs of the value */
  private async make(
    def: FixtureDef,
    args: Record<string, unknown>,
  ): Promise<WorkerInstance> {
    const started = await startSetup(def, args, def.timeout);
    const finish = {
      name: def.name,
      release: started.release,
      done: started.done,
      timeout: def.timeout,
    };
    try {
      const outputs = outputsOf(def, started.value);
      return { value: started.value, started: finish, outputs };
    } catch (err) {
      started.release();
      await started.done().catch(() => undefined);
      throw err;
    }
  }

  /**
   * What makes one instance of a worker fixture different from another: the environment, the values of the
   * option fixtures it reads, the instances of the worker fixtures it uses and the built-ins that differ
   */
  private workerKey(def: FixtureDef, level: number): string {
    const parts: unknown[] = [this.run.environment ?? ""];
    for (const dep of def.deps) {
      const target = dependencyOf(this.layers, def.name, level, dep);
      if (target === "built-in" || target === undefined) {
        if ((KEYED_BUILT_INS as readonly string[]).includes(dep))
          parts.push([dep, this.base[dep as keyof TestFixtures]]);
        continue;
      }
      const used = this.layers.get(target.name)?.[target.level];
      if (used?.option)
        parts.push([
          dep,
          { ...(used.value as object), ...this.run.options?.[target.name] },
        ]);
      else if (used?.scope === "worker")
        parts.push([dep, this.keys.get(`${target.name}#${target.level}`)]);
    }
    return stableJson(parts);
  }
}
