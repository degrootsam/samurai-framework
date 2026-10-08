# Embedding the framework

How another program (the Electron UI, a script, a CI tool) uses this package.

## Build

The package is TypeScript. Consumers load the compiled output in `dist/`:

```sh
bun run build      # rm -rf dist, tsc -p tsconfig.build.json, copy the hand-written .d.ts files
```

The build leaves out tests (`*.test.ts`, `*.browser-test.ts`, `src/tests`, `src/testing`). For local development, link it into the other project after building:

```sh
cd ../samurai && bun add ../samurai-framework
```

Rebuild after changes. The package is ESM only.

## Entry points

| Import                                  | Gives you                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@itmetsam/samurai-framework`           | What specs import: `test`, `describe`, `expect`, `defineConfig`                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `@itmetsam/samurai-framework/runner`    | `runTests`, `listTests`, `listGroups` and the `RunEvent` / `RunnerOptions` types                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `@itmetsam/samurai-framework/steps`     | The step codec: `parseSpec`, `applyEdit`, `stepToSource`, `locatorFromSpec`, step types                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `@itmetsam/samurai-framework/recorder`  | `Recorder`, `recordSpec` (records into a spec file, what `samurai record` uses), `applyRecorderEvent`, `RecorderEvent`                                                                                                                                                                                                                                                                                                                                                                                     |
| `@itmetsam/samurai-framework/browser`   | `Browser` (launch Firefox), `BrowserContext`, `Page`, `findBrowser`                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `@itmetsam/samurai-framework/flows`     | The pure flow model, browser-safe (no Node APIs): `FlowFile`, `readFlowFile`, node keys, graph helpers, the expression language (`parseExpression`, `checkExpression`, `evaluateText`, `scopeAt`) and `FLOWS_API`                                                                                                                                                                                                                                                                                          |
| `@itmetsam/samurai-framework/flows/run` | Running flows (Node): `runFlowInProject` (checks, then walks a flow of a project; `FlowCheckError` when it can't run), `checkFlowInProject` (the check alone, with the project's real tests, groups and environment), `FlowReportBuilder` / `writeFlowReport` (the `result/flows/<id>.json` report), `runFlow` (the walker over tests you resolved yourself), `listFlows` / `readFlow` / `readFlows` (`<project>/flows/*.flow.json`), `HANDLERS`, and the `FlowEvent` / `FlowSummary` / `NodeResult` types |
| `@itmetsam/samurai-framework/init`      | `initProject(folder)` (what `samurai init` uses: writes the config, an example test and the rest of a new project, never overwriting) and `scaffold(name)` (the files as a path-to-content map)                                                                                                                                                                                                                                                                                                            |

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
    // { type: "run-start", environment, total }
    // { type: "test-start", name, file }
    // { type: "test-end", name, file, result }   result: status "success" | "failed" plus the error
    // { type: "run-end", summary }
  },
});
console.log(summary.status); // "success" | "failed"; the same object is written to result/report.json
```

All options (besides the ones above): `config` (use this object instead of reading `samurai.config.ts`), `dataDir`, `timeout`, `expectTimeout`, `reportPath` (a path, or `false` for no report), `grep` (string or RegExp), `group` (only the tests of that entry of the config's `groups`; an unknown name throws `Unknown group "x". Groups: a, b.`).

`listGroups(options)` imports the specs without running them and returns `{ name, kind: "picked" | "pattern", pattern?, testIds, missing }[]` for every configured group. `testIds` are `<file relative to srcDir>::<full name>`; `missing` lists picked tests (`{ file, title }`) that no longer exist.

Things to know:

- **Specs are TypeScript.** The process that calls `runTests` must be able to import `.ts` files (`tsx` is an optional peer dependency of the package: install it in the app): run it under `tsx` (`node --import tsx ...`), or use a process whose Node strips types. The Electron main process can't, so run the framework in a child process and talk to it with messages (below).
- **Specs are ES modules.** The project needs `"type": "module"` in its `package.json`; otherwise `runTests` refuses with a message saying so. A CommonJS spec would get second copies of the framework's classes, and `expect(locator)` would stop recognising locators.
- **One run at a time per process.** Config, secrets and the test registry are process-wide; a second concurrent call throws. Use one child process per run for parallel runs.
- **Running again in the same process** imports ES-module specs afresh, so edits are seen.
- **Aborting** stops the test that is running (its browser is closed) and reports it and the remaining tests as failed with the message `Run aborted`.
- **Where things are read and written** follows `projectDir`: the config, `.env.<environment>`, `srcDir`, `result/report.json` and `downloadsDir`. Framework logs (`logs/`) follow the process's working directory, so start a child process with `cwd` set to the project if you want them there.
- **Browser profile files.** Firefox needs a generated profile and app-data folder. They go in `browsers/` in the project folder, or in `dataDir`, or in the folder `SAMURAI_DATA_DIR` points to (highest priority). An app should point it at a folder it may write to, such as its user-data folder.
- **Firefox must be installed** on the machine; the framework launches the system browser.

## Or use the command

`samurai run --json` prints the same events as JSON lines on stdout (framework logs go to stderr), and `samurai list --json` lists the tests. An app that doesn't want to write its own child-process wrapper can spawn the command and read the lines. See [Command line](cli.md).

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

See [Steps and the recorder](recorder.md) for the codec and the recorder.

## Suggested shape for the Electron app

Run the framework in a **child process** (`child_process.fork` with `ELECTRON_RUN_AS_NODE=1` and tsx loaded, `cwd` set to the project), not inside the Electron main bundle:

- the UI is CommonJS and the framework ESM-only, and the framework keeps process-wide state;
- spec files need a TypeScript loader;
- a crash or `process.exit` in a test can't take the app down.

The child receives commands (`run`, `record`, `stop`, `abort`) and sends back `RunEvent`s and `RecorderEvent`s with `process.send`. The pure codec (`parseSpec`, `applyEdit`) can also run in the main process, imported dynamically. Such an engine entry point is not part of the package yet; see the [roadmap](roadmap.md).
