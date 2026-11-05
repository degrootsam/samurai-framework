/**
 * The time limit of one test. It starts once, and can be changed while the test runs: the new limit counts from
 * the start of the test, so the time already spent counts against it (a limit already passed ends the test now).
 */
export class TestTimeout {
  private timer: NodeJS.Timeout | undefined;
  private startedAt: number | undefined;
  private expired = false;

  constructor(
    private limit: number,
    private readonly onExpire: () => void,
  ) {}

  /** The limit in milliseconds; 0 means none */
  public get ms(): number {
    return this.limit;
  }

  /** Starts the clock; nothing can expire before this */
  public start(): void {
    this.startedAt = Date.now();
    this.arm();
  }

  /** Changes the limit, re-arming the timer from the start of the test */
  public set(ms: number): void {
    this.limit = ms;
    if (this.startedAt !== undefined && !this.expired) this.arm();
  }

  public stop(): void {
    clearTimeout(this.timer);
  }

  private arm(): void {
    clearTimeout(this.timer);
    if (this.limit === 0 || this.startedAt === undefined) return;
    const left = Math.max(0, this.limit - (Date.now() - this.startedAt));
    this.timer = setTimeout(() => {
      this.expired = true;
      this.onExpire();
    }, left);
  }
}

/** Checks a timeout in milliseconds; `label` starts the error (`setTimeout()`) */
export function checkTimeout(label: string, ms: unknown): number {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0)
    throw new Error(
      `${label}: the timeout must be a number of milliseconds, 0 or more`,
    );
  return ms;
}
