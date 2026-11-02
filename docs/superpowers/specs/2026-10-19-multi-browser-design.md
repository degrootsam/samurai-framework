# Testing in more than one browser — design

Date: 2026-10-19
Status: approved
Builds on: [Chrome support](../chrome-support-todo.md) (branch `feat/chrome-support`, PR #32)
Code to change: `src/types/config.d.ts`, `src/runner/test-runner.ts`, `src/runner/reporter.ts`, `src/runner/groups.ts`, `src/cli/args.ts`, `src/recorder/session.ts`, `src/flows/run/`

## Goal

A project can say which browsers its tests run in, and a group can say it differently: `browsers: ["firefox", "chrome"]` runs every selected test once in each.

## Decisions (from you)

- **`browsers` replaces `browser`.** The project key is an array: `browsers: ["firefox"]`, `browsers: ["firefox", "chrome"]`.
- **A group's `browsers` replaces the project's** for that group's tests. A group without it uses the project's.
- **Every test runs once per browser, one browser after the other** (the sequential option). Parallel runs are a separate piece of work; see below.
- **`browser` is rejected**, with a message that says what to write instead. No alias.
- **Every browser always gets its own screenshot folder**, also in a run with one browser.
- **The `browserName` fixture is part of this change.**

## Config

```ts
export default defineConfig({
  browsers: ["firefox"], // default ["firefox"]
  groups: [
    { name: "smoke", src: "./src/smoke" }, // firefox (the project's)
    {
      name: "cross-browser",
      src: "./src/checkout",
      browsers: ["firefox", "chrome"],
    },
    {
      name: "chrome-only",
      testMatch: "**/webauthn-*.spec.ts",
      browsers: ["chrome"],
    },
  ],
});
```

- Values are `"firefox"` or `"chrome"` (`SupportedBrowser`). Order is the run order. A name twice, an unknown name or an empty array is a config error that says what is wrong and which key.
- **Precedence** for a run, the first that is set wins: the command line (`--browser`, repeatable), the group being run, the project, then `["firefox"]`.
- A run without `--group` uses the project's browsers. A run of a group uses the group's. A run of several groups is not possible today (`--group` takes one name), so no merge rules are needed.
- **`browser` is no longer read.** A config that still has it fails with `"browser" was replaced by "browsers": browsers: ["firefox"]`, naming the value it found, instead of being ignored. (Open question below.)

## What a run does

For each browser, in order: start it (warm-up for a fresh build included, before the first test, as today), run the selected tests with a browser of their own per test, close it. Then the next browser. A run's total is `tests × browsers`.

- A browser that is not installed (or a missing path) is **one clear error before anything runs**, for all browsers of the run: `Chrome for Testing 155.0.8059.79 is not installed. Run: samurai browsers install chrome`. Nothing runs on Firefox first.
- A failure in one browser does not stop the others; the run's exit code is 1 if any (test, browser) failed. `--bail`-style stopping does not exist today and is not added.
- Environment, secrets, timeouts and `headless` apply to every browser. A test cannot choose its browser; it can read which one it runs in (`browserName` fixture, below) and use `skipOn`-style conditions itself.

## Results and reports

- **A result is per (test, browser).** `TestResult` gets `browser`. The reporter keys results by `file::name::browser` (today `file::name`).
- **Events** `test-start` and `test-end` carry `browser`; `run-start.total` counts every (test, browser). `run-end.summary.browsers` lists the browsers that ran.
- **`result/report.json`** keeps `tests: []` flat, one entry per (test, browser), each with `browser`. A run with one browser looks like today plus the `browser` field, so readers that ignore unknown fields keep working.
- **Console reporter** prints the browser after the test name when the run has more than one browser (`✔ shows the heading [chrome]`), and nothing extra when it has one.
- **Screenshots and evidence** saved by name go to `result/screenshots/<browser>/…` in every run, so Firefox's `home.png` is not replaced by Chrome's and the paths do not change when a second browser is added.
- **Test ids** (`file::name`) are unchanged, so groups and flows still name tests the same way; the browser is a second coordinate, not part of the id.

## Flows and the app

- A **Group node** runs the group's tests in the group's browsers; a **Test node** (one test) runs in the project's. Their reports list the (test, browser) pairs, each with `browser`; the node fails if any pair fails.
- `listGroups` returns each group's `browsers` (the resolved list, project's when the group has none) so the app can show it.
- `recordSpec` / `samurai record` record in the **first** browser of the project (`--browser` overrides). Recording in two browsers at once makes no sense; replay is where the second one comes in.

## Command line

- `--browser <name>`, repeatable: `samurai run --browser chrome`, `samurai run --browser firefox --browser chrome`. Unknown names are exit code 2 with `Unknown browser "edge". Choose firefox or chrome.`
- `samurai record --browser chrome`.

## Tests can see the browser

A `browserName` fixture (`"firefox" | "chrome"`) next to `page` and `browser`, so a test can branch on it or skip itself with a reason.

## Not in this change: running in parallel

You asked whether parallel runs should come first. Recommendation: no. Parallel is a separate piece of work, and this design does not block it:

- The runner runs one test at a time per process, and a run shares state (config, secrets, the test registry) that a second concurrent run would overwrite. The roadmap lists parallel runs as open for that reason.
- Every browser launch uses the project's profile folder and a fixed debugging port, so two runs of the same browser would collide (a Chrome that is already on the profile is refused). Different browsers use different profile folders, so running Firefox and Chrome side by side is the easier first step later.
- This change makes (test, browser) the unit of work, with its own result. A parallel scheduler can take those units without changing the config, the events or the report.

If you would rather have parallel first, the order flips: the runner's shared state and ports come first, and multi-browser follows as "one worker per browser".

## Tests

Unit: config validation (unknown, duplicate, empty, `browser` rejected), precedence (flag, group, project, default), the reporter's per-browser keys and counts, the group's resolved `browsers`, the console reporter's label, `--browser` parsing, `listGroups`. Browser tests: a project with two browsers runs a passing and a failing test and reports four results with the right `browser`; a group with its own `browsers`; a missing browser stops the run before any test; screenshots land in separate folders. These run on Firefox and Chrome.

## Decided, was open

- `browser` is rejected, not kept as an alias; the `samurai init` template and the Electron app (separate repository) have to write `browsers` instead.
- Screenshot folders are per browser always.
- The `browserName` fixture is in this change.
