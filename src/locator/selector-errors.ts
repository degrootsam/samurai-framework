/** The browser rejected a selector (bad css or xpath); retrying cannot help */
export class InvalidSelectorError extends Error {
  public readonly selector: string;

  constructor(selector: string, reason: string) {
    super(`Invalid selector ${selector}: ${reason}`);
    this.name = "InvalidSelectorError";
    this.selector = selector;
  }
}

/** The browser does not implement this kind of locator */
export class UnsupportedOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedOperationError";
  }
}
