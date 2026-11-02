# Flows in the framework (stage A)

Date: 2026-10-08
Status: draft, awaiting review
Repos: `samurai-framework` (most of the work) and this app
Supersedes: the "flows are a SAMURAI feature, not part of the framework" decision and
the "Where things live" section of `2026-10-07-flow-runtime-design.md`. Builds on
`2026-10-06-flow-node-definitions-design.md`.

## Problem

Tests and flows will eventually live in a repository and run on a server or CI
without the app. Tests already do: `samurai run` is a headless CLI with exit codes
and a JSON report. Flows do not, and splitting the work between the app and the
framework leaves two places that can disagree:

- The flow runtime (`src/engine/flow/`) is plain Node but ships inside the app, and
  only the app's engine process can call it.
- Before it can run, the app's main process resolves what the flow needs: it reads
  the flow file, lists tests, resolves groups (the framework's `groups` setting is
  not implemented) and sends `nodeTests`. A command line has none of that.
- Validation lives in the renderer; what a node does lives in a renderer definition,
  an engine handler and `HANDLED_KINDS`.
- Kinds without a handler are _skipped_. In the app that is a warning; in CI a green
  run that skipped half the flow is a lie.

## Goal

The framework owns everything a flow _is and does_: the file format, node kinds,
validation, expressions, execution and the CLI. The app owns the UI only: editing
the graph, layout, the library and inspector, run history and showing results. A
flow behaves the same locally, in the app and in CI because it is one code path.

Out of scope: integration nodes (HTTP, Database, Email, Script; piece 3 of the
runtime spec), concurrent Parallel (piece 4), project-defined nodes (stage C), a
hosted server or uploading results, schedules, JUnit and other report formats.

## What lives where

**Framework** (`@itmetsam/samurai-framework`):

