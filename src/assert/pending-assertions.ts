/**
 * Locator assertions nobody has awaited yet that are still running or have failed,
 * mapped to their matcher name
 */
const pendingAssertions = new Map<Promise<void>, string>();

/**
 * Returns the matcher names of locator assertions that were never awaited and are
 * still running or already failed, and stops tracking them. The runner calls this
 * after a test to detect a missing `await`.
 */
export function takePendingAssertions(): string[] {
  const names = [...pendingAssertions.values()];
  pendingAssertions.clear();
  return names;
}

/**
 * Promise that stops being pending as soon as anyone subscribes to it. `await`,
 * `.catch`, `.finally`, `Promise.all` and `assert.rejects` all go through `then`
 * (`await` calls it because the constructor is not the native Promise).
 */
class TrackedAssertion extends Promise<void> {
  /** Promises derived through `then` are plain promises */
  static override get [Symbol.species]() {
    return Promise;
  }

  override then<TResult1 = void, TResult2 = never>(
    onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    pendingAssertions.delete(this);
    return super.then(onfulfilled, onrejected);
  }
}

export function track(
  matcher: string,
  assertion: Promise<void>,
): Promise<void> {
  const tracked = new TrackedAssertion((resolve, reject) => {
    assertion.then(resolve, reject);
  });
  pendingAssertions.set(tracked, matcher);
  // The native then does not count as awaiting: a pass stops tracking, a failure stays
  // tracked. Handling the rejection keeps an un-awaited failure from being unhandled.
  Promise.prototype.then.call(
    tracked,
    () => pendingAssertions.delete(tracked),
    () => {},
  );
  return tracked;
}
