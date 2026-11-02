# Test inputs and outputs: design

**Date:** 2026-10-26
**Source:** the app's hand-off `../samurai/docs/handoffs/2026-10-26-test-outputs-and-inputs.md`. Decisions marked **(owner)** are Sam's; **(app)** are the app's, accepted by the owner; **(fw)** are this design's calls, open to change at review.

## Goal

A test declares **outputs**, named text values it reads from the page (an order ID), and **inputs**, named text values with a default. A flow passes one test's outputs on to later nodes: the inputs of a later test, conditions, Set variable and HTTP requests. A flow runs once per browser. Everything the app needs (names, defaults, wiring, checks, captured values) comes from the framework; the app copies no logic.

## Decisions

| # | Decision | By |
| - | -------- | -- |
| 1 | Outputs are text, read from the page or from a typed value. No numbers, JSON, network, cookies or storage | app |
| 2 | "Save as output" toolbar action; a fill's or a check's value can become an output in the editor | owner |
| 3 | A pattern captures its first group, else the whole match | app |
| 4 | A failed capture (element missing, pattern no match) fails the test | app |
| 5 | Outputs are always captured and go in the test's result | app |
| 6 | Inputs: Insert gets a third kind, *input* (name + temporary value that becomes the default); editor value kind `input` | owner/app |
| 7 | A test run alone uses each input's default. Inputs and outputs are never secrets | owner/app |
| 8 | Automatic wiring by name: closest earlier node that every path passes through (`dominates`); a node can override an input with an expression | app |
| 9 | Unwired input is a `check` error unless the node says "use the default" | owner |
| 10 | Two branches of one parallel saving the same output name fail `check` | app |
| 11 | Group nodes: inputs wired by name, no override; no outputs | app |
| 12 | A flow runs once per browser, one after the other, each with its own context | owner |
| 13 | `FlowNodeModel.outputs` (hand-typed names, unread) is dropped, no migration | owner |
| 14 | **Spec syntax:** declared in a `test()` options object; used through `inputs` / `outputs` fixtures and an `{ output }` option on fill and text checks | owner |
| 15 | **Expressions** name an output `nodes.<key>.<name>`, like HTTP request outputs | owner |
| 16 | **Folders:** each browser's run writes to `<outputDir>/<browser>/nodes/<node id>/`; paths in results are relative to `outputDir` | owner |
| 17 | A Group node whose group doesn't include the run's browser is **skipped with a note** | owner |
| 18 | Everything else below | fw |

## Design

### 1. Spec syntax (framework runtime)

```ts
test("purchase", {
  inputs: { email: "a@b.c" },
  outputs: ["orderId", "ref"],
}, async ({ page, inputs, outputs }) => {
  await page.getByLabel("Email").fill(inputs.email);
  await outputs.save("orderId", page.getByTestId("conf"), /Order #(\d+)/);
  await expect(page.getByTestId("conf")).toHaveText(/Order #(\d+)/, { output: "orderId" });
  await page.getByLabel("Ref").fill("gen-123", { output: "ref" });
});
```

