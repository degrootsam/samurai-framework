# Writing tests

## Test files

A test file ends in `.spec.ts` and lives under `srcDir` (see [Configuration](configuration.md)). Importing `test`, `describe` and `expect` from `api.js` registers tests when the file is loaded:

```ts
import { describe, expect, test } from "../api.js";

describe("Checkout", () => {
  describe("as a guest", () => {
    test("applies a coupon", async ({ page }) => {
      await page.goto("/cart");
      await page.getByLabel("Coupon").fill("SPRING");
      await page.getByRole("button", { name: "Apply" }).click();
      await expect(page.getByTestId("discount")).toHaveText("-10%");
    });
  });
});
```

- `test(title, fn)` registers a test. `fn` is an async function that receives the [fixtures](#fixtures).
- `describe(title, fn)` groups tests. The callback runs immediately, must be synchronous and only registers tests; it nests.
- The test's full name is the titles joined with `>`: `Checkout > as a guest > applies a coupon`. Results are keyed by file and full name, so equal titles in different files stay apart.
- Tests run one after the other, in the order the files are found and the tests are registered. Each test gets its own browser, started fresh and closed afterwards, so no cookies or storage carry over.

## Fixtures

The test function receives one object:

| Fixture   | Type             | What it is                                                                                                                 |
| --------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `page`    | `Page`           | The tab the test drives. See [Locators](locators.md) and [Pages and browsers](pages-and-browsers.md)                       |
| `browser` | `Browser`        | The browser process. Use it for extra [contexts and pages](pages-and-browsers.md#contexts)                                 |
| `env`     | read-only object | The chosen environment's `variables`. Reading a name that is not defined throws                                            |
| `secrets` | read-only object | Secrets by `UPPER_SNAKE_CASE` name. Reading one that is not set throws. See [secrets](environments-and-secrets.md#secrets) |

```ts
test("uses test data", async ({ page, env, secrets }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(String(env.testUser));
  await page.getByLabel("Password").fill(secrets.TEST_PASSWORD!);
});
```

## Going to a page

```ts
await page.goto("/products"); // resolved against the environment's baseURL
await page.goto("https://example.com", { wait: "interactive" });
```

A URL starting with `/`, `./` or `../` needs a `baseURL` (config, environment, or `page.setBaseURL(...)`); without one `goto` throws. Anything else is navigated to as is (`navigateTo` adds `https://` to a URL without a scheme). See [Navigation](pages-and-browsers.md#navigation).

## How a test ends

- **Passes** when the function resolves and nothing below applies.
- **Fails** when the function throws. The error, its type (`error`, `assertion` or `timeout`) and a stack go into the [report](running-and-reports.md).
- **Times out** after the environment's/project's `timeout` (default 30 s). The test is reported as timed out and its browser is closed.
- **Fails on a forgotten `await`.** `expect(locator).toBeVisible()` returns a promise. A matcher that was never awaited is reported as `expect(locator).toBeVisible() was not awaited`.
- **Can fail on page errors.** With `logs.failOnPageError: true`, a test that passed fails when the page threw an uncaught exception. Opt out inside a test with `page.allowPageErrors()`.

## Tips

- Prefer role, label and test-id [locators](locators.md); they survive layout changes better than CSS or XPath.
- Don't sleep. Actions and assertions wait for you; for anything else use [`waitFor`](locators.md#waiting-for-state), [`waitForLoadState`](pages-and-browsers.md#waiting), `waitForNetworkIdle` or `waitForResponse`.
- Keep passwords and tokens in `secrets`, never in `variables` or in the spec.
