import type { SupportedBrowser } from "../types/browser.js";
import type {
  AllHookFixtures,
  RegisteredTestCase,
  Suite,
} from "../types/test.js";
import { runHook, type HookError } from "./hooks.js";
import { suiteChain } from "./suite.js";

export interface AllHooksOptions {
  /** The limit of each beforeAll / afterAll hook, in ms */
  timeout: number;
  /** The fixtures the hooks of a browser get */
  fixtures(browser: SupportedBrowser): AllHookFixtures;
}

/** A suite entered in a browser: settles when its `beforeAll` hooks are done, rejects with the first one that failed */
interface Scope {
  suite: Suite;
  browser: SupportedBrowser;
  ready: Promise<void>;
}

/**
 * The `beforeAll` and `afterAll` hooks of one worker: each runs once per suite and browser, `beforeAll` when the
 * first test of the suite arrives and `afterAll` when the worker is done
 */
export class AllHooks {
  private readonly scopes = new Map<Suite, Map<SupportedBrowser, Scope>>();
  /** In the order the suites were entered */
  private readonly entered: Scope[] = [];

  constructor(private readonly options: AllHooksOptions) {}

  /** Runs the `beforeAll` hooks of the suites around `test` that this worker has not run for `browser`. Rejects with the `HookError` of one that failed, now or earlier */
  public async ensure(
    test: RegisteredTestCase,
    browser: SupportedBrowser,
  ): Promise<void> {
    for (const suite of suiteChain(test.suite)) {
      if (!suite.beforeAll?.length && !suite.afterAll?.length) continue;
      await this.enter(suite, browser).ready;
    }
  }

  /** Runs the `afterAll` hooks of every suite entered, last entered first, and returns the errors; a second call has nothing to do */
  public async closeAll(): Promise<HookError[]> {
    const errors: HookError[] = [];
    const entered = this.entered.splice(0).reverse();
    this.scopes.clear();
    for (const { suite, browser, ready } of entered) {
      await ready.catch(() => undefined);
      for (const hook of suite.afterAll ?? []) {
        try {
          await runHook(
            "afterAll",
            hook,
            this.options.fixtures(browser),
            this.options.timeout,
          );
        } catch (error) {
          errors.push(error as HookError);
        }
      }
    }
    return errors;
  }

  private enter(suite: Suite, browser: SupportedBrowser): Scope {
    const ofSuite = this.scopes.get(suite) ?? new Map();
    this.scopes.set(suite, ofSuite);
    const known = ofSuite.get(browser);
    if (known) return known;
    const scope: Scope = {
      suite,
      browser,
      ready: this.runBefore(suite, browser),
    };
    // Rejections are handled by the callers of `ensure`; one nobody waits for is not an error of the process
    scope.ready.catch(() => undefined);
    ofSuite.set(browser, scope);
    this.entered.push(scope);
    return scope;
  }

  private async runBefore(
    suite: Suite,
    browser: SupportedBrowser,
  ): Promise<void> {
    for (const hook of suite.beforeAll ?? [])
      await runHook(
        "beforeAll",
        hook,
        this.options.fixtures(browser),
        this.options.timeout,
      );
  }
}
