# Configuration

Configuration lives in `samurai.config.ts` in the directory you run from (or the `projectDir` given to `runTests`). It must export `defineConfig({...})` as the default export; the file is read when the run starts. In a project, `defineConfig` comes from `@itmetsam/samurai-framework`; this repository's own config imports `./src/config/config.js`.

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

| Option                  | Default                                  | Meaning                                                                                                                            |
| ----------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `srcDir`                | `"./src"`                                | Folder searched (recursively) for `*.spec.ts` files                                                                                |
| `browsers`              | `["firefox"]`                            | Browsers every test runs in, one after the other: `firefox`, `chrome` or both; a group can name its own, see [Browsers](#browsers) |
| `workers`               | half the CPUs                            | Tests that run at the same time, each in its own worker process: a number from 1 or a share like `"50%"`; see [Workers](#workers)  |
| `timeout`               | `30000`                                  | Time (ms) one test may take                                                                                                        |
| `baseURL`               | none                                     | What `page.goto("/…")` resolves against                                                                                            |
| `expect.timeout`        | `5000`                                   | Time (ms) assertions, actions (`click`, `fill`, `focus`) and `waitFor` keep retrying                                               |
| `environments`          | none                                     | Named environments, see [Environments and secrets](environments-and-secrets.md)                                                    |
| `defaultEnvironment`    | none                                     | Environment used when `--env` and `SAMURAI_ENV` are absent                                                                         |
| `browserPaths`          | none                                     | Executables to launch instead of the downloaded builds, see [Browser paths](#browser-paths)                                        |
| `downloadsDir`          | `"result/downloads"`                     | Where downloads are saved (a folder per browser, removed when empty)                                                               |
| `filesDir`              | `"files"`                                | Folder (relative to the project) where the recorder stores uploaded files and steps point at them                                  |
| `use.viewport`          | `{ width: 1280, height: 720 }`           | Viewport of every new page; `null` keeps the browser's own size                                                                    |
| `use.headless`          | headless when `CI` is set, else a window | Run the browser without a window. Needed on machines without a display (CI runners)                                                |
| `bidi.commandTimeout`   | `30000`                                  | Time (ms) a protocol command may wait for its reply                                                                                |
| `navigation.timeout`    | `30000`                                  | Time (ms) a navigation or load-state wait may take                                                                                 |
| `navigation.waitUntil`  | `"complete"`                             | When `navigateTo` resolves: `"none"`, `"interactive"` or `"complete"`                                                              |
| `network.track`         | `true`                                   | Follow requests from the start. When `false`, `waitForNetworkIdle()` throws                                                        |
| `network.idleTime`      | `500`                                    | Time (ms) without requests in flight that counts as idle                                                                           |
| `network.routeTimeout`  | `30000`                                  | Time (ms) a `page.route` handler may take before the request is let through                                                        |
| `network.collectBodies` | `false`                                  | Keep every response body so `response.body()` always works (costs memory)                                                          |
| `network.maxBodySize`   | `10485760`                               | Largest body (bytes) that is kept                                                                                                  |
| `logs.capture`          | `"failures"`                             | Which tests get the page's log in the report: `"off"`, `"failures"`, `"all"`                                                       |
| `logs.failOnPageError`  | `false`                                  | Fail a passing test when the page threw an uncaught exception                                                                      |
| `logs.ignoreErrors`     | `[]`                                     | Strings or RegExps; matching exceptions never fail a test                                                                          |
| `groups`                | none                                     | Named sets of tests, selected with `--group <name>` or the `group` option (see below)                                              |
| `steps`                 | none                                     | Flow steps of this project, made with `defineStep`; see [Writing a step](steps.md#steps-of-your-own)                               |

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

Names are `firefox` or `chrome`, each at most once, and a list is not empty; anything else is an error that names the key (`Unknown browser "edge" in browsers. Choose firefox or chrome.`). The old `browser` key is rejected, not ignored: `"browser" was replaced by "browsers": use browsers: ["chrome"]`. A browser that is not installed stops the run before any test starts, for every browser of the run. A test can read the browser it runs in with the [`browserName` fixture](writing-tests.md#fixtures).

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

The first that is set wins: `--workers`, then `SAMURAI_WORKERS`, then `workers` in the config, then the default. A run with one test, or with a config passed as an object (not read from `samurai.config.ts`), stays on one worker. See [Parallel runs](running-and-reports.md#parallel-runs).

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

Unknown flags are an error, and the millisecond flags must be whole numbers. Every flag of the command (`--file`, `--grep`, `--group`, `--headless`, `--port`, `--json`, …) is in [Command line](cli.md).

## Precedence

For timeouts, the first that is set wins:

1. the command-line flag (`--timeout`, `--expect-timeout`)
2. the environment (`environments.<name>.timeout`, `.expect.timeout`)
3. the project (`timeout`, `expect.timeout`)
4. the built-in default (30 000 and 5000 ms)

`workers` follows its own order: `--workers`, `SAMURAI_WORKERS`, `workers` in the config, then half the CPUs.

`baseURL` follows environment, then project. A timeout passed to one call (`click({ timeout })`, `expect(...).toBeVisible({ timeout })`) always wins for that call.

## Browser paths

By default a launch uses the build `samurai browsers install` downloaded. To use a browser of your own, give its path:

```ts
export default defineConfig({
  browserPaths: { firefox: "/opt/firefox/firefox" },
});
```

Keys are `firefox` and `chrome`; Chrome also needs its chromedriver, which `samurai browsers install chrome` downloads with it (`SAMURAI_CHROMEDRIVER_PATH` replaces it). A relative path is relative to the project folder. The path must exist, or the launch fails. `SAMURAI_FIREFOX_PATH` and `SAMURAI_CHROME_PATH` win over this key. See [Which browser runs](pages-and-browsers.md#which-browser-runs).

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
