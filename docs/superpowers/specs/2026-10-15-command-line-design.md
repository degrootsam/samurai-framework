# The `samurai` command — design

Date: 2026-10-15
Status: implemented (`run`, `list` and `init` first; `record`, `flow` and `browsers` added later); this note was written afterwards, from the code
Code: `bin/samurai.mjs`, `src/cli/`, `src/index.ts`
Guide: [Command line](../../cli.md)

## Goal

One command to scaffold a project, run and list its tests, record into a spec, run flows and manage browsers, usable by a person in a terminal and by another program (the Electron app, a CI tool) that reads its output.

## Non-goals

- A config file flag (`--config`). The config is `samurai.config.ts` in the working directory.
- Watch mode, parallel runs, an interactive UI.
- Its own runner logic. The command is a thin layer over the package's public entry points.

## Decisions

- **The command only uses public entry points.** `src/cli` imports the framework only through files behind `exports` in `package.json` (`runner/run.ts`, `recorder/index.ts`, `steps/index.ts`, `flows/*/index.ts`, `browsers/index.ts`). `src/cli/boundary.test.ts` fails on any other import. Moving the command into a package of its own stays a folder move.
- **A global command defers to the project's copy.** `bin/samurai.mjs` resolves `@itmetsam/samurai-framework` from the working directory and, if that is a different copy, imports that copy's `bin/samurai.mjs`. Specs register tests in the copy they import; a second copy would find none.
- **TypeScript through `tsx`, an optional peer dependency.** The bin registers `tsx/esm/api` before loading anything. Without `tsx` it exits 2 with `npm install --save-dev tsx`. `samurai init` adds `tsx` to the new project.
- **`run` is the default command.** `samurai`, `samurai --grep x` and `samurai run --grep x` are the same.
- **stdout is for the command's output only.** The bin sets `SAMURAI_LOG_LEVEL=warn` unless the caller set it, and the logger sends every console level to stderr. With `--json`, stdout carries exactly the events, one JSON object per line (`run`, `flow run`, `record`), or one array (`list`, `flow list`, `flow check`).
- **Exit codes mean the same everywhere.** 0 success, 1 a test or node failed or the run was cancelled, 2 a usage, configuration or file error. `main` catches every error and returns 2 with the message on stderr.
- **Parsing is strict.** `node:util` `parseArgs` with `strict` and `allowNegative` (for `--no-headless`); an unknown flag is an error. Millisecond flags must be whole numbers, `--port` 1–65535. All parsing lives in `src/cli/args.ts`, not in the framework's config code.
- **Ctrl+C ends cleanly once, then hard.** The first SIGINT or SIGTERM aborts the run, recording or flow (the browser is closed, the spec file and reports are complete); a second exits with 130.
- **`bun run dev` is the same command.** `src/index.ts` calls the same `main` straight from the sources, so the repository needs no build to run its own tests.

## Components

| File                                  | Role                                                                                                        |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `bin/samurai.mjs`                     | Hand-over to the project's copy, log level, `tsx` registration, signals, then `dist/cli/main.js`            |
| `src/cli/main.ts`                     | `main(argv, io)`: `USAGE`, dispatch, `run`, `list`, `record`, `init`; returns the exit code                 |
| `src/cli/args.ts`                     | `parseCommandLine`, `parseRunnerFlags`, `parseRunOverrides` (`--env` falls back to `SAMURAI_ENV`)           |
| `src/cli/console-reporter.ts`         | Human output for `run`: a line per test, failures in detail, a summary; colour when a TTY and no `NO_COLOR` |
| `src/cli/flow.ts`, `flow-reporter.ts` | `samurai flow` with `list`, `check` and `run`, and its human output                                         |
| `src/cli/browsers.ts`                 | `samurai browsers` with `list`, `install` and `uninstall`                                                   |
| `src/cli/init.ts`                     | `scaffold(name)` and `initProject(dir)`: never overwrites a file                                            |

`main` takes an `Io` (`out`, `err`, `color`, `env`, `signal`) instead of touching `process`, so tests call it directly.

## Error handling

- Unknown command: `Unknown command "x"` and the usage, exit 2.
- Missing config, unknown environment or group, bad flag value: the message, exit 2.
- `record` without a spec (`Which spec? …`), with a bad `--at`, or on a spec that doesn't exist without `--new`: exit 2.

## Testing

- `src/cli/args.test.ts`, `flow-reporter.test.ts`, `browsers.test.ts` and `boundary.test.ts` are unit tests (`bun run test`).
- `*.cli-test.ts` (`bun run test:cli`) call `main` and run `bin/samurai.mjs`, which loads `dist/`, so they need a build first. CI doesn't run them.

## Open

- `--config`, watch mode.
- `samurai record --at` doesn't replay the steps before it.
- `samurai --version` creates `logs/`, because the logger opens its files on import.
