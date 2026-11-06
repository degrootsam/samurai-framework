<!-- markdownlint-disable MD041 -->

How another program (the Electron UI, a script, a CI tool) uses this package.

## Build

The package is TypeScript. Consumers load the compiled output in `dist/`:

```sh
bun run build      # rm -rf dist, tsc -p tsconfig.build.json, copy the hand-written .d.ts files
```

The build leaves out tests (`*.test.ts`, `*.browser-test.ts`, `*.cli-test.ts`, `*.test-d.ts`, `src/tests`, `src/testing`). Released versions are on npm (`npm install @itmetsam/samurai-framework`). To use an unreleased checkout, link it into the other project after building:

```sh
cd ../samurai && bun add ../samurai-framework
```

Rebuild after changes. The package is ESM only.

## Entry points

| Import                                     | Gives you                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@itmetsam/samurai-framework`              | What specs and the config import: `test`, `describe`, `expect`, `defineConfig`, `defineStep`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `@itmetsam/samurai-framework/runner`       | `runTests` (also `inputs`), `listTests` (each test with its `id`, `inputs` and `outputs`), `listGroups` and the `RunEvent` / `RunnerOptions` types                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `@itmetsam/samurai-framework/steps`        | The step codec: `parseSpec`, `parseSpecFile` (also the tests it cannot read), `applyEdit` (also `remove-test`), `stepToSource`, `locatorFromSpec`, step types                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `@itmetsam/samurai-framework/agent`        | `runAgent` (the AI agent: a model object in, a session out; needs the optional peers `ai` and `zod`), `modelFromSpec`, `defaultModelSpec`, `assertModelObject`, `resolveLimits`, `DEFAULT_LIMITS` and the types `AgentOptions`, `AgentSession`, `AgentEvent`, `AgentResult`. See [AI agent](AI-agent)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `@itmetsam/samurai-framework/recorder`     | `Recorder`, `recordSpec` (records into a spec file and shows the toolbar, what `samurai record` uses; `onStatus`, `RecordResult.secrets`), `applyRecorderEvent`, `RecorderEvent`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `@itmetsam/samurai-framework/project`      | `loadConfig({ projectDir, env })`, the config as a run uses it (0.16.0; see below). Writing to a project: `addVariable(projectDir, environment, name, value)` (into `environments.<env>.variables` of `samurai.config.ts`), `setSecret(projectDir, environment, name, value)` (into `.env.<env>`), `isGitIgnored`, `editConfig` and `hasConfigPath` (minimal edits to the config), `ConfigEditError`, `ExistsError`, the `VARIABLE_NAME` and `SECRET_NAME` patterns                                                                                                                                                                                                                                                                                                                                                                                      |
| `@itmetsam/samurai-framework/browser`      | `Browser` (launch Firefox), `BrowserContext`, `Page`, `findBrowser` (deprecated: it finds the browser installed on the computer, which launches no longer use)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `@itmetsam/samurai-framework/browsers`     | The browser store: `browserStatus({ projectDir })` (status of each pinned browser: `installed`, `missing` or `unavailable`, with any path set on purpose; a config that can't be read gives no config paths), `installBrowser(name, { onProgress })` (downloads the pinned build, `onProgress(done, total)` in bytes; returns the executable), `uninstallBrowser(name, buildId?)`, `listInstalled()` (every build in the cache, with `pinned` and `sizeBytes`), `resolveExecutable(name, { browserPaths, projectDir })` (the path a launch uses; never downloads), `BrowserNotInstalledError`, `PINNED`, `browsersCacheDir()`                                                                                                                                                                                                                            |
| `@itmetsam/samurai-framework/flows`        | The pure flow model, browser-safe (no Node APIs): `FlowFile`, `readFlowFile`, node keys, graph helpers, the expression language (`parseExpression`, `checkExpression`, `evaluateText`, `scopeAt`), `checkFlow` (options `tests`, `groups`, `environment`, `handled`, `unsupported` and `titles`, a function that names a node in messages; `undefined` falls back to title, key, label; `handled` and `unsupported` only matter for a kind with a definition but no handler; `nodes`, the definitions of step kinds, e.g. a project's `projectSteps().nodes`), `CLOSED_KINDS` (start, end, test, group, condition, parallel: the kinds that are not steps), `FLOWS_API`, and from 0.21.0 the input wiring: `FlowFacts`, `flowFactsFrom`, `wiringAt`, `alwaysBefore`, `declaredInputs`, `declaredOutputs` (see [Wiring flow inputs](#wiring-flow-inputs)) |
| `@itmetsam/samurai-framework/flows/steps`  | Steps (Node): `defineStep` (see [Writing a step](Writing-a-step)), `STEPS` (the built-in steps: Wait, Set variable, HTTP request), `listSteps(options)` (the project's catalog: built-ins then its config's steps; `projectDir` defaults to the working directory), `stepHandler`, `validateSteps(flow, options)` (async; `tests`, `groups`, `projectDir`, `config`), `stepSet`, `projectSteps`, `checkStep`, `BUILTIN_STEPS`                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `@itmetsam/samurai-framework/flows/run`    | Running flows (Node): `runFlowInProject` (checks, then walks a flow of a project; `FlowCheckError` when it can't run), `checkFlowInProject` (the check alone, with the project's real tests, groups and environment), `FlowReportBuilder` / `writeFlowReport` (the `result/flows/<id>.json` report), `projectSteps`, `runFlow` (the walker over tests you resolved yourself; options `handlers` and `nodes` too), `listFlows` / `readFlow` / `readFlows` / `readFlowPath` / `flowsDir` (`<project>/flows/*.flow.json`), `chooseEnvironment` (the environment a flow runs in), `nodeFolder` (a node's folder under `outputDir`), `HANDLERS`, and the `FlowEvent` / `FlowRunResult` / `FlowBrowserRun` / `FlowSummary` / `NodeResult` types                                                                                                                |
| `@itmetsam/samurai-framework/init`         | `initProject(folder)` (what `samurai init` uses: writes the config, an example test and the rest of a new project, never overwriting) and `scaffold(name)` (the files as a path-to-content map)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `@itmetsam/samurai-framework/capabilities` | `CAPABILITIES`: what this version can do, as flags (0.16.0). Imports nothing, so it is cheap to read from a project's own copy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Types ship with the package. Nothing else is importable: internals may move.

## Running tests from code

```ts
import { runTests } from "@itmetsam/samurai-framework/runner";

const controller = new AbortController();
const summary = await runTests({
  projectDir: "/work/shop", // samurai.config.ts, .env.<env>, specs and result/ live here
  environment: "staging",
  headless: true,
  port: 9300, // browser debugging port; use a different one per concurrent browser
  testNames: ["Checkout > applies a coupon"], // or grep: "coupon", or files: ["specs/checkout.spec.ts"]
  signal: controller.signal,
  onEvent: (event) => {
    // { type: "run-start", environment, total, browsers }   total = tests x browsers
    // { type: "test-start", name, file, browser, retry? }   once per attempt when tests are run again, see Retries below
    // { type: "test-end", name, file, browser, result }   result: status "success" | "failed" | "skipped", plus the error or the skip reason
    // { type: "run-end", summary }
  },
});
console.log(summary.status); // "success" when no test failed (skipped ones do not count), else "failed"; the same object is written to result/report.json
```

All options (besides the ones above): `inputs` (values for the inputs the tests declare, by name, from 0.21.0: each test reads the names it declares from here, and its own default for a name missing here; see [Inputs and outputs](Writing-tests#inputs-and-outputs)), `workers` (a number from 1 or a percentage like `"50%"`, as `--workers`; by default the config's `workers`, else half the CPUs, see below), `config` (use this object instead of reading `samurai.config.ts`), `dataDir`, `timeout`, `expectTimeout`, `outputDir` (a folder for this run's `report.json` and named screenshots instead of `<project>/result`, relative to the project; screenshot paths in the results are relative to it; from 0.17.0), `reportPath` (a path, or `false` for no report; beats `outputDir` for the report), `grep` (string or RegExp), `group` (only the tests of that entry of the config's `groups`; an unknown name throws `Unknown group "x". Groups: a, b.`).

`listGroups(options)` imports the specs without running them and returns `{ name, kind: "picked" | "pattern", pattern?, testIds, missing }[]` for every configured group. `testIds` are `<file relative to srcDir>::<full name>`; `missing` lists picked tests (`{ file, title }`) that no longer exist.

Things to know:

- **Result statuses.** A finished test is `"success"`, `"failed"` or `"skipped"`. A skipped result has `annotation` (`"skip"` or `"fixme"`), an optional `reason` and `duration` 0, and emits `test-start` and `test-end` back to back. Code that switches on `status` must handle `"skipped"`, and treat a status it does not know as neutral rather than throwing. See [Skipped tests](Running-tests-and-reports#skipped-tests).
- **`test.only` and `forbidOnly`.** With [`forbidOnly`](Configuration#forbidonly) on (the default when `CI` is set in the process environment), `runTests` rejects before starting when a spec has a `.only`; the message lists every focused test. Show it as a run error, not as a failed test. Do not set `CI` in the environment of an app for local runs unless you want that. Otherwise the focused tests run and the others are not reported.
- **`listTests`** returns `{ id, name, file, relativeFile, modifier?, reason? }[]`. `relativeFile` is the spec path relative to `srcDir` with `/` separators, and `id` is `<relativeFile>::<full name>`: the same string `listGroups` puts in a group's `testIds` (0.16.0). `file` is absolute; `modifier` is `"skip"`, `"fixme"` or `"only"` (a `describe` around the test counts), absent for a plain test. `reason` is the `{ reason }` of the skip or fixme that applies. From 0.21.0 `inputs` (`{ name, default }[]`, in declaration order) and `outputs` (names) are the test's declared [inputs and outputs](Writing-tests#inputs-and-outputs), each absent when it declares none; a result's `inputs` and `outputs` hold the values the attempt read and saved. It never applies `only` or `forbidOnly`: it lists every test.

- **The project config is TypeScript too.** `listSteps`, `validateSteps`, `checkFlowInProject` and `runFlowInProject` import the project's `samurai.config.ts` (and the project steps it lists), so the calling process needs the TypeScript loader for these as well. A long-lived process keeps the config as first imported (ES-module cache): start a fresh process to see edits.
- **Specs are TypeScript.** The process that calls `runTests` must be able to import `.ts` files (`tsx` is an optional peer dependency of the package: install it in the app): run it under `tsx` (`node --import tsx ...`), or use a process whose Node strips types. The Electron main process can't, so run the framework in a child process and talk to it with messages (below).
- **Specs are ES modules.** The project needs `"type": "module"` in its `package.json`; otherwise `runTests` refuses with a message saying so. A CommonJS spec would get second copies of the framework's classes, and `expect(locator)` would stop recognising locators.
- **One run at a time per process.** Config, secrets and the test registry are process-wide; a second concurrent call throws. Tests of one run can run in parallel, see the next item.
- **Hooks.** A failing `beforeEach`, `afterEach` or `beforeAll` is an ordinary failed result of its test (`beforeEach hook failed: <message>`). `runTests` resolves after the workers have run their `afterAll` hooks: `WorkerPool.dispose()` asks an idle worker to exit and waits for it (up to `shutdownMs`, a minute by default) before it kills it.
- **Workers.** A run with a config read from `projectDir`, with more than one test and more than one worker, runs its tests in child processes of the calling process, up to `workers` at a time (default: half the CPUs, the `workers` option beats `SAMURAI_WORKERS`, which `runTests` reads from the calling process's environment, and that beats the config). Each worker takes `port` plus its index as its browser port, so leave room above `port`. `onEvent` gets the events as tests end, in completion order; the summary lists the tests in test order, each result with its `worker`. Pass `workers: 1` to keep the old behaviour of one test at a time in the calling process. A run with `config` given as an object stays on one worker (a worker reads `samurai.config.ts` from the folder), with a warning when `workers` was asked for. Before 0.12 the default was one test at a time: an app that relied on that, or that shares data between tests, should pass `workers: 1`.
- **Retries.** `retries` (a whole number from 0, or its text, as `--retries`; when absent `runTests` takes `SAMURAI_RETRIES` from the calling process's environment, then the config's `retries`, then 0) runs a failing test again with a fresh browser. `runFlowInProject` takes `retries` and `retriesEnv` (the value of `SAMURAI_RETRIES`) with the same rules and applies them to the tests of every node. A retried test is still **one result**, the last attempt's, with `retry` (counting from 1), `flaky: true` for a pass after a failure and `previousAttempts` (the earlier errors), all absent for a test that was not run again. The events are the part to get right: `test-start` is emitted **once per attempt** (`retry: n` from the second), `test-end` **once**. Do not assume one start per end, and do not take a repeated `test-start` for a new test: key a row by `file`, `name` and `browser`, put it back to running on a repeated start, and count progress with `test-end` against `run-start.total`. A flaky test is a pass (the summary `status` stays `"success"`). An aborted run is never retried. The worker protocol's `WorkerInit.retries` is internal.
- **Groups.** `group` is a group name or a list of names. A test that is in two selected groups runs once per group, so a row is keyed by `file`, `name`, `browser` **and `group`** (every result and `test-start` / `test-end` event of a group run has a `group`; it is absent when no group was selected). `run-start.browsers` lists the union of the browsers of the selected groups, and a group only runs in its own.
- **Shards and serial blocks.** `shard: { current, total }` runs one slice of the selected tests (whole files and serial blocks; see [Sharding](Running-tests-and-reports#sharding)); the summary and the `run-start` event carry `shard`, and a shard without tests succeeds with an empty `tests` list. A test of a [serial block](Writing-tests#serial-mode) whose earlier test failed is a `skipped` result with `annotation: "skip"` and the `reason` `serial: an earlier test failed`. With `retries`, the tests of a serial block are reported once the block's last attempt is known. `loadConfig` returns the config's `fullyParallel` when it is set.
- **Flows.** From 0.21.0 a flow runs [once per browser](Flows#browsers). `runFlowInProject` resolves to a `FlowRunResult`, `{ status: "passed" | "failed" | "cancelled", runs: { browser, summary: FlowSummary }[] }`, one entry per browser run in the order they ran. `browsers` limits the runs to those browsers (in the flow's order; a browser no node uses is ignored, and a list that leaves none throws `runFlowInProject(): this flow runs in none of <list>` before anything starts). Every `FlowEvent` has the `browser` of its run, `flow-start` and `flow-end` come once per browser, and the last event is `{ type: "flow-done", status, runs }`, without a `browser`. The report file has the same `runs` (see [The report](Flows#the-report)), and `FlowReportBuilder.finish` takes the `FlowRunResult`. A node's result has `inputs` and `outputs` (see [Inputs and outputs](Flows#inputs-and-outputs)).
- **Flow folders.** `runFlowInProject` takes `outputDir` (the folder the tests' named screenshots go in; from 0.17.0). Each Test and Group node writes to its own folder inside it, so a test that runs in two nodes keeps both sets, and every flow `test` event has the `nodeId`. From 0.21.0 that folder is `<browser>/nodes/<node id>/`, one per browser run, and screenshot paths in a node's events and results are relative to `outputDir` with `/` separators (`<browser>/nodes/<id>/screenshots/...`), so `outputDir` joined with the path is the file. `nodeFolder(nodeId, browser)` returns the folder (`<browser>/nodes/<cleaned id>`) so an app need not rebuild the name. (0.18.0 to 0.20.0: `nodes/<node id>/`, paths relative to it, and `nodeFolder(nodeId)`.) It also takes `workers` (a number or a percentage; the same rules and default) and `workersEnv` (the value of `SAMURAI_WORKERS` to use when `workers` is absent), and runs the tests of all its Test and Group nodes, and of the branches of a Parallel node, on one shared pool of workers. A flow given `config` as an object stays on one worker.
- **Running again in the same process** imports ES-module specs afresh, so edits are seen.
- **Aborting** stops the test that is running (its browser is closed) and reports it and the remaining tests as failed with the message `Run aborted`.
- **Where things are read and written** follows `projectDir`: the config, `.env.<environment>`, `srcDir`, `result/report.json` (or `outputDir`) and `downloadsDir`. Framework logs go to `logs/` of the project folder too, while a run, a recording or a flow is in progress; before and after that (and in a process that never starts one) nothing is written to disk. Before 0.12.2 they went to `logs/` of the process's working directory.
- **Browser profile files.** Firefox needs a generated profile and app-data folder. They go in `browsers/` in the project folder, or in `dataDir`, or in the folder `SAMURAI_DATA_DIR` points to (highest priority). An app should point it at a folder it may write to, such as its user-data folder.
- **Firefox must be downloaded by the framework.** Launches use the pinned build from the cache, or a path set with `SAMURAI_FIREFOX_PATH` or `browserPaths`; they never download and never use the system browser. A missing build throws `BrowserNotInstalledError` (message: `Firefox 158.0 is not installed. Run: samurai browsers install firefox`). Call `installBrowser("firefox", { onProgress })` from the app to offer the download, and `browserStatus` to show whether it is there.

## Wiring flow inputs

From 0.21.0 the pure `flows` entry point has what a flow editor needs to show where a node's [inputs](Flows#inputs-and-outputs) come from, without copying any rules:

```ts
import {
  checkFlow,
  flowFactsFrom,
  wiringAt,
} from "@itmetsam/samurai-framework/flows";

const facts = flowFactsFrom(tests, groups); // the results of listTests and listGroups
wiringAt(flow, "find", { facts });
// { orderId: { from: "node", nodeId: "purchase", output: "orderId" } }
checkFlow(flow, { tests: ids, groups: names, facts }); // also reports inputs with no source
```

- `FlowFacts` is `{ tests: { [testId]: { inputs: { name, default }[], outputs: string[] } }, groups: { [name]: testIds } }`. `flowFactsFrom(tests, groups)` builds it from `listTests` (`id`, `inputs`, `outputs`) and `listGroups` (`name`, `testIds`).
- `wiringAt(flow, nodeId, { facts })` gives each declared input of a Test or Group node an `InputWiring`: `{ from: "node", nodeId, output }`, `{ from: "expression", expression }`, `{ from: "default", value }` or `{ from: "none" }`. Without facts, or for a test the facts don't know, it is `{}`.
- `alwaysBefore(flow, d, n)` says whether node `d` always ran before node `n` (the rule wiring uses). `declaredInputs(node, facts)` and `declaredOutputs(node, facts)` give a node's declared names.
- `checkFlow(flow, { facts })` adds the input problems listed in [Flows](Flows#inputs-and-outputs); without `facts` nothing new is reported. `scopeAt(flow, nodeId, environment, { nodes, facts })` and `expressionProblems(flow, environment, { nodes, facts })` take an options object and, with `facts`, know each keyed Test node's outputs as `nodes.<key>.<name>`.
- A node's overrides are stored in the flow file as `inputs: { [name]: { expression } | { useDefault: true } }` (`InputSource`).

`checkFlowInProject` and `runFlowInProject` build the facts from the project themselves.

## Capabilities and the resolved config

An app that loads each project's own copy of the framework meets several versions. Instead of checking version numbers, read what that copy says it can do:

```ts
import { CAPABILITIES } from "@itmetsam/samurai-framework/capabilities"; // from 0.16.0
CAPABILITIES.testIds; // true: listTests gives ids
```

A missing key, or a missing `capabilities` entry point, means "not supported". The flags: `groups`, `recorderToolbar`, `recorderFiles`, `flowsApi` (a number), `flowSteps`, `managedBrowsers`, `modifiers`, `skipReason`, `testIds`, `resolvedConfig`, `recorderStartStatus`, from 0.17.0 `writtenConfig` and `outputDir`, from 0.18.0 `flowNodeFolders`, and from 0.19.0 `assertionMatchers` (a number: 2 with the 0.19.0 matchers) and `pageAssertions`, from 0.20.0 `nodeFolder`, and from 0.21.0 `testInputsOutputs`, `flowPerBrowser`, `nodeFolder` 2 (it takes the browser), `flowNodeFolders` 2 (`<browser>/nodes/<id>/`, paths relative to `outputDir`) and `flowsApi` 3, and from 0.22.2 `assertionMatchers` 3 (the nine plain matchers in the codec), `actionSteps` (`check`, `uncheck`, `selectOption`, `hover`, `dblclick`, `clear`), `locatorForms` (`exact`, regex text and name, `getByPlaceholder`, `getByAltText`, `getByTitle`, the `getByRole` state options, `nth`, `first`, `last`, `filter`) and `recorderActionSteps` (the recorder writes `check`, `uncheck` and `selectOption`), and `aiAgent` (the `./agent` entry point). Versions only add flags in practice, but nothing is promised: the shapes behind them may change.

`loadConfig({ projectDir, env })` from `@itmetsam/samurai-framework/project` returns the config the way a run uses it, as plain JSON (safe to send between processes): every default filled in, `srcDir` resolved, `browsers` always a list, `workersResolved` (what a run without `--workers` uses), `retries`, `forbidOnly`, `headless`, viewport, folders, logs (an `ignoreErrors` `RegExp` becomes `{ text, regexp: true, flags }`), network settings, each group with its browsers, the project's own step kinds, and every environment with its values merged the way a run merges them. A config with several environments and no `defaultEnvironment` does not throw: `environmentProblem` holds the message a run without `--env` would give. An invalid config throws like a run. The caller registers a TypeScript loader first (as for `runTests`), and the config file is read once per process.

To show and edit the config, pass `written: true` (from 0.17.0): `loadConfig({ projectDir, env, written: true })` returns `{ written, resolved }`. `written` is the config as the file states it, as plain JSON, with nothing filled in: an absent `workers` stays absent, and a config without `environments` has none. Patterns become `{ text, regexp, flags }` and steps become their kinds, as in `resolved`. For an invalid config this mode does not throw: `resolved` is left out and `error` holds the message a run would throw, so the file can still be shown and fixed. `writtenConfig(config)` does the same conversion for a config object you already have.

## Or use the command

`samurai run --json` prints the same events as JSON lines on stdout (framework logs go to stderr), and `samurai list --json` lists the tests. An app that doesn't want to write its own child-process wrapper can spawn the command and read the lines. See [Command line](Command-line).

## Using the pieces directly

```ts
import { parseSpec, applyEdit } from "@itmetsam/samurai-framework/steps";
import { Browser } from "@itmetsam/samurai-framework/browser";
import { applyRecorderEvent } from "@itmetsam/samurai-framework/recorder";

const { browser, page } = await Browser.launch("firefox", {
  port: 9301,
  headless: false,
});
await page.goto("https://example.com");
const recorder = await page.record({
  onEvent: (event) => {
    source = applyRecorderEvent(source, 0, event);
  },
});
// …the person uses the window…
await recorder.stop();
await browser.close();
```

`Browser.launch` also reads `samurai.config.ts` from the working directory (or the active project when called from `runTests`) for settings such as `bidi.commandTimeout` and `downloadsDir`; when you call it on its own, run the process in the project folder.

`recordSpec` takes `onStatus`, called with `{ state: "recording" | "paused", toolbar: boolean }`: once right after `onStarted` (from 0.16.0; before that it was not called at the start), then whenever the person pauses or resumes, or the toolbar fails or comes back on a page. Statuses that arrive while `onStarted` runs are sent after it. `RecordResult` always has every field (`files`, `missingFiles`, `filesIgnored`, `filesFolder`, `firstFiles`, `secrets`, `unsetSecrets`), empty or `false` when there is nothing to report. An app can show "Recording in the browser window" or "Paused in the browser window" from it. The toolbar's Stop resolves `recordSpec` like a closed window, and `RecordResult.secrets` includes secrets added from the toolbar.

See [Steps and the recorder](Steps-and-the-recorder) for the codec, the recorder and the toolbar.

## Suggested shape for the Electron app

Run the framework in a **child process** (`child_process.fork` with `ELECTRON_RUN_AS_NODE=1` and tsx loaded, `cwd` set to the project), not inside the Electron main bundle:

- the UI is CommonJS and the framework ESM-only, and the framework keeps process-wide state;
- spec files and the project config (`samurai.config.ts`) need a TypeScript loader;
- a crash or `process.exit` in a test can't take the app down.

The Electron app has such an engine of its own (`src/engine/` in the `samurai` repository). It takes requests such as `config`, `list`, `groups`, `run`, `record`, `flow` and `abort`, and answers with replies and events (`RunEvent`s, the recorded source) over `process.send`. It loads the framework from the project's own `node_modules`, so the specs and the runner share one test registry. The pure codec (`parseSpec`, `applyEdit`) can also run in the main process, imported dynamically.
