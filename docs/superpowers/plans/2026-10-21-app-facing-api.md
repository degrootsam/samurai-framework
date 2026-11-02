# App-facing API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The framework states what the Electron app now guesses: a capabilities list, test ids on `listTests`, whole-test ranges plus a `remove-test` edit and an `unparsed` list in the codec, a resolved `loadConfig`, and a recorder that always sends a first status.

**Architecture:** Five independent parts, each its own PR, stacked in task order (each branch starts from the previous one; the first from `main`). Every part turns on its key in `src/capabilities.ts`. Defaults move into one module so `loadConfig` and the runner read the same constants.

**Tech Stack:** TypeScript (ESM), Node's test runner via `tsx`, the `typescript` compiler API in the codec.

**Spec:** `docs/superpowers/specs/2026-10-21-app-facing-api-design.md` (local, git-ignored). Source hand-off: `../samurai/docs/handoffs/2026-10-21-framework-api-for-app.md`.

## Global Constraints

- No compatibility promise: shapes may change; no deprecated aliases, no parallel old shapes.
- Listing (capabilities, tests, groups, config) never launches a browser or runs a test. `src/capabilities.ts` imports nothing.
- Everything returned by `listTests`, `listGroups`, `loadConfig` and `CAPABILITIES` survives `JSON.parse(JSON.stringify(x))` unchanged: no functions, `RegExp`, class instances.
- The codec (`src/steps/`) stays pure: no file access, no framework state.
- Repo rules (`CLAUDE.md`): branch from up-to-date `main` (first PR); stage named paths only; run tests through npm scripts (`npm test`, `npm run build` then `npm run test:cli`, `npm run test:browser`); `npx tsc --noEmit --noUnusedLocals`, `npx knip`, `npx madge --circular --extensions ts src` clean; PR body has Summary and a Test plan with checkboxes and real counts; check `gh pr checks`.
- Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR footer `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- New subpaths are added to `package.json` `exports` (types + default under `./dist/...`) **and** to `knip.json` `entry`.
- Match surrounding style: JSDoc on exported names, short comments, `...(x !== undefined && { x })` for optional fields.

## Review Focus

- Windows paths: `relativeFile` and `id` use `/` separators even when `srcDir` uses `\` (pin with a test feeding a `\`-separated relative path through the same helper).
- A symlinked project folder: `listTests` ids must equal `listGroups` ids when the project dir is a symlink (both use the real `srcDir`; Task 2 test runs both on one project and compares).
- `remove-test` on the first test right after the imports, and on the last test of a file with no trailing newline: no other byte changes (Task 3 tests).
- A config with several environments and no `defaultEnvironment`: `loadConfig` returns, with `environmentProblem` set; it does not throw (Task 6 test).
- `logs.ignoreErrors` with a `RegExp` and flags: survives JSON as `{ text, regexp: true, flags }` (Task 6 test).

---

### Task 1: Capabilities subpath

**Files:**
- Create: `src/capabilities.ts`, `src/capabilities.test.ts`
- Modify: `package.json` (`exports` gets `"./capabilities"`), `knip.json` (`entry` gets `"src/capabilities.ts"`)

**Interfaces:**
- Produces: `export const CAPABILITIES` (`as const`) and `export type Capabilities = typeof CAPABILITIES`. Later tasks add one key each.

- [ ] **Step 1: Write the failing tests** in `src/capabilities.test.ts`:
  - `"lists what this framework can do"`: `assert.deepEqual(CAPABILITIES, { groups: true, recorderToolbar: true, recorderFiles: true, flowsApi: FLOWS_API, flowSteps: true, managedBrowsers: true, modifiers: true, skipReason: true })` (import `FLOWS_API` from `./flows/core/index.js`).
  - `"imports nothing"`: read `src/capabilities.ts` as text, `assert.doesNotMatch(text, /^\s*import\s/m)`.
  - `"survives JSON"`: `assert.deepEqual(JSON.parse(JSON.stringify(CAPABILITIES)), CAPABILITIES)`.
- [ ] **Step 2:** `npm test` → the three fail (module missing).
- [ ] **Step 3:** Write `src/capabilities.ts`: JSDoc on the module saying what it is for (the app reads it from a project's copy to know what that framework can do; cheap to import; a missing key means not supported) and one JSDoc line per key naming what it covers. `flowsApi` is the literal `2` with a comment that a test keeps it equal to `FLOWS_API`.
- [ ] **Step 4:** Add the `exports` entry (`"./capabilities": { "types": "./dist/capabilities.d.ts", "default": "./dist/capabilities.js" }`, before `"./package.json"`) and the knip entry.
- [ ] **Step 5:** `npm test` passes; `npm run build` then `node -e "import('@itmetsam/samurai-framework/capabilities').then(m=>console.log(m.CAPABILITIES))"` from the repo prints the object (self-reference through `exports`); knip, madge, tsc clean.
- [ ] **Step 6: Commit** `feat: a capabilities subpath that says what this framework can do`; push branch `feat/capabilities`; open PR against `main`.

### Task 2: Test ids and relative files on `listTests`

**Files:**
- Modify: `src/runner/run.ts` (`FoundTest`, `listTests`), `src/runner/test-runner.ts` (`register` or a new `list` method), `src/runner/select.ts` (reuse `idOf`), `src/runner/groups.ts` (JSDoc on `testId` and `ResolvedGroup.testIds`), `src/capabilities.ts` (+`testIds: true`), `src/capabilities.test.ts`
- Test: `src/runner/run-list.test.ts`

**Interfaces:**
- Consumes: `idOf(test, srcDir)` and `loadSpecs(...)` (`loaded.srcDir`, the real `srcDir`) from `src/runner/select.ts`.
- Produces: `FoundTest = { id: string; name: string; file: string; relativeFile: string; modifier?: Modifier; reason?: string }`. `relativeFile` = `toPosix(path.relative(srcDir, test.file))`; `id` = `testId(relativeFile, name)`, i.e. `idOf`.

- [ ] **Step 1: Write failing tests** in `run-list.test.ts`:
  - `"gives each test the id its groups use, and its file relative to srcDir"`: on the existing temp project, `tests[0]` has `relativeFile === "shop.spec.ts"` and `id === "shop.spec.ts::plain"`; add a group `{ name: "all" }` to the config passed in and assert `(await listGroups(sameOptions))[0].testIds` deep-equals `tests.map((t) => t.id)`.
  - `"ids match groups when the project folder is a symlink"`: `symlinkSync(dir, link)`; `listTests({ projectDir: link, ... })` ids equal `listGroups({ projectDir: link, ... })[0].testIds`.
  - In `groups.test.ts` (or wherever `testId` is tested): `testId(toPosix("a\\b.spec.ts"), "x") === "a/b.spec.ts::x"`.
- [ ] **Step 2:** `npm test` → fail.
- [ ] **Step 3:** Make `TestRunner` expose the selected tests together with the real `srcDir` (e.g. `list(): Promise<{ tests: RegisteredTestCase[]; srcDir: string }>`), and build `FoundTest` from it in `listTests`. Key order in each object: `id, name, file, relativeFile, modifier?, reason?`. Update `listTests` JSDoc and `FoundTest` field docs: the id format is documented on `FoundTest.id` and `ResolvedGroup.testIds`.
- [ ] **Step 4:** Add `testIds: true` to `CAPABILITIES` and to the Task 1 deep-equal test. Update `src/cli/cli.cli-test.ts`'s `list --json` expectations if they deep-equal whole objects.
- [ ] **Step 5:** `npm test`, `npm run build` + `npm run test:cli`, tsc, knip, madge pass.
- [ ] **Step 6: Commit** `feat: listTests gives each test the id its groups use`; branch `feat/test-ids` from `feat/capabilities`; PR with base `feat/capabilities`.

### Task 3: Whole-test ranges and the `remove-test` edit

**Files:**
- Modify: `src/steps/model.ts` (`ParsedTest.start`, `ParsedTest.end`), `src/steps/parse.ts`, `src/steps/edit.ts` (`StepEdit`, `applyEdit`)
- Create: `src/steps/remove-test.test.ts`

**Interfaces:**
- Produces: `ParsedTest.start: number` = the `ExpressionStatement` holding the call, `getFullStart()`; `ParsedTest.end: number` = that statement's `end`. `StepEdit` gains `{ op: "remove-test"; test: number }`; `applyEdit` returns `source.slice(0, start) + source.slice(end)`. Out-of-range `test` throws `RangeError` like the other ops (`pickTest`).

- [ ] **Step 1: Write failing tests** in `remove-test.test.ts`, porting `../samurai/src/main/utils/delete-tests.test.ts` byte for byte (same `spec` and `marked` sources and the same expected outputs), each removal done with `applyEdit(source, { op: "remove-test", test: parseSpec(source).findIndex(t => t.name === name) })`, several removals applied from the highest index to the lowest:
  - `"removes a test with the comment above it, leaving the rest byte for byte"` (expected: `spec.replace("\n\n// Signs in first\ntest(\"logs in\"...});", "")`, exactly as the app's test).
  - `"removes several tests, inside and outside a describe"` (same `toContain` / `not.toContain` checks as the app's test, as `assert.ok(source.includes(...))`).
  - `"removes skipped and fixme tests, with or without a reason"` (exact expected source from the app's test).
  - `"removes the first test right after the imports"` and `"removes the last test of a file without a trailing newline"`: everything outside `[start, end)` unchanged, and `parseSpec` of the result lists the remaining names.
  - `"start and end cover the whole statement"`: for the `logs in` test, `source.slice(t.start, t.end)` starts with `"\n\n// Signs in first\ntest("` and ends with `"});"`.
  - `"an unknown test index throws RangeError"`.
- [ ] **Step 2:** `npm test` → fail.
- [ ] **Step 3:** In `parse.ts`, find the enclosing `ExpressionStatement` of the test's `CallExpression` (walk `parent`) and set `start`/`end`; if the call isn't directly an expression statement, use the call's own full start and end. In `edit.ts`, add the `remove-test` case. JSDoc on `StepEdit`'s new member: removes the whole test with the comments and blank line above it; for several tests apply from the last index to the first.
- [ ] **Step 4:** `npm test` passes; `npm run test:browser` for `src/recorder/*.browser-test.ts` (they write specs through the codec) passes.
- [ ] **Step 5: Commit** `feat: the codec gives whole-test ranges and removes a test`.

### Task 4: `parseSpecFile` and the `unparsed` list

**Files:**
- Modify: `src/steps/parse.ts`, `src/steps/model.ts` (`UnparsedTest`), `src/steps/index.ts` (export `parseSpecFile`, `UnparsedTest`)
- Create: `src/steps/unparsed.test.ts`

**Interfaces:**
- Produces: `parseSpecFile(source: string): { tests: ParsedTest[]; unparsed: UnparsedTest[] }`; `parseSpec(source) === parseSpecFile(source).tests`. `UnparsedTest = { kind: "test" | "describe"; start: number; end: number; reason: "dynamic-title" | "not-inline" }` with `start`/`end` the call's statement range (same rule as `ParsedTest`).
- Rules (spec §3): `test(…)` / `test.only(…)` / `describe(…)` / `describe.skip|fixme|only(…)` are always test or describe calls. `test.skip(…)` / `test.fixme(…)` are test calls only when the first argument is a string literal or a template literal; otherwise they are the in-body condition form: neither a test nor unparsed. Title not a plain string literal or no-substitution template → `"dynamic-title"`. Function argument not an arrow or function expression with a block body (variable, imported function, expression body) → `"not-inline"`. An unreadable `describe` is one `unparsed` entry and its inner tests are not returned. A literal-titled `test` inside a `for` loop is read normally.

- [ ] **Step 1: Write failing tests** in `unparsed.test.ts`, one per rule, each asserting both `tests` names and `unparsed` `kind`/`reason`:
  - template title with `${i}` → `{ kind: "test", reason: "dynamic-title" }`; variable title → same; `"a" + b` → same
  - `test("x", runIt)` → `"not-inline"`; `test("x", async () => doThing())` → `"not-inline"`
  - `describe(\`group ${n}\`, () => { test("inner", async () => {}) })` → one `{ kind: "describe", reason: "dynamic-title" }`, `tests` does not contain `"inner"` nor any name ending in `"inner"`
  - `describe("d", setup)` → `{ kind: "describe", reason: "not-inline" }`
  - `test.skip(isCI, "slow")` inside a test body → not in `unparsed`, still a `custom` step
  - `for (const u of users) test("logs in", async () => {})` → `tests` has `"logs in"`, `unparsed` empty
  - `parseSpec(src)` deep-equals `parseSpecFile(src).tests` for the `SPEC` in `modifiers.test.ts`
- [ ] **Step 2:** `npm test` → fail. Existing tests in `src/steps/*.test.ts` that expected inner tests of a dynamic `describe` must be updated if any exist (search for template titles in those tests first).
- [ ] **Step 3:** Implement in `parse.ts`'s visitor: classify each `test`/`describe` call (using `calleeOf`) before reading it; collect `unparsed`; do not descend into an unreadable `describe`.
- [ ] **Step 4:** `npm test` passes; tsc, knip, madge clean.
- [ ] **Step 5: Commit** `feat: parseSpecFile reports the tests the codec cannot read`; push branch `feat/codec-whole-tests` (Tasks 3+4) from `feat/test-ids`; PR with that base. No capabilities key (spec: the app runs its own codec copy).

### Task 5: One module for config defaults

**Files:**
- Create: `src/config/defaults.ts`
- Modify: `src/config/run-settings.ts` (`DEFAULT_TIMEOUT`, `DEFAULT_EXPECT_TIMEOUT`), `src/runner/groups.ts` (`DEFAULT_SRC_DIR`, `DEFAULT_TEST_MATCH`), `src/browser/page-settings.ts` (`DEFAULT_NAVIGATION_TIMEOUT`, `DEFAULT_IDLE_TIME`, `"complete"`), `src/network/router.ts` (`DEFAULT_ROUTE_TIMEOUT`), `src/network/data-collector.ts` (`DEFAULT_MAX_BODY_SIZE`), `src/transport/bidi-connection.ts` (`DEFAULT_COMMAND_TIMEOUT`), `src/browser/viewport.ts` (`DEFAULT_VIEWPORT`), `src/browser/browser.ts` (`"result/downloads"`), `src/project/files-store.ts` (`"files"`), and every importer of the moved names

**Interfaces:**
- Produces, from `src/config/defaults.ts`: `DEFAULT_SRC_DIR = "./src"`, `DEFAULT_TEST_MATCH = "**/*.spec.ts"`, `DEFAULT_BROWSERS = ["firefox"] as const`, `DEFAULT_TIMEOUT = 30000`, `DEFAULT_EXPECT_TIMEOUT = 5000`, `DEFAULT_NAVIGATION_TIMEOUT = 30000`, `DEFAULT_WAIT_UNTIL = "complete"`, `DEFAULT_COMMAND_TIMEOUT = 30000`, `DEFAULT_IDLE_TIME = 500`, `DEFAULT_ROUTE_TIMEOUT = 30000`, `DEFAULT_MAX_BODY_SIZE = 10 * 1024 * 1024`, `DEFAULT_COLLECT_BODIES = false`, `DEFAULT_TRACK_NETWORK = true`, `DEFAULT_VIEWPORT = { width: 1280, height: 720 }`, `DEFAULT_DOWNLOADS_DIR = "result/downloads"`, `DEFAULT_FILES_DIR = "files"`, `DEFAULT_RETRIES = 0`, `DEFAULT_LOGS_CAPTURE = "failures"`, `DEFAULT_FAIL_ON_PAGE_ERROR = false`. Check each value against its current use before moving; where `browsers.ts` (`browsersFor`) has its own Firefox default, point it at `DEFAULT_BROWSERS`.

