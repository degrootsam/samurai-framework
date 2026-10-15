# Test groups — design

Date: 2026-10-15
Status: implemented; this note was written afterwards, from the code
Code: `src/runner/groups.ts`, `src/types/config.d.ts` (`SamuraiGroup`), `src/runner/test-runner.ts`
Guide: [Configuration › Groups](../../configuration.md#groups)

## Goal

Name a set of tests once in `samurai.config.ts` and use the name everywhere: `samurai run --group <name>`, `runTests({ group })`, and the Group node of a [flow](2026-10-08-flows-in-the-framework-design.md). The app shows what each group holds and which picked tests have gone missing.

## Non-goals

- Tags on tests (`test("…", { tag })`). Groups select by place or by name.
- Per-group configuration (browser, timeout, environment). A group only selects tests; every test runs with the project and environment settings.
- Running groups in parallel.

## Decisions

- **Two kinds, one shape.** A group either picks tests by hand (`tests: [{ file, title }]`) or selects them by pattern (`src` and `testMatch`). `tests` overrides the other two. Both resolve to the same `ResolvedGroup`: `{ name, kind: "picked" | "pattern", pattern?, testIds, missing }`.
- **A test's id is `<file relative to srcDir, with />::<full name>`.** `testId(file, name)`. Paths are POSIX on every platform, so ids in config and flow files are portable. The full name is the `describe` titles and the test title joined with `>`.
- **Patterns use Node's own glob.** `path.matchesGlob` on the spec path below `src`; `testMatch` defaults to `**/*.spec.ts`; `src` is relative to the project folder and defaults to `srcDir`. A spec outside `src` never matches.
- **Missing picked tests are reported, not fatal.** A renamed test leaves its pick behind; `listGroups` reports it under `missing` so the app can offer to fix it. Running the group runs the tests that still exist.
- **Unknown group names are errors that list the groups.** `findGroup` throws `Unknown group "x". Groups: a, b.` (or `No groups are configured.`); the command turns it into exit 2.
- **Group selection combines with the other filters.** `--group` with `--file` and `--grep` (or `testNames`) narrows further; it doesn't replace them.
- **Groups need the specs imported.** Resolving a group needs the registered tests, so `listGroups` imports the specs (without running anything), like `listTests`.

## Components

| Function                                           | Role                                                         |
| -------------------------------------------------- | ------------------------------------------------------------ |
| `testId(file, name)`                               | The id flows and picked groups use                           |
| `resolveGroup(group, tests, projectDir, srcDir)`   | One group against the registered tests                       |
| `resolveGroups(config, tests, projectDir, srcDir)` | Every configured group                                       |
| `findGroup(groups, name)`                          | Lookup with the error above                                  |
| `TestRunner.groups()` / `listGroups(options)`      | The public way in, from `@itmetsam/samurai-framework/runner` |
| `RunnerOptions.group`, `--group`                   | Run one group                                                |

## Testing

`src/runner/groups.test.ts` covers ids, picked and pattern groups, `src` and `testMatch` defaults, Windows-style separators, missing picks and the unknown-name error. `src/runner/run-groups.test.ts` runs `listGroups` and the `group` option through the runner, combined with `grep`, and through a symlinked project folder.

## Open

- Tags, and per-group settings if they turn out to be needed.
