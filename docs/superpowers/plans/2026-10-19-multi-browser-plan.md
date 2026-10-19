# Testing in more than one browser Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `browsers: [...]` in the project config and on each group; a run executes every selected test once per browser, one browser after the other, and every result, event, report line and screenshot folder says which browser it belongs to.

**Architecture:** The runner's loop becomes browsers (outer) × tests (inner). A pure module decides which browsers a run uses (flag, group, project, default) and validates the config. The reporter keys results by test and browser. Everything above the runner (CLI, flows, recorder) passes a browser list or name through.

**Tech Stack:** TypeScript, Node 20+, `node:test` + `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-19-multi-browser-design.md`.

## Global Constraints

- Branch `feat/multi-browser`, cut from `feat/chrome-support`. Rebase it on `main` once PR #32 is merged.
- Version `0.10.0` (the `browser` key is removed: a breaking change for configs).
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Checks before every commit: `npx tsc --noEmit -p .`, `npm test`; at the end also `npm run test:cli`, `npm run build`, `npm run test:browser` and `npm run test:browser:chrome`.
- One browser file on one browser: `SAMURAI_TEST_BROWSER=chrome npx tsx --test --test-concurrency=1 --test-timeout=60000 <file>`.
- Run prettier only on files you changed, never on a folder (it reformats unrelated files).
- Kill leftover browsers after a Chrome run: `pkill -f "[c]hromedriver-linux64"; pkill -f "[c]hrome-linux64/chrome"` (the `[c]` keeps pkill from matching itself). A leftover Chrome holds the project profile.
- Names: `SupportedBrowser` is `"firefox" | "chrome"`. Copy, verbatim:
  - removed key: `"browser" was replaced by "browsers": use browsers: ["<value>"]`
  - unknown name: `Unknown browser "<name>" in <where>. Choose firefox or chrome.` (`<where>` is `browsers`, `groups[<i>].browsers` or `--browser`)
  - duplicate: `Browser "<name>" is listed twice in <where>.`
  - empty: `<where> must list at least one browser.`
- Results are per (test, browser). A test id (`file::name`) does not change.
- The Electron app is a separate repository and writes `browser: "firefox"`; it has to change to `browsers` when it takes this version. Note it in the PR.

## Order and dependencies

```text
1 types and browser list rules -> 2 reporter -> 3 runner loop -> 4 groups -> 5 CLI
                                                  3 -> 6 recorder, 7 flows -> 8 init, docs, version
```

## File structure

| File                                                | Responsibility                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------ |
| `src/runner/browsers.ts` (new)                      | `validateBrowserConfig`, `browsersFor` (flag, group, project, default)   |
| `src/types/config.d.ts`                             | `browsers` on config and group; `browser` removed                        |
| `src/types/test.d.ts`                               | `TestResult.browser`, `TestSummary.browsers`, `TestFixtures.browserName` |
| `src/runner/reporter.ts`                            | Per (test, browser) keys, events with `browser`, total                   |
| `src/runner/test-runner.ts`                         | Browsers × tests loop, pre-check, warm-up per browser, `browserName`     |
| `src/browser/evidence.ts`                           | `screenshots/<browser>/<test dir>/…`                                     |
| `src/runner/groups.ts`                              | `ResolvedGroup.browsers`                                                 |
| `src/cli/args.ts`, `main.ts`, `console-reporter.ts` | `--browser`, label in the console                                        |
| `src/recorder/session.ts`                           | First browser of the project, or `--browser`                             |
| `src/flows/run/*`                                   | Browser in the node's test reports                                       |

---

## Task 1: Types and the rules for the browser list

**Files:** create `src/runner/browsers.ts` and `browsers.test.ts`; modify `src/types/config.d.ts`, `src/types/test.d.ts`, `src/config/config.ts`, `src/testing/test-browser.ts` (`browserConfig`).

