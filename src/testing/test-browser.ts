import { test as nodeTest } from "node:test";
import type { SupportedBrowser } from "../types/browser.js";

const BROWSERS: readonly SupportedBrowser[] = ["firefox", "chrome"];

/** The browser the browser tests run on: `SAMURAI_TEST_BROWSER` (firefox or chrome), else Firefox */
export function testBrowser(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): SupportedBrowser {
  const name = env.SAMURAI_TEST_BROWSER;
  if (!name) return "firefox";
  if (!(BROWSERS as readonly string[]).includes(name))
    throw new Error(
      `Unknown SAMURAI_TEST_BROWSER "${name}". Choose ${BROWSERS.join(" or ")}.`,
    );
  return name as SupportedBrowser;
}

/** Config of a test project that runs on the browser under test */
export const browserConfig = (browser: SupportedBrowser = testBrowser()) => ({
  browser,
});

type TestFn = (...args: any[]) => unknown;
/** The test body, with the options `node:test` takes in front of it (a timeout, say) when there are any */
type TestBody = [fn: TestFn] | [options: object, fn: TestFn];

/** What the wrappers need of `node:test`; tests pass a fake */
export interface TestRegistrar {
  (name: string, ...body: TestBody): unknown;
  skip(name: string, ...body: TestBody): unknown;
}

/** The wrappers for a registrar and the browser under test; `onlyOn` and `skipOn` below use `node:test` and `testBrowser()` */
export function browserTests(
  registrar: TestRegistrar,
  current: SupportedBrowser,
) {
  const register = (
    runs: boolean,
    reason: string,
    name: string,
    body: TestBody,
  ) =>
    runs
      ? registrar(name, ...body)
      : registrar.skip(`${name} (skipped on ${current}: ${reason})`, ...body);
  return {
    /** A test that is only true of `browser`; on the other browser it is reported as skipped, with the reason */
    onlyOn: (
      browser: SupportedBrowser,
      reason: string,
      name: string,
      ...body: TestBody
    ) => register(current === browser, reason, name, body),
    /** A test that is true of every browser except `browser`; on that one it is reported as skipped, with the reason */
    skipOn: (
      browser: SupportedBrowser,
      reason: string,
      name: string,
      ...body: TestBody
    ) => register(current !== browser, reason, name, body),
  };
}

export const { onlyOn, skipOn } = browserTests(
  nodeTest as unknown as TestRegistrar,
  testBrowser(),
);