- [ ] **Step 1:** Move the constants (pure refactor; no behaviour change). The module imports only types.
- [ ] **Step 2:** `npm test`, `npm run build` + `npm run test:cli`, tsc, knip, madge, and `npm run test:browser` all pass unchanged.
- [ ] **Step 3: Commit** `refactor: config defaults live in one module`.

### Task 6: `loadConfig` returns the resolved config

**Files:**
- Create: `src/config/resolved-config.ts` (type `ResolvedConfig`, `resolveConfig(raw, { projectDir, env })`), `src/config/resolved-config.test.ts`
- Modify: `src/config/config.ts` (internal `loadConfig()` → `loadRawConfig()`, all callers), `src/project/index.ts` (export the public `loadConfig` and the types), `src/capabilities.ts` (+`resolvedConfig: true`) and its test

**Interfaces:**
- Consumes: `src/config/defaults.ts` (Task 5); `resolveRunSettings` precedence and `isCI` from `src/config/run-settings.ts`; `resolveWorkers` from `src/runner/workers-option.ts`; `forbidsOnly` (wherever the runner computes it); `browsersFor` from `src/runner/browsers.ts`; `projectConfig({ projectDir })` from `src/config/config.ts`.
- Produces: `loadConfig(options?: { projectDir?: string; env?: Record<string, string | undefined> }): Promise<ResolvedConfig>` from `@itmetsam/samurai-framework/project`. The caller registers `tsx` (JSDoc says so). `ResolvedConfig` fields exactly as spec §4: `projectDir`, `srcDir` (absolute), `srcDirRelative`, `browsers`, `browserPaths`, `timeout`, `expectTimeout`, `navigationTimeout`, `waitUntil`, `bidiCommandTimeout`, `workers` (as written, may be absent), `workersResolved`, `retries`, `forbidOnly`, `headless`, `viewport`, `downloadsDir`, `filesDir`, `logs: { capture, failOnPageError, ignoreErrors: { text; regexp; flags? }[] }`, `network: { track, idleTime, routeTimeout, collectBodies, maxBodySize }`, `baseURL?`, `defaultEnvironment?`, `environmentProblem?`, `environments: Record<string, { baseURL?; timeout; expectTimeout; headless; variables }>`, `groups: (SamuraiGroup & { browsers: SupportedBrowser[] })[]`, `steps: string[]` (kinds of the project's own steps). `env` defaults to `process.env`; it feeds `isCI` (`headless`, `forbidOnly`, environment `headless`) and `SAMURAI_WORKERS` is **not** applied (spec: `workersResolved` is "a run without `--workers`/`SAMURAI_WORKERS`").

- [ ] **Step 1: Write failing tests** for `resolveConfig` (pure, no file I/O) in `resolved-config.test.ts`:
  - `"fills every default for an empty config"`: `resolveConfig({}, { projectDir: "/p", env: {} })` deep-equals the full object with the Task 5 constants, `srcDir: "/p/src"`, `srcDirRelative: "./src"`, `headless: false`, `forbidOnly: false`, one environment `"default"` with `{ timeout: 30000, expectTimeout: 5000, headless: false, variables: {} }`, `groups: []`, `steps: []`, `workersResolved` = `resolveWorkers({ cpus })` result (inject `cpus` or compare to the same call).
  - `"CI makes it headless and forbids only"`: `env: { CI: "1" }` → `headless: true`, `forbidOnly: true`.
  - `"environments merge with the project the way runs do"`: project `timeout: 10000`, env `staging` with `expect: { timeout: 2000 }`, `headless: true` → `staging: { timeout: 10000, expectTimeout: 2000, headless: true, ... }`; `baseURL` falls back to the project's.
  - `"several environments without a default do not throw"`: two environments, no `defaultEnvironment` → `environmentProblem` matches `/No environment chosen/`; unknown `defaultEnvironment: "nope"` → `/Unknown environment "nope"/`.
  - `"ignoreErrors survive JSON"`: `["boom", /x+/gi]` → `[{ text: "boom", regexp: false }, { text: "x+", regexp: true, flags: "gi" }]`, and `JSON.parse(JSON.stringify(r))` deep-equals `r`.
  - `"groups get their browsers"`: group `{ name: "g", browsers: ["chrome"] }` and project `browsers: ["firefox"]` → `g.browsers` `["chrome"]`; a group without → `["firefox"]`.
  - `"steps are listed by kind"`: config with `steps: [defineStep({ kind: "my.step", ... })]` → `steps: ["my.step"]`.
  - `"an invalid config throws like a run"`: `{ workers: 0 }` throws the same message `validateWorkersConfig` throws.
  - In a project test (temp folder with `samurai.config.ts`, run under the test runner's `tsx`): `loadConfig({ projectDir })` returns `srcDir` resolved against that folder and leaves no project active (a following `listTests` on another folder works).
- [ ] **Step 2:** `npm test` → fail.
- [ ] **Step 3:** Implement `resolveConfig` and `ResolvedConfig` (the `environmentProblem` text comes from catching `UnknownEnvironmentError` thrown by `resolveRunSettings(raw, {}, env)`; per-environment values reuse `resolveRunSettings(raw, { environment: name }, env)`). Rename the internal `loadConfig` to `loadRawConfig`; add the public `loadConfig` in `src/config/resolved-config.ts` built on `projectConfig` + `resolveConfig`; export it from `src/project/index.ts`.
- [ ] **Step 4:** Add `resolvedConfig: true` to capabilities and its test.
- [ ] **Step 5:** `npm test`, build + `test:cli`, tsc, knip, madge pass.
- [ ] **Step 6: Commit** `feat: loadConfig returns the config the way a run uses it`; push branch `feat/resolved-config` (Tasks 5+6) from `feat/codec-whole-tests`; PR with that base.

### Task 7: Recorder first status and the result contract

**Files:**
- Modify: `src/recorder/session.ts` (`onStatus` JSDoc, call it once after `onStarted`), possibly `src/recorder/toolbar-bridge.ts` (to read whether the toolbar loaded), `RecordResult` JSDoc ("every field is always present"), `src/capabilities.ts` (+`recorderStartStatus: true`) and its test
- Test: `src/recorder/session.browser-test.ts`

**Interfaces:**
- Produces: `recordSpec` calls `onStatus({ state: "recording", toolbar })` exactly once right after `onStarted` resolves and before any other `onStatus` call; `toolbar` is `false` if the toolbar has already reported failing to load, else `true`.

- [ ] **Step 1: Write failing browser tests** in `session.browser-test.ts` (follow the existing `statuses` test near line 165):
  - `"sends a first recording status right after it starts"`: collect `onStatus` calls; abort right after `onStarted`; `assert.deepEqual(statuses[0], { state: "recording", toolbar: true })` and `statuses.length === 1`.
  - `"a recording with nothing recorded returns every result field"`: abort at once; result has `files: []`, `missingFiles: []`, `filesIgnored: false`, `firstFiles: false`, `secrets: []`, `unsetSecrets: []`, and `typeof filesFolder === "string"`.
  - Update the existing status test's expectations to account for the new first entry.
- [ ] **Step 2:** `npm run test:browser` (Firefox) → the new first-status test fails.
- [ ] **Step 3:** Implement in `session.ts`; update the JSDoc on `onStatus` (remove "There is no initial call", state the new rule) and on `RecordResult`.
- [ ] **Step 4:** `npm run test:browser` and `npm run test:browser:chrome` pass; `npm test`, build + `test:cli` (the `record` CLI prints "Recording" on status changes: check `src/cli/record.ts` doesn't print an extra line for the first status; if it does, skip printing when the state equals the initial one) pass.
- [ ] **Step 5: Commit** `feat: the recorder sends its first status when recording starts`; branch `feat/recorder-start-status` from `feat/resolved-config`; PR with that base.

### Task 8: Docs and the app hand-off (done by the controller, not a subagent)

- [ ] Wiki (approved by the owner for this roadmap item): Embedding page (capabilities, `FoundTest.id`/`relativeFile`, `loadConfig`), Steps and the recorder (`start`/`end`, `remove-test`, `parseSpecFile`), Configuration (pointer to `loadConfig`), Pages and browsers "Upgrading to …" section per release, Roadmap item marked done. Push only what is merged and released; hold the rest locally.
- [ ] App hand-off file under `docs/superpowers/handoffs/` naming each capabilities key and field, plus: `recordSpec` already returns `unsetSecrets` (app item 5), and `./project` already exports `editConfig` (app item 8).
- [ ] Release: the owner publishes; commit the version bump with the release.
