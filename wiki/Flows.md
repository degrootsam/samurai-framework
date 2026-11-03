<!-- markdownlint-disable MD041 -->

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
- A test is referenced by its id, `<file relative to srcDir>::<full test name>`, with `/` separators. A group is referenced by the name of an entry of the config's [`groups`](Configuration).
- `nodes[].inputs` (Test and Group nodes, from 0.21.0) sets where an input of the node's test comes from, when not from an earlier test: see [Inputs and outputs](#inputs-and-outputs).
- `envDefault` is the environment used when `--env` is not given and the project has it; then the config's `defaultEnvironment`, then the first environment.

## Nodes

| Kind           | Label        | What it does                                                                                               |
| -------------- | ------------ | ---------------------------------------------------------------------------------------------------------- |
| `start`, `end` | Start, End   | Where the flow begins and ends                                                                             |
| `test`         | Test         | Runs one test (a skipped test counts as passed)                                                            |
| `group`        | Group        | Runs the tests of a config group (a group with no tests passes with a note; skipped tests count as passed) |
| `set-variable` | Set variable | Evaluates an expression into `vars.<name>`                                                                 |
| `condition`    | Condition    | Evaluates an expression and follows the `true` or the `false` branch; the other branch is skipped          |
| `parallel`     | Parallel     | Walks its branches at the same time, ends when all are done and fails when a branch failed                 |
| `wait`         | Wait         | Waits `ms` milliseconds (stopping the run ends the wait)                                                   |
| `api`          | HTTP request | Sends an HTTP request; outputs `statusCode` and `body` (see [Writing a step](Writing-a-step))              |

### Parallel

A Parallel node walks its branches at the same time. The tests of its branches (and of any Test or Group node) are run by one pool of worker processes that the whole flow run shares, so [`workers`](Configuration#workers) is the cap for the whole run, not per branch: with `workers: 2`, a Parallel node with four test branches runs two of them at a time.

- **Variables.** Each branch starts with its own copy of `vars` and of the outputs of the nodes before it. At the join the changes are merged: a variable changed by one branch is taken, and so are its node outputs. If two branches set the same variable to different values, the Parallel node fails with `branches set <name> differently`; the same value in both is not a clash.
- **Failure.** A branch that fails in a node whose `onFailure` is `stop` cancels the other branches: their running tests are aborted and nodes that have not started are skipped. The Parallel node then fails with `A branch failed.` With `continue` the other branches carry on.
- **Order of events.** The events of one node stay in order; the events of different branches interleave.

A flow takes `--workers` and `SAMURAI_WORKERS` like `samurai run`, and the config's `workers`. Without any of them it uses half the CPUs, which also applies to a flow with one test node, but a pool never starts more workers than there are tests waiting.

### Browsers

Test and Group nodes launch the browser; every other node runs in-process. A Group node runs its tests in the group's [`browsers`](Configuration#browsers) (the project's when the group has none); a Test node runs in the project's.

From 0.21.0 a flow runs **once per browser**, one browser after the other: once for each browser any of its nodes uses, in the order the nodes first name them. A flow without Test or Group nodes runs once, in the project's first browser. In a browser's run, a node that doesn't use that browser is skipped with the note `not run in <browser>`. Each run has its own variables, node results and [outputs](#inputs-and-outputs), so a value saved in Chrome only reaches Chrome's later nodes. The runs are independent: a run that fails (`onFailure: "stop"` included) ends that browser's run only, and the next browser still runs. Stopping the run stops them all.

