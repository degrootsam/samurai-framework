/**
 * Something started on first use and shared by everyone who asks: concurrent callers get the same promise, a failed
 * start is forgotten so the next call tries again, and the finished value can be read without waiting (`peek`).
 */
export class Lazy<T> {
  private promise: Promise<T> | undefined;
  private value: T | undefined;

  /** Whether a start was made and not forgotten since (it may still be running or have failed and been kept) */
  public get started(): boolean {
    return this.promise !== undefined;
  }

  /**
   * The shared start, made by `factory` on the first call. `keepFailure` says which failures stay (every later call
   * gets the same rejection) instead of being forgotten.
   */
  public get(
    factory: () => Promise<T>,
    keepFailure: (err: unknown) => boolean = () => false,
  ): Promise<T> {
    if (this.promise) return this.promise;
    const started: Promise<T> = (async () => factory())().then(
      (value) => {
        if (this.promise === started) this.value = value;
        return value;
      },
      (err: unknown) => {
        if (this.promise === started && !keepFailure(err)) this.reset();
        throw err;
      },
    );
    this.promise = started;
    return started;
  }

  /** The value once the start finished, else undefined */
  public peek(): T | undefined {
    return this.value;
  }

  /** Forgets the start; the next `get` starts again */
  public reset(): void {
    this.promise = undefined;
    this.value = undefined;
  }

  /** Forgets the start and hands back its promise, for the caller to dispose; undefined when nothing was started */
  public take(): Promise<T> | undefined {
    const promise = this.promise;
    this.reset();
    return promise;
  }
}
