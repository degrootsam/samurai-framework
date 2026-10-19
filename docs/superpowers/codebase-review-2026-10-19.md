# Codebase review, 2026-10-19

Five read-only reviews (browser/transport, locator/assert/wait/script, recorder/steps/project, runner/cli/config/flows, network/types/repo) plus knip and madge. Goals: readable code, no unused code, modular design. Findings were checked with grep over `src/`, `docs/`, `package.json`, `scripts/` and `bin/`. Anything reachable through a `package.json` export counts as public API and is never called dead.

## State of the code

- 286 source files, 130 test files, about 21k lines of source.
- Files over 800 lines: `browser/page.ts` 1742, `locator/locator.ts` 1022, `recorder/toolbar/source.ts` 890 (a page-side script held as a string). Over 400: `recorder.ts` 720, `controller.ts` 655, `browser.ts` 596, `router.ts` 509, `steps/parse.ts` 456, `test-runner.ts` 445.
- Runtime import cycles: one real value edge, `browser/page.ts` -> `recorder/recorder.ts` (through `Page.record`). The other cycles madge reports are type-only imports (erased) or the generated BiDi `.d.ts` files.
- Layering smells: `config` imports from `runner`; `script/helpers.ts` imports from `locator`; `locator` imports from `browser`; `wait` imports `config`; `UnsupportedOperationError` lives in `locator/` but `browser/` uses it.
- Knip finds little dead code; the bigger cost is duplication and long functions.

## Phase 1: dead code, hygiene, stale comments (no API change, done first)

Repo: untrack `.DS_Store`; drop the stale `results` line in `.gitignore` and the stale `paths` block in `tsconfig.json`; delete `src/config/default.ts`; delete `types/bidi-modules/web-extensions.d.ts` and what only it feeds; add `esbuild` as a dev dependency and build before the unit tests in CI so `flows/core` bundle test runs.

Dead code: `TestRunner`'s `group` parameter, field and branch, and the unused `reject`; `getRunSettings`; `BACKSPACE` (duplicates `NAMED_KEYS.Backspace`); the `WaitForState` and error re-exports from `locator.ts`; `WaitOptions.interval`; dead `role` branches in `selector.ts`; the `SESSION_CAPABILITIES` re-export in `browser.ts`; `backReference().found`; a second `removeIfEmpty`; unused parameters (`onBegin`, `onStart(total = 0)`).

Exports used only in their own file lose `export`: `NormaliserOptions`, `describeCall`, `PICKER_WINDOW`, `MatcherChoice`, `DEFAULT_BROWSERS`, `BROWSERS_USAGE`, `FLOW_USAGE`, `SameSite`, `PaperFormat`, `ElementBox`, `toHeaders` (tracker).

Stale comments: `logger` file names, `resetSecrets` / `clearRegistry` "(tests only)", `bun run dev` in `src/index.ts`, "Phase 3" in `flows/run/project.ts`, xpath wording in `assertion-error.ts`, the `clickRect` example, `performance.mark("group-start")` names.

Small fixes found on the way: the logger prints `null`/`{}` after every line without metadata; `PORT undefined is already in use` for the default port; `DEFAULT_TEST_MATCH` hard-coded a second time in `test-runner.ts`.

## Phase 2: mechanical refactors (behaviour unchanged, tests prove it)

- Break the remaining layering smells: `Io` to `cli/io.ts`; browser validation to `config/browsers.ts`; `script/helpers.ts` to `locator/helper-realm.ts`; `UnsupportedOperationError` to a shared module.
- Remove duplication: `isUnsupported(err)` (4 copies), `emitSafely` (3-4 copies), `Lazy<T>` for the 7 lazy-start blocks in `Page`, `navigationTimeout()` (6 copies), one `Page.startTracking()` (2 copies), `DEFAULT_PORT` (6 copies), one ANSI painter (3 copies), one version reader (2), the `runner/run.ts` triple destructure, the "no element matches" error (4), `isVisible` through the probe, `textCheck` in `expect.ts`, `bidi-wire.ts` for header and request mapping.
- Extract without changing behaviour: `locator/page-scripts.ts` and `input-actions.ts`; `expect.ts` into three modules; `browser/init-script.ts`, `viewport.ts`, `history.ts`, `page-settings.ts`, `page-events.ts`; `browser/launch-flags.ts` and `session.ts`; `transport/log-redaction.ts`; `cli/usage.ts`, `record.ts`; `network/network-types.ts`.
- Spec files are imported two or three times per `--group` run; register once.

## Phase 3: structural splits (need a design and your approval)

- `Page` (1742 lines): `DocumentWatcher`, `DialogHandling`, `PageNetwork` classes behind a thinner `Page`; `Page` public surface unchanged.
- `Locator` (1022): `ChainResolver`, actionability, file actions behind a facade of about 250 lines.
- `router.ts` into `route.ts`, `intercept.ts`, `router.ts`; `Route` stops exposing `@internal` members.
- `recorder.ts` (files, toolbar bridge, options), `controller.ts` (actions, types), `session.ts` (`recordSpec` is 135 lines), `normalise.ts` (`observe` is 105 lines), `steps/parse.ts`.
- `toolbar/source.ts`: split the string by its section banners, verified by comparing the produced string before and after.
- `test-runner.ts` (`executeTestCase` is 130 lines with an async promise executor) and `flows/run/run.ts` (`runFlow` is 245 lines).

## Decisions for the owner (public API or intent)

1. `Page.record` creates the one real cycle. Options: remove it in favour of `recordPage(page, options)` (breaking), or load the recorder lazily inside `record()` (no API change; hides the cycle from the graph). The review recommends the first.
2. `Page.captureScreenshot` sends a command, discards the result and ends in a TODO. Remove it (breaking, but it does nothing).
3. `src/tests/index.spec.ts` submits a real contact form to a real site; the repo's own `samurai.config.ts` points at it and the README warns against running it. Replace with a harmless example?
4. `script/` has test-only infrastructure (`disown`, `ownership`, `thisArg`, `keepHandles`). Delete with its tests?
5. `LAUNCHABLE` / `BrowserStatus.launchable` are always true. Remove at the next major.
6. `docs/superpowers/` (about 70 tracked files, now ignored by Trunk): keep in the repository?
7. Error message style (`name(): ...`) is mixed; unifying changes text that tests assert on.
8. Error classes users may `instanceof` (`DownloadTimeoutError`, `EmulationUnsupportedError`) are not exported from any entry point.