Before 0.21.0 each node ran its tests in every browser at once. A flow now takes longer with several browsers; `runFlowInProject({ browsers: ["firefox"] })` runs it in one (see [Embedding](Embedding-the-framework#running-tests-from-code)).

Wait, Set variable and HTTP request are steps; see [Writing a step](Writing-a-step).

### Unknown kinds

A node whose kind is neither one of the kinds above nor a built-in or project step is an **error**: `samurai flow check` reports "Unknown step: `<kind>`" and `samurai flow run` refuses to start. This is what a flow file with an old kind, such as `database`, gets.

`handled` and `unsupported` in `checkFlow` only matter for a kind that has a definition but no handler. With the built-in handlers every kind a flow can name runs, so nothing is reported, and the `--allow-unsupported` flag (still accepted) has nothing to skip.

### Checking a flow from code

`checkFlow(flow, options)` from the pure `flows` entry returns every problem. Options: `tests` and `groups` (the ids and names that exist), `environment`, `handled` (the kinds that have a handler) with `unsupported: "skip" | "fail"` (what to report for a node whose kind has a definition but no handler: a warning by default, an error with `"fail"`), `nodes` (the step definitions to check against; the built-ins by default; pass `(await projectSteps({ projectDir })).nodes` for a project's own), and `titles: (node) => string | undefined`. When `titles` returns a string, that is how every message names the node; when it returns `undefined`, the node's title, else its key, else its kind's label is used.

## Inputs and outputs

From 0.21.0 a test can declare text [inputs and outputs](Writing-tests#inputs-and-outputs), and a flow passes one test's outputs to later tests' inputs: a Purchase test saves `orderId`, and a Find order test after it gets it.

- **Where an input comes from.** A Test node's inputs are its test's declared inputs; a Group node's are those of all its tests (the first default wins), and every test of the group gets the same values. Each input takes the output of the same name from the closest Test node that **always ran before** it: every path from Start to the node passes that node. A node on a Parallel branch counts for the nodes after the Parallel's meet (where the branches join), at any depth, because a Parallel runs all its branches. A node on one arm of a Condition does not count. Of two such producers one after the other, the later one wins. Only Test nodes save outputs; Group nodes don't.
- **Overriding.** A node's `inputs` entry changes that:

  ```json
  "inputs": {
    "orderId": { "expression": "vars.order" },
    "email": { "useDefault": true }
  }
  ```

  `{ "expression": ... }` (Test nodes only) evaluates an [expression](#expressions); a number or a boolean becomes text, and anything else fails the node with `input "orderId": the expression gave no text`. `{ "useDefault": true }` (Test and Group nodes) sends nothing, so the test uses its default. The order is: expression, then the default, then an earlier node.

- **At run time** a node's inputs are worked out before its tests start. When the producer was skipped (for example `not run in <browser>`), failed or passed without saving the value, the node fails with `input "orderId": Purchase saved no orderId` and its tests don't run, so a flow never goes on with an empty value. A Test node that failed saves no outputs.
- **Results.** A node's result has `inputs` (the values it sent; absent when it sent none) and `outputs` (what its test saved).
- **Secrets.** Results are masked, so an output whose text contains a secret's value reaches later nodes masked (`••••`). Don't save secrets as outputs.

`check` reports, when it knows the project's tests (`samurai flow check`, `checkFlowInProject`, or `checkFlow` with `facts`):

- an input with no source: `<title>: input "orderId" has no source. Save it as an output in an earlier test, set an expression, or use the default`;
- a bad override expression: `<title>: input "orderId": <problem>`;
- two branches of one Parallel that both save a name: `<title>: branches both save "orderId"`;
- an `inputs` entry the test doesn't declare (a warning): `input "x" is not used by this test`;
- an expression on a Group node: `<title>: Group nodes can't set inputs ("orderId")`.

## Expressions

Conditions and Set variable values are expressions over four roots: `env.<name>` (the environment's variables), `vars.<name>` (set by earlier Set variable nodes), `nodes.<key>.status|durationMs|error` (earlier nodes) and `run.environment|trigger|startedAt`. A step's declared outputs are read the same way, as `nodes.<key>.<name>`: `nodes.<key>.statusCode` for an HTTP request. From 0.21.0 so are a Test node's [outputs](#inputs-and-outputs): `nodes.purchase.orderId == "42"`. For example `vars.order > 0 && nodes.login.status == "passed"`. `check` validates every expression against the flow and the environment: unknown keys, variables nothing sets, syntax errors.

## `samurai flow check`

```sh
samurai flow check                  # every flow in ./flows
samurai flow check checkout smoke   # these two
```

Checks, without launching a browser: one Start and End, every node reachable, every branch connected, each node's own settings, expressions, that the referenced tests and groups exist in the project, that the environment variables used exist, that every kind can run, and that every input has a source (see [Inputs and outputs](#inputs-and-outputs)). Prints each problem with the node's key and title.

```text
checkout:
  ✖ error   verify (Verify order): Unknown step: database
  ! warning pay (Pay): ...
```

`--json` prints all problems of all flows as one array: `{ "flow", "level", "message", "nodeId", "key", "title" }`. Options: `--env`, `--allow-unsupported`.

## `samurai flow run`

```sh
samurai flow run checkout --env staging --headless
samurai flow run checkout smoke       # in the order given
samurai flow run --all                # every flow in ./flows, by file name
```

`run` checks the flow first and refuses to start when it has errors (exit code 2, nothing is executed; with several flows, none starts). Then it walks the graph, once per [browser](#browsers), with a header for each run. Options are those of [`samurai run`](Command-line#samurai-run) (`--env`, `--headless`/`--no-headless`, `--timeout`, `--expect-timeout`, `--port`, `--workers`, `--retries`, `--json`) plus `--allow-unsupported`.

```text
Flow "Checkout" against staging in firefox
  ✔ Login (1.2s)
  ✔ Set variable vars.order (0ms)
  ◇ Condition → true (1ms)
  ✖ Checkout with saved card (4.8s)
      expect(locator).toHaveText …
  ✔ Verify order (210ms)

1 failed, 3 passed, 1 not run (8.4s)
Report: result/flows/checkout.json
```

`✔` passed, `✖` failed (the error indented below), `◇` a condition and the branch it took, `⊘` skipped. Start and End are not listed. Nodes that never ran (the flow stopped earlier) only show in the count. Colour follows [`samurai run`](Command-line#samurai-run): on in a terminal, off with `NO_COLOR`.

`--json` prints one `FlowEvent` per line (`flow-start`, `node-start`, `node-end`, `test` wrapping the runner's events, `flow-end`) and nothing else on stdout. From 0.21.0 each event has the `browser` of its run, `flow-start` and `flow-end` come once per browser, and a last `flow-done` event (`{ "type": "flow-done", "status", "runs" }`, with no `browser`) ends the output.

A flow run takes the same [retries](Writing-tests#retries) as `samurai run`: `--retries`, `SAMURAI_RETRIES` or the config's `retries`, for the tests of every Test and Group node. A test that passes on a retry is a pass, so its node is `passed`; a test that fails every attempt fails the node, as one failure. The `test` events of the node carry the attempts: a `test-start` per attempt with `retry: n` on the ones after the first, and one `test-end`. The flow report holds the final result of each test, with `retry`, `flaky` and `previousAttempts`.

Ctrl+C or SIGTERM stops the run: the current test is aborted, the flow ends `cancelled`, the report is still written and the exit code is 1. With `--all`, the flows after it do not start.

### Exit codes

| Code | Meaning                                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------- |
| 0    | Every node that ran passed                                                                                      |
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
  "tests": [
    {
      "nodeId": "n1",
      "name": "signs in",
      "file": "/work/shop/tests/login.spec.ts",
      "browser": "firefox",
      "status": "success",
      "duration": 1180.4
    }
  ],
  "runs": [
    {
      "browser": "firefox",
      "summary": {
        "status": "failed",
        "nodes": { "n1": { "status": "passed", "durationMs": 1200 } },
        "vars": { "order": 42 }
      }
    }
  ]
}
```

`status` is `passed`, `failed` or `cancelled`, over all browsers: `cancelled` when the run was stopped, else `failed` when any browser's run failed. `runs` has one entry per browser run, in the order they ran (a run that never started because the flow was stopped is left out). Each `summary` has its own `status`, `nodes` with a result for every node (`passed`, `failed`, `skipped`, `not-run`, with `error`, `note`, `branch`, `wrote`, `inputs`, `outputs`), `vars`, and `error` when the graph could not be walked at all. `tests` holds the runner's result for every test the Test and Group nodes ran in every run (error, page logs), tagged with the node: one entry per test and browser, each with its `browser`. Secrets are masked as in [`report.json`](Running-tests-and-reports). Before 0.21.0 `nodes`, `vars` and `error` were at the top level.

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
          node-version: 24
      - run: npm ci
      - uses: actions/cache@v4
        with:
          path: ~/.cache/samurai/browsers
          key: browsers-${{ runner.os }}-${{ hashFiles('**/package-lock.json') }}
      - run: npx samurai browsers install firefox
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

`CI` is set on GitHub Actions, so the browser runs headless. The Firefox preinstalled on the runner is not used: the framework launches the build `samurai browsers install` downloads (see [Which browser runs](Pages-and-browsers#which-browser-runs)). See [Contributing](https://github.com/degrootsam/samurai-framework/blob/main/docs/contributing.md) for how the framework's own CI is set up.

## From code

`runFlowInProject` and `checkFlowInProject` from `@itmetsam/samurai-framework/flows/run` do what the command does; see [Embedding](Embedding-the-framework).
