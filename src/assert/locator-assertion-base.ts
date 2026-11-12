import { resolveTimeout } from "../config/timeouts.js";
import type Locator from "../locator/locator.js";
import { waitUntil, WaitTimeoutError } from "../wait/wait-until.js";
import { AssertionError } from "./assertion-error.js";
import { track } from "./pending-assertions.js";
import { bindOutput } from "../wait/output-sink.js";
import { captured, normalizedTextCheck, textCheck } from "./text-match.js";

export interface LocatorAssertionOptions {
  /** Time (ms) to keep retrying. Defaults to config `expect.timeout`, then 5000 */
  timeout?: number;
}

/** The options of the checks that can keep the text they found */
export interface TextAssertionOptions extends LocatorAssertionOptions {
  /** Saves the text that passed (a RegExp's first group, else its match) as this output of the running test */
  output?: string;
}

/** What `readEventually` reads, what it waits for and how its failure is named */
export interface EventualRead<V> {
  /** The matcher, with `not.` in front when negated */
  name: string;
  locator: Locator;
  expected: unknown;
  read: () => Promise<V>;
  /** True for the read that ends the wait */
  check: (actual: V) => boolean;
  /** Time (ms) to keep retrying. Defaults to the expect timeout */
  timeout?: number | undefined;
  /** A read of `null` (no element) never passes, and fails as "could not read" */
  mustExist?: boolean;
  /** The first line of a failure, instead of `expect(locator).<name>` */
  call?: string;
  /** What a failure shows as the received value, when the read is a wrapper around it */
  display?: (actual: V) => unknown;
}

/**
 * Re-reads the element until `check` passes or the timeout expires, and resolves with the read that passed. A
 * timeout fails as an `AssertionError` with the last read, or as "could not read" when no read completed.
 */
export async function readEventually<V>({
  name,
  locator,
  expected,
  read,
  check,
  timeout: perCall,
  mustExist = false,
  call,
  display,
}: EventualRead<V>): Promise<V> {
  const timeout = await resolveTimeout(perCall);
  try {
    return await waitUntil(
      read,
      (actual) => (mustExist && actual === null ? false : check(actual)),
      { timeout },
    );
  } catch (err) {
    if (!(err instanceof WaitTimeoutError)) throw err;
    // Reads never resolve to undefined, so an undefined `last` means no read completed
    if (err.last === undefined || (mustExist && err.last === null)) {
      throw new Error(
        `${call ?? `expect(locator).${name}`}: could not read ${locator.selector} within ${timeout}ms`,
      );
    }
    throw new AssertionError({
      matcher: name,
      expected,
      actual: display ? display(err.last) : err.last,
      locator: locator.selector,
      call,
    });
  }
}

export class LocatorAssertionBase {
  protected readonly locator: Locator;
  protected readonly negated: boolean;

  constructor(locator: Locator, negated = false) {
    this.locator = locator;
    this.negated = negated;
  }

  /** The matcher name as failures show it: `not.` in front when negated */
  protected matcherName(matcher: string): string {
    return this.negated ? `not.${matcher}` : matcher;
  }

  /**
   * Re-reads the element until `check` passes or the timeout expires. With `mustExist`, a read of `null`
   * (no element) never passes, with or without `.not`, and fails as "could not read"
   */
  protected assertEventually<V>(
    matcher: string,
    expected: unknown,
    read: () => Promise<V>,
    check: (actual: V) => boolean,
    options?: LocatorAssertionOptions,
    mustExist = false,
    save?: (actual: V) => void,
  ): Promise<void> {
    const name = this.negated ? `not.${matcher}` : matcher;

    return track(
      `expect(locator).${name}()`,
      readEventually({
        name,
        locator: this.locator,
        expected,
        read,
        check: (actual) => check(actual) !== this.negated,
        timeout: options?.timeout,
        mustExist,
      }).then((actual) => save?.(actual)),
    );
  }

  /**
   * A text check that can keep what it read: with `options.output` the read that passed goes to that output, as
   * `expected` captures it. The sink is taken now, when the call starts.
   */
  protected assertText(
    matcher: string,
    expected: string | RegExp,
    read: () => Promise<string | null>,
    mode: "exact" | "contains",
    options?: TextAssertionOptions,
    normalize = false,
  ): Promise<void> {
    let save: ((actual: string | null) => void) | undefined;
    if (options?.output !== undefined) {
      const call = `expect(locator).${this.negated ? "not." : ""}${matcher}`;
      if (this.negated)
        throw new Error(`${call}: output can’t be saved from a negated check`);
      const keep = bindOutput(call, options.output);
      save = (actual) => keep(captured(expected, actual!));
    }
    return this.assertEventually(
      matcher,
      expected,
      read,
      normalize
        ? normalizedTextCheck(expected, mode)
        : textCheck(expected, mode),
      options,
      false,
      save,
    );
  }

  /** For matchers that need an element: `read` answers null when there is none, which never passes */
  protected assertExisting<V>(
    matcher: string,
    expected: unknown,
    read: () => Promise<V | null>,
    check: (actual: V) => boolean,
    options?: LocatorAssertionOptions,
  ): Promise<void> {
    return this.assertEventually(
      matcher,
      expected,
      read,
      (actual) => actual !== null && check(actual),
      options,
      true,
    );
  }
}
