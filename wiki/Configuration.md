<!-- markdownlint-disable MD041 -->

Configuration lives in `samurai.config.ts` in the directory you run from (or the `projectDir` given to `runTests`). It must export `defineConfig({...})` as the default export; the file is read when the run starts. In a project, `defineConfig` comes from `@itmetsam/samurai-framework`; this repository's own config imports `./src/config/config.js`. An app can read the config with every default filled in through `loadConfig` (see [Embedding](Embedding-the-framework#capabilities-and-the-resolved-config)).

```ts
import { defineConfig } from "@itmetsam/samurai-framework";

export default defineConfig({
  srcDir: "./src/tests",
  browsers: ["firefox"],
  timeout: 30000,
  expect: { timeout: 5000 },
  environments: {
    dev: {
      baseURL: "http://localhost:3000",
      variables: { testUser: "dev@example.com" },
    },
    staging: { baseURL: "https://staging.example.com", timeout: 60000 },
  },
  defaultEnvironment: "dev",
});
```

## Options

| Option                  | Default                                  | Meaning                                                                                                                                                             |
| ----------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `srcDir`                | `"./src"`                                | Folder searched (recursively) for `*.spec.ts` files                                                                                                                 |
| `browsers`              | `["firefox"]`                            | Browsers every test runs in, one after the other: `firefox`, `chrome` or both; a group can name its own, see [Browsers](#browsers)                                  |
| `workers`               | half the CPUs                            | Tests that run at the same time, each in its own worker process: a number from 1 or a share like `"50%"`; see [Workers](#workers)                                   |
| `retries`               | `0`                                      | Times a failing test is run again, each with a fresh browser; see [Retries](#retries)                                                                               |
| `forbidOnly`            | `true` when `CI` is set, else `false`    | Stop a run that contains `test.only`; see [forbidOnly](#forbidonly)                                                                                                 |
| `timeout`               | `30000`                                  | Time (ms) one test may take                                                                                                                                         |
| `baseURL`               | none                                     | What `page.goto("/…")` resolves against                                                                                                                             |
| `expect.timeout`        | `5000`                                   | Time (ms) assertions, actions (`click`, `fill`, `focus`) and `waitFor` keep retrying                                                                                |
| `environments`          | none                                     | Named environments, see [Environments and secrets](Environments-and-secrets)                                                                                        |
| `defaultEnvironment`    | none                                     | Environment used when `--env` and `SAMURAI_ENV` are absent                                                                                                          |
| `browserPaths`          | none                                     | Executables to launch instead of the downloaded builds, see [Browser paths](#browser-paths)                                                                         |
| `downloadsDir`          | `"result/downloads"`                     | Where downloads are saved (a folder per browser, removed when empty)                                                                                                |
| `filesDir`              | `"files"`                                | Folder (relative to the project) where the recorder stores uploaded files and steps point at them                                                                   |
| `use.viewport`          | `{ width: 1280, height: 720 }`           | Viewport of every new page; `null` keeps the browser's own size                                                                                                     |
| `use.headless`          | headless when `CI` is set, else a window | Run the browser without a window. Needed on machines without a display (CI runners)                                                                                 |
| `use.strictSelectors`   | `false`                                  | Make an action or read on a locator that matches several elements throw `strict mode violation` instead of using the first; see [Strict mode](Locators#strict-mode) |
| `bidi.commandTimeout`   | `30000`                                  | Time (ms) a protocol command may wait for its reply                                                                                                                 |
| `navigation.timeout`    | `30000`                                  | Time (ms) a navigation or load-state wait may take                                                                                                                  |
| `navigation.waitUntil`  | `"complete"`                             | When `navigateTo` resolves: `"none"`, `"interactive"` or `"complete"`                                                                                               |
| `network.track`         | `true`                                   | Follow requests from the start. When `false`, `waitForNetworkIdle()` throws                                                                                         |
| `network.idleTime`      | `500`                                    | Time (ms) without requests in flight that counts as idle                                                                                                            |
| `network.routeTimeout`  | `30000`                                  | Time (ms) a `page.route` handler may take before the request is let through                                                                                         |
| `network.collectBodies` | `false`                                  | Keep every response body so `response.body()` always works (costs memory)                                                                                           |
| `network.maxBodySize`   | `10485760`                               | Largest body (bytes) that is kept                                                                                                                                   |
| `logs.capture`          | `"failures"`                             | Which tests get the page's log in the report: `"off"`, `"failures"`, `"all"`                                                                                        |
| `logs.failOnPageError`  | `false`                                  | Fail a passing test when the page threw an uncaught exception                                                                                                       |
| `logs.ignoreErrors`     | `[]`                                     | Strings or RegExps; matching exceptions never fail a test                                                                                                           |
| `groups`                | none                                     | Named sets of tests, selected with `--group <name>` or the `group` option (see below)                                                                               |
| `steps`                 | none                                     | Flow steps of this project, made with `defineStep`; see [Writing a step](Writing-a-step#steps-of-your-own)                                                          |

### Browsers

`browsers` lists the browsers the tests run in. Every selected test runs once in each, one browser after the other, so `browsers: ["firefox", "chrome"]` doubles the run and gives each test a result per browser.

```ts
export default defineConfig({
  browsers: ["firefox"], // the default
  groups: [
    { name: "smoke", src: "./src/smoke" }, // the project's browsers
    {
      name: "cross-browser",
      src: "./src/checkout",
      browsers: ["firefox", "chrome"],
    },
  ],
});
```

The first that is set wins:

1. the command line (`--browser`, repeatable)
2. the group being run (`groups[].browsers`), which replaces the project's list
3. the project (`browsers`)
4. `["firefox"]`

Names are `firefox` or `chrome`, each at most once, and a list is not empty; anything else is an error that names the key (`Unknown browser "edge" in browsers. Choose firefox or chrome.`). The old `browser` key is rejected, not ignored: `"browser" was replaced by "browsers": use browsers: ["chrome"]`. A browser that is not installed stops the run before any test starts, for every browser of the run. A test can read the browser it runs in with the [`browserName` fixture](Writing-tests#fixtures).

### forbidOnly

`forbidOnly` refuses a run when a spec contains `test.only` or `describe.only`, so a forgotten focus cannot quietly shrink the suite on CI. The default is `true` when the `CI` environment variable is set and `false` otherwise; the config wins either way (`forbidOnly: false` allows `.only` on CI).

The run stops before any test starts and one error lists every focused test, in every spec the run loads (also in tests that `--grep` or `--group` leave out; specs that `--file` does not load are not looked at):

```text
test.only is not allowed (forbidOnly): tests/checkout.spec.ts: pays
test.only is not allowed (forbidOnly): tests/login.spec.ts: block > inside
```

On the command line that is exit code 2 with the message on stderr; `runTests` rejects with it. `samurai list` is not affected.

### Environment options

Each entry of `environments` can set:

| Option           | Meaning                                                                            |
| ---------------- | ---------------------------------------------------------------------------------- |
| `baseURL`        | Overrides the project `baseURL`                                                    |
| `timeout`        | Overrides the project `timeout`                                                    |
| `expect.timeout` | Overrides `expect.timeout`                                                         |
| `variables`      | Test data available as `env.<name>` in tests. Never put secrets here               |
| `headless`       | Overrides `use.headless` for this environment (e.g. `true` for a `ci` environment) |

### Workers

`workers` is how many tests run at the same time. Each test (in one browser) runs in a worker process of its own, with its own browser, so tests do not share state. The default is half the CPUs (`max(1, floor(cpus / 2))`); `workers: 1` runs the tests one after the other.

```ts
workers: 4,        // four at a time
workers: "50%",    // half the CPUs
```

A group can hold back its own tests: `{ name: "checkout", workers: 1 }` means no two tests of that group run at the same time, even when the run uses more workers (for tests that share an account or data). Only `1` has an effect on a group; any other whole number is accepted and ignored. Tests outside the group still run beside it.

The first that is set wins: `--workers`, then `SAMURAI_WORKERS`, then `workers` in the config, then the default. A run with one test, or with a config passed as an object (not read from `samurai.config.ts`), stays on one worker. See [Parallel runs](Running-tests-and-reports#parallel-runs).

### Retries

`retries` is how many times a failing test is run again, each time with a fresh browser. It is a whole number from 0; the default 0 runs every test once. A test that passes on a retry is reported as flaky and does not fail the run (see [Retries](Writing-tests#retries)).

```ts
retries: 2,   // a failing test gets up to three runs
```

The first that is set wins: `--retries`, then `SAMURAI_RETRIES`, then `retries` in the config, then 0. A value that is not a whole number from 0 is an error that names its source, for example `--retries must be a whole number from 0, got "abc"`. A negative number has to be written `--retries=-1` to reach that check: with a space, the argument parser takes `-1` for another flag and refuses it. There is no `retries` per group.

### Groups

`groups` names sets of tests. Run one with `samurai run --group <name>` or `runTests({ group })`.

```ts
groups: [
  { name: "checkout", src: "./src/checkout" },                 // every *.spec.ts below that folder
  { name: "api", testMatch: "**/api-*.spec.ts" },              // a glob, relative to `src` (default `srcDir`)
  { name: "smoke", tests: [{ file: "login.spec.ts", title: "Login > works" }] },
],
```

| Field       | Meaning                                                                                                                                                                                                                     |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`      | What `--group` takes                                                                                                                                                                                                        |
| `src`       | Folder to search, relative to the project; default `srcDir`. Only specs below it count                                                                                                                                      |
| `testMatch` | Glob matched against the spec path below `src`; default `**/*.spec.ts`                                                                                                                                                      |
| `tests`     | Tests picked by hand: `file` relative to `srcDir`, `title` the full name (`describe` titles joined with `>`). Overrides `src` and `testMatch`; a picked test that no longer exists is reported as `missing` by `listGroups` |
| `browsers`  | The browsers this group's tests run in, instead of the project's `browsers` (see [Browsers](#browsers))                                                                                                                     |
| `workers`   | `1`: the group's tests never run at the same time as each other (see [Workers](#workers))                                                                                                                                   |

A test's id is `<file relative to srcDir, with />::<full name>`. An unknown group name is an error that lists the groups.

## Command-line flags

```sh
bun run dev --env staging --timeout 60000 --expect-timeout 10000
```

| Flag                    | Meaning                               | Also                  |
| ----------------------- | ------------------------------------- | --------------------- |
| `--env <name>`          | Environment to run against            | `SAMURAI_ENV=<name>`  |
| `--timeout <ms>`        | Per-test timeout                      |                       |
| `--expect-timeout <ms>` | Retry time for actions and assertions |                       |
| `--workers <n\|n%>`     | Tests that run at the same time       | `SAMURAI_WORKERS=<n>` |
| `--retries <n>`         | Times a failing test is run again     | `SAMURAI_RETRIES=<n>` |

Unknown flags are an error, and the millisecond flags must be whole numbers. Every flag of the command (`--file`, `--grep`, `--group`, `--headless`, `--port`, `--json`, …) is in [Command line](Command-line).

## Precedence

For timeouts, the first that is set wins:

1. the command-line flag (`--timeout`, `--expect-timeout`)
2. the environment (`environments.<name>.timeout`, `.expect.timeout`)
3. the project (`timeout`, `expect.timeout`)
4. the built-in default (30 000 and 5000 ms)

`workers` follows its own order: `--workers`, `SAMURAI_WORKERS`, `workers` in the config, then half the CPUs. `retries` does the same with `--retries`, `SAMURAI_RETRIES`, `retries` in the config, then 0.

`baseURL` follows environment, then project. A timeout passed to one call (`click({ timeout })`, `expect(...).toBeVisible({ timeout })`) always wins for that call.

## Browser paths

By default a launch uses the build `samurai browsers install` downloaded. To use a browser of your own, give its path:

```ts
export default defineConfig({
  browserPaths: { firefox: "/opt/firefox/firefox" },
});
```

Keys are `firefox` and `chrome`; Chrome also needs its chromedriver, which `samurai browsers install chrome` downloads with it (`SAMURAI_CHROMEDRIVER_PATH` replaces it). A relative path is relative to the project folder. The path must exist, or the launch fails. `SAMURAI_FIREFOX_PATH` and `SAMURAI_CHROME_PATH` win over this key. See [Which browser runs](Pages-and-browsers#which-browser-runs).

## Headless

Whether the browser runs without a window. The first that is set wins:

1. the command line (`--headless` or `--no-headless`) or the `headless` option of `runTests` / `recordSpec`
2. the environment's `headless`
3. `use.headless`
4. the `CI` environment variable: set (and not empty, `0` or `false`) means headless, which is what GitHub Actions and most CI systems provide
5. otherwise a window

So a CI pipeline needs no flag, and a `ci` environment or `use.headless` makes it explicit:

```ts
export default defineConfig({
  use: { headless: false }, // a window on your machine
  environments: { ci: { headless: true } }, // `samurai run --env ci`
});
```

## Choosing the environment

1. `--env` (or `SAMURAI_ENV`)
2. `defaultEnvironment`
3. the only environment, when exactly one is defined
4. with no `environments` at all, an implicit environment called `default`

Otherwise the run stops with `No environment chosen. Available: dev, staging (use --env or set defaultEnvironment)`. An unknown name stops it too, listing the known ones.
