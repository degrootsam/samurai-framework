# Flows

A flow is a graph of nodes that runs tests, groups of tests and a few helper steps in an order you draw: run the login test, wait, branch on a variable, run the checkout group. Flows are edited in the Samurai app and run by the framework, on your machine or in CI, with `samurai flow`.

Flows live in the project folder, one JSON file each, next to `samurai.config.ts`:

```text
flows/
  checkout.flow.json
  smoke.flow.json
```

A flow's id is its file name without `.flow.json`. Everywhere a flow is asked for you can give the id or a path to a `.flow.json` file.

## The file

```json
{
  "id": "checkout",
  "name": "Checkout",
  "version": 1,
  "envDefault": "staging",
  "nodes": [
    { "id": "start", "kind": "start", "position": { "x": 0, "y": 0 } },
    {
      "id": "n1",
      "kind": "test",
      "title": "Login",
      "onFailure": "stop",
      "ref": { "testId": "login.spec.ts::signs in" },
      "position": { "x": 0, "y": 100 }
    },
    { "id": "end", "kind": "end", "position": { "x": 0, "y": 200 } }
  ],
  "edges": [
    { "id": "e1", "source": "start", "target": "n1" },
    { "id": "e2", "source": "n1", "target": "end" }
  ]
}
```

- `nodes[].key` names a node in expressions (`nodes.login.status`). Keys are made from titles when missing.
- `nodes[].onFailure` is `"stop"` (default: the flow ends, later nodes are _not run_) or `"continue"`.
- A test is referenced by its id, `<file relative to srcDir>::<full test name>`, with `/` separators. A group is referenced by the name of an entry of the config's [`groups`](configuration.md).
- `envDefault` is the environment used when `--env` is not given and the project has it; then the config's `defaultEnvironment`, then the first environment.

## Nodes

| Kind           | Label          | What it does                                                                                                  | Runs today |
| -------------- | -------------- | ------------------------------------------------------------------------------------------------------------- | ---------- |
| `start`, `end` | Start, End     | Where the flow begins and ends                                                                                | yes        |
| `test`         | Test           | Runs one test                                                                                                 | yes        |
| `group`        | Group          | Runs the tests of a config group (a group with no tests passes with a note)                                   | yes        |
| `set-variable` | Set variable   | Evaluates an expression into `vars.<name>`                                                                    | yes        |
| `condition`    | Condition      | Evaluates an expression and follows the `true` or the `false` branch; the other branch is skipped             | yes        |
| `parallel`     | Parallel       | Walks each of its branches (one after the other today), ends when all are done and fails when a branch failed | yes        |
| `wait`         | Wait           | Waits `ms` milliseconds (stopping the run ends the wait)                                                      | yes        |
| `api`          | HTTP request   | -                                                                                                             | no         |
| `database`     | Database query | -                                                                                                             | no         |
| `email`        | Email inbox    | -                                                                                                             | no         |
| `script`       | Script         | -                                                                                                             | no         |

Test and Group nodes launch the browser; every other node runs in-process.

### Unsupported nodes

A kind that cannot run yet is an **error** in the command line: `samurai flow check` reports "HTTP request can't run yet" and `samurai flow run` refuses to start, so a green CI run never hides a skipped step. `--allow-unsupported` turns the error into a warning: those nodes are _skipped_ (note "Not supported yet") and the flow can still pass.

## Expressions