- **Options object.** `test(title, options, fn)`, and the same on `test.only`, `test.skip`, `test.fixme`. The existing `TestDetails` (`{ reason }`) grows into `TestOptions = { reason?: string; inputs?: Record<string, string>; outputs?: string[] }` (fw: one options type, not two). `reason` on plain `test` / `test.only` throws `test(): reason only applies to skip and fixme`.
- **Name rules (fw):** an identifier (`/^[A-Za-z_]\w*$/`), not `status`, `durationMs` or `error` (`RESERVED_OUTPUTS`), no duplicates within a list. A name may be both an input and an output (pass-through). Defaults are strings. Violations throw at registration: `test(): output "x" …`.
- **`inputs` fixture:** a frozen object of the declared names. Value = the run's value, else the default. An undeclared name throws, like `env` (`inputs.x: not declared, add it to the test's inputs`).
- **`outputs` fixture:** `save(name, locator, pattern?: RegExp): Promise<void>`. Waits like a check (`expectTimeout`) for the element and, with a pattern, for the text to match. Text is read the way `toHaveText` reads it. On timeout it fails with an assertion-style error (expected/actual). An undeclared name throws.
- **`{ output }` option (fw scope):** on `Locator.fill(value, { output })` (saves the typed value) and on `toHaveText`, `toContainText`, `toHaveValue`, `toHaveAttribute` (saves what the element had when the check passed: whole text/value, or the pattern's first group / whole match). With `.not` it throws. Other matchers don't take it.
- **Never captured fails (fw):** a passing test body that declared an output but never saved it fails: `output "orderId" was never saved`. This is what keeps a flow from continuing with an empty value. Saving twice keeps the last value.
- **Results:** `TestSuccess` and `TestFailed` gain `inputs?: Record<string,string>` (the values the test got, defaults included) and `outputs?: Record<string,string>` (what was saved, partial on failure). Absent when the test declares none. A retried test reports its last attempt's.
- **Supplying inputs:** `runTests({ inputs: Record<string,string> })`. Each test takes the names it declares and ignores the rest. Travels on `WorkItem.inputs` to workers. (fw: no CLI flag in this version.)
- **Listing:** `FoundTest` gains `inputs?: { name: string; default: string }[]` and `outputs?: string[]` (from the registry, since `listTests` imports the specs).

### 2. Codec (`src/steps/`)

- `ParsedTest` gains `inputs?` / `outputs?` with the same shapes as `FoundTest`, read from an options object literal. An options object that isn't a plain literal of string values makes the test `unparsed` (fw).
- Steps:
  - new `saveOutput { name, locator, pattern?: { source, flags } }`, emitted `await outputs.save(...)`;
  - `fill` gains `output?: string`;
  - `expect` gains `output?: string` (only with the four matchers above, never with `not`).
- `TextValue` gains `{ kind: "input", name }`, emitted `inputs.<name>`.
- `applyEdit`:
  - new op `declare { test, inputs?, outputs? }`, which replaces the test's lists (empty lists remove the options object);
  - `insert` / `replace` of a step that saves an output adds the name to `outputs` when missing (fw);
  - a step reading an undeclared input is refused (`applyEdit(): input "x" is not declared`), so the app declares first and sets the default;
  - the `inputs` / `outputs` fixtures are added to the callback the way `env` / `secrets` are.
- Round-trip rule as today: everything the codec emits it reads back as the same step, never as `custom`.

### 3. Recorder toolbar

- **Save as output:** a panel next to Assert, with the same pick-an-element flow. Fields: name (required, name rules), pattern (optional). It shows the element's current text and the value it would capture, and refuses a pattern that doesn't match now. It records `saveOutput` and declares the output.
- **Insert → input:** a third kind next to variable and secret. Name + temporary value. Types the temporary value, records `fill` with `{ kind: "input", name }`, declares the input with the temporary value as its default. Inserting an existing input types its default.
- The recorder's generated spec carries the options object and fixtures.

### 4. Flows: once per browser

- **Which browsers (fw):** each node keeps the browsers it has today (a Test node: `browsersFor` of the project; a Group node: its group's). The flow's browsers are the union of all its nodes', in first-seen order. In a run for browser B, a node whose browsers don't include B is `skipped` with `note: "not run in <B>"` (decision 17, applied to every node), so every node still runs in exactly the browsers it ran in before. New option `runFlowInProject({ browsers })` restricts the runs to those browsers (the escape hatch for the doubled run time).
- `runFlowInProject` walks the whole flow once per browser, in that order. Each run has its own context (`vars`, `nodes`), its own walker and its own results. The worker pool is still used inside a run (a Group node's tests in parallel).
- **Events:** every flow event gains `browser`. `flow-start` / `flow-end` are sent once per browser run. A new last event, `flow-done { status, runs: { browser, summary }[] }`, closes the whole thing.
- **Return value:** `runFlowInProject` resolves to `{ status, runs: { browser, summary: FlowSummary }[] }`. `status` is failed when any run failed. **Breaking.**
- **Report:** `result/flows/<id>.json` holds `runs: [...]`, one entry per browser. **Breaking** for report readers.
- **Folders:** `nodeFolder(nodeId, browser)` returns `<browser>/nodes/<cleaned id>`. A node's screenshot paths in events and results are relative to `outputDir` (the app joins `outputDir` + path and needs `nodeFolder` only for display). **Breaking.**
- **Group node, browser not in its group:** the node is `skipped` with `note: "not run in <browser>"`, and the flow goes on.
- **Runs are independent (fw):** a failed run (including an `onFailure: "stop"`) ends that browser's run only; the next browser still runs. An aborted run (signal) stops all of them.
- `runFlow` (the lower-level walker) takes `browser` and walks once.

### 5. Flows: wiring, scope and check (`flows/core`, pure)

- **Schema:** `FlowNodeOutput` and `FlowNodeModel.outputs` are removed (an old file's `outputs` is ignored and dropped on the next save). Test and Group nodes gain `inputs?: Record<string, InputSource>`, where `InputSource = { expression: string } | { useDefault: true }`. Group nodes accept only `{ useDefault: true }`.
- **Test metadata in core (fw):** `checkFlow`, `scopeAt` and `wiringAt` take an options object with `facts?: FlowFacts`, where `FlowFacts = { tests: Record<testId, { inputs: { name, default }[]; outputs: string[] }>; groups: Record<groupName, testId[]> }`. `scopeAt`'s existing positional `nodes` parameter moves into the same options object (breaking, with the rest). `checkFlowInProject` builds the facts from the project's real tests; the app builds them from `listTests` / `listGroups`. Without facts, input and output checks are skipped. A group's inputs are the union of its tests' inputs (the first default wins).
- **"Always ran before" (fw):** node D always ran before N when D dominates N, **or** D sits on a Parallel branch, every path from that Parallel into the branch's end passes D, and the Parallel's meet node dominates N. A Parallel's branches all run; a Condition's arms don't. This is what makes decision 10 real: two branches can both reach the node after the meet.
- **Wiring** `wiringAt(flow, nodeId, { facts }): Record<inputName, InputWiring>`, where `InputWiring` is:
  - `{ from: "node", nodeId, output }`: the Test node closest to the node, among those that always ran before it and declare that output (if two are in a row, the later one wins);
  - `{ from: "expression", expression }`: the override;
  - `{ from: "default", value }`: "use the default";
  - `{ from: "none" }`.

  The order is override > useDefault > node > none (fw: an explicit choice beats the automatic one). The wiring is computed, never stored. Exported for the builder's "← orderId from Purchase".
- **Scope:** `scopeAt` lists a keyed Test node's declared outputs under `nodes.<key>`, next to `status`, `durationMs` and `error`. `checkExpression` then accepts `nodes.purchase.orderId` with the existing before/after/branch rules.
- **Check** (new `FlowProblem`s, errors):
  - `<node title>: input "x" has no source. Save it as an output in an earlier test, set an expression, or use the default`;
  - an override expression that fails `checkExpression` (message as today);
  - `<parallel title>: branches both save "x"` when two branches of one parallel contain Test nodes declaring the same output;
  - an `inputs` entry for a name the test doesn't declare: warning, `input "x" is not used by this test`.
- **Runtime:** after a Test node passes, its result's `outputs` go in `context.nodes[key]` (if keyed) and in a per-run map by node id for wiring. Before a node runs, its inputs are resolved: override → the expression's value, where strings pass, numbers and booleans go through `String()`, and `undefined`, `null`, objects and arrays fail the node (`input "x": the expression gave no text`) (fw); node → that node's saved value; default → not sent (the test uses its own). An input whose source node saved nothing (skipped, failed with `onFailure: continue`) fails the node: `input "x": Purchase saved no orderId`. `NodeResult` gains `inputs?` (the values passed).

### 6. Capabilities

New keys: `testInputsOutputs: true`, `flowPerBrowser: true`; `nodeFolder` becomes `2` (takes `browser`), `flowNodeFolders` becomes `2` (per-browser layout).

### 7. Delivery

Five PRs, merged to `main` one at a time, stacked where a PR needs another's code, the usual way (fw); a separate release PR bumps the version and capability keys; wiki and upgrading note at release. Released together as **0.21.0** (minor, with an "Upgrading to 0.21.0" note for the breaking flow changes):

1. Runtime: options, fixtures, `save`, `{ output }`, results, `runTests({ inputs })`, `FoundTest`.
2. Codec: steps, `TextValue`, `declare`, parse/emit (needs 1 for the types).
3. Toolbar: Save as output, Insert → input (needs 2).
4. Flows once per browser: events, return value, report, folders, group skip.
5. Flows wiring: schema, `wiringAt`, scope, check, runtime passing (needs 1 and 4).

## Out of scope

Non-text values, outputs from network/cookies/storage, Group node overrides and outputs, a CLI `--input` flag, secret inputs, migrating old `outputs` fields, and running browsers of one flow in parallel.

## Risks

- **Breaking flow API** (events, return value, report, folders) hits the app at once. Mitigation: one release, capability keys, the upgrading note, and the app moves its minimum version.
- **Flows take longer** (browsers in series). Accepted by the owner.
- **Declaration drift:** a step removed in the code view leaves a declared output never saved → the test fails at runtime with a clear message, rather than passing silently.
- **Overload ambiguity:** `test.skip(title, options, fn)` vs `test.skip(condition, reason)`. The first argument's type (string vs boolean) already separates them.
- **Size:** `registry.ts`, `run-test.ts`, `walker.ts`, `project.ts` and the codec's `parse.ts` / `edit.ts` grow. New behaviour goes in new modules (`test-io.ts`, `wiring.ts`, `per-browser.ts`) per the size rules.
