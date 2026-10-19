# Running tests and reports

## What a run does

```sh
bun run dev [--env <name>] [--timeout <ms>] [--expect-timeout <ms>]
        [--headless | --no-headless] [--port <n>] [--grep <text>] [--group <name>] [--file <spec>]... [--browser <name>]... [--json]
```

1. Reads `samurai.config.ts`, picks the [environment](environments-and-secrets.md), loads its secrets and registers them for masking.
2. Finds every `*.spec.ts` under `srcDir` (recursively) and imports each one, which registers its tests.
3. Runs the tests **one at a time**, in registration order, once in each of the [`browsers`](configuration.md#browsers) of the run (all tests in the first browser, then all in the second). For each test it launches a fresh browser, opens a page, runs the test function with the [fixtures](writing-tests.md#fixtures), judges the page's log, and closes the browser.
4. Prints each result as it finishes and a summary, writes `result/report.json` and exits with the run's status.

The browser window is visible unless you pass `--headless`, set `use.headless` in the config, or run on CI (the `CI` environment variable is set); see [Headless](configuration.md#headless). The browser's debugging port is 9223 unless you pass `--port`. `--grep <text>` runs only tests whose full name contains the text, `--group <name>` only the tests of a [group](configuration.md#groups), and `--file <spec>` (repeatable, relative to the working directory) only those spec files. The process exits with code 0 when every test passed, 1 otherwise and 2 for a usage or configuration error, so a CI job can gate on it. Tests still run one at a time.

`bun run dev` is the installed `samurai run` command, run from the sources; see [Command line](cli.md) for the output and `--json`. To run tests from your own code, see [Embedding the framework](embedding.md).

## The report

`result/report.json`:

```json
{
  "duration": 5321.4,
  "startTime": 120.7,
  "status": "failed",
  "environment": "staging",
  "browsers": ["firefox"],
  "tests": [
    {
      "name": "Checkout > applies a coupon",
      "file": "/work/src/tests/checkout.spec.ts",
      "browser": "firefox",
      "startTime": 130.2,
      "duration": 2210.8,
      "status": "success"
    },
    {
      "name": "Checkout > rejects an expired coupon",
      "file": "/work/src/tests/checkout.spec.ts",
      "browser": "firefox",
      "startTime": 2350.1,
      "duration": 5004.3,
      "status": "failed",
      "type": "assertion",
      "message": "expect(locator).toHaveText\n  locator: testid=\"coupon-error\"\n  expected: \"Coupon expired\"\n  received: \"\"",
      "expected": "Coupon expired",
      "actual": "",
      "stack": "…",
      "logs": [
        {
          "level": "error",
          "type": "javascript",
          "text": "TypeError: x is undefined",
          "timestamp": 1760000000000
        }
      ]
    }
  ]
}
```

- Run `status` is `"success"` only when every test succeeded, in every browser.
- `browsers` on the summary lists the browsers the run used, in the order they ran. A test that ran in two browsers has two entries, each with its own `browser` (`"firefox"` or `"chrome"`), status and times: a result is per test and browser. All tests run in the first browser, then all in the second.
- Times are milliseconds (`startTime` is relative to the process start).
- A failed test carries the error flat on its entry: `type` (`"error"`, `"assertion"` or `"timeout"`), `message`, `stack`, and for assertions `expected` and `actual`.
- A test that called `page.screenshot({ name })` has `screenshots: [{ "name": "after-sign-in", "path": "screenshots/firefox/login/Login-signs-in/after-sign-in.png" }]`. `path` is relative to the `result/` folder and uses `/`. See [Screenshots](#screenshots).
- Everything in the report is passed through [secret masking](environments-and-secrets.md#masking).

### Page logs

The page's console output and uncaught exceptions are kept while a test runs (the newest 1000 entries). Config `logs.capture` decides which tests get them in the report:

- `"failures"` (default): only failed tests
- `"all"`: every test
- `"off"`: none

Each entry has `level` (`debug`, `info`, `warn`, `error`), `type` (`console`, `javascript` for an uncaught exception, or another type the browser reports), `method` for console calls, `text` and `timestamp`. When the buffer overflowed, `logsDropped` says how many entries were lost.

### Failing on page errors and route errors

- With `logs.failOnPageError: true`, a test that passed fails when the page threw an uncaught exception. `logs.ignoreErrors` skips known noise; `page.allowPageErrors()` opts one test out.
- If the browser goes away during a test (a person closes the window, or it crashes), the test fails at once with `The browser was closed while the test was running`, and the next test starts with a browser of its own.
- An error thrown inside a `page.route` handler fails a test that otherwise passed (the mock didn't do what the test meant).

## Events

A run reports what happens as events (`--json` prints them, `onEvent` receives them, see [Command line](cli.md#--json) and [Embedding](embedding.md)). With more than one browser the numbers and the labels change:

- `run-start` has `total`, which counts every test in every browser (3 tests in 2 browsers: 6), and `browsers`.
- `test-start` and `test-end` have `browser`, and `test-end`'s `result` has it too.
- The console output ends each test line with its browser (`[chrome]`) when a run has more than one browser, and names the browsers in its header. A run with one browser prints no label.

## Screenshots

`page.screenshot({ name })` in a test saves the image under `result/screenshots/<browser>/<spec file under srcDir, without extension>/<test name>/<name>.png` (`<name>.jpg` with `type: "jpeg"`). A spec outside `srcDir` uses its path relative to `srcDir` without the leading `../`, so its screenshots stay in `result/screenshots/`. The test name and the screenshot name keep letters, digits, `-` and `_` (the rest becomes `-`), and a repeated name in one test gets `-2`, `-3`, …. Outside a run (a script that launches a browser itself) the file is `result/screenshots/<name>.png` (or `.jpg`) in the project folder. The paths are listed in the report, see above.

## Timeouts at a glance

| What                              | Default      | Set with                                                     |
| --------------------------------- | ------------ | ------------------------------------------------------------ |
| One whole test                    | 30 s         | `timeout`, `--timeout`                                       |
| Actions, assertions, `waitFor`    | 5 s          | `expect.timeout`, `--expect-timeout`, per call `{ timeout }` |
| Navigation and `waitForLoadState` | 30 s         | `navigation.timeout`, per call `{ timeout }`                 |
| A protocol command                | 30 s         | `bidi.commandTimeout`                                        |
| A `page.route` handler            | 30 s         | `network.routeTimeout`                                       |
| Network idle                      | 500 ms quiet | `network.idleTime`, per call `{ idleTime }`                  |

## Logs and artefacts

| Path                            | Content                                                                     |
| ------------------------------- | --------------------------------------------------------------------------- |
| `result/report.json`            | The report above                                                            |
| `result/downloads/`             | Files downloaded during tests (`downloadsDir`)                              |
| `result/screenshots/<browser>/` | Screenshots taken with `page.screenshot({ name })`, in a folder per browser |
| `logs/combined.log`             | Framework log, all levels                                                   |
| `logs/error.log`                | Framework errors                                                            |

`logs/` and `result/` are git-ignored.

## Debugging a failing test

- Read the `message` and, for an assertion, `expected` against `actual` in the report.
- An `ActionTimeoutError` names the check that kept failing (`visible`, `enabled`, `hit target`, …) and what covers the element.
- Set `logs.capture: "all"` to see the page's console for passing tests as well.
- Add `await page.screenshot({ path: "out/debug.png" })` before the failing step.
- Run only the failing test with `--file <spec>` and `--grep <name>`, and with `--no-headless` to watch it.