Conditions and Set variable values are expressions over four roots: `env.<name>` (the environment's variables), `vars.<name>` (set by earlier Set variable nodes), `nodes.<key>.status|durationMs|error` (earlier nodes) and `run.environment|trigger|startedAt`. For example `vars.order > 0 && nodes.login.status == "passed"`. `check` validates every expression against the flow and the environment: unknown keys, variables nothing sets, syntax errors.

## `samurai flow check`

```sh
samurai flow check                  # every flow in ./flows
samurai flow check checkout smoke   # these two
```

Checks, without launching a browser: one Start and End, every node reachable, every branch connected, each node's own settings, expressions, that the referenced tests and groups exist in the project, that the environment variables used exist, and that every kind can run. Prints each problem with the node's key and title.

```text
checkout:
  ✖ error   verify (Verify order): HTTP request can't run yet.
  ! warning pay (Pay): ...
```

`--json` prints all problems of all flows as one array: `{ "flow", "level", "message", "nodeId", "key", "title" }`. Options: `--env`, `--allow-unsupported`.

## `samurai flow run`

```sh
samurai flow run checkout --env staging --headless
samurai flow run checkout smoke       # in the order given
samurai flow run --all                # every flow in ./flows, by file name
```

`run` checks the flow first and refuses to start when it has errors (exit code 2, nothing is executed; with several flows, none starts). Then it walks the graph. Options are those of [`samurai run`](cli.md#samurai-run) (`--env`, `--headless`/`--no-headless`, `--timeout`, `--expect-timeout`, `--port`, `--json`) plus `--allow-unsupported`.

```text
Flow "Checkout" against staging
  ✔ Login (1.2s)
  ✔ Set variable vars.order (0ms)
  ◇ Condition → true (1ms)
  ✖ Checkout with saved card (4.8s)
      expect(locator).toHaveText …
  ⊘ Verify order (skipped: Not supported yet)

1 failed, 2 passed, 1 skipped, 1 not run (8.4s)
Report: result/flows/checkout.json
```

`✔` passed, `✖` failed (the error indented below), `◇` a condition and the branch it took, `⊘` skipped. Start and End are not listed. Nodes that never ran (the flow stopped earlier) only show in the count. Colour follows [`samurai run`](cli.md#samurai-run): on in a terminal, off with `NO_COLOR`.

`--json` prints one `FlowEvent` per line (`flow-start`, `node-start`, `node-end`, `test` wrapping the runner's events, `flow-end`) and nothing else on stdout.

Ctrl+C or SIGTERM stops the run: the current test is aborted, the flow ends `cancelled`, the report is still written and the exit code is 1. With `--all`, the flows after it do not start.

### Exit codes

| Code | Meaning                                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------- |
| 0    | Every node that should run passed (skipped nodes under `--allow-unsupported` do not fail a run)                 |
| 1    | A node failed, or the run was cancelled; for `check`: a flow has errors                                         |
| 2    | Usage, configuration or flow-file error, no flows folder, or `run` refused a flow that has errors (nothing ran) |

For `check`, 1 means problems were found and 2 means a flow could not even be read.

### The report

Every run writes `result/flows/<id>.json`, also when the flow failed or was cancelled:

```json
{
  "flow": "checkout",
  "name": "Checkout",
  "environment": "staging",
  "status": "failed",
  "startedAt": "2026-10-08T09:00:00.000Z",
  "durationMs": 8400,
  "nodes": { "n1": { "status": "passed", "durationMs": 1200 } },
  "vars": { "order": 42 },
  "tests": [
    {
      "nodeId": "n1",
      "name": "signs in",
      "file": "/work/shop/tests/login.spec.ts",
      "status": "success",
      "duration": 1180.4
    }
  ]
}
```

`status` is `passed`, `failed` or `cancelled`; `nodes` has a result for every node (`passed`, `failed`, `skipped`, `not-run`, with `error`, `note`, `branch`, `wrote`). `tests` holds the runner's result for every test the Test and Group nodes ran (error, page logs), tagged with the node. Secrets are masked as in [`report.json`](running-and-reports.md). `error` appears when the graph could not be walked at all.

## In CI

The same setup as the tests: install, then run the flows. The step fails the job when a flow fails, and the reports are kept as an artifact.

```yaml
name: Flows

on:
  pull_request:

jobs:
  flows:
    name: Flows (Firefox)
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - name: Check flows
        run: npx samurai flow check
      - name: Run flows
        run: npx samurai flow run --all --env staging
        env:
          SAMURAI_SECRET_TEST_PASSWORD: ${{ secrets.TEST_PASSWORD }}
      - name: Upload reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: flow-reports
          path: result/flows/
          if-no-files-found: ignore
```

`CI` is set on GitHub Actions, so the browser runs headless. Firefox is preinstalled on `ubuntu-latest`; see [Contributing](contributing.md) for how the framework's own CI is set up.

## From code

`runFlowInProject` and `checkFlowInProject` from `@itmetsam/samurai-framework/flows/run` do what the command does; see [Embedding](embedding.md).