- [ ] Failing tests for `validateBrowserConfig(config)`: valid project and group lists pass; `browser` present throws the removed-key message with the value; unknown name, duplicate and empty list throw the messages above naming the key (`browsers`, `groups[1].browsers`).
- [ ] Failing tests for `browsersFor({ flag, group, project })`: flag wins over group, group over project, project over `["firefox"]`; a group with no `browsers` falls through to the project's; an empty flag list counts as not given.
- [ ] Implement both. `SamuraiTestConfig.browsers?: SupportedBrowser[]`, `SamuraiGroup.browsers?: SupportedBrowser[]`; delete `browser`.
- [ ] Call `validateBrowserConfig` where a config is loaded for use: `loadConfig()` (and the `activeProject.config` path), so every caller gets the error before anything else happens.
- [ ] `browserConfig()` in `test-browser.ts` returns `{ browsers: [browser] }`; fix the test projects that spread it.
- [ ] `TestResult.browser`, `TestSummary.browsers`, `TestFixtures.browserName` in the types.
- [ ] Commit: `feat: browsers in the config, and the rules for choosing them`.

## Task 2: Reporter

**Files:** `src/runner/reporter.ts`, `reporter.test.ts`.

- [ ] Failing tests: `onTestStart(test, browser)` / `onTestEnd(test, browser, …)` keep a result for each browser of the same test; the events carry `browser`; `run-start.total` is what the runner passes (tests × browsers); `onEnd` fills `summary.browsers` in run order; status is failed when any (test, browser) failed; a one-browser run still reports `browser` on each result.
- [ ] Implement: key `file::name::browser`; `RunEvent` variants get `browser`; `ReporterOptions` gets `browsers`.
- [ ] Commit: `feat: results are kept per test and browser`.

## Task 3: The runner

**Files:** `src/runner/test-runner.ts`, `test-runner.test.ts`, `src/browser/evidence.ts`, `evidence.test.ts`, `src/runner/run.ts`, `run-browser-missing.test.ts`, `run.browser-test.ts`.

- [ ] `RunnerOptions.browsers?: SupportedBrowser[]` (the flag). `TestRunner` resolves the list with `browsersFor` from the flag, the selected group's `browsers` and the project's.
- [ ] Failing test first: **every browser is resolved before anything runs**. With Chrome not installed, a run of `["firefox", "chrome"]` fails with the `BrowserNotInstalledError` message and no test started (reuse `run-browser-missing.test.ts`).
- [ ] Failing test: tests × browsers are executed in order (all tests in the first browser, then the second); `run-start.total` is the product; a failure in the first browser does not stop the second; an abort stops the rest.
- [ ] Warm-up: `ensureWarm` for each browser of the run, before the first test, with the project's `port` option (the browsers run one after another, so the port is free again).
- [ ] `executeTestCase(test, browserName, reporter)` replaces `readConfig("browser")`; the `browserName` fixture is `TestFixtures.browserName`.
- [ ] `Evidence` takes the browser: files go to `screenshots/<browser>/<test dir>/<name>.png` and the reported `path` says so, in every run. Update `evidence.test.ts`, the screenshot tests and the docs' example paths.
- [ ] Browser test (both browsers): a project with `browsers: ["firefox", "chrome"]` and two tests (one passing, one failing) reports four results with the right `browser`, the run is failed, and the named screenshot exists in both browser folders.
- [ ] Browser test: `browserName` is the browser the test runs in.
- [ ] Commit: `feat: a run executes every test in every configured browser`.

## Task 4: Groups

**Files:** `src/runner/groups.ts`, `groups.test.ts`, `run-groups.test.ts`, `src/runner/test-runner.ts`.

- [ ] Failing tests: `resolveGroup` returns `browsers` (the group's, else the project's resolved list); `listGroups` includes it; running `{ group: "cross-browser" }` uses the group's browsers while `{ group: "smoke" }` (no `browsers`) uses the project's; `--browser` on the command line (the runner option) wins over both; without `group` the project's list is used.
- [ ] Implement; `ResolvedGroup.browsers: SupportedBrowser[]`.
- [ ] Commit: `feat: groups choose their browsers`.

