# Configuration

Configuration lives in `samurai.config.ts` in the directory you run from. It must export `defineConfig({...})` as the default export; the file is read when the run starts.

```ts
import { defineConfig } from "./src/config/config.js";

export default defineConfig({
  srcDir: "./src/tests",
  browser: "firefox",
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

| Option                  | Default                                  | Meaning                                                                              |
| ----------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `srcDir`                | `"./src"`                                | Folder searched (recursively) for `*.spec.ts` files                                  |
| `browser`               | `"firefox"`                              | Browser for every test. Only `firefox` is supported today                            |
| `timeout`               | `30000`                                  | Time (ms) one test may take                                                          |
| `baseURL`               | none                                     | What `page.goto("/…")` resolves against                                              |
| `expect.timeout`        | `5000`                                   | Time (ms) assertions, actions (`click`, `fill`, `focus`) and `waitFor` keep retrying |
| `environments`          | none                                     | Named environments, see [Environments and secrets](environments-and-secrets.md)      |
| `defaultEnvironment`    | none                                     | Environment used when `--env` and `SAMURAI_ENV` are absent                           |
| `downloadsDir`          | `"result/downloads"`                     | Where downloads are saved (a folder per browser, removed when empty)                 |
| `use.viewport`          | `{ width: 1280, height: 720 }`           | Viewport of every new page; `null` keeps the browser's own size                      |
| `use.headless`          | headless when `CI` is set, else a window | Run the browser without a window. Needed on machines without a display (CI runners)  |
| `bidi.commandTimeout`   | `30000`                                  | Time (ms) a protocol command may wait for its reply                                  |
| `navigation.timeout`    | `30000`                                  | Time (ms) a navigation or load-state wait may take                                   |
| `navigation.waitUntil`  | `"complete"`                             | When `navigateTo` resolves: `"none"`, `"interactive"` or `"complete"`                |
| `network.track`         | `true`                                   | Follow requests from the start. When `false`, `waitForNetworkIdle()` throws          |
| `network.idleTime`      | `500`                                    | Time (ms) without requests in flight that counts as idle                             |
| `network.routeTimeout`  | `30000`                                  | Time (ms) a `page.route` handler may take before the request is let through          |
| `network.collectBodies` | `false`                                  | Keep every response body so `response.body()` always works (costs memory)            |
| `network.maxBodySize`   | `10485760`                               | Largest body (bytes) that is kept                                                    |
| `logs.capture`          | `"failures"`                             | Which tests get the page's log in the report: `"off"`, `"failures"`, `"all"`         |
| `logs.failOnPageError`  | `false`                                  | Fail a passing test when the page threw an uncaught exception                        |
| `logs.ignoreErrors`     | `[]`                                     | Strings or RegExps; matching exceptions never fail a test                            |
| `groups`                | none                                     | Declared in the types but **not implemented yet**; see the [roadmap](roadmap.md)     |

### Environment options

Each entry of `environments` can set:

| Option           | Meaning                                                                            |
| ---------------- | ---------------------------------------------------------------------------------- |
| `baseURL`        | Overrides the project `baseURL`                                                    |
| `timeout`        | Overrides the project `timeout`                                                    |
| `expect.timeout` | Overrides `expect.timeout`                                                         |
| `variables`      | Test data available as `env.<name>` in tests. Never put secrets here               |
| `headless`       | Overrides `use.headless` for this environment (e.g. `true` for a `ci` environment) |

## Command-line flags

```sh
bun run dev --env staging --timeout 60000 --expect-timeout 10000
```

| Flag                    | Meaning                               | Also                 |
| ----------------------- | ------------------------------------- | -------------------- |
| `--env <name>`          | Environment to run against            | `SAMURAI_ENV=<name>` |
| `--timeout <ms>`        | Per-test timeout                      |                      |
| `--expect-timeout <ms>` | Retry time for actions and assertions |                      |

Unknown flags are an error, and the millisecond flags must be whole numbers.

## Precedence

For timeouts, the first that is set wins:

1. the command-line flag (`--timeout`, `--expect-timeout`)
2. the environment (`environments.<name>.timeout`, `.expect.timeout`)
3. the project (`timeout`, `expect.timeout`)
4. the built-in default (30 000 and 5000 ms)

`baseURL` follows environment, then project. A timeout passed to one call (`click({ timeout })`, `expect(...).toBeVisible({ timeout })`) always wins for that call.

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