| Module       | Contents                                                                                                                                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flows/core` | Flow file format and `version`, keys, graph helpers (`meetOf`, `inFillOrder`, scope at a node), the expression language (parse, check, evaluate), node **core definitions**, `checkFlow` (all validation) |
| `flows/run`  | `runFlow`, flow file reading and listing, test and group resolution, `FlowEvent`, `FlowSummary`                                                                                                           |
| CLI          | `samurai flow list \| check \| run`                                                                                                                                                                       |
| config       | `groups` implemented (it is on the roadmap today)                                                                                                                                                         |

**App**:

| Stays                                                                                             | Why                                                                        |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Graph editing: `edit`, `normalize`, layout, merge slots, history                                  | Editing the picture of a flow, driven by the shapes the framework declares |
| Editor half of node definitions: icon, section, title, description, link, custom field components | Looks                                                                      |
| Library, inspector, canvas, field components                                                      | UI                                                                         |
| Run history, run model, `flow-events.ts`                                                          | The app's record of runs                                                   |
| Saving a flow                                                                                     | Writes the file in the framework's format                                  |
| The engine process                                                                                | A thin caller of the project's framework (below)                           |

Removed from the app: `src/engine/flow/`, `src/shared/flows/` (schema, graph, keys,
expression, runtime), `HANDLERS`, `HANDLED_KINDS`, `nodeTests` and its resolution in
`main`, and the validation rules in `validateFlow` (it calls `checkFlow`).

### Browser-safe core

The renderer is a browser bundle, the framework is Node ESM. `flows/core` must be
pure: no `node:` imports, no filesystem, no browser automation. It gets its own
export (`@itmetsam/samurai-framework/flows`), with `flows/run` under
`@itmetsam/samurai-framework/flows/run`. A test in the framework builds `flows/core`
for the browser to keep it pure.

## Node definitions: core and editor

**Core** (framework, `flows/core/nodes/<kind>.ts`):
`kind`, `label`, `shape`, `branches`, `fields` (type, path, label, default, options;
data only), `outputs`, `onFailure` and `validate`.

**Editor** (app, `lib/flows/nodes/<kind>.ts`): `icon`, `section`, `title`,
`description`, `link`, custom field components. `defineNode` in the app takes the
core definition and adds these; the app's registry is the merge. A kind in only one
half fails a registry test.

**Execution is separate from the definition** (separation of concerns). A core
definition is data and pure functions (`validate`, `title` inputs); it never
executes anything. What a kind does in a run is a handler in `flows/run`:

```ts
// flows/run/handlers/wait.ts
export const wait: Handler = async (node, ctx) => { ... }
// Outcome: { status: "passed" | "failed", error?, note?, branch?, wrote? } | "cancelled"
```

`flows/run/handlers/index.ts` maps kind to handler. `ctx` is today's `HandlerRun`:
flow, environment, expression context, `runTests`, `sleep`, `signal`. A kind with no
handler is _unsupported_ (policy below). A framework test fails if a core kind is
neither handled nor listed as unsupported, and if a handler has no core kind, so the
two halves cannot drift. The browser bundle imports only `flows/core`.

### Shape-driven walker

`flows/run` walks by shape; it has no `kind` checks.

- `step`: run it, follow its single out edge.
- `branches`, fixed list (Condition): its handler returns `branch`; the walker follows
  that edge, marks the other branches' nodes `skipped`, continues at the meeting
  node.
- `branches`, dynamic list (Parallel): run every branch in fill order (one after
  another in this stage), then continue at the meeting node; the node fails if a node
  in a branch failed.
- `start`, `end`: as now.

A new node of an existing shape needs only its core file.

## Running a flow

`runFlow({ projectDir, flow | flowId, environment, signal, onEvent, unsupported })`:

1. Read `<project>/flows/<id>.flow.json` (or take the object).
2. Load `samurai.config.ts`; pick the environment: option, else the flow's
   `envDefault`, else the config default.
3. List tests and resolve test and group nodes (groups are implemented in the
   framework's config in this stage; it is a prerequisite).
4. Check the flow (`checkFlow`); refuse to start on errors.
5. Walk it; each Test or Group node runs its tests through the framework's own
   runner, narrowed to those tests, fresh browser per test as today.

One run at a time per process, as `runTests` already requires.

## Command line

```sh
samurai flow list                      # flows in ./flows
samurai flow check [<flow>...]         # validate without running
samurai flow run <flow>... [options]   # run, in the order given
```

`run` takes the options of `samurai run`: `--env`, `--headless`/`--no-headless`,
`--timeout`, `--expect-timeout`, `--port`, `--json` (JSON lines of `FlowEvent`s),
plus `--allow-unsupported`. A flow is an id or a path. `--all` runs every flow in `./flows`; the exit code is 1 if any flow failed, and each flow still writes its own report.

### Check

One Start and End, reachability, every branch present, no Start-to-End shortcut,
each node's `validate`, expression checks (scope, keys, variables), test and group
references that exist. Prints problems with the node's key and title.

### Unsupported nodes

A kind with no handler is an error in the CLI: `check` reports "HTTP request can't
run yet" and `run` refuses to start. `--allow-unsupported` (option `unsupported:
"skip"`) restores skipping: node `skipped`, note "Not supported yet", the flow can
still pass. The app passes `"skip"` so its behaviour does not change; it keeps its
warning.

### Output and exit codes

Human output like `samurai run`:

```text
Flow "Checkout" against staging
  ✔ Login (1.2s)
  ✔ Set variable vars.order (0ms)
  ◇ Condition vars.order → true
  ✖ Checkout with saved card (4.8s)
      expect(locator).toHaveText …
  ⊘ Verify order (skipped)

