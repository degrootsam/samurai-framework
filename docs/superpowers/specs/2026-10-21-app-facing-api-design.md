# App-facing API: the framework states what the app now guesses — design

Date: 2026-10-21
Status: design, not built
Source: the app's hand-off `samurai/docs/handoffs/2026-10-21-framework-api-for-app.md` (items 1, 2, 3, 4, 7)
Roadmap: "Stable `listTests`, `listGroups`, `parseSpec` and recorder options across versions" (wiki, Open: embedding)

## Intent

The Electron app (`degrootsam/samurai`) talks to a project's own copy of the framework through its engine process
(`samurai/src/engine/index.ts`). Today it guesses: it parses version strings, probes for exports with `typeof`,
builds test ids itself, re-parses spec source to find whole tests, maps `samurai.config.ts` field by field, and
fills in recorder fields and events the framework leaves out.

**"Stable" means complete, not frozen** (the owner's words): the app should not have to guess, and should not have
to fill holes. From the version that ships this work, the framework states each of these facts itself.

## Goals

1. **Capabilities list.** One cheap export that says what this framework version can do.
2. **Test ids from the framework.** `listTests` returns the id groups already use, and a `srcDir`-relative file.
3. **Whole tests in the step codec.** Ranges for the whole `test(...)` statement, a `remove-test` edit, and a count
   of tests the codec could not read.
4. **The resolved config.** A published `loadConfig` that returns the config the way a run uses it.
5. **A complete recorder contract.** `onStatus` fires once at the start; the result always carries every field.

## Non-goals

- **No compatibility promise.** Shapes may change between versions; the app adapts. The framework and the app are
  not used by the public yet. No deprecation periods, no parallel old and new shapes.
- No engine process entry point in the framework (the app keeps its own; see the wiki's Embedding page).
- Hand-off items 5 (missing secrets), 6 (results folder per run) and 8 (config editing) are separate projects.
  Note for item 5: `recordSpec` already returns `unsetSecrets` (since 0.7.1, read when the recording ends from
  `.env.<environment>` and `SAMURAI_SECRET_*`). The app recomputes it in `samurai/src/engine/secrets.ts`, which
  it could drop for 0.7.1+. Tell the app; no framework work.
- Nothing for frameworks already released: the app keeps its fallbacks for older versions (back to 0.2.3).

## Anti-goals

- Listing anything (capabilities, tests, groups, config) must never launch a browser or run a test. The
  capabilities export must not even load `tsx`, the config or specs.
- The app must not be left reconstructing something the framework already computes (ids, defaults, environment
  precedence). If the framework has the logic, the app gets its result, not a copy of the rules.

## Constraints

- The app loads these from the **project's** copy of the framework (createRequire from the project folder), in a
  child process, and passes results to the Electron main process over `process.send`. Everything returned by
  `listTests`, `listGroups`, `loadConfig` and the capabilities export must survive `process.send`'s JSON
  serialisation: no functions, no `RegExp`, no class instances, no `undefined` that matters.
- The step codec (`./steps`) is imported by the app in its **main** process from the **app's** copy, not the
  project's (`samurai/src/main/utils/specs.ts`, `delete-tests.ts`, `secrets.ts`). It must stay pure: no file
  access, no `tsx`, no framework state.
- Repository rules (`CLAUDE.md`): branch from an up-to-date `main`, npm scripts for tests, knip and madge clean,
  PR body with real counts. The wiki is updated for each shipped item (owner has approved wiki updates for this
  work as part of the roadmap item).

## Decisions

### 1. Capabilities

- New subpath `@itmetsam/samurai-framework/capabilities` (`src/capabilities.ts`, added to `exports` and the
  `typesVersions`/build if those list subpaths). It imports nothing (a plain object literal and its type), so
  importing it costs nothing.
- Shape: `export const CAPABILITIES = { ... } as const` plus `export type Capabilities = typeof CAPABILITIES`.
  Keys only get added in practice, but per the non-goals that is not a promise.
- Initial keys, each `true` or a number, covering what the app probes today and what this work adds:

  | Key | Value | Replaces in the app |
  | --- | --- | --- |
  | `groups` | `true` | `typeof listGroups === "function"` |
  | `recorderToolbar` | `true` | `hasRecorderToolbar(version)` in `src/engine/versions.ts` |
  | `recorderStartStatus` | `true` | the app faking the first `record-status` |
  | `recorderFiles` | `true` | `?? []` / `?? false` fallbacks on the record result |
  | `flowsApi` | `FLOWS_API` (2 today; import the number from `flows/core` would load flows, so copy it and keep them in sync with a unit test) | the `FLOWS_API` probe in `doctor()` |
  | `flowSteps` | `true` | importing `flows/steps` and checking `listSteps` |
  | `managedBrowsers` | `true` | importing `browsers` and checking `browserStatus` |
  | `testIds` | `true` | building `` `${relative(srcDir, file)}::${name}` `` |
  | `resolvedConfig` | `true` | `readConfig()` in the engine |
  | `skipReason` | `true` | (new in 0.15.2; lets the app know `reason` can appear) |
  | `modifiers` | `true` | (0.13+; lets the app know `modifier` can appear) |

  The builder may add keys for other features the app turns out to probe for; the table is the minimum.
- A unit test asserts `CAPABILITIES.flowsApi === FLOWS_API` and that the module imports nothing.

### 2. Test ids on `listTests`

- `FoundTest` (`src/runner/run.ts`) gets `id: string` and `relativeFile: string`:
  - `relativeFile`: the spec path relative to the resolved `srcDir`, `/` separators (what `toPosix(relative(...))`
    in `groups.ts` produces today).
  - `id`: `testId(relativeFile, name)` from `src/runner/groups.ts`, the exact string `ResolvedGroup.testIds` holds.
    One function builds both, so they cannot drift.
- `file` stays absolute, as today.
- Document the id format on `FoundTest.id` and `ResolvedGroup.testIds` (JSDoc and the wiki's Embedding page).

### 3. Whole tests in the step codec

- `ParsedTest` (`src/steps/model.ts`) gets `start` and `end`: the whole statement holding the `test(...)` call
  (the `ExpressionStatement`). `start` is the statement's `getFullStart()`: it takes in the comments above the
  test and the whitespace and blank line before it, exactly what the hand-off asked for and what the app's
  `removeTests` uses today. `end` is the statement's `end`; the line break after it stays.
- `StepEdit` gets `{ op: "remove-test"; test: number }`. `applyEdit` removes `start..end`; everything else stays
  byte for byte. **Acceptance:** the four cases in `samurai/src/main/utils/delete-tests.test.ts` produce the same
  output through `applyEdit` (port them into the framework's tests): a top-level test after a blank line, an
  indented test inside a `describe`, and `test.skip` and `test.fixme("…", { reason }, …)` removed together.
  Removing several tests is several edits, applied from the last test to the first (document that).
  (Resolved after review: the first draft removed from the first comment through the following line break, which
  fails three of those four cases.)
- The edit type is no longer only about steps, so rename nothing; keep `StepEdit` as the union's name (renaming
  churns the app for no gain).
- `parseSpec` returns `ParsedTest[]` today. To report tests it could not read without changing that return type,
  add a second function `parseSpecFile(source): { tests: ParsedTest[]; unparsed: UnparsedTest[] }` and make
  `parseSpec(source)` return `parseSpecFile(source).tests`. `UnparsedTest` is `{ kind: "test" | "describe";
  start: number; end: number; reason: "dynamic-title" | "not-inline" }`: a `test`/`describe` call (with or
  without a modifier) that the codec cannot read, because its title is not a plain string literal (a template
  with substitutions, a variable, a concatenation: `"dynamic-title"`) or its function is not an inline function
  with a block body (a variable, an imported function, or an expression body like `async () => doThing()`:
  `"not-inline"`). A call inside a loop with a literal title is read normally (it is one test in the source).
  - **An unreadable `describe`** is one `unparsed` entry of kind `"describe"`, and the tests inside it are **not**
    returned: their names would lack the `describe` title and never match `listTests`. This changes today's
    output (today they come back with a short name); that is fine per the non-goals. Builder's call, made after
    review.
  - What counts as a test call: `test(…)` and `test.only(…)` always. `test.skip(…)` and `test.fixme(…)` only
    when the first argument is a string literal or a template literal; any other first argument is the in-body
    `test.skip(condition, reason)` form, which is neither a test nor unparsed. So `test.skip(someTitle, fn)` with
    a variable title is missed without a count. Accepted: it is rare, and a variable can't be told from a
    condition without type information.
- No capabilities key for the codec changes: the app runs the codec from its own bundled copy, so the
  project's capabilities say nothing about it; the app knows its own version. (Resolved after review.)
- The app then compares `listTests` against `parseSpecFile(...).tests` and can say "N tests in this file are
  generated by code and can't be edited here" instead of "couldn't find".

### 4. The resolved config

- Export from the `./project` subpath (it already holds project-level helpers and is loaded in the engine):
  `loadConfig(options: { projectDir?: string; env?: Record<string, string | undefined> }): Promise<ResolvedConfig>`.
  The existing internal `loadConfig()` (no arguments, used across the framework) is renamed internally
  (e.g. `loadRawConfig`) so the public name is free; the existing `projectConfig({ projectDir })` already loads a
  config without leaving a project active and is the starting point.
- It needs TypeScript loading for `samurai.config.ts`. The framework does not register `tsx` itself today (the
  CLI runs under `tsx`; the app registers it). Keep that: the caller registers `tsx`, as the app's engine already
  does. Document it.
- `ResolvedConfig` is a new, JSON-safe type with every default applied and run-level precedence resolved,
  everything the app shows. Fields (names follow `SamuraiTestConfig` unless noted):
  - `projectDir` (absolute), `srcDir` (absolute) and `srcDirRelative` (as written, default `"./src"`)
  - `browsers: SupportedBrowser[]` (default `["firefox"]`; a pre-0.10 `browser` never reaches here, the framework
    no longer reads it), `browserPaths`
  - `timeout`, `expectTimeout`, `navigationTimeout`, `waitUntil`, `bidiCommandTimeout`
  - `workers`: the config value as written (`number | string`) and `workersResolved: number` (what a run without
    `--workers`/`SAMURAI_WORKERS` uses on this machine, via the existing workers resolution)
  - `retries` (default 0), `forbidOnly` (resolved against `env.CI` with the existing `isCI`)
  - `headless` (resolved: `use.headless`, else `isCI(env)`), `viewport` (`{ width, height } | null`, default
    1280×720)
  - `downloadsDir`, `filesDir` (as written, with defaults `"result/downloads"` and `"files"`)
  - `logs: { capture, failOnPageError, ignoreErrors: { text: string; regexp: boolean; flags?: string }[] }`
    (a `RegExp` becomes `{ text: source, regexp: true, flags }`, a string `{ text, regexp: false }`)
  - `network: { track, idleTime, routeTimeout, collectBodies, maxBodySize }` with defaults
  - `baseURL` (project level, may be absent)
  - `defaultEnvironment` (as written) and `environments: Record<string, ResolvedEnvironment>`, where each
    environment has `baseURL?`, `timeout`, `expectTimeout`, `headless`, `variables`, every value merged with the
    same precedence `resolveRunSettings` uses (environment > project > built-in default; no run overrides). A
    config without `environments` yields one environment named `"default"`, as runs do.
  - `groups`: the groups as written (JSON-safe already) plus each group's resolved `browsers`
  - `steps`: the kinds of the project's own flow steps (`string[]`), not the definitions
- Defaults must come from the same constants the runner uses (move scattered defaults such as
  `DEFAULT_TIMEOUT`, `DEFAULT_EXPECT_TIMEOUT`, `DEFAULT_SRC_DIR`, the viewport and network defaults into one
  module if needed), so the app's view and a run cannot disagree.
- Invalid config: throw the same errors a run throws for the config itself (the existing `validate*Config`
  calls). **Environment choice does not throw**: a config with several environments and no `defaultEnvironment`
  is valid for runs that pass `--env`. `ResolvedConfig` gets `defaultEnvironment` (as written, may be absent)
  and `environmentProblem?: string`, the message a run without `--env` would throw (`UnknownEnvironmentError`'s
  text: none chosen, or an unknown `defaultEnvironment`). Builder's call, made after review.

### 5. Recorder contract

- `recordSpec` calls `onStatus({ state: "recording", toolbar: true })` once, right after `onStarted`, before any
  pause, resume or toolbar change can be reported. Remove the "There is no initial call" note from the JSDoc and
  state the new rule. If the toolbar has already failed to load by then, the first call carries `toolbar: false`.
- `RecordResult` already always has `files`, `missingFiles`, `filesIgnored`, `filesFolder`, `firstFiles`,
  `secrets` and `unsetSecrets` (0.8.0+). Document on the type that every field is always present, and add a unit
  test that pins it (a result with nothing recorded has empty arrays and `false`).

## Shipping

- Each of the five parts can ship on its own PR and release; each one turns its capabilities key on in the same
  PR. The capabilities subpath ships first (with the keys for what already exists: `groups`, `recorderToolbar`,
  `flowsApi`, `flowSteps`, `managedBrowsers`, `modifiers`, `skipReason`, `recorderFiles`).
- After each release: update the wiki (Embedding page, Steps and the recorder, Configuration, and the "Upgrading
  to …" section on Pages and browsers) and send the app a short hand-off naming the key and the field.
- Version numbers: patch releases are fine (0.15.x); the owner publishes. Commit the version bump with the release
  (0.15.1 and 0.15.2 were published without one).

## Testing

- Unit tests next to each change: capabilities (`flowsApi` in sync, no imports), `listTests` ids equal
  `listGroups` ids for the same project (`run-list.test.ts` / `run-groups.test.ts`), codec ranges and
  `remove-test` byte-for-byte (`modifiers.test.ts` style), `parseSpecFile` unparsed cases (template title, variable
  title, `test.skip(cond, reason)` not counted, loop with literal title read), `loadConfig` defaults and
  environment merging (`run-settings.test.ts` style), JSON round trip of `ResolvedConfig`
  (`JSON.parse(JSON.stringify(x))` deep-equals `x`), recorder first status (a recorder unit or browser test).
- `npm test`, `npx tsc --noEmit --noUnusedLocals`, `npm run build` then `npm run test:cli`, knip, madge; browser
  tests for the recorder change.

## Left to the builder

- File layout inside `src/` for the new modules, internal renames, helper names.
- Whether `ResolvedConfig` gets a separate `src/types/resolved-config.d.ts` or lives next to `loadConfig`.
- Exact JSDoc and wiki wording.
- Order of the PRs after the capabilities one.
