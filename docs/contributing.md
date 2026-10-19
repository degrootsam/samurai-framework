# Contributing

## Layout

```txt
samurai.config.ts        project config (used by `bun run dev`)
bin/samurai.mjs          the installed `samurai` command: hands over to the project's copy, loads tsx, runs dist/cli/main.js
scripts/                 build helpers (copies the hand-written .d.ts files into dist/)
src/
  api.ts                 public entry: test, describe, expect, defineConfig, defineStep
  index.ts               development entry (`bun run dev`): the command line, straight from the sources
  runner/                test registry, runner, reporter, page-log verdicts
  config/                config loading, run settings, env variables, secrets, masking
  browser/               Browser, BrowserContext, Page, navigation, screenshots, downloads, dialogs, emulation
  browsers/              pinned browser builds: download, cache folder, which executable a launch uses
  locator/               Locator, selectors, actionability probe, text and label search
  assert/                expect and AssertionError
  network/               tracking, interception (route), response bodies, URL matching
  script/                script.callFunction, preload scripts, serialisation, in-page helpers
  transport/             BiDi WebSocket connection, errors, refcounted subscriptions
  cli/                   the `samurai` command (see the rule below)
  steps/                 step model, parser, emitter, minimal-diff editor
  recorder/              capture script, locator ranking, normaliser, Recorder, recordSpec
  recorder/toolbar/      the toolbar shown in the recorded page and its controller
  project/               writing to a project: config edits, variables, .env secrets
  flows/core/            the pure flow model: schema, graph, expressions, checks (no Node APIs)
  flows/run/             walking a flow, node handlers, flow files and reports
  flows/steps/           defineStep and the built-in steps (Wait, Set variable, HTTP request)
  logger/                winston logger (stderr and logs/), masked
  wait/                  the polling helper behind auto-waiting
  types/                 hand-written BiDi typings and public types
  testing/               stubs and helpers for the framework's own tests
  tests/                 the project's own spec files (run by `bun run dev`)
docs/                    these guides
```

## Running the framework's tests

```sh
bun run test            # unit tests, no browser (src/**/*.test.ts)
bun run test:browser        # browser tests against Firefox (src/**/*.browser-test.ts)
bun run test:browser:chrome # the same tests against Chrome (SAMURAI_TEST_BROWSER=chrome)
bun run build && bun run test:cli   # the `samurai` command, through bin/ and dist/ (src/**/*.cli-test.ts)
bunx tsc --noEmit       # typecheck
```

CI (`.github/workflows/ci.yml`) runs the typecheck, the unit tests (after a build, so the bundle test of `flows/core` runs), browser tests and Trunk's code-quality checks on every pull request and push to `main`, on Node 26 and Bun 1.3.0 (`.github/actions/setup`). The browser tests run in a matrix, once on Firefox and once on Chrome (`SAMURAI_TEST_BROWSER`); each job installs its browser with `samurai browsers install <browser>` and caches the downloads keyed on `src/browsers/pins.ts` (Chrome's chromedriver is part of that cache). A test that is true of one browser only is written with `onlyOn` / `skipOn` from `src/testing/test-browser.ts`, which show it as skipped with the reason. The CLI tests are not part of CI; run them before changing `src/cli` or `bin/`.

- Unit tests use `src/testing/stub-connector.ts`, a fake BiDi connection that records what was sent and answers with canned replies.
- Browser tests launch a real headless browser, Firefox by default and Chrome with `SAMURAI_TEST_BROWSER=chrome`, and are run with `--test-concurrency=1` and a 60 s limit per test. They end in `.browser-test.ts`. Install the browsers first: `bun run dev browsers install all`. A few tests (several browsers in one run) need both and skip themselves when one is missing.
- CLI tests run `bin/samurai.mjs`, which loads `dist/`, so build first. They end in `.cli-test.ts`.
- Both use Node's built-in test runner through `tsx`.

## How the folders depend on each other

The table reads top to bottom: a folder mostly uses the ones below it. It is taken from the imports (`npx madge --json src`, with the exclusions in `.madgerc`), the real picture today is:

