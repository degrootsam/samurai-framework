import { resolveTimeout } from "../config/timeouts.js";
import { waitUntil, WaitTimeoutError } from "../wait/wait-until.js";
import { AssertionError } from "./assertion-error.js";
import { track } from "./pending-assertions.js";
import type { ValueAssertions } from "./value-assertions.js";

/** Pauses (ms) between tries; the last one repeats */
const DEFAULT_INTERVALS = [100, 250, 500, 1000];

export interface RetryOptions {
  /** Time (ms) to keep trying; 0 tries once */
  timeout?: number;
  /** Pauses (ms) between tries; the last one repeats. Default: 100, 250, 500, then 1000 */
  intervals?: number[];
}

export interface PollOptions extends RetryOptions {
  /** Replaces the first line of a failure (`expect.poll().<matcher>`) */
  message?: string;
}

/** The value matchers of `expect(value)`, each returning a promise that settles once the polled value passes (or the time is up) */
export type PollAssertions<T> = {
  [K in keyof Omit<ValueAssertions<T>, "not">]: ValueAssertions<T>[K] extends (
    ...args: infer A
  ) => unknown
    ? (...args: A) => Promise<void>
    : never;
} & { readonly not: PollAssertions<T> };

function asError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

interface Attempt {
  /** What the try threw, if it did */
  error?: unknown;
}

/**
 * `expect(block).toPass()`: runs `block` (sync or async) until it stops throwing. The default timeout is 0, one try.
 * With `negated`, until it throws. A failure rethrows the last error as it was.
 */
export function toPass(
  block: () => unknown,
  options: RetryOptions | undefined,
  negated: boolean,
): Promise<void> {
  const timeout = options?.timeout ?? 0;
  const name = negated ? "not.toPass" : "toPass";
  const run = async (): Promise<void> => {
    try {
      await waitUntil<Attempt>(
        async () => {
          try {
            await block();
            return {};
          } catch (error) {
            return { error: error ?? new Error("undefined") };
          }
        },
        (attempt) => (attempt.error === undefined) !== negated,
        { timeout, intervals: options?.intervals ?? DEFAULT_INTERVALS },
      );
    } catch (err) {
      if (!(err instanceof WaitTimeoutError)) throw err;
      const last = err.last as Attempt | undefined;
      if (last === undefined) {
        throw new Error(`expect(value).${name}: timed out after ${timeout}ms`);
      }
      if (negated) {
        throw new AssertionError({
          matcher: name,
          expected: "the block to throw",
          actual: "it did not throw",
        });
      }
      throw asError(last.error);
    }
  };
  return track(`expect(value).${negated ? "not." : ""}toPass()`, run());
}

/** Runs one matcher of `ValueAssertions` against `value` once; an `AssertionError` is a failed try, anything else (a misused matcher) propagates */
async function tryMatcher(
  value: unknown,
  negated: boolean,
  matcher: string,
  args: unknown[],
): Promise<Attempt> {
  const { ValueAssertions } = await import("./value-assertions.js");
  try {
    const assertions = new ValueAssertions(value, negated) as unknown as Record<
      string,
      (...args: unknown[]) => void
    >;
    assertions[matcher]!(...args);
    return {};
  } catch (error) {
    if (error instanceof AssertionError) return { error };
    throw error;
  }
}

async function pollMatcher(
  fn: () => unknown,
  options: PollOptions | undefined,
  negated: boolean,
  matcher: string,
  args: unknown[],
): Promise<void> {
  const timeout = await resolveTimeout(options?.timeout);
  const name = negated ? `not.${matcher}` : matcher;
  const call = options?.message ?? `expect.poll().${name}`;
  try {
    await waitUntil<Attempt>(
      async () => {
        let value: unknown;
        try {
          value = await fn();
        } catch (error) {
          return { error };
        }
        return tryMatcher(value, negated, matcher, args);
      },
      (attempt) => attempt.error === undefined,
      { timeout, intervals: options?.intervals ?? DEFAULT_INTERVALS },
    );
  } catch (err) {
    if (!(err instanceof WaitTimeoutError)) throw err;
    const last = err.last as Attempt | undefined;
    if (last === undefined) {
      throw new Error(`expect.poll().${name}: timed out after ${timeout}ms`);
    }
    if (last.error instanceof AssertionError) {
      throw new AssertionError({
        matcher: last.error.matcher,
        expected: last.error.expected,
        actual: last.error.actual,
        call,
      });
    }
    throw new Error(
      `expect.poll().${name}: the function threw: ${asError(last.error).message}`,
    );
  }
}

/**
 * `expect.poll(fn)`: the value matchers of `expect(value)`, each calling `fn` (sync or async) again and again until
 * the matcher passes or the time is up. The timeout defaults to the expect timeout; 0 tries once.
 * A function that throws counts as a failed try.
 */
export function poll<T>(
  fn: () => T | Promise<T>,
  options?: PollOptions,
  negated = false,
): PollAssertions<Awaited<T>> {
  const target = {};
  return new Proxy(target, {
    get(_target, property) {
      if (property === "not") return poll(fn, options, !negated);
      // Only matchers: anything else (`then`, which would make the object awaitable) is not there
      if (typeof property !== "string" || !/^to[A-Z]/.test(property))
        return undefined;
      return (...args: unknown[]) =>
        track(
          `expect.poll().${negated ? "not." : ""}${property}()`,
          pollMatcher(fn, options, negated, property, args),
        );
    },
  }) as PollAssertions<Awaited<T>>;
}
