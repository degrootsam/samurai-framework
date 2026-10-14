# Recorder toolbar (B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A toolbar inside the recording browser window (pause, assert, insert variable/secret, add a missing one, wait, screenshot, stop) whose every action becomes a spec step; the app shows the paused state, the two new step kinds and run screenshots.

**Architecture:** A sandboxed, shadow-DOM toolbar script draws state and reports presses over the recorder's existing `script.message` channel. A `ToolbarController` in Node owns all toolbar state and turns presses into observations for the normaliser, which emits steps as today. Framework 0.7.0 ships first (steps, page API, project writers, toolbar, recorder, recordSpec); the app then bumps, forwards status, edits the new steps and shows screenshots.

**Tech Stack:** TypeScript, WebDriver BiDi (Firefox), `node:test` via tsx (framework), bun test + React + Electron (app), TypeScript compiler API (config edits).

**Spec:** `docs/superpowers/specs/2026-10-14-recorder-toolbar-design.md` (framework repo). Approved mockups: [the published page](https://claude.ai/artifact/SzFJ7FVeJj9HxqEanJJX9L); the same mockups as local HTML (CSS to copy from) are in the app repo at `.superpowers/brainstorm/89228-1791983668/content/` (`rail-states.html`, `insert-wait-shot.html`, `insert-add-v2.html`).

## Global Constraints

- Framework version **0.7.0**; the app depends on `@itmetsam/samurai-framework@^0.7.0`.
- Firefox only. The toolbar runs in the BiDi sandbox realm named exactly `samurai-toolbar`; its host element is `<samurai-recorder-toolbar>` with a **closed** shadow root.
- Top-level documents only (no toolbar or capture in iframes).
- Secret values never go to the page: the toolbar receives secret names and a `set` flag only.
- Screenshot names keep `[A-Za-z0-9_-]`; every other character becomes `-`; leading/trailing `-` trimmed; empty → `screenshot`. Repeats in one test get `-2`, `-3`, ….
- Screenshot files: `<result dir>/screenshots/<test file without extension>/<cleaned test name>/<name>.png` in a run; `<result dir>/screenshots/<name>.png` outside a run. Report entry `screenshots: [{ name, path }]`, `path` relative to the result dir, POSIX separators.
- Wait for time: toolbar range 0.1–60 s (default 2); `waitForTimeout(ms)` takes a non-negative integer literal in specs.
- Copy (verbatim from the spec): "Recording", "Paused", "Nothing you do now is recorded.", "Click an element · Esc cancels", "Add a step that opens this page?", "Click into a field first", "This element can't be identified uniquely", "Couldn't type into that field", "This recording has no environment", "Screenshot step added", "Wait step added", "Until the page settles", "No requests for 500 ms", "Save and insert", "Add `.env.<env>` to .gitignore before committing.", "The toolbar couldn't load on this page. Alt+click still records assertions.", "Recording in the browser window", "Paused in the browser window".
- Framework commands: `npm test`, `npm run test:browser`, `npm run test:cli`, `npx tsc --noEmit -p .`, `npm run build`. bun.lock, not package-lock.
- App commands: `bun test`, `npx tsc --noEmit -p .`, `npx electron-vite build` (must pass: tsc alone missed a broken import in A). Renderer imports use relative paths, never `@renderer/…` for values.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No pushes from implementers.
- Plan decision (narrower than the spec's wording): the secrets the toolbar lists are those with a value (`.env.<env>` or `SAMURAI_SECRET_*` variables) plus the `secrets.X` names the spec file being recorded reads; other spec files are not scanned.
- Plan decision (beyond the spec): the app copies each run's screenshots into its own run storage, so a later run that overwrites `result/` does not change an old run's screenshots.
- "No environment" means the config has no `environments` object (the run uses the implicit `default` environment): Insert lists only secrets then, and adding a **variable** is disabled with "This recording has no environment". Secrets still work (`.env.default`).

## Review Focus

1. A site that monkeypatches DOM globals (`Element.prototype.attachShadow`, `EventTarget.prototype.addEventListener`, `JSON.stringify`) → the toolbar still appears and works, because it runs in the sandbox realm. Test in Task 6.
2. The page navigates while the Assert picker or a panel is open → the toolbar comes back on the new page from the controller's state, the picker is off, and no stale step is added. Test in Task 7.
3. Inserting into a field the page re-renders on every input (a controlled input) → exactly one `fill` step with the `env`/`secrets` reference, no literal `fill`. Test in Task 7 (browser) and Task 4 (normaliser).
4. A secret's value never appears in what is sent to the page (state push, replies, toasts). Test in Task 7 (controller unit test inspects every push).
5. Pressing Add twice quickly (double click) on a panel → one step. Test in Task 7 (controller ignores a second action while one with the same id is in flight; panels disable Add after the first press).

---

## Part 1 — Framework (repo `samurai-framework`)

Branch: `feat/recorder-toolbar` from `docs/recorder-toolbar` (it carries the spec and this plan).

### Task 1: Steps `waitForTimeout` and `screenshot`

**Files:**

- Modify: `src/steps/model.ts`, `src/steps/parse.ts`, `src/steps/emit.ts`
- Test: `src/steps/steps.test.ts`

**Interfaces:**

- Produces (`Step` union additions):
  `| { kind: "waitForTimeout"; ms: number }`
  `| { kind: "screenshot"; name: string; fullPage: boolean }`

- [ ] **Step 1: Failing tests.** In `steps.test.ts` add to `SAMPLES`:

```ts
  { kind: "waitForTimeout", ms: 2000 },
  { kind: "screenshot", name: "after-sign-in", fullPage: false },
  { kind: "screenshot", name: "whole", fullPage: true },
```

and a new test in `describe("step codec")`:

```ts
it("reads waits and screenshots, and keeps other shapes as custom code", () => {
  assert.equal(
    stepToSource({ kind: "waitForTimeout", ms: 1500 }),
    "await page.waitForTimeout(1500);",
  );
  assert.equal(
    stepToSource({ kind: "screenshot", name: "a", fullPage: true }),
    'await page.screenshot({ name: "a", fullPage: true });',
  );
  assert.equal(
    stepToSource({ kind: "screenshot", name: "a", fullPage: false }),
    'await page.screenshot({ name: "a" });',
  );
  const steps = stepsOf(
    wrap(
      "await page.waitForTimeout(ms);",
      "await page.waitForTimeout(1.5);",
      "await page.waitForTimeout(-1);",
      'await page.screenshot({ path: "x.png" });',
      "await page.screenshot();",
      'await page.screenshot({ name: "a", fullPage: false });',
    ),
  );
  assert.deepEqual(
    steps.map((s) => s.kind),
    ["custom", "custom", "custom", "custom", "custom", "screenshot"],
  );
  assert.deepEqual(steps[5], {
    kind: "screenshot",
    name: "a",
    fullPage: false,
  });
});
```

- [ ] **Step 2:** `npm test` → the round-trip and the new test fail.
- [ ] **Step 3: Implement.**

`model.ts`, in `Step` after `waitForNetworkIdle`:

```ts
  /** A fixed pause, in milliseconds */
  | { kind: "waitForTimeout"; ms: number }
  /** Saves the page as evidence under the run's results; never compares */
  | { kind: "screenshot"; name: string; fullPage: boolean }
```

`emit.ts`, in `stepToSource`:

```ts
    case "waitForTimeout":
      return `await page.waitForTimeout(${step.ms});`;
    case "screenshot":
      return `await page.screenshot({ name: ${str(step.name)}${step.fullPage ? ", fullPage: true" : ""} });`;
```

`parse.ts`, in `readStep`'s `page` branch (replace the `waitForNetworkIdle` return):

```ts
if (name.text === "waitForNetworkIdle" && args.length === 0)
  return { kind: "waitForNetworkIdle" };
if (
  name.text === "waitForTimeout" &&
  args.length === 1 &&
  ts.isNumericLiteral(args[0]!)
) {
  const ms = Number(args[0].text);
  return Number.isInteger(ms) ? { kind: "waitForTimeout", ms } : undefined;
}
if (name.text === "screenshot" && args.length === 1) {
  const options = readObject(args[0], ["name", "fullPage"]);
  if (!options || typeof options.name !== "string") return undefined;
  if (options.fullPage !== undefined && typeof options.fullPage !== "boolean")
    return undefined;
  return {
    kind: "screenshot",
    name: options.name,
    fullPage: options.fullPage === true,
  };
}
return undefined;
```

(`-1` is a prefix-unary expression, not a numeric literal, so it stays custom.)

- [ ] **Step 4:** `npm test` → pass; `npx tsc --noEmit -p .` → clean (fix any exhaustive `switch` over `Step` the compiler reports, e.g. in `src/flows` or `src/steps/build.ts`, by handling the two kinds the way `waitForNetworkIdle` is handled there).
- [ ] **Step 5: Commit** `feat: waitForTimeout and screenshot steps`.

### Task 2: Page API — `waitForTimeout`, named screenshots as run evidence

**Files:**

- Create: `src/browser/evidence.ts`, `src/browser/evidence.test.ts`, `src/runner/screenshots.browser-test.ts`
- Modify: `src/browser/page.ts`, `src/browser/screenshot.ts` (`ScreenshotOptions.name`), `src/runner/test-runner.ts`, `src/runner/reporter.ts`, `src/types/test.d.ts`

**Interfaces:**

- Produces: `cleanName(name: string): string`; `class Evidence { constructor(resultDir: string, testDir?: string); fileFor(name: string): { file: string; name: string; path: string }; readonly screenshots: { name: string; path: string }[] }`; `page.setEvidence(evidence: Evidence | undefined): void` (`@internal`); `page.waitForTimeout(ms: number): Promise<void>`; `TestResult` success/failed gain `screenshots?: { name: string; path: string }[]`; `TestReporter.onTestEnd(test, error?, extras?: { logs?; logsDropped?; screenshots? })`.

- [ ] **Step 1: Failing unit tests** `src/browser/evidence.test.ts`:

```ts
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { cleanName, Evidence } from "./evidence.js";

describe("cleanName", () => {
  it("keeps letters, digits, - and _", () => {
    assert.equal(cleanName("after sign-in!"), "after-sign-in");
    assert.equal(cleanName("  "), "screenshot");
    assert.equal(cleanName("a/b\\c"), "a-b-c");
    assert.equal(cleanName("ok_1"), "ok_1");
  });
});

describe("Evidence", () => {
  it("puts a test's screenshots in its folder and numbers repeats", () => {
    const e = new Evidence("/r", "login.spec/signs-in");
    assert.deepEqual(e.fileFor("home"), {
      file: path.join(
        "/r",
        "screenshots",
        "login.spec",
        "signs-in",
        "home.png",
      ),
      name: "home",
      path: "screenshots/login.spec/signs-in/home.png",
    });
    assert.equal(e.fileFor("home").name, "home-2");
    assert.equal(e.fileFor("home").name, "home-3");
    assert.deepEqual(
      e.screenshots.map((s) => s.name),
      ["home", "home-2", "home-3"],
    );
  });

  it("without a test folder writes to screenshots/", () => {
    assert.equal(new Evidence("/r").fileFor("x").path, "screenshots/x.png");
  });
});
```

Note: `testDir` passed by the runner is already cleaned: `<test file relative to srcDir without its extension>/<cleanName(test name)>` with `/` separators (e.g. `login.spec/signs-in` for `src/tests/login.spec.ts` with srcDir `src/tests`).

- [ ] **Step 2:** `npm test` → fails (no module).
- [ ] **Step 3: Implement** `src/browser/evidence.ts`:

```ts
import path from "node:path";

/** A screenshot name as a file name: letters, digits, - and _ (the rest becomes -) */
export function cleanName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned === "" ? "screenshot" : cleaned;
}

/** Where a run (or one test) saves named screenshots, and the ones it saved */
export class Evidence {
  public readonly screenshots: { name: string; path: string }[] = [];
  private readonly used = new Set<string>();

  constructor(
    private readonly resultDir: string,
    private readonly testDir?: string,
  ) {}

  /** The file for the next screenshot called `name`; a repeat gets -2, -3, … */
  public fileFor(name: string) {
    const base = cleanName(name);
    let unique = base;
    for (let n = 2; this.used.has(unique); n++) unique = `${base}-${n}`;
    this.used.add(unique);
    const relative = [
      "screenshots",
      ...(this.testDir ? this.testDir.split("/") : []),
      `${unique}.png`,
    ].join("/");
    const entry = {
      file: path.join(this.resultDir, ...relative.split("/")),
      name: unique,
      path: relative,
    };
    this.screenshots.push({ name: entry.name, path: entry.path });
    return entry;
  }
}
```

`screenshot.ts`: `ScreenshotOptions` gains

```ts
  /** Also save the image as run evidence under this name (see the Page API docs) */
  name?: string;
```

`page.ts`:

```ts
  private evidence: Evidence | undefined;

  /** @internal The runner gives each test its own evidence folder */
  public setEvidence(evidence: Evidence | undefined): void {
    this.evidence = evidence;
  }

  /** Waits `ms` milliseconds. Prefer waiting for something (an assertion, `waitForNetworkIdle`) when you can */
  public async waitForTimeout(ms: number): Promise<void> {
    if (!Number.isFinite(ms) || ms < 0) throw new RangeError(`waitForTimeout needs 0 or more milliseconds, got ${ms}`);
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
```

and `screenshot`:

```ts
  public async screenshot(options: ScreenshotOptions = {}): Promise<Buffer> {
    this.assertOpen();
    const image = await takeScreenshot(this.biDiConnector, this.id, options);
    if (options.name !== undefined) {
      const evidence = this.evidence ?? new Evidence(path.join(projectDir(), "result"));
      await writeOutput(evidence.fileFor(options.name).file, image);
    }
    return image;
  }
```

(import `path`, `projectDir` from `../config/config.js`, `Evidence` from `./evidence.js`, `writeOutput` from `./screenshot.js`.)

`types/test.d.ts`: add `screenshots?: { name: string; path: string }[];` (doc: "Named screenshots the test saved, relative to the result folder") to `TestResultSuccess` and `TestResultFailed`.

`reporter.ts`: rename the third parameter of `onTestEnd` to `extras?: { logs?: TestLogEntry[]; logsDropped?: number; screenshots?: { name: string; path: string }[] }` and add `...(extras?.screenshots?.length && { screenshots: extras.screenshots })`.

`test-runner.ts` (`executeTestCase`): compute once per run `resultDir` = `path.dirname(this.options.reportPath)` when `reportPath` is a string, else `path.join(projectDir(), "result")`. After `page = launched.page;`:

```ts
evidence = new Evidence(resultDir, testDirOf(test, srcDir));
launched.page.setEvidence(evidence);
```

where `testDirOf` = `toPosix(path.relative(srcDir, test.file)).replace(/\.[cm]?[jt]sx?$/, "") + "/" + cleanName(test.name)` (srcDir as `resolveAll` computes it; read it once in `start()` and keep it on the instance). Every `finish(...)` call that passes logs also passes `screenshots: evidence?.screenshots`; `finish`'s second parameter becomes the `extras` object.

- [ ] **Step 4: Browser test** `src/runner/screenshots.browser-test.ts`: create a temp project (follow `src/runner/run.browser-test.ts` for how it builds one and calls `runTests`) whose spec does

```ts
await page.navigateTo("data:text/html,<h1>Hi</h1>");
await page.screenshot({ name: "first view" });
await page.screenshot({ name: "first view", fullPage: true });
await page.waitForTimeout(50);
```

and assert: the run passed; `result/screenshots/<file>/<test>/first-view.png` and `first-view-2.png` exist and start with the PNG signature `89 50 4E 47`; `report.json`'s test entry has `screenshots` with both `{ name, path }`.

- [ ] **Step 5:** `npm test`, `npm run test:browser -- src/runner/screenshots.browser-test.ts` (or the whole browser suite), `npx tsc --noEmit -p .` → pass.
- [ ] **Step 6: Commit** `feat: page.waitForTimeout and named screenshots saved with the run`.

### Task 3: Project writers (`/project`)

**Files:**

- Create: `src/project/config-edit.ts` (moved from the app's `src/main/utils/config-edit.ts`, byte-identical except imports), `src/project/config-edit.test.ts`, `src/project/variables.ts`, `src/project/secrets-file.ts`, `src/project/project.test.ts`, `src/project/index.ts`
- Modify: `package.json` (`exports["./project"]`)

**Interfaces:**

- Produces: `editConfig(source, path, value)`, `ConfigEditError`, `ConfigValue` (as in the app); `addVariable(projectDir: string, environment: string, name: string, value: string): Promise<void>`; `setSecret(projectDir: string, environment: string, name: string, value: string): Promise<void>`; `isGitIgnored(projectDir: string, file: string): Promise<boolean>`; `VARIABLE_NAME = /^[A-Za-z_$][\w$]*$/`, `SECRET_NAME = /^[A-Z][A-Z0-9_]*$/`; errors `ExistsError`.

- [ ] **Step 1:** Copy `/Users/samdegroot/dev/itmetsam/projects/samurai/src/main/utils/config-edit.ts` to `src/project/config-edit.ts` unchanged.
- [ ] **Step 2: Failing tests** `src/project/config-edit.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConfigEditError, editConfig } from "./config-edit.js";

const CONFIG = `import { defineConfig } from "@itmetsam/samurai-framework";

export default defineConfig({
  // keep me
  environments: {
    dev: { baseURL: "http://localhost:3000" },
  },
});
`;

describe("editConfig", () => {
  it("adds a nested value and creates the objects on the way", () => {
    const out = editConfig(
      CONFIG,
      ["environments", "dev", "variables", "adminUser"],
      "a@b.c",
    );
    assert.match(out, /adminUser: "a@b\.c"/);
    assert.match(out, /\/\/ keep me/);
    assert.match(out, /baseURL: "http:\/\/localhost:3000"/);
  });

  it("replaces an existing value and leaves the rest byte for byte", () => {
    const once = editConfig(
      CONFIG,
      ["environments", "dev", "variables", "x"],
      "1",
    );
    const twice = editConfig(
      once,
      ["environments", "dev", "variables", "x"],
      "2",
    );
    assert.equal(twice, once.replace('x: "1"', 'x: "2"'));
  });

  it("refuses a config built from spreads", () => {
    const spread = `const base = {};\nexport default defineConfig({ ...base });\n`;
    assert.throws(
      () => editConfig(spread, ["environments", "dev", "variables", "x"], "1"),
      ConfigEditError,
    );
  });
});
```

`src/project/project.test.ts` (temp dir per test with `mkdtempSync(path.join(tmpdir(), "samurai-project-"))`):

```ts
it("addVariable writes environments.<env>.variables", async () => {
  writeFileSync(join(dir, "samurai.config.ts"), CONFIG); // the CONFIG above
  await addVariable(dir, "dev", "adminUser", "admin@example.com");
  assert.match(
    readFileSync(join(dir, "samurai.config.ts"), "utf8"),
    /variables: \{\s*adminUser: "admin@example\.com",/,
  );
});
it("addVariable refuses an existing name and a bad name", async () => {
  writeFileSync(join(dir, "samurai.config.ts"), CONFIG);
  await addVariable(dir, "dev", "a", "1");
  await assert.rejects(addVariable(dir, "dev", "a", "2"), /"a" already exists/);
  await assert.rejects(
    addVariable(dir, "dev", "1x", "2"),
    /Use letters, digits and _/,
  );
});
it("setSecret adds and replaces SAMURAI_SECRET_ lines", async () => {
  writeFileSync(join(dir, ".env.dev"), "OTHER=1\nSAMURAI_SECRET_A=old\n");
  await setSecret(dir, "dev", "A", "new value");
  await setSecret(dir, "dev", "B", "x");
  assert.equal(
    readFileSync(join(dir, ".env.dev"), "utf8"),
    "OTHER=1\nSAMURAI_SECRET_A='new value'\nSAMURAI_SECRET_B=x\n",
  );
  await assert.rejects(setSecret(dir, "dev", "lower", "x"), /UPPER_SNAKE_CASE/);
});
it("isGitIgnored reads .gitignore", async () => {
  assert.equal(await isGitIgnored(dir, ".env.dev"), false);
  writeFileSync(join(dir, ".gitignore"), "node_modules\n.env*\n");
  assert.equal(await isGitIgnored(dir, ".env.dev"), true);
});
```

- [ ] **Step 3:** `npm test` → fails.
- [ ] **Step 4: Implement.**

`src/project/variables.ts`:

```ts
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { editConfig, hasConfigPath } from "./config-edit.js";

export const VARIABLE_NAME = /^[A-Za-z_$][\w$]*$/;

/** Adds a variable to one environment in samurai.config.ts; only that property's text changes */
export async function addVariable(
  projectDir: string,
  environment: string,
  name: string,
  value: string,
) {
  if (!VARIABLE_NAME.test(name))
    throw new Error("Use letters, digits and _, starting with a letter.");
  const file = path.join(projectDir, "samurai.config.ts");
  const source = await readFile(file, "utf8");
  if (hasConfigPath(source, ["environments", environment, "variables", name]))
    throw new Error(`"${name}" already exists`);
  await writeFile(
    file,
    editConfig(source, ["environments", environment, "variables", name], value),
  );
}
```

The existence check reads the file as it is now, not the loaded config: add to `config-edit.ts` an exported `hasConfigPath(source: string, path: string[]): boolean` (walk the same object literals `editConfig` walks; false when a step is missing or not an object literal) with a test (`hasConfigPath(CONFIG, ["environments", "dev", "baseURL"])` → true, `[…, "variables", "x"]` → false), and use it in `addVariable` instead of `loadConfig`.

`src/project/secrets-file.ts`: port `checkName`, `formatValue`, `lineFor`, `setSecret` and `gitIgnored` from `/Users/samdegroot/dev/itmetsam/projects/samurai/src/main/utils/secrets.ts`, taking `projectDir` instead of `Project`. `isGitIgnored(projectDir, file)` returns true when a `.gitignore` line (trimmed, leading `/` dropped) equals `file` or is `.env*` / `.env.*`. `SECRET_NAME` exported. The error for a bad name: `Use letters, digits and _; a secret is UPPER_SNAKE_CASE.`

`src/project/index.ts` re-exports all of the above. `package.json` `exports`:

```json
    "./project": {
      "types": "./dist/project/index.d.ts",
      "default": "./dist/project/index.js"
    },
```

- [ ] **Step 5:** `npm test`, `npx tsc --noEmit -p .`, `npm run build` (the export resolves) → pass.
- [ ] **Step 6: Commit** `feat: write variables and secrets into the project (/project)`.

### Task 4: Normaliser — toolbar observations

**Files:**

- Modify: `src/recorder/normalise.ts`
- Test: `src/recorder/normalise.test.ts`

**Interfaces:**

- Produces: `Observation` gains
  `| { type: "expect"; locator: LocatorSpec; not: boolean; expectation: Expectation }`
  `| { type: "insert"; locator: LocatorSpec; value: { kind: "env" | "secret"; name: string } }`
  `| { type: "wait-idle" } | { type: "wait-time"; ms: number }`
  `| { type: "screenshot"; name: string; fullPage: boolean }`
  `| { type: "goto"; url: string }`;
  exported `expectationFor(text: string, value: string | undefined): Expectation` (today private).

- [ ] **Step 1: Failing tests** (append to `normalise.test.ts`, using its existing helpers for locators):

```ts
describe("toolbar observations", () => {
  const field = {
    chain: [{ method: "getByLabel", text: "Email" }],
    fallbacks: [],
  } as LocatorSpec;
  it("each becomes its step", () => {
    const n = new Normaliser({ at: 0, baseURL: "https://app.test" });
    const steps = [
      ...n.observe(
        {
          type: "expect",
          locator: field,
          not: true,
          expectation: { matcher: "toBeVisible" },
        },
        1,
      ),
      ...n.observe(
        {
          type: "insert",
          locator: field,
          value: { kind: "env", name: "testUser" },
        },
        2,
      ),
      ...n.observe({ type: "wait-idle" }, 3),
      ...n.observe({ type: "wait-time", ms: 2000 }, 4),
      ...n.observe({ type: "screenshot", name: "x", fullPage: true }, 5),
      ...n.observe({ type: "goto", url: "https://app.test/admin" }, 6),
    ].map((e) => e.step);
    assert.deepEqual(steps, [
      {
        kind: "expect",
        locator: field,
        not: true,
        expectation: { matcher: "toBeVisible" },
      },
      {
        kind: "fill",
        locator: field,
        value: { kind: "env", name: "testUser" },
      },
      { kind: "waitForNetworkIdle" },
      { kind: "waitForTimeout", ms: 2000 },
      { kind: "screenshot", name: "x", fullPage: true },
      { kind: "goto", url: "/admin" },
    ]);
  });

  it("a toolbar step closes the fill being typed: typing afterwards is a new fill (Review Focus 3)", () => {
    const n = new Normaliser({ at: 0 });
    n.observe({ type: "input", key: "k", locator: field, value: "a" }, 1);
    n.observe({ type: "wait-time", ms: 100 }, 2);
    const [event] = n.observe(
      { type: "input", key: "k", locator: field, value: "ab" },
      3,
    );
    assert.equal(event!.op, "insert");
    assert.equal(event!.index, 2);
  });

  it("an insert replaces nothing and is followed by nothing", () => {
    const n = new Normaliser({ at: 0 });
    const events = n.observe(
      { type: "insert", locator: field, value: { kind: "secret", name: "PW" } },
      1,
    );
    assert.deepEqual(
      events.map((e) => e.op),
      ["insert"],
    );
  });
});
```

- [ ] **Step 2:** `npm test` → fails.
- [ ] **Step 3: Implement.** Export `expectationFor`. At the top of `observe`, before the existing branches:

```ts
const fromToolbar = this.toolbarStep(observation);
if (fromToolbar) {
  this.lastFill = undefined;
  return [this.insert(fromToolbar)];
}
```

with

```ts
  /** Steps the toolbar asks for directly; undefined for page observations */
  private toolbarStep(observation: Observation): Step | undefined {
    switch (observation.type) {
      case "expect":
        return { kind: "expect", locator: observation.locator, not: observation.not, expectation: observation.expectation };
      case "insert":
        return { kind: "fill", locator: observation.locator, value: observation.value };
      case "wait-idle":
        return { kind: "waitForNetworkIdle" };
      case "wait-time":
        return { kind: "waitForTimeout", ms: observation.ms };
      case "screenshot":
        return { kind: "screenshot", name: observation.name, fullPage: observation.fullPage };
      case "goto":
        return { kind: "goto", url: this.relative(observation.url) };
      default:
        return undefined;
    }
  }
```

The remaining code narrows `observation` to the page types; if TypeScript needs it, add `if (observation.type !== "input") return [];` before building the fill. Toolbar steps leave `lastAction` alone: whether a navigation counts as the result of an action depends only on page actions, as today.

- [ ] **Step 4:** `npm test`, `npx tsc --noEmit -p .` → pass.
- [ ] **Step 5: Commit** `feat: the normaliser turns toolbar observations into steps`.

### Task 5: Shared candidates; capture ignores the toolbar and can be muted

**Files:**

- Create: `src/recorder/candidates.ts`
- Modify: `src/recorder/capture.ts`, `src/recorder/recorder.ts` (mute helpers)
- Test: `src/recorder/capture.test.ts`, `src/recorder/recorder.browser-test.ts`

**Interfaces:**

- Produces: `CANDIDATES_JS: string` (function declarations, no wrapper: `norm`, `textOf`, `roleOf`, `labelTexts`, `nameOf`, `plain`, `xpathOf`, `candidatesOf`, `isTextEntry`, `INTERACTIVE`, `interactiveAt`, and `TOOLBAR_TAG = "SAMURAI-RECORDER-TOOLBAR"`, `inToolbar(event)`); `CAPTURE_MUTE: string` and `CAPTURE_UNMUTE: string` (function declarations run in the page realm); `Recorder.mute(): Promise<void>`, `Recorder.unmute(): Promise<void>` (`@internal`).

- [ ] **Step 1: Failing tests.** `capture.test.ts`: `assert.match(CAPTURE_SOURCE, /inToolbar\(event\)/)`, and that `CAPTURE_SOURCE` and `CANDIDATES_JS` both parse (building a function from each with `new Function` does not throw). Browser test (in `recorder.browser-test.ts`): a page containing `<samurai-recorder-toolbar><button id="t">t</button></samurai-recorder-toolbar><button id="b">b</button>` — clicking `#t` records nothing, clicking `#b` records one click; after `recorder.mute()` clicking `#b` records nothing; after `unmute()` it records again.
- [ ] **Step 2:** `npm test`, `npm run test:browser` → new tests fail.
- [ ] **Step 3: Implement.** Move the helper functions out of `CAPTURE_SOURCE` into `CANDIDATES_JS` verbatim (same names), plus:

```js
const TOOLBAR_TAG = "SAMURAI-RECORDER-TOOLBAR";
const inToolbar = (event) =>
  event.composedPath().some((node) => node && node.tagName === TOOLBAR_TAG);
```

`CAPTURE_SOURCE` becomes ``String.raw`(send) => { ${CANDIDATES_JS} … }` `` with the rest unchanged, plus `const MUTED = Symbol.for("samurai.recorder.muted");`, `const off = () => window[OFF] === true || window[MUTED] === true;`, and `if (inToolbar(event)) return;` as the first check in the click, input and keydown listeners. `CAPTURE_MUTE = '() => { window[Symbol.for("samurai.recorder.muted")] = true; }'`, `CAPTURE_UNMUTE` sets `false`. `Recorder.mute()`/`unmute()` run them with `runInLoadedContexts(this.connector, { source, contexts: [this.context], onRunError: "log" })`. A new document starts unmuted; the controller re-mutes after a load while paused (Task 7).

- [ ] **Step 4:** `npm test`, `npm run test:browser` (the whole recorder suite must still pass: candidates are unchanged), `npx tsc --noEmit -p .` → pass.
- [ ] **Step 5: Commit** `refactor: share element candidates; capture ignores the toolbar and can be muted`.

### Task 6: The toolbar script (view)

**Files:**

- Create: `src/recorder/toolbar/protocol.ts`, `src/recorder/toolbar/source.ts`, `src/recorder/toolbar/styles.ts`, `src/recorder/toolbar/toolbar.browser-test.ts`, `src/recorder/toolbar/source.test.ts`

**Interfaces:**

- Produces (`protocol.ts`):

```ts
import type { LocatorCall } from "../../steps/model.js";

export const TOOLBAR_SANDBOX = "samurai-toolbar";
export const TOOLBAR_KEY = "samurai.toolbar";

export type MatcherChoice =
  | "toBeVisible"
  | "toHaveText"
  | "toContainText"
  | "toHaveValue"
  | "toHaveAttribute"
  | "toHaveCount";

/** What the toolbar draws; secrets are names only */
export interface ToolbarState {
  status: "recording" | "paused";
  collapsed: boolean;
  /** Top-left corner in CSS pixels; null = the default spot (top right, 12 px in) */
  position: { x: number; y: number } | null;
  steps: number;
  environment: string;
  /** False when the config has no `environments` */
  canAddVariables: boolean;
  variables: { name: string; value: string }[];
  secrets: { name: string; set: boolean }[];
  /** Whether `.env.<environment>` is git-ignored */
  secretsIgnored: boolean;
  /** Ask "Add a step that opens this page?" */
  resumeQuestion: boolean;
  /** Prefill for the Screenshot panel: `screenshot-<n>` */
  nextScreenshot: string;
  /** Shown once per id */
  toast?: { id: number; text: string };
}

/** Element-carrying messages send the element itself (it arrives as a handle) and its candidates */
export type ToolbarMessage = { type: "toolbar" } & (
  | { action: "ready" }
  | { action: "pause" }
  | { action: "resume" }
  | { action: "resume-goto"; add: boolean }
  | { action: "stop" }
  | { action: "move"; x: number; y: number }
  | { action: "collapse"; collapsed: boolean }
  | { action: "pick"; id: number; target: unknown; candidates: LocatorCall[] }
  | {
      action: "assert";
      id: number;
      target: unknown;
      candidates: LocatorCall[];
      matcher: MatcherChoice;
      expected?: string;
      attribute?: string;
      countIndex?: number;
      not: boolean;
    }
  | {
      action: "insert";
      id: number;
      target: unknown;
      candidates: LocatorCall[];
      kind: "env" | "secret";
      name: string;
    }
  | {
      action: "add-insertable";
      id: number;
      target: unknown;
      candidates: LocatorCall[];
      kind: "env" | "secret";
      name: string;
      value: string;
    }
  | { action: "wait"; kind: "idle" }
  | { action: "wait"; kind: "time"; ms: number }
  | { action: "screenshot"; name: string; fullPage: boolean }
);

/** The answer to `pick` */
export type PickInfo =
  | {
      ok: true;
      label: string;
      text: string;
      value?: string;
      attributes: { name: string; value: string }[];
      first: { matcher: MatcherChoice; expected?: string };
      counts: { label: string; count: number }[];
    }
  | { ok: false; error: string };

/** The answer to `insert`, `add-insertable` and `assert` */
export type ActionReply =
  { ok: true } | { ok: false; error: string; field?: "name" };
```

- `source.ts`: `TOOLBAR_SOURCE: string` — a function declaration `(send) => { … }` run as a preload script in the sandbox, top-level only. It sets `globalThis[Symbol.for(TOOLBAR_KEY)] = { update(state), reply(id, result) }` and calls `send({ type: "toolbar", action: "ready" })` once the host is attached.
- `styles.ts`: `TOOLBAR_CSS: string` (the mockups' rail, chip, panel, toast styles, scoped to the shadow root, starting with `:host { all: initial; }`).

- [ ] **Step 1: Failing tests.** `source.test.ts`: `TOOLBAR_SOURCE` parses as a function (`new Function`), contains `attachShadow({ mode: "closed" })` and `TOOLBAR_SANDBOX`-independent text (the sandbox name is passed by the caller). Browser test `toolbar.browser-test.ts` (launch like `recorder.browser-test.ts`, port 9242): register the preload with `addPreload(connector, { source: TOOLBAR_SOURCE, sandbox: TOOLBAR_SANDBOX, contexts: [context], arguments: [new ChannelArg(channel)] })`, listen for `script.message` on `channel`, then:
  1. `ready` arrives; the page has one `samurai-recorder-toolbar` element; page-realm `document.querySelector("samurai-recorder-toolbar").shadowRoot` is `null` (closed).
  2. **Review Focus 1:** load a page whose inline script first does `Element.prototype.attachShadow = () => { throw new Error("nope"); }; EventTarget.prototype.addEventListener = () => {}; JSON.stringify = () => "x";` → `ready` still arrives and a click on the rail's Pause (by coordinates from the host's bounding box plus the known rail layout, or via a `data-action` lookup done with `callFunction` in the sandbox) sends `{ action: "pause" }`.
  3. `update(state)` (called with `callFunction` in the sandbox) with `status: "paused"` makes Assert/Insert/Wait/Screenshot disabled (check via a sandbox `callFunction` that reads the shadow root kept on the sandbox global).
  4. **Review Focus 5 (view half):** with the Wait panel open, two quick clicks on Add send one `wait` message (Add is disabled after the first press until the next `update`).
  5. Position clamping: `update` with `position: { x: 5000, y: 5000 }` puts the rail fully inside the viewport; after `browsingContext.setViewport` to 600×400 it is still inside.
- [ ] **Step 2:** run → fails.
- [ ] **Step 3: Implement the view** following the mockups and the spec's "The toolbar" section exactly (texts in Global Constraints):
  - Host: `document.createElement("samurai-recorder-toolbar")`, appended to `document.documentElement` (re-append on `DOMContentLoaded` if the page replaced the root); `host.attachShadow({ mode: "closed" })`; keep the root on the sandbox global for tests (`globalThis[Symbol.for(TOOLBAR_KEY)].root`). Capture native functions at script start (`const attach = Element.prototype.attachShadow` … ) is unnecessary in the sandbox — the sandbox has its own prototypes; do not add workarounds.
  - Rail rows, chip, paused note, toast, resume question (`Add a step that opens this page?` with Yes/No → `resume-goto`).
  - Drag: pointerdown on the grip, pointermove updates the position live, pointerup sends `move { x, y }`. Clamp to `[0, innerWidth - width] × [0, innerHeight - height]` on every update and on `resize`.
  - Collapse/expand sends `collapse`.
  - Assert: sets picking mode; a `window` capture-phase `pointerover` outlines the element under the pointer (outline drawn as an absolutely positioned div inside the shadow root, not on the page element); a `window` capture-phase `click` (fires before the capture script's `document` listener) calls `event.preventDefault()` and `event.stopImmediatePropagation()`, leaves picking mode and sends `pick { id, target, candidates }` (candidates from `CANDIDATES_JS`, interpolated into the source like the capture script does). Esc cancels. The reply fills the panel: matcher buttons, value input (prefilled from `first`), attribute select (Has attribute), count select (Count, from `counts`), Not checkbox, Add → `assert`. `{ ok: false }` shows its `error` and no Add.
  - Insert: `focusin` on `document` (capture) remembers the last focused element that `isTextEntry` accepts and is not in the toolbar. Insert with none shows "Click into a field first". Otherwise the list (filter, Variables with values, Secrets with `••••••` or "not set", "+ Add variable", "+ Add secret"; filter text in the add labels as in the mockup). Picking sends `insert`; a "not set" secret opens the New secret form. New variable/secret form: Variable/Secret switch, Name (prefill: filter text, else the field's label/name/id → camelCase for a variable, UPPER_SNAKE for a secret), "Value in `<env>`", hints/warning from `canAddVariables` and `secretsIgnored`; "Save and insert" → `add-insertable`; an `{ ok: false, field: "name" }` reply shows the error under Name. With `canAddVariables: false` the Variable side shows "This recording has no environment" and no Save.
  - Wait: two radios, seconds input (0.1–60, default 2), Add → `wait`.
  - Screenshot: name (prefilled from `state.nextScreenshot`), Visible part / Whole page, Add → `screenshot`.
  - Every panel: Esc or a click outside closes it; Add disables until the next `update` or `reply`.
  - While `status === "paused"`: picking is off, panels close, tools disabled.
- [ ] **Step 4:** `npm test`, `npm run test:browser -- src/recorder/toolbar/toolbar.browser-test.ts`, `npx tsc --noEmit -p .` → pass.
- [ ] **Step 5: Commit** `feat: the recorder toolbar view (sandboxed, shadow DOM)`.

(Task 7's controller fills `nextScreenshot`.)

### Task 7: ToolbarController and the recorder

**Files:**

- Create: `src/recorder/toolbar/controller.ts`, `src/recorder/toolbar/controller.test.ts`, `src/recorder/toolbar/inspect.ts`, `src/recorder/toolbar/recorder-toolbar.browser-test.ts`
- Modify: `src/recorder/recorder.ts`, `src/recorder/index.ts` (export the new option types)

**Interfaces:**

- Consumes: Tasks 3–6.
- Produces:

```ts
export interface ControllerDeps {
  /** Sends the state to every loaded top-level document's toolbar */
  push(state: ToolbarState): void;
  reply(id: number, result: PickInfo | ActionReply): void;
  currentUrl(): Promise<string>;
  rank(
    target: ElementHandle,
    candidates: LocatorCall[],
  ): Promise<LocatorSpec | undefined>;
  inspect(
    target: ElementHandle,
    locator: LocatorSpec,
    candidates: LocatorCall[],
  ): Promise<PickInfo & { ok: true }>;
  /** Types into the field with capture muted */
  type(locator: LocatorSpec, value: string): Promise<void>;
  mute(): Promise<void>;
  unmute(): Promise<void>;
  addVariable(name: string, value: string): Promise<void>;
  setSecret(name: string, value: string): Promise<void>;
  observe(observation: Observation): void;
  stop(): void;
  onStatus(status: { state: "recording" | "paused"; toolbar: boolean }): void;
}

export interface ControllerOptions {
  environment: string;
  canAddVariables: boolean;
  variables: Record<string, string | number | boolean>;
  /** Name → value; undefined when not set */
  secrets: Record<string, string | undefined>;
  secretsIgnored: boolean;
  /** Screenshot steps already in the test, for the default name */
  screenshots: number;
}

export class ToolbarController {
  constructor(deps: ControllerDeps, options: ControllerOptions);
  readonly paused: boolean;
  handle(message: ToolbarMessage & { target?: ElementHandle }): Promise<void>;
  /** A top-level document finished loading: push state; start the 2 s ready watchdog */
  loaded(): void;
  /** A step was emitted (any source): count it */
  stepAdded(step: Step): void;
}
```

`RecorderOptions` gains `toolbar?: ControllerOptions & { projectDir: string; onStatus?: ControllerDeps["onStatus"]; onStop?: () => void }`. Without `toolbar`, the recorder behaves exactly as today (no toolbar script), so `page.record()` users are unaffected.

- [ ] **Step 1: Failing controller unit tests** (`controller.test.ts`, fakes for every dep; the fake `push` records every state):
  - pause → `mute` called, state `paused`, `onStatus({ state: "paused", toolbar: true })`; while paused `handle(insert)` does nothing.
  - resume on the same URL → no question; resume after `currentUrl` changed → state `resumeQuestion: true`; `resume-goto { add: true }` → `observe({ type: "goto", url })`; `{ add: false }` → nothing.
  - insert env → `type(locator, "dev@example.com")` then `observe({ type: "insert", … value: { kind: "env", name: "testUser" } })`, reply `{ ok: true }`; `type` throwing → reply `{ ok: false, error: "Couldn't type into that field" }`, no observe.
  - insert of a secret that is not set → reply `{ ok: false, error: … }` is NOT used; the view opens the form itself — the controller rejects it with `{ ok: false, error: "Set a value for X first" }` (defensive).
  - add-insertable variable → `addVariable` then insert; state now lists it; `addVariable` throwing `already exists` → `{ ok: false, error, field: "name" }`; with `canAddVariables: false` → `{ ok: false, error: "This recording has no environment" }`.
  - add-insertable secret → `setSecret`, state lists `{ name, set: true }`, the typed value is the given one.
  - **Review Focus 4:** after every action above, `JSON.stringify(everyPushedState)` and every reply never contain any secret value.
  - **Review Focus 5:** two `assert` messages with the same `id` while the first is in flight → one `observe`.
  - wait idle/time, screenshot → observe + toast "Wait step added" / "Screenshot step added"; `nextScreenshot` goes `screenshot-1` → `screenshot-2` after a screenshot step (and starts at `screenshots + 1`).
  - stop → `deps.stop()`.
  - `loaded()` with no `ready` within 2 s (use `node:test` mock timers) → `onStatus({ …, toolbar: false })`; a later `ready` → `toolbar: true`.
  - **Review Focus 2:** `loaded()` while a pick is pending → the pending pick is dropped (its late reply is not sent), and the state is pushed.
- [ ] **Step 2:** `npm test` → fails.
- [ ] **Step 3: Implement** `controller.ts` against `ControllerDeps` (no BiDi in it). `inspect.ts` implements `deps.inspect`: label = `describe(locator.chain[0])` (role + name, `label "…"`, `text "…"`, test id, css), `text`/`value` via `callFunction` on the element (`el => ({ text: el.textContent, value: typeof el.value === "string" ? el.value : undefined, attributes: [...el.attributes].slice(0, 20).map(a => ({ name: a.name, value: a.value })) })`), `first` via `expectationFor` (`toHaveText`/`toContainText` expected is the 100-character rule's text), `counts`: from `candidates`, for the element's role without a name (`{ method: "getByRole", role }`) and `tag.class1.class2` CSS (only when it has classes), keep those whose `locatorFromSpec(page, …).count()` is > 1, at most 3, as `{ label, count }`; keep the calls on the controller's pending pick so `assert { countIndex }` maps back. Assert → `observe({ type: "expect", locator, not, expectation })` where `expectation` is built from `matcher`/`expected`/`attribute` (`toHaveCount` uses `{ chain: [countCall], fallbacks: [] }` as the locator and `Number(expected)`).
      In `recorder.ts`, when `options.toolbar` is set: register `TOOLBAR_SOURCE` as a second preload (`sandbox: TOOLBAR_SANDBOX`, same channel, top-level context only); route `script.message` with `type: "toolbar"` to `controller.handle` (others as today); subscribe to `browsingContext.load` for the context → `controller.loaded()` and, while paused, `mute()`; implement `push`/`reply` with `callFunction(connector, context, "(s) => globalThis[Symbol.for(\"samurai.toolbar\")]?.update(s)", [state], { sandbox: TOOLBAR_SANDBOX, awaitPromise: false })` (errors logged at debug: a document between loads has no toolbar yet); `type` = `mute` → `locatorFromSpec(page, locator).fill(value)` → `unmute`; `emit` also calls `controller.stepAdded`. `stop()` disposes the toolbar preload and removes the host from loaded documents (`runInLoadedContexts` in the sandbox: `() => document.querySelector("samurai-recorder-toolbar")?.remove()`).
- [ ] **Step 4: Browser tests** `recorder-toolbar.browser-test.ts` (port 9243; drive the toolbar through `callFunction` in the sandbox that dispatches the same messages the buttons send — expose `globalThis[Symbol.for(TOOLBAR_KEY)].press(action)` in the view for tests — plus one real coordinate click on Pause):
  - pause → click on a page button records nothing; navigate to a second local server's page; resume → the state asks; `resume-goto { add: true }` → a `goto` step with that URL.
  - insert `testUser` into a focused field → the field's value is the variable's value; steps end with `fill(env.testUser)`; **Review Focus 3:** the field is a controlled input (its page script replaces `value` on every `input` and re-renders the element) → exactly one `fill` step, with the reference.
  - add a variable from the panel in a temp project → `samurai.config.ts` has it, the field has the value, the step is `fill(env.adminUser)`.
  - the Assert pick of a heading → `PickInfo` `first` is `toHaveText` with the heading text; Count lists `getByRole("listitem")` with 3 for a 3-item list.
  - the toolbar state (position, collapsed) survives navigation to the second origin: after the load the view's state equals the pushed state.
  - **Review Focus 2:** start a pick, navigate, → no `expect` step, the new page's toolbar is not in picking mode.
- [ ] **Step 5:** `npm test`, `npm run test:browser`, `npx tsc --noEmit -p .` → pass.
- [ ] **Step 6: Commit** `feat: the recorder runs the toolbar: pause, assert, insert, add, wait, screenshot, stop`.

### Task 8: recordSpec and the CLI

**Files:**

- Modify: `src/recorder/session.ts`, `src/cli/main.ts` (or the file that implements `samurai record`; find it with `git grep -n "recordSpec(" src/cli`)
- Test: `src/recorder/session.test.ts`, `src/recorder/session.browser-test.ts`

**Interfaces:**

- Produces: `RecordSpecOptions.onStatus?: (status: { state: "recording" | "paused"; toolbar: boolean }) => void`; `RecordResult.secrets` includes secrets added from the panel; toolbar Stop resolves `recordSpec`.

- [ ] **Step 1: Failing tests.** `session.test.ts` (pure): a helper `toolbarOptions(run, specSource, projectDir)` returns the controller options: `environment`; `canAddVariables` (the config has `environments`); `variables` (`settings.variables`); `secrets` (the names in `run.secrets` plus the `secrets.X` names the spec source reads via `parseSpec`, with values from `run.secrets` or undefined); `secretsIgnored`; `screenshots` (the number of screenshot steps in the test). Browser test: `recordSpec({ …, headless: true, onStarted })` where `onStarted` sends a toolbar `stop` through the sandbox → `recordSpec` resolves with the steps so far; `onStatus` saw `{ state: "recording", toolbar: true }`.
- [ ] **Step 2:** run → fails.
- [ ] **Step 3: Implement.** In `recordSpec`, build `toolbar: { ...toolbarOptions(...), projectDir: projectDir(), onStatus: options.onStatus, onStop: () => resolveStop() }` for `page.record`; the wait promise also resolves on `onStop`. `addVariable`/`setSecret` from `../project/index.js` are bound to `projectDir()` and the environment; after `setSecret` the name is added to the result's `secrets`. The CLI prints `Paused` / `Recording` lines on status changes (only when stdout is a TTY or always — always, they are short) and `The toolbar couldn't load on this page. Alt+click still records assertions.` once per `toolbar: false`.
- [ ] **Step 4:** `npm test`, `npm run test:browser`, `npm run test:cli`, `npx tsc --noEmit -p .` → pass.
- [ ] **Step 5: Commit** `feat: recordSpec runs the toolbar and reports its status`.

### Task 9: Docs, version 0.7.0, verification

**Files:**

- Modify: `docs/recorder.md` (toolbar section replacing "The UI itself … is not built yet", steps table rows for `waitForTimeout` and `screenshot`, the Insert/add behaviour, pause, Limits), `docs/pages-and-browsers.md` (`waitForTimeout`, `screenshot({ name })`), `docs/running-and-reports.md` (`screenshots` in report entries and the folder layout), `docs/embedding.md` (`/project`, `onStatus`), `docs/roadmap.md` (recorder toolbar shipped), `README.md` if it lists features, `package.json` (`"version": "0.7.0"`), `bun.lock` if the version appears.

- [ ] **Step 1:** Write the docs in the existing style (short sentences, tables like the existing ones). Upgrading note: "0.7 adds the recorder toolbar; specs written by 0.6 still parse; 0.6 reads the new steps as custom code."
- [ ] **Step 2:** `npm test && npm run test:cli && npm run test:browser && npx tsc --noEmit -p . && npm run build` → all green. Record the counts.
- [ ] **Step 3: Commit** `docs: the recorder toolbar; 0.7.0`. Do not push; the controller pushes and opens the PR after the whole-branch review, then waits for the user to merge and publish 0.7.0.

---

## Part 2 — App (repo `samurai`)

Start only after `npm view @itmetsam/samurai-framework version` prints `0.7.0`. Branch: `feat/recorder-toolbar` from `origin/main`.

### Task 10: Bump, record status end to end

**Files:**

- Modify: `package.json`, `bun.lock`, `src/shared/engine.ts`, `src/shared/specs.ts`, `src/engine/index.ts`, `src/main/engine/client.ts`, `src/main/record/service.ts`, `src/preload/index.ts`, `src/renderer/src/types/api.d.ts`
- Test: `src/main/record/status.test.ts`

**Interfaces:**

- Produces: `EngineMessage` gains `{ type: "record-status"; id: number; state: "recording" | "paused"; toolbar: boolean }`; `Engine.request` option `onStatus?(status: { state; toolbar })`; `RecordStatus { projectId: string; state: "recording" | "paused"; toolbar: boolean }` in `src/shared/specs.ts`; push channel `record:status`; `window.api.onRecordStatus(cb) → unsubscribe`.

- [ ] **Step 1:** `bun add @itmetsam/samurai-framework@^0.7.0`.
- [ ] **Step 2: Failing test** `status.test.ts`: extract the record service's message handling into a pure function `statusUpdate(projectId, message): RecordStatus | undefined` and test it maps a `record-status` message and ignores others.
- [ ] **Step 3: Implement.** Engine `record()`: pass `onStatus: (s) => send({ type: "record-status", id, ...s })` to `recordSpec` (frameworks before 0.7 ignore the unknown option). Client: route `record-status` to `entry.onStatus` like `record-source`. Record service: `onStatus` broadcasts `record:status` to every window. Preload/api: `onRecordStatus`.
- [ ] **Step 4:** `bun test`, `npx tsc --noEmit -p .` → pass.
- [ ] **Step 5: Commit** `feat: framework 0.7.0; the app hears when a recording is paused and whether its toolbar loaded`.

### Task 11: Editor — status, new steps

**Files:**

- Modify: `src/renderer/src/pages/project/layout/index.tsx` (keep `recordStatus` per project from `onRecordStatus`, reset on `record:done`), `src/renderer/src/context/context.ts` (`recordStatus?: RecordStatus`), `src/renderer/src/pages/project/test-editor/components/live-browser.tsx`, `src/renderer/src/pages/project/test-editor/components/record-control.tsx` (Paused pill), `src/renderer/src/lib/steps.ts`, `src/renderer/src/pages/project/test-editor/components/step-edit-dialog.tsx` (`stepFields`), `src/renderer/src/pages/project/test-editor/components/inspector.tsx`, `src/renderer/src/pages/project/test-editor/components/add-step-bar.tsx`
- Test: `src/renderer/src/lib/steps.test.ts` (create if missing)

- [ ] **Step 1: Failing tests** for `describeStep`, `stepRowProps` and `isEditable`:

```ts
expect(describeStep({ kind: "waitForTimeout", ms: 2000 })).toEqual({
  icon: "timer",
  title: "Wait 2 s",
});
expect(describeStep({ kind: "waitForTimeout", ms: 1500 }).title).toBe(
  "Wait 1.5 s",
);
expect(
  describeStep({ kind: "screenshot", name: "home", fullPage: true }),
).toEqual({ icon: "camera", title: "Screenshot “home”", detail: "whole page" });
expect(
  stepRowProps({ kind: "screenshot", name: "home", fullPage: false }),
).toEqual({ action: "screenshot", title: "Screenshot", target: "home" });
expect(isEditable({ kind: "waitForTimeout", ms: 1 })).toBe(true);
expect(isEditable({ kind: "screenshot", name: "a", fullPage: false })).toBe(
  true,
);
```

(Use an icon name the components' `IconName` has: check `node_modules/@itmetsam/samurai-components` for `camera`/`image`; adjust the expectation to the real name.)

- [ ] **Step 2:** `bun test` → fails.
- [ ] **Step 3: Implement.** `lib/steps.ts` cases above (seconds shown with up to one decimal). `stepFields`: Wait → a number input "Seconds" (0.1–60, step 0.1) writing `ms = Math.round(seconds * 1000)`; Screenshot → "Name" text input and a "Whole page" checkbox. Inspector heading for these: "Wait" / "Screenshot". Add-step bar: "Wait for a time" (adds `{ kind: "waitForTimeout", ms: 2000 }`) and "Screenshot" (adds `{ kind: "screenshot", name: "screenshot-<n>", fullPage: false }`, n = screenshot steps in the test + 1). Live browser while recording: title "Recording in the browser window" with Stop; paused → "Paused in the browser window"; `toolbar: false` → the notice text. Record control: the Paused pill (`StatusDot tone="warning"`, no pulse, "Paused"), the timer frozen while paused.
- [ ] **Step 4:** `bun test`, `npx tsc --noEmit -p .`, `npx electron-vite build` → pass.
- [ ] **Step 5: Commit** `feat: the editor shows a paused recording and edits waits and screenshots`.

### Task 12: Run detail — screenshots

**Files:**

- Create: `src/main/runs/screenshots.ts`, `src/main/runs/screenshots.test.ts`
- Modify: `src/shared/runs.ts` (`RunTest.screenshots?: { name: string; file: string }[]`), `src/main/runs/service.ts` (on `test-end` copy), `src/main/runs/store.ts` (prune folders of dropped runs), `src/main/utils/ipc.ts` (`runs:screenshot`), `src/preload/index.ts`, `src/renderer/src/types/api.d.ts`, `src/renderer/src/pages/project/runs/detail/components/artifacts.tsx`, `src/renderer/src/pages/project/runs/detail/index.tsx`

**Interfaces:**

- Produces: `copyScreenshots(resultDir: string, runDir: string, shots: { name: string; path: string }[]): { name: string; file: string }[]` (sync; skips missing files; `file` relative to `runDir`); `screenshotsDir(projectId: string, runId: string): string` = `<userData>/runs/<projectId>/<runId>`; `readScreenshot(projectId, runId, file): string | undefined` returns a `data:image/png;base64,…` URL, or undefined when the path escapes the run folder or the file is gone; IPC `runs:screenshot(projectId, runId, file)`; `window.api.runScreenshot(projectId, runId, file)`.

- [ ] **Step 1: Failing tests** (temp dirs): `copyScreenshots` copies two files into `runDir` as `1-home.png`, `2-home-2.png` and returns them; a missing source is skipped; `readScreenshot` refuses `../x.png` and an absolute path, returns a data URL for a copied file. Store: saving the 201st run removes the folder of the dropped run (inject the folder root for the test).
- [ ] **Step 2:** `bun test` → fails.
- [ ] **Step 3: Implement.** The result dir is `<project.path>/result` (the app runs with the default report path). `service.ts` `test-end`: `if ("screenshots" in result && result.screenshots?.length) test.screenshots = copyScreenshots(resultDir, screenshotsDir(projectId, run.id), result.screenshots)`. Artifacts: the Screenshot tab lists the selected test's screenshots (thumbnail `<img>` from `runScreenshot`, the name under it; click opens a dialog with the full image); no screenshots → today's empty state, retitled "No screenshots in this test" with "Add a Screenshot step to save one." DOM snapshot and Video tabs unchanged.
- [ ] **Step 4:** `bun test`, `npx tsc --noEmit -p .`, `npx electron-vite build` → pass.
- [ ] **Step 5: Commit** `feat: run detail shows each test's screenshots`.

### Task 13: Docs, verification, PR

**Files:**

- Modify: `docs/screens/test-editor.md` (drop the "project B target" notes for the shipped wording; Paused state; toolbar notice; Wait/Screenshot step rows), `docs/screens/run-detail.md` (Screenshot tab)

- [ ] **Step 1:** Update the docs to match the shipped code (read the components; quote real strings).
- [ ] **Step 2:** `bun test && npx tsc --noEmit -p . && npx electron-vite build` → green.
- [ ] **Step 3:** Ask the user before bumping their test project (`/Users/samdegroot/dev/samurai-tests/samurai-test-project`) to `^0.7.0`.
- [ ] **Step 4: Commit** `docs: the editor's recording states and run screenshots`, push `feat/recorder-toolbar`, open the PR (body: what the user sees, framework 0.7 requirement, a manual test plan: record a sign-in using every tool, including adding a missing variable and secret; pause, navigate, resume and answer the question; collapse and drag the rail; run the test and open its screenshots; ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`).