1 failed, 2 passed, 1 skipped, 1 not run (8.4s)
```

| Code | Meaning                                                                    |
| ---- | -------------------------------------------------------------------------- |
| 0    | Every node that should run passed                                          |
| 1    | A node failed, or the run was cancelled (SIGINT, SIGTERM)                  |
| 2    | Usage, configuration or flow-file error; `check` found errors; nothing ran |

Each flow also writes `result/flows/<id>.json`: `FlowSummary` (`nodes`, `vars`,
status) plus the framework's per-test results (errors, logs), so a CI log is as
useful as the app's run detail. Secrets are masked as in `report.json`.

## The app calls the project's framework

The app's engine process already imports the framework from the project's
`node_modules`, falling back to its own copy. Flows follow that rule: the flow runs
with the framework version the project pins, which is also what CI installs.

Consequences:

- The app bundles `flows/core` from its own framework dependency for editing and
  checking; the engine runs the project's copy. Both can differ. The flow file
  `version` and a framework `flowsApi` number (exported constant) decide
  compatibility: the engine's `doctor` reports it; if the project's framework has no
  flows, or an older `flowsApi` than the app needs, **Run flow** is disabled with
  "Update @itmetsam/samurai-framework to run flows" (and the app's own copy runs
  nothing it can't check).
- Node kinds the app knows but the project's framework lacks are unsupported there,
  and the app says so before running.

## Flow file versioning

Flow files get a top-level `version` (absent means 1). The framework reads versions
up to the one it knows, runs a migration chain on load (none yet) and refuses a
newer one with exit 2: "This flow was saved by a newer SAMURAI. Update
@itmetsam/samurai-framework." The builder writes the current version on save.

## What a CI run needs

Documented in the framework's docs with a GitHub Actions example next to the
existing CI one: install dependencies and Firefox, `npx samurai flow run checkout
--env staging`, secrets as environment variables, upload `result/`.

## Testing

Framework (`tsx --test`, next to the code):

- Walker by shape: Condition both branches, Parallel order, a fixed-branch kind
  defined in the test with no walker change, Stop and Continue, cancellation, `not
run` after a stop, shape errors.
- `checkFlow`: every rule, unsupported kind, missing test and group, bad expression
  (the cases the app's `validateFlow` tests cover today move here).
- Expressions: parser, checker messages, evaluator (moved with their tests).
- Groups in config.
- CLI: arguments, exit codes, `check` before `run`, `--allow-unsupported`, `--json`,
  report file, SIGINT writes a cancelled report.
- `flows/core` builds for the browser with no `node:` imports.
- Versioning: absent, current, newer.
- One browser test (like `*.browser-test.ts`) running a fixture project flow
  end to end.

App (`bun test`):

- The registry merge: every core kind has an editor half and the reverse.
- Compatibility gate: framework without flows, older `flowsApi`.
- `flow-events.ts` against the framework's `FlowEvent`.
- Existing edit, layout and merge-slot tests keep passing, now reading shapes from
  the framework's core.

## Migration order

Framework first, in its own repo and releases; the app follows.

Framework:

1. Implement `groups` in config and the runner (prerequisite; roadmap item).
2. `flows/core`: move the format, keys, graph helpers and expression language with
   their tests; browser-purity test; `flowsApi` constant. Release.
3. Node core definitions and `checkFlow`; handlers and the shape-driven walker in
   `flows/run`; resolution of tests and groups; `FlowEvent` and `FlowSummary`.
4. CLI (`samurai flow`), report file, exit codes, versioning, docs and CI example.
   Release.

App (after step 4 is released and the dependency bumped):

5. Import `flows/core` instead of `shared/flows`; the editor half of definitions
   wraps the core; `validateFlow` calls `checkFlow`.
6. The engine process calls the project's `flows/run`; remove `src/engine/flow`,
   `nodeTests` and group resolution from `main`; add the compatibility gate.
7. Remove the old files and `HANDLED_KINDS`; update `nodes/README.md` and the
   runtime spec's pointer.

The app works after every step. Until the dependency is bumped it keeps its current
runtime, so framework steps 1 to 4 need no app change.

## Release plan

The framework is at 0.2.x and bumps versions by hand. Steps 1 to 3 change nothing a
project can see except `groups` (step 1) and the new `flows` exports, so they merge
to `main` without a release. Step 4 completes the feature: release it as one minor
(0.3.0) with the `samurai flow` command, the `flowsApi` constant and the docs. The
app bumps its dependency to that version in step 5. Later flow changes that need
the app too bump `flowsApi`.

## Decided

- Execution is a separate handler map in `flows/run`, not part of the core
  definition.
- `samurai flow run --all` is in.
