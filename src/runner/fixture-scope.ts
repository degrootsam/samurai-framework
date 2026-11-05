import type { TestFixtures } from "../types/test.js";
import { requestedBy } from "./fixture-args.js";
import {
  BUILT_IN_FIXTURES,
  dependencyOf,
  type FixtureLayers,
} from "./fixture-defs.js";
import {
  FixtureSetupError,
  messageOf,
  startSetup,
  type Started,
} from "./fixture-start.js";

/**
 * The custom fixtures of one test run. Fixtures are set up when a test or hook asks for them (by destructuring
 * them), their dependencies first, and torn down in the opposite order. The hooks and the body of a test share
 * one scope, so they see the same instances.
 */
export class FixtureScope {
  /** The built-in fixtures, with each custom fixture added (replacing a built-in of that name) once it is set up */
  public readonly fixtures: TestFixtures;
  private readonly values = new Map<string, unknown>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly started: Started[] = [];
  private closed = false;

  constructor(
    private readonly layers: FixtureLayers,
    private readonly base: TestFixtures,
  ) {
    const own = Object.getOwnPropertyDescriptors(base);
    for (const descriptor of Object.values(own)) descriptor.configurable = true;
    this.fixtures = Object.defineProperties({}, own) as TestFixtures;
  }

  /** Sets up the fixtures marked `auto` */
  public async prepareAuto(): Promise<void> {
    for (const [name, defs] of this.layers)
      if (defs[defs.length - 1]?.auto) await this.ensure(name, defs.length - 1);
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

  /**
   * Finishes the fixtures that were set up, last first, each within `limitMs`. Returns the first error (a
   * fixture's cleanup threw or ran out of time); the others still run.
   */
  public async teardown(limitMs: number): Promise<Error | undefined> {
    this.closed = true;
    let first: Error | undefined;
    for (let one = this.started.pop(); one; one = this.started.pop()) {
      one.release();
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          one.done(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(new Error(`timed out after ${limitMs / 1000} seconds`)),
              limitMs,
            );
          }),
        ]);
      } catch (err) {
        first ??= new Error(
          `fixture "${one.name}" teardown failed: ${messageOf(err)}`,
        );
        if (err instanceof Error && err.stack) first.stack = err.stack;
      } finally {
        clearTimeout(timer);
      }
    }
    return first;
  }

  private ensure(name: string, level: number): Promise<void> {
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
      if (def.setup) {
        const started = await startSetup(def, args);
        if (this.closed) {
          started.release();
          throw new Error("the test is already over");
        }
        value = started.value;
        this.started.push({ name, ...started });
      }
      this.values.set(`${name}#${level}`, value);
      if (level === (this.layers.get(name)?.length ?? 0) - 1)
        Object.defineProperty(this.fixtures, name, {
          value,
          enumerable: true,
          configurable: true,
          writable: true,
        });
    } catch (err) {
      throw err instanceof FixtureSetupError
        ? err
        : new FixtureSetupError(name, err);
    }
  }
}
