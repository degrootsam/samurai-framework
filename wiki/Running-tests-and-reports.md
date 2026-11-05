<!-- markdownlint-disable MD041 -->

## What a run does

```sh
bun run dev [--env <name>] [--timeout <ms>] [--expect-timeout <ms>]
        [--headless | --no-headless] [--port <n>] [--workers <n|n%>] [--grep <text>] [--group <name>] [--file <spec>]... [--browser <name>]... [--json]
```

1. Reads `samurai.config.ts`, picks the [environment](Environments-and-secrets), loads its secrets and registers them for masking.
2. Finds every `*.spec.ts` under `srcDir` (recursively) and imports each one, which registers its tests.
3. Runs the tests, once in each of the [`browsers`](Configuration#browsers) of the run (all tests in the first browser, then all in the second), several at a time when the run has more than one [worker](#parallel-runs). For each test it launches a fresh browser, opens a page, runs the test function with the [fixtures](Writing-tests#fixtures), judges the page's log, and closes the browser.
4. Prints each result as it finishes and a summary, writes `result/report.json` and exits with the run's status.

The browser window is visible unless you pass `--headless`, set `use.headless` in the config, or run on CI (the `CI` environment variable is set); see [Headless](Configuration#headless). The browser's debugging port is 9223 unless you pass `--port`. `--grep <text>` runs only tests whose full name contains the text, `--group <name>` only the tests of a [group](Configuration#groups), and `--file <spec>` (repeatable, relative to the working directory) only those spec files. The process exits with code 0 when every test passed, 1 otherwise and 2 for a usage or configuration error, so a CI job can gate on it.

`bun run dev` is the installed `samurai run` command, run from the sources; see [Command line](Command-line) for the output and `--json`. To run tests from your own code, see [Embedding the framework](Embedding-the-framework).

## Parallel runs

By default a run uses half the CPUs as workers (`--workers`, `SAMURAI_WORKERS` or `workers` in the config change that, see [Workers](Configuration#workers)). With more than one worker, tests run at the same time:

```sh
samurai run --workers 4
samurai run --workers 50%
samurai run --workers 1      # one after the other, in this process
```

How it works:

- The unit of work is one test in one browser. A test in two browsers is two items.
- The main process starts up to `workers` child processes (never more than there are items) and hands each free worker the next item in the queue, so a slow test does not hold up the others. A worker imports the specs once, then runs one test at a time with its own browser.
- Results come back as tests end. The console prints each line then, and `onEvent` gets the events then, so the order can differ from the order of the tests. The summary and `result/report.json` list the tests in the usual order, and each result has a `worker` (the index of the worker that ran it).
- Retries happen inside the worker that ran the test: it runs the attempts one after the other with a fresh browser each, and reports the test once, at the end (see [Retries](#retries)). A worker that dies fails the test without a retry.
- Each worker has its own browser debugging port (the run's [`--port`](Command-line#samurai-run) plus the worker's index) and, from the second worker on, its own browser profile folder (`browsers/profiles/<browser>-w<index>`). Downloads and screenshots already have a folder per test.

When something goes wrong:

- A worker that dies in the middle of a test (a test that calls `process.exit`, a crash) fails that test with `The worker process exited (code N)`, takes its browser with it, and is replaced. The other tests go on.
- Workers that exit before they are ready three times in a row (the project cannot be loaded, say) fail the whole run with `The worker process exited before it was ready (code N)`.
- An abort (Ctrl+C, `signal`) stops the running tests, reports the queued ones as failed with `Run aborted`, and closes the workers.

`beforeAll` and `afterAll` [hooks](Writing-tests#hooks) run once per worker: a worker runs the `beforeAll` of a block before the first test of it that it gets, and its `afterAll` when it is told to leave at the end of the run. The run waits for the workers to finish their `afterAll` hooks (up to a minute each) before it ends.

A run stays in this process, with no workers, when `workers` is 1, when there is only one test to run, or when the config is passed as an object (`runTests({ config })`): a worker reads `samurai.config.ts` from the project folder, and an object with functions in it cannot be sent to another process. If you asked for more than one worker in that case, a warning says `workers needs samurai.config.ts in the project folder; running on one worker`.

Tests that run side by side need to be independent:

- They must not share an account, a cart or other data. Give each test its own, or use the `workerIndex` [fixture](Writing-tests#fixtures) (0, 1, 2, …) to pick one per worker.
- A group whose tests have to run one at a time can say so with `workers: 1` ([Groups](Configuration#groups)).
- A flow's Parallel node uses the same workers, see [Flows](Flows#parallel).

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

- Run `status` is `"success"` when no test failed, in any browser. Skipped tests do not count as failed (see [Skipped tests](#skipped-tests)).
- `browsers` on the summary lists the browsers the run used, in the order they ran. A test that ran in two browsers has two entries, each with its own `browser` (`"firefox"` or `"chrome"`), status and times: a result is per test and browser. All tests run in the first browser, then all in the second.
- Times are milliseconds (`startTime` is relative to the process start).
- A failed test carries the error flat on its entry: `type` (`"error"`, `"assertion"` or `"timeout"`), `message`, `stack`, and for assertions `expected` and `actual`.
- A failing [hook](Writing-tests#hooks) fails the test it belongs to, with `<hook> hook failed: <message>` as the message (`beforeEach hook failed: …`, `afterEach hook failed: …`, `beforeAll hook failed: …`). The `type` is the one of what the hook threw, or `"error"` for a hook that ran out of time.
- A test that called `page.screenshot({ name })` has `screenshots: [{ "name": "after-sign-in", "path": "screenshots/firefox/login/Login-signs-in/after-sign-in.png" }]`. `path` is relative to the `result/` folder and uses `/`. See [Screenshots](#screenshots).
- A test that ran [`test.step`](Writing-tests#steps-expected-failures-and-timeouts) has `steps: [{ "title", "status", "duration", "error", "steps" }]`: `status` is `"passed"`, `"failed"` or `"skipped"`, `error` is present on a failed step and `steps` holds the nested ones. A test with no steps has no `steps` field. A test marked `test.fail()` or `test.slow()` has the matching entry in `annotations`.
- Everything in the report is passed through [secret masking](Environments-and-secrets#masking).

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

### Skipped tests

A test marked `test.skip` or `test.fixme` (or inside a `describe.skip` / `describe.fixme`), and a test that skipped itself with `test.skip(condition, reason)`, is reported with the status `"skipped"`:

```json
{
  "name": "Checkout > coupon on staging",
  "file": "/work/src/tests/checkout.spec.ts",
  "browser": "firefox",
  "startTime": 130.2,
  "duration": 0,
  "status": "skipped",
  "annotation": "fixme",
  "reason": "broken on staging"
}
```

- `annotation` is `"skip"` or `"fixme"`. `reason` is there only when a reason was given: `{ reason }` on `test.skip`, `test.fixme`, `describe.skip` or `describe.fixme`, or `test.skip(condition, reason)` inside a test, and is [masked](Environments-and-secrets#masking) like the rest of the report.
- `duration` is 0. A test that is marked skipped never launches a browser; one that skips itself from the inside has launched it, and closes it again.
- It emits `test-start` and then `test-end` with the skipped result, and counts in `run-start.total`.
- The run `status` stays `"success"` when nothing failed, and the command exits with 0. Count from `tests`: `success`, `failed` and `skipped` are the three outcomes of a finished test.
- The console prints a dim dash line and counts them: `- coupon on staging (fixme: broken on staging)`, `- old checkout (skipped)`, and `3 passed, 2 skipped` at the end.
- In a [flow](Flows#nodes), a Test or Group node whose tests are skipped counts as passed.

### Retries

With `retries` above 0 ([Configuration](Configuration#retries)), a failing test is run again with a fresh browser. It is still one result, the last attempt's, with three more fields that are there only when the test was run again:

- `retry`: the attempt this result is from, counting from 1 (`retry: 1` is the first run again).
- `flaky`: `true` when the test passed after at least one failed attempt.
- `previousAttempts`: the errors of the attempts before this one, in order, with the same fields as a failed result's error (`message`, `type`, `stack`, `expected`, `actual`). They are [masked](Environments-and-secrets#masking) like the rest of the report.

A flaky pass (the status is `"success"`):

```json
{
  "name": "Checkout > pays",
  "file": "/work/src/tests/checkout.spec.ts",
  "browser": "chrome",
  "startTime": 4210.7,
  "duration": 2110.3,
  "status": "success",
  "retry": 1,
  "flaky": true,
  "previousAttempts": [
    { "message": "Timed out 1000ms waiting for ...", "type": "assertion" }
  ]
}
```

A test that failed every attempt (`retries: 2`) is `failed`, with the last attempt's own error fields, and the two before it:

```json
{
  "name": "Checkout > pays",
  "file": "/work/src/tests/checkout.spec.ts",
  "browser": "chrome",
  "startTime": 9120.4,
  "duration": 1500.8,
  "status": "failed",
  "message": "Timed out 1000ms waiting for ...",
  "type": "assertion",
  "retry": 2,
  "previousAttempts": [
    { "message": "Timed out 1000ms waiting for ...", "type": "assertion" },
    { "message": "Timed out 1000ms waiting for ...", "type": "assertion" }
  ]
}
```

- `startTime` and `duration` are the last attempt's.
- The run `status` stays `"success"` when every failed test passed on a retry. Count flaky tests from `tests` (`flaky: true`).
- A test that was not run again has none of the three fields. An aborted run is never retried, and neither is a test that skips itself.
- Screenshots of the first attempt are in the test's folder; those of attempt n are in a `retry-<n>` folder inside it (see [Screenshots](#screenshots)). The result lists the last attempt's.
- The console marks a retried test: `✔ pays (2.1s, passed on retry 2)`, `✖ pays (1.5s, failed after 2 retries)`, and the summary counts flaky tests inside the passed: `5 passed (1 flaky)`.

## Events

A run reports what happens as events (`--json` prints them, `onEvent` receives them, see [Command line](Command-line#--json) and [Embedding](Embedding-the-framework)). With more than one browser the numbers and the labels change:

- `run-start` has `total`, which counts every test in every browser (3 tests in 2 browsers: 6), and `browsers`. It has `workers` when the run uses more than one.
- `test-start` and `test-end` have `browser`, and `test-end`'s `result` has it too. A skipped test emits both, one after the other.
- A test that is run again emits `test-start` **once per attempt**, with `retry: n` (from 1) on the attempts after the first, and `test-end` **once**, with the final result. A test with `retries: 2` that passes on its third run emits `test-start`, `test-start` (`retry: 1`), `test-start` (`retry: 2`) and then one `test-end`. Do not match starts to ends one for one: a row is a test, keyed by `file`, `name` and `browser`.
- The console output ends each test line with its browser (`[chrome]`) when a run has more than one browser, and names the browsers in its header. A run with one browser prints no label.

## Screenshots

`page.screenshot({ name })` in a test saves the image under `result/screenshots/<browser>/<spec file under srcDir, without extension>/<test name>/<name>.png` (`<name>.jpg` with `type: "jpeg"`). A spec outside `srcDir` uses its path relative to `srcDir` without the leading `../`, so its screenshots stay in `result/screenshots/`. The test name and the screenshot name keep letters, digits, `-` and `_` (the rest becomes `-`), and a repeated name in one test gets `-2`, `-3`, …. Outside a run (a script that launches a browser itself) the file is `result/screenshots/<name>.png` (or `.jpg`) in the project folder. The paths are listed in the report, see above.

The screenshots of a test that is run again: the first attempt's are in the folder above, those of attempt n (`retry: n`) in `.../<test name>/retry-<n>/`, so no attempt overwrites another. The result lists the last attempt's.

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

With `outputDir` (`runTests` and `runFlowInProject`, from 0.17.0), the report and the screenshots go to that folder instead of `result/`, so each run keeps its own; see [Embedding](Embedding-the-framework#running-tests-from-code).

`logs/` is in the project folder and exists once a run has started; nothing is written to it by commands that have no project, such as `samurai --version`. `logs/` and `result/` are git-ignored.

## Debugging a failing test

- Read the `message` and, for an assertion, `expected` against `actual` in the report.
- An `ActionTimeoutError` names the check that kept failing (`visible`, `enabled`, `hit target`, …) and what covers the element.
- Set `logs.capture: "all"` to see the page's console for passing tests as well.
- Add `await page.screenshot({ path: "out/debug.png" })` before the failing step.
- Run only the failing test with `--file <spec>` and `--grep <name>`, and with `--no-headless` to watch it.
