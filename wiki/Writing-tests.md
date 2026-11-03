<!-- markdownlint-disable MD041 -->

## Test files

A test file ends in `.spec.ts` and lives under `srcDir` (see [Configuration](Configuration)). Importing `test`, `describe` and `expect` from `@itmetsam/samurai-framework` registers tests when the file is loaded (in this repository's own `src/tests`, the import is `../api.js`):

```ts
import { describe, expect, test } from "@itmetsam/samurai-framework";

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

| Fixture       | Type                    | What it is                                                                                                                                      |
| ------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `page`        | `Page`                  | The tab the test drives. See [Locators](Locators) and [Pages and browsers](Pages-and-browsers)                                                  |
| `browser`     | `Browser`               | The browser process. Use it for extra [contexts and pages](Pages-and-browsers#contexts)                                                         |
| `browserName` | `"firefox" \| "chrome"` | The browser this run of the test is in. With several [`browsers`](Configuration#browsers) the test runs once in each                            |
| `workerIndex` | `number`                | The worker process running the test, from 0. It is 0 when the run has one worker or none; use it to give each worker its own account or data    |
| `env`         | read-only object        | The chosen environment's `variables`. Reading a name that is not defined throws                                                                 |
| `secrets`     | read-only object        | Secrets by `UPPER_SNAKE_CASE` name. Reading one that is not set throws. See [secrets](Environments-and-secrets#secrets)                         |
| `inputs`      | read-only object        | The test's declared [inputs](#inputs-and-outputs): the value the run supplies, else the default. Reading a name the test did not declare throws |
| `outputs`     | `{ save }`              | Saves the text values the test declared as [outputs](#inputs-and-outputs)                                                                       |

Tests may run at the same time, each in its own worker process and browser (see [Parallel runs](Running-tests-and-reports#parallel-runs)). Do not let two tests depend on the same account or data; give each its own, or pick one by `workerIndex`.

```ts
// The field is labelled differently in the two browsers' date pickers
test("books a date", async ({ page, browserName }) => {
  await page.goto("/booking");
  const label = browserName === "chrome" ? "Date" : "Date (yyyy-mm-dd)";
  await page.getByLabel(label).fill("2026-10-19");
});
```

```ts
test("uses test data", async ({ page, env, secrets }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(String(env.testUser));
  await page.getByLabel("Password").fill(secrets.TEST_PASSWORD!);
});
```

## Inputs and outputs

From 0.21.0. A test can declare named text **inputs**, each with a default, and **outputs**, text it reads from the page. In a [flow](Flows#inputs-and-outputs) a later test's input gets the output of the same name that an earlier test saved: an order number made by one test is searched for by the next.

```ts
test(
  "places an order",
  { inputs: { email: "guest@example.com" }, outputs: ["orderId", "total"] },
  async ({ page, inputs, outputs }) => {
    await page.goto("/checkout");
    await page.getByLabel("Email").fill(inputs.email);
    await page.getByRole("button", { name: "Place order" }).click();
    await outputs.save(
      "orderId",
      page.getByTestId("confirmation"),
      /Order #(\d+)/,
    );
    await expect(page.getByTestId("total")).toHaveText(/€[\d.]+/, {
      output: "total",
    });
  },
);
```

- **Declaring.** `test`, `test.only`, `test.skip` and `test.fixme` take an options object before the body: `{ reason?, inputs?, outputs? }`. `inputs` maps each name to its default (a string); `outputs` lists names. `reason` only applies to `skip` and `fixme`: on `test` and `test.only` it throws.
- **Names** are identifiers (letters, digits and `_`, not starting with a digit). `status`, `durationMs` and `error` (a flow node's own result fields) and `__proto__`, `constructor` and `prototype` are not allowed, and an output can't be listed twice. A bad name throws when the test is registered, for example `test(): output "order-id" is not a valid name`.
- **`inputs`** gives each declared input the value the run supplies, else its default. A test run on its own (`samurai run`) uses the defaults. Reading an undeclared name throws `inputs.x: not declared, add it to the test's inputs`.
- **`outputs.save(name, locator, pattern?)`** waits, up to the [expect timeout](Assertions), for the element to have text and saves its trimmed text. Without a pattern it waits for non-empty text; with one it waits until the text matches and saves the pattern's first capture group, else the whole match. It fails like a `toHaveText` that timed out, and must be awaited.
- **`{ output }`** saves a value on the way: `fill(value, { output })` saves the typed value, and `toHaveText`, `toContainText`, `toHaveValue` and `toHaveAttribute` save the value that passed (a `RegExp`'s first group, else its match; with a string, the whole value read). Not with `.not`, and only inside a test. See [Assertions](Assertions#saving-what-passed-as-an-output).
- **Every declared output must be saved.** A test that passes without saving one fails with `output "total" was never saved`, so a flow never goes on with an empty value. Saving a name the test did not declare throws.
- **Results** carry them: a test's result has `inputs` (the values it read) and `outputs` (what it saved), each absent when the test declares none. `listTests` gives each test's declared `inputs` (with defaults) and `outputs`; `runTests({ inputs })` supplies values (see [Embedding](Embedding-the-framework#running-tests-from-code)).

Inputs and outputs are plain text, never secrets: keep passwords in `secrets`.

## Going to a page

```ts
await page.goto("/products"); // resolved against the environment's baseURL
await page.goto("https://example.com", { wait: "interactive" });
```

A URL starting with `/`, `./` or `../` needs a `baseURL` (config, environment, or `page.setBaseURL(...)`); without one `goto` throws. Anything else is navigated to as is (`navigateTo` adds `https://` to a URL without a scheme). See [Navigation](Pages-and-browsers#navigation).

## How a test ends

- **Passes** when the function resolves and nothing below applies.
- **Fails** when the function throws. The error, its type (`error`, `assertion` or `timeout`) and a stack go into the [report](Running-tests-and-reports).
- **Times out** after the environment's/project's `timeout` (default 30 s). The test is reported as timed out and its browser is closed.
- **Fails when a declared output was never saved.** See [Inputs and outputs](#inputs-and-outputs).
- **Fails on a forgotten `await`.** `expect(locator).toBeVisible()` returns a promise. A matcher that was never awaited is reported as `expect(locator).toBeVisible() was not awaited`.
- **Can be run again.** With `retries` set, a failing test is run again with a fresh browser; see [Retries](#retries).
- **Can fail on page errors.** With `logs.failOnPageError: true`, a test that passed fails when the page threw an uncaught exception. Opt out inside a test with `page.allowPageErrors()`.

## Skipping, focusing and fixing later

```ts
import { describe, expect, test } from "@itmetsam/samurai-framework";

test.skip("old checkout", async ({ page }) => {}); // registered, never run
test.fixme("coupon on staging", async ({ page }) => {}); // like skip: known to be broken, fix later
test.only("focus on this one", async ({ page }) => {}); // only the focused tests run

describe.skip("legacy", () => {
  /* every test inside is skipped */
});
describe.fixme("flaky area", () => {
  /* ... */
});
describe.only("new area", () => {
  /* every test inside is focused */
});

// Say why, with an optional { reason } before the body
test.skip(
  "checkout v2",
  { reason: "waits for the new payments API" },
  async ({ page }) => {},
);
describe.fixme("search", { reason: "flaky on staging" }, () => {
  /* every test inside gets the reason */
});

test("needs Chrome", async ({ page, browserName }) => {
  test.skip(browserName !== "chrome", "needs Chrome"); // skips this test from the inside
  // ...
});
```

- **`skip` and `fixme`** register the test but do not run it. It never launches a browser and is reported as `skipped` with `annotation: "skip"` or `"fixme"`. A modifier on a `describe` applies to every test inside it, also in nested blocks.
- **`{ reason }`** between the title and the body of `test.skip`, `test.fixme`, `describe.skip` and `describe.fixme` says why the tests are not run. It is optional. The reason shows in the console, the report and `samurai list`. A test gets the reason of the skip or fixme that applies to it: its own, else the closest `describe` around it.
- **`only`** narrows the run: when any selected test is focused, only the focused ones run, and the others are not run and not reported. It applies after `--group` and `--grep` have chosen the tests, so a focused test they leave out narrows nothing. A skip wins over a focus: a `test.skip` inside a `describe.only` stays skipped.
- **`test.skip(condition, reason)`** inside a test ends it as skipped when the condition is true (the reason goes into the report); when it is false nothing happens. The browser has launched by then, and the rest of the test does not run. `test.fixme(condition, reason)` is the same with the `fixme` annotation.
- **`forbidOnly`** refuses a run that contains a `.only`, so a forgotten focus cannot shrink a suite unseen. It is on by default when `CI` is set, see [Configuration](Configuration#forbidonly).

Skipped tests count in the run (`run-start.total`) and in the report, never as failures: a run whose tests passed or were skipped succeeds. See [Running tests and reports](Running-tests-and-reports#skipped-tests).

## Hooks

`beforeEach`, `afterEach`, `beforeAll` and `afterAll` come from the package, like `test`:

```ts
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  test,
} from "@itmetsam/samurai-framework";

describe("checkout", () => {
  beforeAll(async ({ env }) => {
    /* once per worker, no page: seed data over HTTP, say */
  });
  beforeEach(async ({ page }) => {
    await page.goto("/cart");
  });
  afterEach(async ({ page }) => {
    /* runs after every test of the block */
  });
  afterAll(async ({ env }) => {
    /* when the worker is done */
  });

  test("pays", async ({ page }) => {
    /* the page is already on /cart */
  });
});
```

- **Scope.** A hook belongs to the `describe` it is written in, or to the file when it is at the top level. It applies to every test below it, in nested blocks too.
- **Order.** `beforeEach` runs outermost block first, `afterEach` innermost first, and the hooks of one block in the order they are written.
- **What they get.** `beforeEach` and `afterEach` get the test's [fixtures](#fixtures), `page` included, in the test's browser. `beforeAll` and `afterAll` get only `env`, `secrets`, `browserName` and `workerIndex`: no page, as they run once for many tests.
- **Time.** `beforeEach` and `afterEach` run inside the test's time limit. `beforeAll` and `afterAll` each have their own, the config's `timeout`.

When a hook fails:

- A failing `beforeEach` fails the test with `beforeEach hook failed: <message>`. The body does not run, and the `afterEach` hooks still do.
- `afterEach` runs after a passing, failing or skipped body. It does **not** run after a timeout, an abort or a closed browser: the time or the page is gone. A failing `afterEach` fails a passing test; when the body failed too, the body's error is the one reported.
- A failing `beforeAll` fails every test of its scope that the worker runs, each with `beforeAll hook failed: <message>`. The hook is not tried again on that worker, and its `afterAll` still runs.
- `test.skip(condition, reason)` inside a `beforeEach` skips the test.
- An `afterAll` error is written to `logs/combined.log`. It is not attached to a test, as those have ended.

`beforeAll` and `afterAll` run once per worker, scope and browser, so with N workers a `beforeAll` can run up to N times (once in a run with one worker). `afterAll` runs when the worker is done, which is the end of the run, not right after its `describe`. See [Parallel runs](Running-tests-and-reports#parallel-runs).

## Retries

A test that fails is run again, each time with a fresh browser, up to `retries` more times (config `retries`, `--retries <n>` or `SAMURAI_RETRIES`; the default is 0, so nothing is run again). It stops at the first pass.

```sh
samurai run --retries 2    # a failing test gets up to three runs in all
```

- **What is run again.** Every failure: an error, a failed assertion, a timeout. Not an aborted run, and not a test that skips itself (`test.skip(condition)`): it ends there. A worker process that dies during a test fails the test without a retry (the pool starts a new worker for the next test).
- **Hooks.** `beforeEach` and `afterEach` run again with every attempt. `beforeAll` and `afterAll` belong to the worker and do not run again.
- **Flaky.** A test that passes after a failed attempt is a pass: the run does not fail. Its result says `flaky: true` and keeps the errors of the failed attempts (`previousAttempts`), so flaky tests can be found. See [Retries in the report](Running-tests-and-reports#retries).
- **A test that fails every attempt** is reported once, as failed, with the last attempt's error and the earlier ones in `previousAttempts`.
- **Screenshots** of a retry go to a `retry-<n>` folder next to the first attempt's, so no attempt overwrites another.

Retries hide a test that is unreliable, they do not fix it: treat a flaky result as a bug to look at.

## Tips

- Prefer role, label and test-id [locators](Locators); they survive layout changes better than CSS or XPath.
- Don't sleep. Actions and assertions wait for you; for anything else use [`waitFor`](Locators#waiting-for-state), [`waitForLoadState`](Pages-and-browsers#waiting), `waitForNetworkIdle` or `waitForResponse`.
- Keep passwords and tokens in `secrets`, never in `variables` or in the spec.
