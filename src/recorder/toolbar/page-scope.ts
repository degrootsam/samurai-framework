/** What a wait on the page ends with when the page was left first */
export const LEFT = Symbol("left the page");

/**
 * Tracks which document the toolbar is working for. Work started for an older document must not be answered, and
 * Chrome never answers a command into a document that is being replaced, so such work stops being waited for.
 */
export class PageScope {
  private page = 0;
  /** Wake-ups for the work waiting on the current page: called, and forgotten, when the page changes */
  private readonly waiting = new Set<() => void>();

  /** Bumped on every page load */
  public get current(): number {
    return this.page;
  }

  /** A new document loaded */
  public enter(): void {
    this.page++;
    this.leave();
  }

  /** Lets what waits on the current document stop waiting */
  public leave(): void {
    const wakes = [...this.waiting];
    this.waiting.clear();
    for (const wake of wakes) wake();
  }

  /** Runs `work`, but stops waiting for it when the page is left; resolves `LEFT` then */
  public async whileOn<T>(work: () => Promise<T>): Promise<T | typeof LEFT> {
    let wake!: () => void;
    const left = new Promise<typeof LEFT>((resolve) => {
      wake = () => resolve(LEFT);
      this.waiting.add(wake);
    });
    try {
      return await Promise.race([work(), left]);
    } finally {
      this.waiting.delete(wake);
    }
  }
}