| Folder                        | Imports from (values; `import type` is not counted)                                |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| `cli`                         | `runner`, `recorder`, `steps`, `browsers`, `flows/*` (public entry points only)    |
| `runner`                      | `browser`, `browsers`, `assert`, `config`, `transport`, `logger`                   |
| `recorder`                    | `browser`, `steps`, `project`, `runner`, `script`, `config`, `transport`           |
| `flows/run`, `flows/steps`    | `flows/core`, `runner`, `config` (and each other: handlers and steps)              |
| `browser`                     | `network`, `locator`, `script`, `steps`, `browsers`, `transport`, `wait`, `config` |
| `assert`                      | `locator`, `wait`, `config`                                                        |
| `locator`                     | `script`, `browser` (screenshots, generated files), `transport`, `wait`, `config`  |
| `network`, `script`           | `transport`, `wait`, `logger`                                                      |
| `transport`                   | `wait`, `logger`                                                                   |
| `config`, `logger`            | each other only                                                                    |
| `project`, `browsers`         | `config`, `logger`                                                                 |
| `steps`, `wait`, `flows/core` | nothing (`flows/core` is pure, no Node APIs; a test bundles it to prove that)      |

Rules that keep it modular:

- `config/` does not import `runner/`. Config validation that the runner needs lives in `config/` (`config/browsers.ts`).
- `cli/` shares its small helpers inside its own folder (`cli/io.ts` holds `Io`), so `main.ts` is the only file that imports the command modules.
- `transport/` knows nothing of pages, locators or the recorder.
- `import type` between files of one folder is fine; a value import that closes a loop is not. `npx madge --circular src` lists loops; `.madgerc` makes it ignore type-only imports and the generated BiDi `.d.ts` files, so it reports none today and a new one is a regression. `Page.record` loads the recorder with a dynamic `import()` for that reason: the recorder is built on `Page`.

Known exceptions to the direction, the places to untangle next: `browser` imports `steps` and, lazily, the recorder (`Page.record`); `locator` imports `screenshot` and `generated-files` from `browser/`; `config` and `logger` import each other; `flows/steps` and `flows/run` import each other.

## Keeping the code tidy

`npx knip` lists unused files, exports and dependencies (`knip.json` names the public entry points, which count as used). Exports that only the package's users reach, such as error classes, are listed on purpose; a finding for anything else means dead code: delete it. Run it and madge (above) before a larger change.

## Conventions

- **Design first.** Write down the design (goal, non-goals, decisions) before a feature of any size, and keep the guide in `docs/` in step with the code.
- **Test first.** Write the failing test, then the code.
- **Everything the browser is sent is typed** in `src/types/bidi-modules/`.
- **Events go through the refcounted subscription API** (`connector.subscribe`), never a bare `session.subscribe`.
- **No unbounded waits.** Timeouts resolve through `resolveTimeout` (actions, assertions), the navigation timeout, or the BiDi command timeout.
- **Code that runs in the page is a string** (or a plain arrow function with no inner named functions), because the transpiler can inject helpers that don't exist there.
- **Secrets never reach logs or reports unmasked.** Anything that writes text goes through the masking in `src/config/mask.ts`.
- **Small modules.** A file does one job. Past about 400 lines, or a function past about 60, look for the seam.
- **Commits** use conventional prefixes (`feat:`, `fix:`, `docs:`, `ci:`, `chore:`). A Trunk pre-commit hook formats staged files; commit what it formats.
- A command Firefox lacks is documented in its guide and surfaced as `UnsupportedOperationError`, never as a hang.

## Adding a feature

1. Write down the design: goal, non-goals, decisions.
2. Add the BiDi typings you need.
3. Write unit tests against the stub connector, then the implementation.
4. Add a browser test for what only a real browser can show.
5. Document it in the matching guide in `docs/` and tick the roadmap.

## The command line stays separable

`src/cli` and `bin/` use the framework only through its public entry points, the files behind the `exports` in `package.json` (such as `runner/run.ts`, `recorder/index.ts`, `steps/index.ts`, `flows/run/index.ts`). A unit test (`src/cli/boundary.test.ts`) fails when a file in `src/cli` imports anything else. If the command needs something more, export it from an entry point first. That keeps the command movable into a package of its own: a folder move, not a refactor. Command-line parsing lives in `src/cli/args.ts`, not in the framework's config code.

`tsx` is an optional peer dependency of the package (and a dev dependency here): it is only needed by whoever loads spec files, such as `samurai` or an embedding app's child process.
