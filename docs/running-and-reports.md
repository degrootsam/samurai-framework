# Running tests and reports

## What a run does

```sh
bun run dev [--env <name>] [--timeout <ms>] [--expect-timeout <ms>]
```

1. Reads `samurai.config.ts`, picks the [environment](environments-and-secrets.md), loads its secrets and registers them for masking.
2. Finds every `*.spec.ts` under `srcDir` (recursively) and imports each one, which registers its tests.
3. Runs the tests **one at a time**, in registration order. For each test it launches a fresh browser (window visible), opens a page, runs the test function with the [fixtures](writing-tests.md#fixtures), judges the page's log, and closes the browser.
4. Writes `result/report.json` and exits.

The browser window is visible and the debugging port is fixed (9223); see the [roadmap](roadmap.md) for headless and parallel runs. The process exits with code 0 whatever the outcome, so a CI job can't use the exit code yet; read the report instead.

## The report

`result/report.json`:

```json
{
  "duration": 5321.4,
  "startTime": 120.7,
  "status": "failed",
  "environment": "staging",
  "tests": [
    {
      "name": "Checkout > applies a coupon",
      "file": "/work/src/tests/checkout.spec.ts",
      "startTime": 130.2,
      "duration": 2210.8,
      "status": "success"
    },
    {
      "name": "Checkout > rejects an expired coupon",
      "file": "/work/src/tests/checkout.spec.ts",
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

- Run `status` is `"success"` only when every test succeeded.
- Times are milliseconds (`startTime` is relative to the process start).
- A failed test carries the error flat on its entry: `type` (`"error"`, `"assertion"` or `"timeout"`), `message`, `stack`, and for assertions `expected` and `actual`.
- Everything in the report is passed through [secret masking](environments-and-secrets.md#masking).

### Page logs

The page's console output and uncaught exceptions are kept while a test runs (the newest 1000 entries). Config `logs.capture` decides which tests get them in the report:

- `"failures"` (default): only failed tests
- `"all"`: every test
- `"off"`: none

Each entry has `level` (`debug`, `info`, `warn`, `error`), `type` (`console`, `javascript` for an uncaught exception, or another type the browser reports), `method` for console calls, `text` and `timestamp`. When the buffer overflowed, `logsDropped` says how many entries were lost.

### Failing on page errors and route errors

- With `logs.failOnPageError: true`, a test that passed fails when the page threw an uncaught exception. `logs.ignoreErrors` skips known noise; `page.allowPageErrors()` opts one test out.
- An error thrown inside a `page.route` handler fails a test that otherwise passed (the mock didn't do what the test meant).

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

| Path                 | Content                                        |
| -------------------- | ---------------------------------------------- |
| `result/report.json` | The report above                               |
| `result/downloads/`  | Files downloaded during tests (`downloadsDir`) |
| `logs/combined.log`  | Framework log, all levels                      |
| `logs/error.log`     | Framework errors                               |

`logs/` and `result/` are git-ignored.

## Debugging a failing test

- Read the `message` and, for an assertion, `expected` against `actual` in the report.
- An `ActionTimeoutError` names the check that kept failing (`visible`, `enabled`, `hit target`, …) and what covers the element.
- Set `logs.capture: "all"` to see the page's console for passing tests as well.
- Add `await page.screenshot({ path: "out/debug.png" })` before the failing step.
- Run one spec by pointing `srcDir` at a folder that holds only it.
