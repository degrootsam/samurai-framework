# Test Inputs and Outputs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tests declare text inputs and outputs. Flows wire one test's outputs into later nodes and run once per browser. The codec and the recorder toolbar can write all of it.

**Architecture:** Five PRs, merged to `main` one at a time:
- **PR A, runtime** (Tasks 1–3): registry options, `inputs`/`outputs` fixtures, a test-scoped output sink that `Locator.fill` and the text matchers write to, results, and `runTests({ inputs })`.
- **PR B, codec** (Task 4).
- **PR C, toolbar** (Tasks 5–6).
- **PR D, flows once per browser** (Task 7).
- **PR E, flows wiring** (Tasks 8–9).

Branch dependencies: B branches from A; C from B; D from `main` (independent of A–C); E from A + D (wait until both are merged, or stack on D and rebase).

The capability keys, the version and the wiki go in the release PR (Task 10), after the owner merges A–E.

**Tech Stack:** TypeScript (ESM), node:test via `tsx`, WebDriver BiDi, the `typescript` compiler API in the codec, plain-JS toolbar source in template strings.

**Spec:** `docs/superpowers/specs/2026-10-26-test-inputs-outputs-design.md` (local, git-ignored). Read it before every task. Its decisions table is binding.

## Global Constraints

- **Names:** match `/^[A-Za-z_]\w*$/`, are not in `RESERVED_OUTPUTS` (`status`, `durationMs`, `error`, from `src/flows/core/steps.ts`; import it, don't copy it), and have no duplicates within one list. A name may be both an input and an output. Input defaults are strings.
- **Error messages:** public throws use `name(): what is wrong` (lower-case, no trailing full stop):
  - `test(): output "x" is not a valid name`
  - `test(): reason only applies to skip and fixme`
  - `inputs.x: not declared, add it to the test's inputs`
  - `outputs.save(): output "x" is not declared`
  - `output "x" was never saved` (a test failure, type `"assertion"`)
  - `applyEdit(): input "x" is not declared`
- **Results:** `TestSuccess` and `TestFailed` get `inputs?` / `outputs?: Record<string, string>`. Both are absent when the test declares none. On a retry they come from the last attempt.
- **What a capture reads:**
  - text: the way `toHaveText` reads it;
  - with a pattern: the first capture group, else the whole match;
  - from `fill`: the typed value;
  - from `toHaveValue` / `toHaveAttribute`: the value that passed.
- **`{ output }` rules:**
  - Accepted on `Locator.fill` and on `toHaveText`, `toContainText`, `toHaveValue`, `toHaveAttribute` only.
  - With `.not` it throws `expect(locator).not.<matcher>: output can't be saved from a negated check`.
  - Outside a test run (no sink) it throws `<method>: output can only be saved inside a test`.
- **Flows:**
  - `nodeFolder(nodeId, browser)` returns `<browser>/nodes/<cleanName(id)>`.
  - Screenshot paths in node results and events are relative to `outputDir`, with `/` separators.
  - Every `FlowEvent` gets `browser`.
  - A new last event is `flow-done { status, runs }`.
  - `runFlowInProject` resolves to `FlowRunResult = { status: "passed" | "failed" | "cancelled"; runs: { browser: SupportedBrowser; summary: FlowSummary }[] }`.
- **Core purity:** `flows/core` stays pure (no Node APIs; `purity.test.ts` must pass). `src/cli` imports only entry points.
- **Size:** new behaviour goes in new modules: `src/runner/test-io.ts`, `src/flows/core/wiring.ts`, `src/flows/run/per-browser.ts`, a toolbar `actions/save-output.ts`. Keep files under ~400 lines and functions under ~60. `Locator` stays a facade.
- **Repo rules (`CLAUDE.md`):**
  - Branch from an up-to-date `main`. Tests go through the npm scripts.
  - `npx tsc --noEmit --noUnusedLocals`, `npx knip --no-config-hints` and `npx madge --circular src` must be clean.
  - Stage named paths. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - PR body: Summary, Breaking change (PR D and E), Test plan with real counts.
  - Browser tests run under `flock`, on Firefox then Chrome.

## Review Focus

1. **The output sink leaking between tests:** a capture after a test timed out, or in an un-awaited promise, must not land in the next test's outputs. Test (Task 2): a test that times out while `save` is pending; the next test's `outputs` holds only its own values.
2. **Never-saved vs. failed:** a test that fails before saving reports the real failure, not `output "x" was never saved`. Test (Task 2).
3. **Wiring through a Condition:** a producer on one arm only is `none`, not `node`. A producer before the condition is `node`. Test (Task 8).
4. **A producer that is skipped at run time** (its group lacks the browser, or `onFailure: continue` after a failure): the consumer node fails with `input "x": <title> saved no <x>`, never runs with a default or an empty value. Test (Task 9).
5. **A codec round-trip with the options object:** `test("t", { inputs: { a: "1" } }, async ({ page, inputs }) => …)` parses, emits back byte-identical after a no-op edit, and an options object holding a non-literal (`{ inputs: defaults }`) makes the test `unparsed`, not silently empty. Test (Task 4).

---

## PR A: runtime (`feat/test-io-runtime`)

### Task 1: Registry options and listing

**Files:**
- Modify: `src/types/test.d.ts` (add `TestOptions`; `TestDetails` stays `{ reason }` for `describe.skip`/`fixme`), `src/runner/registry.ts`, `src/runner/run.ts` (`FoundTest`)
- Create: `src/runner/test-io.ts`, holding `validateTestIO(call, options): { inputs?: Record<string,string>; outputs?: string[] }` (throws per the Global Constraints)
- Test: `src/runner/registry.test.ts` (extend), `src/runner/test-io.test.ts`, and the `listTests` test in `src/runner/run.test.ts` or `src/api.test.ts` (wherever `FoundTest` is tested today)

**Interfaces:**
- Produces:
  - `TestOptions { reason?: string; inputs?: Record<string, string>; outputs?: string[] }`
  - `RegisteredTestCase.inputs?: Record<string,string>` and `.outputs?: string[]`
  - `TestFunction` gains `(title, options: TestOptions, fn)`, and `only` gains the same overload
  - `FoundTest.inputs?: { name: string; default: string }[]` (in declaration order) and `FoundTest.outputs?: string[]`

- [ ] **Step 1: Failing tests:**
  - `test("t", { inputs: { a: "1" }, outputs: ["o"] }, fn)` registers `inputs {a:"1"}` and `outputs ["o"]`;
  - `test.skip("t", { reason: "r", outputs: ["o"] }, fn)` keeps the reason;
  - `test("t", { reason: "r" }, fn)` throws `test(): reason only applies to skip and fixme`;
  - an invalid name, a reserved name (`status`), a duplicate in `outputs`, and a non-string default each throw;
  - `listTests` returns `inputs [{name:"a",default:"1"}]` and `outputs ["o"]`, and leaves both absent for a plain test.
- [ ] **Step 2:** Run `npm test`. The new tests fail.
- [ ] **Step 3:** Implement. `bodyAndReason` becomes `bodyAndOptions` and returns `{ fn, reason?, inputs?, outputs? }`.
- [ ] **Step 4:** Run `npm test`, tsc, knip and madge. All green.
- [ ] **Step 5: Commit** `feat: test() takes inputs and outputs options`

### Task 2: Fixtures, `outputs.save`, results, supplying inputs

**Files:**
- Modify:
  - `src/runner/test-io.ts`: the sink, `createInputsFixture`, `createOutputsFixture`, and `takeOutputs()`.
  - `src/types/test.d.ts`: `TestFixtures.inputs` / `.outputs`, and `inputs?` / `outputs?` on the success and failed results.
  - `src/runner/run-test.ts`: build the fixtures, open and close the sink per attempt, the never-saved check, and attach to the result.
  - `src/runner/worker-protocol.ts`: `WorkItem.inputs?: Record<string,string>`.
  - The worker session and pool files that build and read `WorkItem` (follow `outputDir`'s path: `src/runner/worker-session.ts`, `src/flows/run/node-pool.ts`).
  - `RunTestsOptions` (`src/runner/run.ts` or the options file): `inputs?: Record<string,string>`.
- Test:
  - `src/runner/test-io.test.ts`
  - a `run-test` unit test (pattern: the existing run-test tests)
  - Create `src/runner/test-io.browser-test.ts`

**Interfaces:**
- Produces:
  - `TestFixtures.inputs: Readonly<Record<string, string>>`
  - `TestFixtures.outputs: { save(name: string, locator: Locator, pattern?: RegExp): Promise<void> }`
  - `beginOutputs(declared: string[]): OutputSink`, where `OutputSink.set(name, value)` throws if the name is undeclared, and `currentOutputSink(): OutputSink | undefined` (used by Task 3)
  - `endOutputs(): Record<string,string>`
  - `runTests({ inputs })`
- The sink is module state, like `takePendingAssertions` (`src/assert/pending-assertions.ts`). It is opened before the body and closed in a `finally`. A sink object that is closed ignores later `set`s; that ignoring is the leak guard (Review Focus 1).

- [ ] **Step 1: Failing unit tests:**
  - `inputs` returns the run value, else the default;
  - an undeclared read throws `inputs.x: not declared, add it to the test's inputs`;
  - `save` on an undeclared name throws;
  - a sink after `endOutputs` ignores `set`;
  - a passing body that declared `o` and never saved it fails with `output "o" was never saved`;
  - a body that throws first reports its own error (Review Focus 2);
  - a result carries `inputs` (defaults included) and `outputs`, and both are absent with no declarations.
- [ ] **Step 2: Failing browser tests** (data-URL page, pattern: `src/assert/assertions.browser-test.ts`):
  - `save("o", loc)` saves the element text;
  - `save("o", loc, /Order #(\d+)/)` saves `12345` from text that appears after 300 ms;
  - `/Order #\d+/` with no group saves the whole match;
  - a missing element fails at `expectTimeout` with an `AssertionError`;
  - a pattern that never matches fails;
  - `runTests({ inputs: { a: "x" } })` makes `inputs.a === "x"`, both on a pool (`workers: 2`) and in-process;
  - Review Focus 1: test 1 times out mid-`save`, and test 2's outputs hold only its own value.
- [ ] **Step 3:** Run the tests. They fail.
- [ ] **Step 4:** Implement. `save` reuses the matcher retry loop (`assertEventually` in `src/assert/locator-assertions.ts`) and the `toHaveText` text read. It is registered with `track()`, so an un-awaited `save` is reported like an un-awaited matcher.
- [ ] **Step 5:** Run `npm test`, then the browser file on Firefox and Chrome, then tsc, knip and madge.
- [ ] **Step 6: Commit** `feat: inputs and outputs fixtures, outputs in results`

### Task 3: `{ output }` on fill and text checks

**Files:**
- Modify:
  - `src/locator/locator.ts`: the `fill` options type gets `output?: string` (a one-line delegation; the logic goes in `input-actions.ts` or `test-io.ts`).
  - `src/locator/input-actions.ts`.
  - `src/assert/locator-assertions.ts`: the four matchers take `options.output`, and the passing read value goes to the sink.
  - `src/assert/text-match.ts`: `captured(matcher, actual): string` (group, match or whole).
- Test: `src/assert/expect-locator.test.ts` (stubConnector), and extend `src/runner/test-io.browser-test.ts`

**Interfaces:**
- Consumes: `currentOutputSink()` from Task 2.
- Produces: `fill(value, { output })`, and `{ output?: string }` in `LocatorAssertionOptions` for the four matchers (in the type, on those four only, by using a separate options type).

- [ ] **Step 1: Failing tests:**
  - `toHaveText(/Order #(\d+)/, { output: "o" })` saves `12345`;
  - `toHaveText("Done", { output: "o" })` saves `Done`;
  - `toContainText("Order", { output: "o" })` saves the whole text;
  - `toHaveValue` and `toHaveAttribute` save the value that passed;
  - `fill("x", { output: "o" })` saves `x`;
  - `.not.toHaveText("a", { output: "o" })` throws the negated message;
  - without a sink it throws `<method>: output can only be saved inside a test`.
- [ ] **Step 2:** Run the tests. They fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`, the browser file (both browsers), tsc, knip and madge.
- [ ] **Step 5: Commit** `feat: save fill values and check results as outputs`

Open PR A (no capability key yet).

## PR B: codec (`feat/test-io-codec`, from PR A)

### Task 4: Codec steps, options object, `declare`

**Files:**
- Modify:
  - `src/steps/model.ts`: `TextValue` gets `{ kind: "input"; name }`; the `saveOutput` step; `fill.output?`; `expect.output?`; `ParsedTest.inputs?` / `.outputs?`; `ParsedTest.fixtures` covers `inputs` / `outputs`.
  - `src/steps/parse.ts`.
  - `src/steps/emit.ts`.
  - `src/steps/edit.ts`: the `declare` op, auto-declaring outputs, refusing undeclared inputs, and the fixtures. Past ~400 lines, split the options-object handling into `src/steps/test-options.ts`.
- Test: `src/steps/parse.test.ts`, `emit.test.ts` and `edit.test.ts` (extend), plus a round-trip test for every new shape.

**Interfaces:**
- Produces:
  - `Step` member `{ kind: "saveOutput"; name: string; locator: LocatorSpec; pattern?: { source: string; flags: string } }`, emitted `await outputs.save("<name>", <locator>[, /src/flags]);`
  - `fill` gains `output?: string`, emitted `.fill(<value>, { output: "<name>" })`
  - `expect` gains `output?: string`; only `toHaveText`, `toContainText`, `toHaveValue` and `toHaveAttribute` take it, never with `not`, and any other shape stays `custom`
  - `TextValue { kind: "input"; name }`, emitted `inputs.<name>`
  - `ParsedTest.inputs?: { name; default }[]` and `ParsedTest.outputs?: string[]`
  - `StepEdit` member `{ op: "declare"; test: number; inputs?: { name: string; default: string }[]; outputs?: string[] }`: a given list replaces that list; when both end up empty, the options object is removed (it keeps `reason` if there is one)

- [ ] **Step 1: Failing tests:**
  - each new step parses and emits identically;
  - the options object is read into `inputs` / `outputs` (and `reason` for skip and fixme);
  - a non-literal options object makes the test unparsed (Review Focus 5);
  - `declare` adds, replaces and removes the object;
  - `insert` of a `saveOutput` adds the name to `outputs` and adds the `outputs` fixture;
  - `replace` of a fill with `value {kind:"input",name:"a"}` when `a` is undeclared throws `applyEdit(): input "a" is not declared`; once declared, it works and adds the `inputs` fixture;
  - an untouched file round-trips byte-identical (Review Focus 5).
- [ ] **Step 2:** Run `npm test`. The new tests fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`, tsc, knip and madge. Check `wc -l` for `parse.ts` and `edit.ts`.
- [ ] **Step 5: Commit** `feat: codec reads and writes test inputs and outputs`

Open PR B (base `feat/test-io-runtime`, with a retarget note).

## PR C: toolbar (`feat/test-io-toolbar`, from PR B)

### Task 5: "Save as output" panel

**Files:**
- Create: `src/recorder/toolbar/actions/save-output.ts`
- Modify:
  - `src/recorder/toolbar/protocol.ts`: a new message `save-output { target, candidates, name, pattern? }`.
  - `src/recorder/toolbar/controller.ts`: dispatch.
  - `src/recorder/normalise.ts`: the `saveOutput` observation → step.
  - `src/recorder/spec-source.ts`: the options object and fixtures in the generated spec; it reuses Task 4's emit, with no second emitter.
  - The browser-side slices: `source/views-panels.ts`, `source/fields.ts`, `source/handlers.ts`, `source/picking.ts` (a panel next to Assert, with the same pick flow).
- Test: `src/recorder/toolbar/controller-save-output.test.ts` (pattern: `controller-assert.test.ts`), `src/recorder/normalise.test.ts`, `src/recorder/spec-source.test.ts`, and Create `src/recorder/toolbar/save-output.browser-test.ts` (pattern: `page-panel.browser-test.ts`, using `recorder-toolbar-fixture.ts`)

**Interfaces:**
- Consumes: Task 4's `saveOutput` step, `declare`, and the `ParsedTest.outputs` shape.
- Produces: the panel shows the picked element's current text and the value it would capture. Save is refused when:
  - the name breaks the name rules (`name: use letters, digits and _`);
  - the pattern is not valid, or doesn't match now (`pattern doesn't match the element's text`).

- [ ] **Step 1: Failing tests:**
  - the controller turns `save-output` into a recorded `saveOutput` step and declares the output;
  - each refusal case gets its reply;
  - normalise and spec-source emit `outputs: ["o"]` and `async ({ page, outputs })`;
  - browser: pick, name, pattern, save; the recorded file contains `await outputs.save("orderId", …, /Order #(\d+)/);`.
- [ ] **Step 2:** Run the tests. They fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`, then the toolbar browser files on both browsers.
- [ ] **Step 5: Commit** `feat: Save as output in the recorder toolbar`

### Task 6: Insert → input

**Files:**
- Modify: `src/recorder/toolbar/actions/insert.ts`, `protocol.ts` (`kind: "env" | "secret" | "input"` on `insert` and `add-insertable`), `controller.ts`, `normalise.ts`, `spec-source.ts`, and the source slices that render Insert
- Test: `src/recorder/toolbar/controller-insert.test.ts`, `normalise.test.ts`, `spec-source.test.ts`, and the toolbar browser test for Insert

**Interfaces:**
- Produces:
  - `add-insertable { kind: "input", name, value }` declares the input with `value` as its default, types `value`, and records `fill` with `{ kind: "input", name }`;
  - `insert { kind: "input", name }` types the declared default;
  - the Insert list shows declared inputs as a third group;
  - inputs never go through `setSecret` or `addVariable`.

- [ ] **Step 1: Failing tests:** the recorded step and declaration for a new input; an existing input types its default; a duplicate name is refused; the generated spec has `inputs: { email: "a@b.c" }` and `inputs.email`.
- [ ] **Step 2:** Run the tests. They fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test` and the browser files on both browsers.
- [ ] **Step 5: Commit** `feat: Insert an input in the recorder toolbar`

Open PR C (base `feat/test-io-codec`).

## PR D: flows once per browser (`feat/flow-per-browser`, from `main`)

### Task 7: One walk per browser

**Files:**
- Create: `src/flows/run/per-browser.ts`, holding `flowBrowsers(nodeBrowsers, flow, projectBrowsers, only?)` and the loop over runs.
- Modify:
  - `src/flows/run/events.ts`: `browser` on every event, `flow-done`, `FlowRunResult`.
  - `src/flows/run/run.ts`: `RunFlowOptions.browser: SupportedBrowser` (required). A node whose browsers don't include it is `skipped` with `note: "not run in <browser>"`. `runTests` gets a single `browser`.
  - `src/flows/run/walker.ts`.
  - `src/flows/run/handlers/support.ts`.
  - `src/flows/run/project.ts`: the loop; `RunFlowInProjectOptions.browsers?`; returns `FlowRunResult`; per-browser `outputDir`.
  - `src/flows/run/node-folder.ts`: `nodeFolder(nodeId, browser)`.
  - `src/flows/run/report.ts`: `runs[]`.
  - `src/flows/run/node-pool.ts`.
  - The screenshot paths in the node's test events, made relative to `outputDir`.
  - The wiki-facing docs comments.
- Test: `src/flows/run/run.test.ts`, `project.test.ts`, `report.test.ts`, `node-folder.test.ts`, `flows.browser-test.ts`

**Interfaces:**
- Produces:
  - `FlowEvent`: every member gets `browser: SupportedBrowser`, plus `{ type: "flow-done"; status; runs }`;
  - `runFlowInProject(): Promise<FlowRunResult>`;
  - `RunFlowInProjectOptions.browsers?: SupportedBrowser[]` (only those, in the flow's order; a browser no node uses is ignored);
  - `nodeFolder(nodeId: string, browser: SupportedBrowser): string`;
  - the report file's shape is `{ …existing top-level fields, runs: { browser, summary }[] }`.
- **Runs:**
  - The flow's browsers are the union of every node's browsers, in first-seen order: a Test node uses `browsersFor({ project })`, a Group node uses its group's.
  - Runs are independent: a failed or stopped run doesn't stop the next one, but an abort stops them all.
  - `status` is `cancelled` if aborted, else `failed` if any run failed, else `passed`.

- [ ] **Step 1: Failing tests:**
  - a project with `["firefox", "chrome"]` walks twice, Firefox first, and every event carries its browser;
  - a Group node limited to `["chrome"]` is skipped in the Firefox run with `not run in firefox`;
  - `browsers: ["chrome"]` runs once;
  - `onFailure: "stop"` failing in Firefox still runs Chrome;
  - an abort during Firefox cancels both;
  - `nodeFolder("n 1", "chrome") === "chrome/nodes/n_1"` (whatever `cleanName` gives);
  - screenshot paths start with `<browser>/nodes/`;
  - the report has `runs` of length 2.
- [ ] **Step 2:** Run `npm test`. The tests fail.
- [ ] **Step 3:** Implement. Keep `walker.ts` and `project.ts` from growing: the loop and the browser union live in `per-browser.ts`.
- [ ] **Step 4:** Run `npm test`, build, `npm run test:cli`, `flows.browser-test.ts` on both browsers, tsc, knip and madge. Check `wc -l`.
- [ ] **Step 5: Commit** `feat!: a flow runs once per browser`

Open PR D. Breaking change section: events, return value, report and folders; escape hatch `browsers: [one]`.

## PR E: flows wiring (`feat/flow-wiring`, after A and D are on `main`)

### Task 8: Schema, facts, wiring, scope and check (core, pure)

**Files:**
- Create: `src/flows/core/wiring.ts`, holding `alwaysBefore` and `wiringAt`.
- Modify:
  - `src/flows/core/schema.ts`: remove `FlowNodeOutput` and `outputs`; add `inputs?: Record<string, InputSource>`. Reading a file drops a stray `outputs` (find the reader: `readFlowFile`).
  - `src/flows/core/graph.ts`: only if a helper belongs there.
  - `src/flows/core/expression/scope.ts`: the signature moves to options.
  - `src/flows/core/check.ts`: `CheckOptions.facts`, and the new problems.
  - Every `scopeAt` caller.
  - `src/flows/core/index.ts`: exports.
  - `nodes/test.ts` and `nodes/group.ts`: drop the unread `outputs: true` flag if nothing else reads it (grep first).
- Test: Create `src/flows/core/wiring.test.ts`; extend `check.test.ts`, `expression/scope.test.ts` and `schema.test.ts`.

**Interfaces:**
- Produces:
  - `FlowFacts { tests: Record<string, { inputs: { name: string; default: string }[]; outputs: string[] }>; groups: Record<string, string[]> }`
  - `InputSource = { expression: string } | { useDefault: true }`
  - `InputWiring = { from: "node"; nodeId; output } | { from: "expression"; expression } | { from: "default"; value } | { from: "none" }`
  - `alwaysBefore(flow, d, n): boolean`: `dominates`, or the parallel-branch rule in the spec, §5
  - `wiringAt(flow, nodeId, { facts }): Record<string, InputWiring>`, in the order override > useDefault > node > none
  - `scopeAt(flow, nodeId, environment, options?: { nodes?; facts? })`: a keyed Test node's declared outputs join its `nodes.<key>` fields
  - `CheckOptions.facts?: FlowFacts`
- **Check problems** (text per the spec, §5):
  - `input "x" has no source…` (error, nodeId);
  - an override expression that fails `checkExpression` (error);
  - `branches both save "x"` (error, on the parallel);
  - `input "x" is not used by this test` (warning);
  - a Group node `inputs` entry that's `{ expression }` (error, `Group nodes can't set inputs`).
- Without `facts`, nothing new is reported.

- [ ] **Step 1: Failing tests (`wiring.test.ts`):**
  - linear `A(out o) → B(in o)` is `node A`;
  - `A → A2(out o) → B`: A2 wins;
  - a producer on one Condition arm is `none` (Review Focus 3);
  - a producer before the Condition is `node`;
  - a producer inside a Parallel branch feeding a node after the meet is `node`;
  - two branches both producing `o` give a check error;
  - an override beats a node; `useDefault` gives the default value;
  - a group's inputs are the union of its tests' (first default wins);
  - scope: `nodes.a.o` is accepted after A and rejected before it;
  - an old file with `outputs` reads without it.
- [ ] **Step 2:** Run `npm test`. The tests fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test` (including `purity.test.ts`), tsc, knip and madge.
- [ ] **Step 5: Commit** `feat!: flow inputs wired from earlier tests' outputs`

### Task 9: Runtime wiring and project facts

**Files:**
- Modify:
  - `src/flows/run/walker.ts`: after a Test node, store its result `outputs` in `context.nodes[key]` (when keyed) and in a per-run `outputsById`.
  - `src/flows/run/handlers/test.ts` and `group.ts`.
  - `src/flows/run/handlers/support.ts`: resolve the inputs before `runTests`, and pass `inputs`.
  - `src/flows/run/run.ts`: `RunFlowOptions.facts?: FlowFacts`; `runTests` input gets `inputs?: Record<string,string>`.
  - `src/flows/run/events.ts`: `NodeResult.inputs?`.
  - `src/flows/run/project.ts`: build `FlowFacts` from the listed tests and groups; pass it to `checkFlow` and `runFlow`; pass `inputs` to `run` and the pool items.
  - `branch-context.ts`: `outputsById` forks and merges like `nodes`.
- Test: `src/flows/run/run.test.ts`, `project.test.ts`, `flows.browser-test.ts`

**Interfaces:**
- Consumes: `wiringAt`, `FlowFacts` (Task 8), `runTests({ inputs })`, `TestSuccess.outputs` (Tasks 2–3), and the per-browser runs (Task 7).
- Resolving each input:
  - `node`: the producer's saved value; missing → the node fails with `input "x": <producer title> saved no x`;
  - `expression`: evaluate it; a string passes, a number or boolean goes through `String()`, and anything else fails with `input "x": the expression gave no text`;
  - `default`: not sent.
- `NodeResult.inputs` holds the values sent.

- [ ] **Step 1: Failing tests (stubbed `runTests`):**
  - A's outputs reach B's `inputs`;
  - `nodes.a.o` works in a condition;
  - a skipped producer fails the consumer (Review Focus 4);
  - the override expression rules;
  - each browser run has its own values (Firefox's `o` never reaches Chrome's B);
  - `checkFlowInProject` reports an unwired input;
  - browser e2e: test 1 saves `orderId` from a data-URL page, and test 2 types it and checks it.
- [ ] **Step 2:** Run `npm test`. The tests fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the full verification: tsc, `npm test`, build, `npm run test:cli`, knip, madge, then both browser suites. Check `wc -l`.
- [ ] **Step 5: Commit** `feat: flows pass outputs to later tests' inputs`

Open PR E. Breaking change section: `FlowNodeModel.outputs` removed, `scopeAt` options.

## Release (`chore/version-0.21.0`, after the owner merges A–E)

### Task 10: Capabilities, version, docs

- [ ] `src/capabilities.ts`: `testInputsOutputs: true`, `flowPerBrowser: true`, `nodeFolder: 2`, `flowNodeFolders: 2`, each with a comment. Update `capabilities.test.ts`.
- [ ] `package.json` → `0.21.0`. Run build, then `npm run test:cli`.
- [ ] Commit `release: 0.21.0` and open the PR.
- [ ] After the owner publishes:
  - wiki pages: Writing tests (inputs and outputs), Assertions (`{ output }`), Steps-and-the-recorder (codec, toolbar), Flows (wiring, per browser), Embedding (API, capabilities), Roadmap, and "Upgrading to 0.21.0";
  - a reply in the UI hand-off.
