# Contributing

## Layout

```txt
samurai.config.ts        project config (used by `bun run dev`)
src/
  api.ts                 public entry: test, describe, expect, defineConfig
  index.ts               CLI entry: loads config, prepares the run, runs the tests
  runner/                test registry, runner, reporter, page-log verdicts
  config/                config loading, run settings, env variables, secrets, masking
  browser/               Browser, BrowserContext, Page, navigation, screenshots, downloads, dialogs, emulation
  locator/               Locator, selectors, actionability probe, text and label search
  assert/                expect and AssertionError
  network/               tracking, interception (route), response bodies, URL matching
  script/                script.callFunction, preload scripts, serialisation, in-page helpers
  transport/             BiDi WebSocket connection, errors, refcounted subscriptions
  steps/                 step model, parser, emitter, minimal-diff editor
  recorder/              capture script, locator ranking, normaliser, Recorder
  types/                 hand-written BiDi typings and public types
  testing/               stubs and helpers for the framework's own tests
  tests/                 the project's own spec files (run by `bun run dev`)
docs/                    these guides
docs/superpowers/        design specs, plans and roadmaps
```

## Running the framework's tests

```sh
bun run test            # unit tests, no browser (src/**/*.test.ts)
bun run test:browser    # browser tests against Firefox (src/**/*.browser-test.ts)
bunx tsc --noEmit       # typecheck
```

CI (`.github/workflows/ci.yml`) runs the typecheck, unit tests, browser tests and Trunk's code-quality checks on every pull request.

- Unit tests use `src/testing/stub-connector.ts`, a fake BiDi connection that records what was sent and answers with canned replies.
- Browser tests launch a real headless Firefox on a port of their own and are run with `--test-concurrency=1`. They end in `.browser-test.ts`.
- Both use Node's built-in test runner through `tsx`.

## Conventions

- **Spec first.** Every feature has a design note in `docs/superpowers/specs/` and, for bigger ones, a plan in `docs/superpowers/plans/`. Roadmaps in `docs/superpowers/` track what is done.
- **Test first.** Write the failing test, then the code.
- **Everything the browser is sent is typed** in `src/types/bidi-modules/`.
- **Events go through the refcounted subscription API** (`connector.subscribe`), never a bare `session.subscribe`.
- **No unbounded waits.** Timeouts resolve through `resolveTimeout` (actions, assertions), the navigation timeout, or the BiDi command timeout.
- **Code that runs in the page is a string** (or a plain arrow function with no inner named functions), because the transpiler can inject helpers that don't exist there.
- **Secrets never reach logs or reports unmasked.** Anything that writes text goes through the masking in `src/config/mask.ts`.
- **Commits** use conventional prefixes (`feat:`, `fix:`, `docs:`, `ci:`, `chore:`). A Trunk pre-commit hook formats staged files; commit what it formats.
- A command Firefox lacks is documented in its spec and surfaced as `UnsupportedOperationError`, never as a hang.

## Adding a feature

1. Write or extend a spec in `docs/superpowers/specs/`.
2. Add the BiDi typings you need.
3. Write unit tests against the stub connector, then the implementation.
4. Add a browser test for what only a real browser can show.
5. Document it in the matching guide in `docs/` and tick the roadmap.