## Task 5: Command line

**Files:** `src/cli/args.ts`, `args.test.ts`, `main.ts`, `console-reporter.ts`, `src/cli/boundary.test.ts` if it lists flags, `cli.cli-test.ts`.

- [ ] Failing tests: `parseRunnerFlags` reads `--browser <name>` repeatably into `browsers`; an unknown name is exit code 2 with the unknown-browser message; the usage text lists `--browser`.
- [ ] `ConsoleReporter` prints ` [chrome]` after the test name when the run has more than one browser (taken from `run-start`'s browsers) and nothing extra for one; failures in the summary carry the label too.
- [ ] `samurai list` lists tests once (it does not depend on browsers).
- [ ] CLI test: `samurai run --browser chrome` runs on Chrome; a config with `browser: "firefox"` exits 2 with the removed-key message.
- [ ] Commit: `feat: samurai run --browser`.

## Task 6: Recording

**Files:** `src/recorder/session.ts`, `session.browser-test.ts`, `src/cli/main.ts`.

- [ ] `recordSpec` options get `browser?: SupportedBrowser`; without it the first browser of the project's list; warm-up and launch use it.
- [ ] `samurai record --browser chrome`.
- [ ] Browser test (both browsers): a project with `browsers: ["chrome", "firefox"]` records in Chrome by default and in Firefox with `browser: "firefox"`.
- [ ] Commit: `feat: recording picks its browser`.

## Task 7: Flows

**Files:** `src/flows/run/project.ts`, `run.ts`, `report.ts`, `events.ts`, their tests, `src/cli/flow-reporter.ts`.

- [ ] A Group node's `runTests` call passes the group's `browsers`; a Test node passes none (the project's). The node's report lists one entry per (test, browser) with `browser`; the node fails if any entry fails.
- [ ] Failing tests with the injected `testRunner`: the browsers reach the runner; reports carry `browser`; the flow reporter prints the label for more than one browser.
- [ ] Commit: `feat: flow Group nodes run in their group's browsers`.

## Task 8: Init template, docs, version

**Files:** `src/cli/init.ts` (+ test), `docs/configuration.md`, `docs/cli.md`, `docs/writing-tests.md`, `docs/running-and-reports.md`, `docs/flows.md`, `docs/pages-and-browsers.md`, `docs/roadmap.md`, `README.md`, `package.json`.

- [ ] `samurai init` writes `browsers: ["firefox"]`.
- [ ] Docs: the `browsers` option and precedence (flag, group, project, default); groups table gets `browsers`; the `browserName` fixture; `--browser`; the report's `browser` fields and the screenshot folders; flows; an "Upgrading to 0.10" note (replace `browser: "x"` with `browsers: ["x"]`; screenshots moved into `screenshots/<browser>/`; the Electron app needs the same change).
- [ ] Roadmap: multi-browser moves to Built; "Parallel runs" stays open with the note that (test, browser) is the unit a scheduler can take.
- [ ] Version `0.10.0`; `npm run build`.
- [ ] Run everything: `npm test`, `npm run test:cli`, `npm run test:browser`, `npm run test:browser:chrome`.
- [ ] Commit: `docs: testing in more than one browser`; push; open the PR against `main` (or against `feat/chrome-support` while PR #32 is open) with the Electron-app note.

## Review Focus

1. Task 3: a run with one browser behaves as before, apart from the `browser` field and the screenshot folder.
2. Task 3: a missing second browser stops the run before the first browser's tests start.
3. Task 4: a group's `browsers` replaces the project's, never merges with it.
4. Task 5: `--browser` beats the group's list too, not only the project's.
5. Task 1: the removed-key error appears from every entry point (CLI, `runTests`, `recordSpec`, `listGroups`, flows).
