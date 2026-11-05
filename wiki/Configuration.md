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

| Option                                                                                                                                                                                                                                                              | Default                                  | Meaning                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `srcDir`                                                                                                                                                                                                                                                            | `"./src"`                                | Folder searched (recursively) for `*.spec.ts` files                                                                                                                 |
| `browsers`                                                                                                                                                                                                                                                          | `["firefox"]`                            | Browsers every test runs in, one after the other: `firefox`, `chrome` or both; a group can name its own, see [Browsers](#browsers)                                  |
| `workers`                                                                                                                                                                                                                                                           | half the CPUs                            | Tests that run at the same time, each in its own worker process: a number from 1 or a share like `"50%"`; see [Workers](#workers)                                   |
| `retries`                                                                                                                                                                                                                                                           | `0`                                      | Times a failing test is run again, each with a fresh browser; see [Retries](#retries)                                                                               |
| `fullyParallel`                                                                                                                                                                                                                                                     | not set                                  | Whether the tests of one file may run on different workers; see [Fully parallel](#fully-parallel)                                                                   |
| `forbidOnly`                                                                                                                                                                                                                                                        | `true` when `CI` is set, else `false`    | Stop a run that contains `test.only`; see [forbidOnly](#forbidonly)                                                                                                 |
| `timeout`                                                                                                                                                                                                                                                           | `30000`                                  | Time (ms) one test may take                                                                                                                                         |
| `baseURL`                                                                                                                                                                                                                                                           | none                                     | What `page.goto("/…")` resolves against                                                                                                                             |
| `expect.timeout`                                                                                                                                                                                                                                                    | `5000`                                   | Time (ms) assertions, actions (`click`, `fill`, `focus`) and `waitFor` keep retrying                                                                                |
| `environments`                                                                                                                                                                                                                                                      | none                                     | Named environments, see [Environments and secrets](Environments-and-secrets)                                                                                        |
| `defaultEnvironment`                                                                                                                                                                                                                                                | none                                     | Environment used when `--env` and `SAMURAI_ENV` are absent                                                                                                          |
| `browserPaths`                                                                                                                                                                                                                                                      | none                                     | Executables to launch instead of the downloaded builds, see [Browser paths](#browser-paths)                                                                         |
| `downloadsDir`                                                                                                                                                                                                                                                      | `"result/downloads"`                     | Where downloads are saved (a folder per browser, removed when empty)                                                                                                |
| `filesDir`                                                                                                                                                                                                                                                          | `"files"`                                | Folder (relative to the project) where the recorder stores uploaded files and steps point at them                                                                   |
| `use.viewport`                                                                                                                                                                                                                                                      | `{ width: 1280, height: 720 }`           | Viewport of every new page; `null` keeps the browser's own size                                                                                                     |
| `use.headless`                                                                                                                                                                                                                                                      | headless when `CI` is set, else a window | Run the browser without a window. Needed on machines without a display (CI runners)                                                                                 |
| `use.strictSelectors`                                                                                                                                                                                                                                               | `false`                                  | Make an action or read on a locator that matches several elements throw `strict mode violation` instead of using the first; see [Strict mode](Locators#strict-mode) |
| `use.locale`, `use.timezone`, `use.userAgent`, `use.geolocation`, `use.offline`, `use.orientation`, `use.screen`, `use.javaScriptEnabled`, `use.acceptInsecureCerts`, `use.hasTouch`, `use.isMobile`, `use.storageState`, `use.extraHTTPHeaders`, `use.colorScheme` | none                                     | How every test's browser behaves; `test.use()` overrides them per file or `describe`. See [Use options](#use-options)                                               |
| `bidi.commandTimeout`                                                                                                                                                                                                                                               | `30000`                                  | Time (ms) a protocol command may wait for its reply                                                                                                                 |
| `navigation.timeout`                                                                                                                                                                                                                                                | `30000`                                  | Time (ms) a navigation or load-state wait may take                                                                                                                  |
| `navigation.waitUntil`                                                                                                                                                                                                                                              | `"complete"`                             | When `navigateTo` resolves: `"none"`, `"interactive"` or `"complete"`                                                                                               |
| `network.track`                                                                                                                                                                                                                                                     | `true`                                   | Follow requests from the start. When `false`, `waitForNetworkIdle()` throws                                                                                         |
| `network.idleTime`                                                                                                                                                                                                                                                  | `500`                                    | Time (ms) without requests in flight that counts as idle                                                                                                            |
| `network.routeTimeout`                                                                                                                                                                                                                                              | `30000`                                  | Time (ms) a `page.route` handler may take before the request is let through                                                                                         |
| `network.collectBodies`                                                                                                                                                                                                                                             | `false`                                  | Keep every response body so `response.body()` always works (costs memory)                                                                                           |
| `network.maxBodySize`                                                                                                                                                                                                                                               | `10485760`                               | Largest body (bytes) that is kept                                                                                                                                   |
| `logs.capture`                                                                                                                                                                                                                                                      | `"failures"`                             | Which tests get the page's log in the report: `"off"`, `"failures"`, `"all"`                                                                                        |
| `logs.failOnPageError`                                                                                                                                                                                                                                              | `false`                                  | Fail a passing test when the page threw an uncaught exception                                                                                                       |
| `logs.ignoreErrors`                                                                                                                                                                                                                                                 | `[]`                                     | Strings or RegExps; matching exceptions never fail a test                                                                                                           |
| `webServer`                                                                                                                                                                                                                                                         | none                                     | Servers the run starts before the first test and stops after the last; see [Web server](#web-server)                                                                |
| `globalSetup`, `globalTeardown`                                                                                                                                                                                                                                     | none                                     | A module (or function) that runs once before / after all tests; see [Global setup and teardown](#global-setup-and-teardown)                                         |
| `groups`                                                                                                                                                                                                                                                            | none                                     | Named sets of tests, selected with `--group <name>` or the `group` option, each with its own `browsers` and `use` (see below)                                       |
| `steps`                                                                                                                                                                                                                                                             | none                                     | Flow steps of this project, made with `defineStep`; see [Writing a step](Writing-a-step#steps-of-your-own)                                                          |
| `fixtures`                                                                                                                                                                                                                                                          | none                                     | The tests made with `test.extend()` whose fixtures `use.fixtures`, groups and the app can name; see [Fixtures](#fixtures)                                           |

### Use options

`use` also takes the options of `test.use()`, which then apply to every test:

```ts
export default defineConfig({
  use: {
    locale: "nl-NL",
    timezone: "Europe/Amsterdam",
    extraHTTPHeaders: { "x-env": "test" },
  },
});
```

The options, what they do and what each browser supports are on [Writing tests](Writing-tests#use-options). A wrong value stops the run with `use(): what is wrong`. A group can add its own on top: [Group use](#group-use).

### Fixtures

`fixtures` lists the extended tests of the project:

```ts
import { test as shop } from "./fixtures/shop";

export default defineConfig({ fixtures: [shop] });
```

The fixtures are read from the list without running a test (`listFixtures()` of `@itmetsam/samurai-framework/runner`), and `use.fixtures` may name only these. A name defined twice in the list, or not matching `/^[a-z][A-Za-z0-9]*$/`, stops the run before any test with a message that names both places. Describing fixtures, option fixtures, `use.fixtures`, worker scope and the report: [Your own fixtures](Writing-tests#your-own-fixtures).

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

| Option           | Meaning                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| `baseURL`        | Overrides the project `baseURL`                                                                   |
| `timeout`        | Overrides the project `timeout`                                                                   |
| `expect.timeout` | Overrides `expect.timeout`                                                                        |
| `variables`      | Test data available as `env.<name>` in tests. Never put secrets here                              |
| `headless`       | Overrides `use.headless` for this environment (e.g. `true` for a `ci` environment)                |
| `use`            | `use` options (and `fixtures`, option fixtures) for every test run in this environment, see below |

An environment's `use` is a layer between config `use` and a group's `use`: config, then environment, then group, then `test.use()`, the later winning key by key. It takes what a group's `use` takes (see [Group use](#group-use)), and a wrong value stops the run with `config.environments.production.use.locale: ...`. Its `fixtures: { name: false }` turns a fixture off for that environment for good: a test that needs it is skipped with `Fixture name is turned off in production`, whatever a group or `test.use()` says (see [Writing tests](Writing-tests#attaching-fixtures-with-usefixtures)).

### Workers

`workers` is how many tests run at the same time. Each test (in one browser) runs in a worker process of its own, with its own browser, so tests do not share state. The default is half the CPUs (`max(1, floor(cpus / 2))`); `workers: 1` runs the tests one after the other.

```ts
workers: 4,        // four at a time
workers: "50%",    // half the CPUs
```

A group can hold back its own tests: `{ name: "checkout", workers: 1 }` means no two tests of that group run at the same time, even when the run uses more workers (for tests that share an account or data). Only `1` has an effect on a group; any other whole number is accepted and ignored. Tests outside the group still run beside it.

The first that is set wins: `--workers`, then `SAMURAI_WORKERS`, then `workers` in the config, then the default. A run with one test, or with a config passed as an object (not read from `samurai.config.ts`), stays on one worker. See [Parallel runs](Running-tests-and-reports#parallel-runs).

### Fully parallel

`fullyParallel` says whether the tests of one file may run on different workers.

```ts
fullyParallel: false,   // the tests of a file stay together, in order, on one worker
```

- **Not set** (the default) is what the runner has always done: the unit of work is one test, and a free worker takes the next test, whatever file it is in. Playwright's default is the file; SAMURAI keeps its own, so a config without the option behaves as before. `true` says the same.
- **`false`** makes the file the unit, as in Playwright: all the tests of a file run one after the other on one worker, and different files go to different workers. A file's `beforeAll` hooks run on that one worker, not on every worker that would have got one of its tests. `test.describe.configure({ mode: "parallel" })` (or `describe.parallel`) frees the tests of one block again.
- **A serial block** ([Serial mode](Writing-tests#serial-mode)) is never split, whatever this says.
- It also decides what `--shard` keeps together: with `true`, single tests are dealt out; otherwise whole files ([Sharding](Running-tests-and-reports#sharding)).

A value that is not `true` or `false` is an error: `fullyParallel must be true or false, got "yes"`.

### Retries

`retries` is how many times a failing test is run again, each time with a fresh browser. It is a whole number from 0; the default 0 runs every test once. A test that passes on a retry is reported as flaky and does not fail the run (see [Retries](Writing-tests#retries)).

```ts
retries: 2,   // a failing test gets up to three runs
```

The first that is set wins: `--retries`, then `SAMURAI_RETRIES`, then `retries` in the config, then 0. A value that is not a whole number from 0 is an error that names its source, for example `--retries must be a whole number from 0, got "abc"`. A negative number has to be written `--retries=-1` to reach that check: with a space, the argument parser takes `-1` for another flag and refuses it. There is no `retries` per group.

### Web server

`webServer` starts the application under test for the run. It is one object or a list of them:

```ts
webServer: {
  command: "npm run start",           // a shell command, run in the project folder
  url: "http://localhost:3000/",      // ready when this answers; or `port: 3000`
  reuseExistingServer: !process.env.CI,
},
```

| Field                 | Default                                | Meaning                                                                                                                                     |
| --------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `command`             | required                               | Shell command that starts the server                                                                                                        |
| `url` or `port`       | one is required                        | Ready once `url` answers with a status from 200 to 403 (`http` or `https`), or once `localhost` accepts connections on `port`               |
| `cwd`                 | the project folder                     | Working directory of the command, relative to the project folder                                                                            |
| `env`                 | none                                   | Extra environment variables for the command. Their values are never printed in errors                                                       |
| `timeout`             | `60000`                                | Milliseconds the server may take to be ready                                                                                                |
| `reuseExistingServer` | `false`                                | When `url` or `port` already answers, use that server and start nothing (it is not stopped either). Otherwise a busy address is an error    |
| `stdout`, `stderr`    | `"ignore"`, `"pipe"`                   | Whether the command's output goes to this process's stdout / stderr. The last lines are kept for errors either way                          |
| `ignoreHTTPSErrors`   | `false`                                | Accept a bad certificate while waiting for an `https` `url`                                                                                 |
| `gracefulShutdown`    | `{ signal: "SIGTERM", timeout: 5000 }` | Signal sent to the server's whole process group at the end; what is still running after `timeout` ms is killed (`timeout: 0` kills at once) |

The command leads its own process group, so the whole tree it starts (a shell, a package manager, the server) is stopped at the end, also when the run fails or is aborted with Ctrl-C. Servers start one after the other, before the first test, and stop after `globalTeardown`. A server that does not become ready fails the run before any test starts, with a message such as `webServer(): timed out after 60000ms waiting for http://localhost:3000/` or `webServer(): the process exited (code 1) before localhost:3000 was ready`, followed by the last lines of its output; servers that were already started are stopped again.

When no `baseURL` is configured (neither the project's nor the environment's), the first server's address becomes the base URL: the origin of its `url`, or `http://localhost:<port>`. A configured `baseURL` always wins. The base URL reaches worker processes too.

Only a run starts servers (`samurai run`, `runTests`, and runs the desktop app starts through them, once per run). `samurai list`, `listTests`, the recorder and flows do not. Mistakes in the block are config errors that name the key, such as `config.webServer.timeout: must be a positive number of milliseconds` or `config.webServer[1]: give either url or port`.

### Global setup and teardown

`globalSetup` and `globalTeardown` run once per run, not once per test or worker. Each is a path relative to the project folder to a module whose default export is a function, or the function itself.

```ts
// samurai.config.ts
export default defineConfig({
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
});

// global-setup.ts
import type { GlobalHookConfig } from "@itmetsam/samurai-framework";
export default async function (config: GlobalHookConfig) {
  process.env.TEST_USER = await createUser(config.baseURL);
  return async () => deleteUser(process.env.TEST_USER!); // optional: runs as teardown too
}
```

The function receives the project's resolved config (what `loadConfig` returns) with `baseURL` as the run uses it, including one from a `webServer`, and the run's `environment`. Variables it sets in `process.env` reach the tests, worker processes included.

The order is: web servers start, `globalSetup`, the tests, what `globalSetup` returned, `globalTeardown`, web servers stop. The teardown also runs when tests fail, when the run is aborted and when `globalSetup` throws half way. It does not run when a web server failed to start, since nothing was set up. A throwing `globalSetup` fails the run before any test with `globalSetup(): <message>` (exit code 2); a throwing teardown fails it with `globalTeardown(): <message>`, unless the run had already failed, in which case the earlier error is reported.

As with `webServer`, only a run uses these hooks, not `list`, the recorder or flows.

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
| `use`       | Options for this group's tests, over the config's `use`: see [Group use](#group-use)                                                                                                                                        |
| `workers`   | `1`: the group's tests never run at the same time as each other (see [Workers](#workers))                                                                                                                                   |

A test's id is `<file relative to srcDir, with />::<full name>`. An unknown group name is an error that lists the groups.

#### Selecting several groups

`--group` can be repeated (`--group phone --group tablet`), and `runTests({ group })` takes a name or a list of names. The run holds the union of the groups' tests. A test that is in two selected groups runs **once per group**, each run with that group's `use` and `browsers`, and its report entry and events carry the `group`. Without `--group` nothing is a group run: results have no `group` and no group `use` applies.

#### Group use

A group's `use` takes the options of the config's `use` that make sense for one set of tests: `locale`, `timezone`, `userAgent`, `geolocation`, `offline`, `orientation`, `screen`, `javaScriptEnabled`, `acceptInsecureCerts`, `hasTouch`, `isMobile`, `storageState`, `extraHTTPHeaders`, `colorScheme` (see [Use options](Writing-tests#use-options)) and `viewport`. `headless` and `strictSelectors` are for the whole run and are not accepted here. It is how a Playwright `project` is ported: [Porting from Playwright](Porting-from-Playwright).

```ts
groups: [
  { name: "phone", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  { name: "desktop", browsers: ["firefox", "chrome"], use: { viewport: { width: 1440, height: 900 } } },
],
```

The options of a test layer from the outside in, the inner one winning key by key: the config's `use`, then the `use` of the run's environment, then the `use` of the group the test is being run for, then `test.use()` of the file and of each `describe` around the test. `extraHTTPHeaders` is replaced as a whole, not merged. A test in several groups takes the group that is being run. When no group is selected, the group's `use` is not applied. Group `use` is not applied by flow Group nodes (a flow runs the tests of a group by name).

A bad option stops the run before any test with the key it is at, for example `config.groups[1].use.locale: invalid locale "xx!"`. Inside a run, `testInfo.project.name` is the group's name (the browser's when no group is run) and screenshots and attachments of a group run go to a folder of the group inside the browser's.

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

This applies to running tests and flows. **Recording ignores all of it and always opens a window** (see [Command line](Command-line)).

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
