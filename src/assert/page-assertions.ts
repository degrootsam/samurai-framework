import type Page from "../browser/page.js";
import { resolveTimeout } from "../config/timeouts.js";
import { waitUntil, WaitTimeoutError } from "../wait/wait-until.js";
import { AssertionError } from "./assertion-error.js";
import { track } from "./pending-assertions.js";
import { matchesText } from "./text-match.js";

export interface PageAssertionOptions {
  /** Time (ms) to keep retrying. Defaults to config `expect.timeout`, then 5000 */
  timeout?: number;
}

export class PageAssertions {
  private readonly page: Page;
  private readonly negated: boolean;

  constructor(page: Page, negated = false) {
    this.page = page;
    this.negated = negated;
  }

  /** Inverts the next matcher: it retries until the condition is false */
  get not(): PageAssertions {
    return new PageAssertions(this.page, !this.negated);
  }

  /**
   * Re-reads the page until `check` passes or the timeout expires. A read that throws on an open page
   * (a navigation in progress) counts as "no value yet" and never passes, with or without `.not`;
   * a closed page fails at once with the page's error
   */
  private assertEventually(
    matcher: string,
    what: string,
    expected: unknown,
    read: () => Promise<string>,
    check: (actual: string) => boolean,
    options?: PageAssertionOptions,
  ): Promise<void> {
    const name = this.negated ? `not.${matcher}` : matcher;

    return track(
      name,
      (async () => {
        const timeout = await resolveTimeout(options?.timeout);
        const safeRead = async (): Promise<string | null> => {
          try {
            return await read();
          } catch (err) {
            if (this.page.closed) throw err;
            return null;
          }
        };
        try {
          await waitUntil(
            safeRead,
            (actual) => actual !== null && check(actual) !== this.negated,
            { timeout },
          );
        } catch (err) {
          if (!(err instanceof WaitTimeoutError)) throw err;
          if (err.last === undefined || err.last === null) {
            throw new Error(
              `expect(page).${name}: could not read the page ${what} within ${timeout}ms`,
            );
          }
          throw new AssertionError({
            matcher: name,
            expected,
            actual: err.last,
            locator: "page",
          });
        }
      })(),
    );
  }

  /**
   * The page URL equals `expected` (string) or matches it (RegExp, tested on the full URL). A string starting
   * with "/", "./" or "../" resolves against the base URL like `page.goto`; any other string must equal the URL
   */
  toHaveURL(expected: string | RegExp, options?: PageAssertionOptions) {
    let target: string | RegExp;
    try {
      target =
        typeof expected === "string"
          ? this.page.resolveURL(expected, "toHaveURL")
          : expected;
    } catch (err) {
      return Promise.reject(err);
    }
    return this.assertEventually(
      "toHaveURL",
      "URL",
      target,
      () => this.page.url(),
      (url) => matchesText(url, target, "exact"),
      options,
    );
  }

  /** The trimmed page title equals `expected` (string) or matches it (RegExp) */
  toHaveTitle(expected: string | RegExp, options?: PageAssertionOptions) {
    return this.assertEventually(
      "toHaveTitle",
      "title",
      expected,
      async () => (await this.page.title()).trim(),
      (title) => matchesText(title, expected, "exact"),
      options,
    );
  }
}
