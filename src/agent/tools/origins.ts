/** Which origins the agent may navigate to. The start page's origin is allowed; others need the person's yes */
export class OriginPolicy {
  private readonly allowed = new Set<string>();

  constructor(origins: readonly string[]) {
    for (const origin of origins) this.allowed.add(new URL(origin).origin);
  }

  /** The site a path is opened on when the page is not on a web page: the first origin given */
  public get base(): string {
    return [...this.allowed][0] ?? "";
  }

  public isAllowed(url: URL): boolean {
    return this.allowed.has(url.origin);
  }

  public allow(url: URL): void {
    this.allowed.add(url.origin);
  }

  /** The allowed origins, for messages */
  public list(): string[] {
    return [...this.allowed];
  }
}
