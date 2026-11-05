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
- Tests run one after the other, in the order the files are found and the tests are registered. Each test gets its own browser, started fresh and closed afterwards, so no cookies or storage carry over. Tests that depend on each other can be put in a [serial block](#serial-mode).

## Serial mode

Tests that build on each other (create, edit, delete) belong in a serial block. Its tests run in order on the same worker, and when one fails the rest of the block is not run:

```ts
test.describe.serial("order", () => {
  test.beforeAll(() => {
    /* once for the block */
  });

  test("creates", async ({ page }) => {
    /* ... */
  });
  test("pays", async ({ page }) => {
    /* ... */
  });
  test("ships", async ({ page }) => {
    /* ... */
  });
});
```

- **Ways to write it.** `test.describe.serial(title, fn)`, or `test.describe.configure({ mode: "serial" })` as the first line of a `describe` block. At the top of a file the same call makes the whole file one block. `test.describe.parallel(title, fn)` and `mode: "parallel"` are the other way round (see [Parallel runs](Running-tests-and-reports#parallel-runs)); `mode: "default"` takes a block back to what the config says. `describe.configure` accepts only `mode`; anything else is an error (`describe.configure(): unknown option "retries"`).
- **A failure skips the rest.** The tests after the failed one are reported as `skipped` (`annotation: "skip"`) with the reason `serial: an earlier test failed`, and they never start a browser. The run fails because of the test that failed. A test that skips itself (`test.skip(condition)`) or is marked `skip` does not stop the block.
- **Retries run the whole block again.** With `retries` ([Retries](#retries)), a failing test in a serial block does not run alone again: the block starts over from its first test, with a new worker (the old one leaves and runs its `afterAll` hooks), so state left by the first attempt is gone. Each test is still one result, from the last attempt, with `retry` saying which attempt that was, and `previousAttempts` holding the errors of the test that failed before. A test in the block that passed before the failure and again after it is marked `retry` but not `flaky`. The console and the report show a test of a block once the block's last attempt is known; without retries each test is shown as it ends.
- **Hooks.** `beforeAll` and `afterAll` of the block run once per attempt at the block, on the worker that runs it. `beforeEach` and `afterEach` run for every test as usual.
- **Nesting.** A `describe` inside a serial block is part of the block; the outermost serial block counts. A block is never split over workers or [shards](Running-tests-and-reports#sharding), also not with `fullyParallel`.
- **Groups and filters.** A block is made of the tests that are selected: `--grep`, `--group` and a `test.only` can leave tests out, and the rest still run in order. A group with `workers: 1` and a serial block combine: nothing in the group runs beside the block.

## Fixtures

The test function receives one object:

| Fixture       | Type                    | What it is                                                                                                                                                                           |
| ------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `page`        | `Page`                  | The tab the test drives. See [Locators](Locators) and [Pages and browsers](Pages-and-browsers)                                                                                       |
| `browser`     | `Browser`               | The browser process. Use it for extra [contexts and pages](Pages-and-browsers#contexts)                                                                                              |
| `browserName` | `"firefox" \| "chrome"` | The browser this run of the test is in. With several [`browsers`](Configuration#browsers) the test runs once in each                                                                 |
| `workerIndex` | `number`                | The worker process running the test, from 0. It is 0 when the run has one worker or none; use it to give each worker its own account or data                                         |
| `env`         | read-only object        | The chosen environment's `variables`. Reading a name that is not defined throws                                                                                                      |
| `secrets`     | read-only object        | Secrets by `UPPER_SNAKE_CASE` name. Reading one that is not set throws. See [secrets](Environments-and-secrets#secrets)                                                              |
| `inputs`      | read-only object        | The test's declared [inputs](#inputs-and-outputs): the value the run supplies, else the default. Reading a name the test did not declare throws                                      |
| `outputs`     | `{ save }`              | Saves the text values the test declared as [outputs](#inputs-and-outputs)                                                                                                            |
| `context`     | `BrowserContext`        | The browser context of `page` (cookies, storage); the same object as `page.context()`                                                                                                |
| `baseURL`     | `string \| undefined`   | The run's `baseURL` (the environment's, else the project's); `undefined` when none is set                                                                                            |
| `request`     | `APIRequestContext`     | Makes HTTP requests without the browser, with its own cookies: `await request.get("/api/users")`. See [API requests](API-requests); `page.request` shares the page's cookies instead |
| `testInfo`    | `TestInfo`              | About the running test, see [Test info](#test-info)                                                                                                                                  |
| `isMobile`    | `boolean`               | Whether the page runs as a phone (`use.isMobile`, [Chrome only](#use-options)); always `false` on Firefox                                                                            |
| `hasTouch`    | `boolean`               | Whether the page has touch input (`use.hasTouch`, [Chrome only](#use-options)); always `false` on Firefox                                                                            |

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

## Your own fixtures

`test.extend` returns a `test` that also has the fixtures you define. A fixture is a value, or a function that sets something up, hands it to the test with `use`, and cleans up after `use` returns:

```ts
import { test as base, expect } from "@itmetsam/samurai-framework";

const test = base.extend<{ shop: ShopPage; admin: { token: string } }>({
  shop: async ({ page, baseURL }, use) => {
    await page.goto(`${baseURL}/shop`);
    await use(new ShopPage(page)); // the test runs here
    // anything after use() runs once the test and its afterEach hooks are done
  },
  admin: async ({ secrets }, use) => {
    const token = await login(secrets.ADMIN_PASSWORD!);
    await use({ token });
    await logout(token);
  },
});

test("adds to the cart", async ({ shop }) => {
  await shop.add("Sword");
  await expect(shop.cart).toHaveText("1");
});
```

- **Lazy.** A fixture is set up only when a test or hook destructures it. `admin` above is not set up for a test that asks for `shop` alone. The destructuring is read from the function's source, so write it in the parameter list (`async ({ shop }) => ...`); a function that takes the fixtures whole (`async (f) => ...`) gets only the built-in ones, and `({ ...all })` sets every custom fixture up.
- **Dependencies.** A fixture destructures the built-in fixtures (`page`, `context`, `baseURL`, `testInfo`, `isMobile`, ...) and other custom ones in its own first parameter, and takes `{}` when it needs none. They are set up first and torn down last. A fixture that depends on an unknown one, or on itself through others, throws `extend(): ...` when `extend` is called.
- **One instance per test.** The `beforeEach` and `afterEach` hooks and the body of a test get the same instance. Fixtures are torn down in reverse order after the `afterEach` hooks, also when the test failed or timed out. A setup error fails the test as `fixture "shop" setup failed: ...`; a teardown error fails a passing test as `fixture "shop" teardown failed: ...`.
- **Auto fixtures.** `[async ({ page }, use) => {...}, { auto: true }]` is set up for every test, before the `beforeEach` hooks, whether or not anything asks for it.
- **Values.** A fixture that is not a function is handed over as it is (`answer: 42`). To use a function or an array as the value, set it up with `use`: an array of two with an options object second is read as `[fixture, options]`.
- **Overriding.** A fixture with the name of a built-in one replaces it for the tests of that `test` (`baseURL: "http://localhost:3000"`); inside, asking for the same name gets the one it replaces, so `page: async ({ page }, use) => ...` wraps the built-in page. This works the same when you extend an extended `test`.
- **Chaining.** `base.extend(...)` can be extended again. The result has the whole API (`describe`, `beforeEach`, `skip`, `use`, `info`, ...), and its tests are registered like any other, so `samurai list`, groups and the recorder find them. Hooks written on an extended `test` get its custom fixtures.
- **Only per test.** `{ scope: "test" }` is the only scope; worker-scoped fixtures are not supported (`extend()` throws). Share expensive setup between tests with `beforeAll`.

The types follow: give `extend` the fixtures' types as its generic, and the destructured names are typed in the body and the hooks. Put the extended `test` in a module of its own and import it in the specs.

## Test info

`testInfo` (a fixture) and `test.info()` (callable in the test body and in `beforeEach` / `afterEach` hooks, and the same object) tell a test about itself. `test.info()` throws `info(): no test is running` anywhere else, such as in `beforeAll`.

| Field                                       | What it is                                                                                                                                                                                                                       |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`, `titlePath`                        | The test's title, and the `describe` titles followed by it                                                                                                                                                                       |
| `file`, `line`, `column`                    | Absolute path of the spec and where `test(...)` is written (`line` and `column` are left out when unknown)                                                                                                                       |
| `retry`                                     | The attempt, from 0: 1 is the first run again (see [Retries](#retries))                                                                                                                                                          |
| `workerIndex`                               | Same as the fixture                                                                                                                                                                                                              |
| `project.name`                              | The name of the [group](Configuration#groups) being run (a Playwright "project" is a group here), else the browser name                                                                                                          |
| `config`                                    | `{ baseURL, timeout }` of the run                                                                                                                                                                                                |
| `annotations`                               | An array you can push `{ type, description? }` to; the notes are listed in the report entry                                                                                                                                      |
| `status`, `expectedStatus`                  | `status` is `undefined` while the body runs, then `"passed"`, `"failed"` or `"skipped"` before the `afterEach` hooks; `expectedStatus` is `"passed"`, or `"failed"` after [`test.fail()`](#steps-expected-failures-and-timeouts) |
| `errors`                                    | The errors of the body or of a `beforeEach` hook, filled before the `afterEach` hooks (same shape as an error in the report)                                                                                                     |
| `timeout`, `setTimeout(ms)`                 | The time limit in milliseconds (0: none), and a way to change it; see [timeouts](#steps-expected-failures-and-timeouts)                                                                                                          |
| `slow()`, `fail()`, `skip()`, `fixme()`     | The same as `test.slow()`, `test.fail()`, `test.skip()` and `test.fixme()`, each taking an optional `condition` boolean (default `true`) and a `description`                                                                     |
| `duration`                                  | Milliseconds since the attempt started; fixed once the body is done                                                                                                                                                              |
| `outputDir`                                 | The folder for this attempt's attachments, `attachments/<browser>/<spec>/<test>[/retry-n]` in the result folder                                                                                                                  |
| `attach(name, { body, path, contentType })` | Saves a string or `Buffer` `body`, or copies the file at `path`, into `outputDir` and lists it in the report entry. Give one of `body` and `path`. String bodies are masked like the rest of a report                            |

```ts
test.afterEach(async ({ page, testInfo }) => {
  if (testInfo.status === "failed")
    await testInfo.attach("page-html", {
      body: await page.content(),
      contentType: "text/html",
    });
});
```

A test that attached files has `attachments: [{ name, contentType, path }]` in its report entry (`path` is relative to the result folder), and one that pushed annotations has `annotations`. Both fields are absent otherwise, so existing reports read the same.

## Steps, expected failures and timeouts

**`test.step(title, body, { timeout? })`** runs `body` as a named step of the running test and returns its value. Steps nest. A step that throws is marked failed and rethrows, so the test fails as it would without the step. With `timeout` (milliseconds), a step that takes longer fails with `step "title" timed out after N ms`; its body keeps running, as nothing can stop it. `test.step` works on a `test` made by `test.extend` too, and throws `step(): no test is running` outside a test or hook.

```ts
const total = await test.step("add to the cart", async () => {
  await test.step("open the shop", () => page.navigateTo("/shop"));
  await page.getByRole("button", { name: "Add" }).click();
  return page.locator("#total").textContent();
});
```

The report entry of a test that ran steps has `steps: [{ title, status, duration, error?, steps? }]` (`status` is `"passed"`, `"failed"` or `"skipped"`; `error` is the message of what the step threw; `steps` holds the nested ones). A step still running when the test ended is listed as failed with the error `the test ended before the step finished`. The field is absent when a test ran no steps.

**`test.fail()`** says the test is expected to fail. A test that fails is then reported as passed, and one that passes is reported as failed with `expected to fail, but passed`. A timeout is not the failure it was waiting for and is reported as usual. Forms:

- `test.fail("title", fn)` or `test.fail("title", { reason }, fn)` registers a test expected to fail.
- `test.fail()` inside a test or a `beforeEach` hook marks the running test; `test.fail(condition, reason)` does it when the condition is true. The condition is a boolean or a synchronous function of the fixtures, as with `test.skip`.
- `test.fail(true, reason)` in a `describe` block (or at the top of a file) marks every test in it. There the condition must be a boolean.

A marked test has the annotation `{ type: "fail" }` (with the reason as `description`) in its report entry, and `testInfo.expectedStatus` is `"failed"`.

**`test.slow()`** triples the timeout of the test, once, and adds the annotation `slow`. It takes the same arguments as `test.fail()` without a title: `test.slow()`, `test.slow(condition, reason)`, and `test.slow(true)` in a `describe` block for every test in it.

**`test.setTimeout(ms)`** (or `testInfo.setTimeout(ms)`) sets the timeout of the running test, in a test body or a hook; `0` removes it. The new limit counts from the start of the test, so the time already spent counts against it: lowering it below the time spent ends the test at once. `testInfo.timeout` is the limit in force. Errors read `setTimeout(): ...`, `fail(): ...`, `slow(): ...` and `step(): ...`.

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
- **Times out** after the environment's/project's `timeout` (default 30 s), unless the test changes it with [`test.slow()` or `test.setTimeout()`](#steps-expected-failures-and-timeouts). The test is reported as timed out and its browser is closed.
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
- **`test.skip(condition, reason)`** inside a test (or a `beforeEach` hook) ends it as skipped when the condition is true (the reason goes into the report); when it is false nothing happens. The browser has launched by then, and the rest of the test does not run. `test.fixme(condition, reason)` is the same with the `fixme` annotation. The condition may be a synchronous function of the fixtures: `test.skip(({ browserName }) => browserName === "firefox", "needs Chrome")`. A condition function outside a running test throws.
- **`forbidOnly`** refuses a run that contains a `.only`, so a forgotten focus cannot shrink a suite unseen. It is on by default when `CI` is set, see [Configuration](Configuration#forbidonly).

Skipped tests count in the run (`run-start.total`) and in the report, never as failures: a run whose tests passed or were skipped succeeds. See [Running tests and reports](Running-tests-and-reports#skipped-tests).

## Hooks

`beforeEach`, `afterEach`, `beforeAll` and `afterAll` come from the package, like `test`. They are also reachable as `test.beforeEach`, `test.afterEach`, `test.beforeAll` and `test.afterAll`, and `describe` as `test.describe` (with `.skip`, `.fixme`, `.only`, `.serial`, `.parallel` and `.configure`); both spellings are the same functions:

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

## Use options

`test.use({...})` sets how the browser behaves for the `describe` block it is written in, or for the whole file when it is at the top level (before or after the tests, it makes no difference). The same options can be set for every test in the config's `use` (see [Configuration](Configuration#use-options)). An inner block wins over an outer one, and both win over the config, key by key; an option that is left out keeps the value from further out.

```ts
import { test } from "@itmetsam/samurai-framework";

test.use({
  locale: "nl-NL",
  timezone: "Europe/Amsterdam",
  colorScheme: "dark",
});

test.describe("as a customer", () => {
  test.use({
    storageState: "auth/customer.json",
    extraHTTPHeaders: { "x-feature": "new-checkout" },
  });

  test("sees the order history", async ({ page }) => {
    await page.goto("/orders");
  });
});
```

| Option                | Value                                                                      | What it does                                                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `locale`              | BCP 47 tag, `"nl-NL"`                                                      | `navigator.language`, `Intl` formatting and the `Accept-Language` header                                                                                                |
| `timezone`            | IANA name, `"Asia/Tokyo"`                                                  | The timezone of `Date` and `Intl`                                                                                                                                       |
| `userAgent`           | string                                                                     | The `User-Agent` header and `navigator.userAgent`                                                                                                                       |
| `geolocation`         | `{ latitude, longitude, accuracy? }`                                       | The position `navigator.geolocation` reports; it answers once the permission is granted (`page.grantPermission("geolocation")`)                                         |
| `offline`             | `boolean`                                                                  | `true`: no network, `navigator.onLine` is false and requests fail                                                                                                       |
| `orientation`         | `"portrait" \| "landscape"` or a full type such as `"landscape-secondary"` | What `screen.orientation` reports                                                                                                                                       |
| `screen`              | `{ width, height }`                                                        | What `screen.width` and `screen.height` report                                                                                                                          |
| `javaScriptEnabled`   | `boolean`                                                                  | `false` runs pages without JavaScript                                                                                                                                   |
| `acceptInsecureCerts` | `boolean`                                                                  | Open sites with a self-signed, expired or mismatched certificate                                                                                                        |
| `hasTouch`            | `boolean`                                                                  | Touch input: `navigator.maxTouchPoints` is 1. **Chrome only**                                                                                                           |
| `isMobile`            | `boolean`                                                                  | A phone-like page: the layout viewport follows the page's `<meta name="viewport">`. **Chrome only**                                                                     |
| `storageState`        | path or `{ cookies, origins }`                                             | Cookies and local storage to start with, in the format Playwright's `storageState` files use. A path is relative to the project folder; it is read when the test starts |
| `extraHTTPHeaders`    | `Record<string, string>`                                                   | Headers added to every request of the page. An inner value replaces the whole outer object, headers are not merged                                                      |
| `colorScheme`         | `"light" \| "dark" \| "no-preference"`                                     | What `prefers-color-scheme` reports. On Firefox `"no-preference"` means the browser's own setting                                                                       |

A `storageState` object looks like this (`expires` is in seconds; `-1` or no value is a session cookie):

```ts
test.use({
  storageState: {
    cookies: [
      {
        name: "session",
        value: "abc",
        domain: "example.com",
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ],
    origins: [
      {
        origin: "https://example.com",
        localStorage: [{ name: "token", value: "t-1" }],
      },
    ],
  },
});
```

Local storage can only be written once the browser is on its origin, so the framework opens a scratch tab on each origin of the state (the request is answered by the framework and never reaches the network), writes the entries and closes the tab before the test starts.

The options apply to the test's `page`, to every page opened in its `context`, and to the contexts the test creates with `browser.newContext()`; options passed to `newContext` win. A wrong value is refused with `use(): what is wrong`, for example `use(): invalid locale "xx!"`, `use(): isMobile must be true or false, got "yes"` or `use(): storageState file "auth.json" could not be read: ...`. `test.use` itself refuses an option it does not know.

The options marked run time in [Settings](Pages-and-browsers#settings-use-and-pageuse) (`locale`, `timezone`, `userAgent`, `geolocation`, `offline`, `orientation`, `screen`, `hasTouch`, `javaScriptEnabled`) can also be changed while a test runs, with `page.use({...})` and `context.use({...})`: the same names, applied now. `test.use()` is the declarative form (the value holds before the test starts), `page.use()` the run-time form. In `test.use()` and config `use`, `null` cancels a value from further out.

A renamed option is refused with the name to use: `use(): unknown option "timezoneId"; use "timezone"`.

A test without `use` options, in a project without them in the config, runs exactly as before.

### What each browser can do

`isMobile` and `hasTouch` work on Chrome only. On Firefox they are ignored with a warning that is printed once per process (any other option the browser does not support is skipped the same way; `page.use()` throws instead), and the `isMobile` and `hasTouch` fixtures are `false`: check them if a test depends on a phone layout, or skip it with `test.skip(({ browserName }) => browserName === "firefox")`. Every other option works on both browsers. The table of how each is done is in [Pages and browsers](Pages-and-browsers#use-options-per-browser).

## Retries

A test that fails is run again, each time with a fresh browser, up to `retries` more times (config `retries`, `--retries <n>` or `SAMURAI_RETRIES`; the default is 0, so nothing is run again). It stops at the first pass.

```sh
samurai run --retries 2    # a failing test gets up to three runs in all
```

- **What is run again.** Every failure: an error, a failed assertion, a timeout. Not an aborted run, and not a test that skips itself (`test.skip(condition)`): it ends there. A worker process that dies during a test fails the test without a retry (the pool starts a new worker for the next test).
- **Hooks.** `beforeEach` and `afterEach` run again with every attempt. `beforeAll` and `afterAll` belong to the worker and do not run again.
- **Serial blocks** are run again as a whole, see [Serial mode](#serial-mode).
- **Flaky.** A test that passes after a failed attempt is a pass: the run does not fail. Its result says `flaky: true` and keeps the errors of the failed attempts (`previousAttempts`), so flaky tests can be found. See [Retries in the report](Running-tests-and-reports#retries).
- **A test that fails every attempt** is reported once, as failed, with the last attempt's error and the earlier ones in `previousAttempts`.
- **Screenshots** of a retry go to a `retry-<n>` folder next to the first attempt's, so no attempt overwrites another.

Retries hide a test that is unreliable, they do not fix it: treat a flaky result as a bug to look at.

## Tips

- Prefer role, label and test-id [locators](Locators); they survive layout changes better than CSS or XPath.
- Don't sleep. Actions and assertions wait for you; for anything else use [`waitFor`](Locators#waiting-for-state), [`waitForLoadState`](Pages-and-browsers#waiting), `waitForNetworkIdle` or `waitForResponse`.
- Keep passwords and tokens in `secrets`, never in `variables` or in the spec.
