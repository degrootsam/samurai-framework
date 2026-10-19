/** Thrown by `test.skip(condition, reason)` and `test.fixme(condition, reason)` inside a test: the test ends as skipped */
export class SkipSignal extends Error {
  constructor(
    public readonly annotation: "skip" | "fixme",
    public readonly reason?: string,
  ) {
    super(reason ?? "skipped");
    this.name = "SkipSignal";
  }
}

export function isSkipSignal(error: unknown): error is SkipSignal {
  return error instanceof SkipSignal;
}
